import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { hashOf } from './sources.js';
import { emptyRoadmap, type Roadmap, type TimelineEntry, type Annotation } from './schema.js';
import type { Checkpoint } from './shared.js';

export interface SavedSession {
  schemaVersion: 2; sessionId: string; commitVersion: number;
  live: Roadmap; rebuild: Roadmap | null; rebuildTarget: string | null;
  liveFloor: number | null;
  pendingWork: { branch: 'live' | 'rebuild'; batchIds: string[]; extraSourceIds: string[]; extraNodeIds: string[]; repair: number; supplement: number; error: string | null } | null;
  history: TimelineEntry[]; annotations: Annotation[]; legacy: Checkpoint[];
  paused: boolean; backfillPaused: boolean; callsTotal: number; tokensTotal: number;
}
interface Delta { op: 'set' | 'remove' | 'append'; path: Array<string | number>; value?: unknown }
interface Transaction { version: number; parent: number; parentHash: string; key: string; delta: Delta[] }
interface Envelope<T> { hash: string; data: T }
function envelope<T>(data: T): Envelope<T> { return { hash: hashOf(JSON.stringify(data)), data }; }
function unpack<T>(raw: string): Envelope<T> {
  const value = JSON.parse(raw) as Envelope<T>;
  if (!value || typeof value.hash !== 'string' || hashOf(JSON.stringify(value.data)) !== value.hash) throw new Error('存储校验值不一致。');
  return value;
}
function diff(before: unknown, after: unknown, path: Array<string | number> = [], result: Delta[] = []): Delta[] {
  if (Object.is(before, after)) return result;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (after.length >= before.length && before.every((v, i) => JSON.stringify(v) === JSON.stringify(after[i]))) {
      if (after.length > before.length) result.push({ op: 'append', path, value: after.slice(before.length) });
    } else if (after.length === before.length) after.forEach((v, i) => diff(before[i], v, [...path, i], result));
    else result.push({ op: 'set', path, value: after });
  } else if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>;
    for (const key of Object.keys(a)) if (!(key in b)) result.push({ op: 'remove', path: [...path, key] });
    for (const key of Object.keys(b)) diff(a[key], b[key], [...path, key], result);
  } else result.push({ op: 'set', path, value: after });
  return result;
}
function applyDelta(previous: SavedSession, delta: Delta[]): SavedSession {
  const state = structuredClone(previous);
  for (const d of delta) {
    if (!d.path.length || d.path.some(p => ['__proto__', 'constructor', 'prototype'].includes(String(p)))) throw new Error('日志路径无效。');
    let target: any = state;
    for (const key of d.path.slice(0, -1)) { if (!target || typeof target !== 'object') throw new Error('日志路径缺失。'); target = target[key]; }
    const key = d.path.at(-1)!;
    if (d.op === 'remove') delete target[key];
    else if (d.op === 'append') { if (!Array.isArray(target[key]) || !Array.isArray(d.value)) throw new Error('日志数组无效。'); target[key].push(...d.value); }
    else target[key] = d.value;
  }
  return state;
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), 'utf8');
  try { await rename(temporary, path); } catch (e) { await unlink(temporary).catch(() => undefined); throw e; }
}
const fileName = (version: number) => `${String(version).padStart(10, '0')}.json`;
/** Checksummed write-ahead deltas; a valid orphan transaction is replayed after a crash. */
export class RoadmapStore {
  readonly directory: string;
  state: SavedSession;
  notice: string | null = null;
  private lastHash = ''; private corrupt = false; private writing = Promise.resolve();
  constructor(root: string, id: string) {
    this.directory = join(root, 'roadmaps', hashOf(id));
    this.state = { schemaVersion: 2, sessionId: id, commitVersion: 0, live: emptyRoadmap(id, 'initial'), rebuild: null, rebuildTarget: null, liveFloor: null, pendingWork: null,
      history: [], annotations: [], legacy: [], paused: true, backfillPaused: false, callsTotal: 0, tokensTotal: 0 };
  }
  private async lease(): Promise<() => Promise<void>> {
    await mkdir(this.directory, { recursive: true }); const path = join(this.directory, 'write.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
      try { const file = await open(path, 'wx'); await file.writeFile(JSON.stringify({ pid: process.pid, time: Date.now() })); await file.close(); return () => unlink(path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try { const lock = JSON.parse(await readFile(path, 'utf8')) as { pid: number; time: number };
          let dead = false; try { process.kill(lock.pid, 0); } catch (e) { dead = (e as NodeJS.ErrnoException).code === 'ESRCH'; }
          if (dead) { await unlink(path); continue; }
        } catch { /* An incomplete or active lease is never stolen. */ }
        throw new Error('另一实例正在写入此会话，请稍后重试。');
      }
    }
    throw new Error('会话写锁获取失败。');
  }
  async initialize(): Promise<void> {
    await mkdir(join(this.directory, 'changes'), { recursive: true }); await mkdir(join(this.directory, 'checkpoints'), { recursive: true });
    await mkdir(join(this.directory, 'sources'), { recursive: true });
    const release = await this.lease(); try { await this.restore(); } finally { await release(); }
  }
  private async restore(through = Infinity): Promise<SavedSession> {
    const checkpointFiles = (await readdir(join(this.directory, 'checkpoints'))).filter(f => /^\d{10}\.json$/.test(f) && Number(f.slice(0, -5)) <= through).sort().reverse();
    let state = this.state.commitVersion === 0 ? structuredClone(this.state) : { ...structuredClone(this.state), commitVersion: 0,
      live: emptyRoadmap(this.state.sessionId, 'initial'), rebuild: null, rebuildTarget: null, liveFloor: null, pendingWork: null, history: [], annotations: [], legacy: [], callsTotal: 0, tokensTotal: 0, paused: true, backfillPaused: false };
    let parentHash = '';
    for (const file of checkpointFiles) {
      try { const checkpoint = unpack<{ state: SavedSession; transactionHash: string }>(await readFile(join(this.directory, 'checkpoints', file), 'utf8'));
        if (checkpoint.data.state.sessionId !== state.sessionId || checkpoint.data.state.commitVersion !== Number(file.slice(0, -5))) throw new Error('检查点身份不一致。');
        state = checkpoint.data.state; parentHash = checkpoint.data.transactionHash; break;
      } catch { this.notice = '一个恢复检查点损坏，已改用较早记录重放。'; }
    }
    const files = (await readdir(join(this.directory, 'changes'))).filter(f => /^\d{10}\.json$/.test(f) && Number(f.slice(0, -5)) > state.commitVersion && Number(f.slice(0, -5)) <= through).sort();
    for (const file of files) {
      try {
        const tx = unpack<Transaction>(await readFile(join(this.directory, 'changes', file), 'utf8'));
        if (tx.data.version !== state.commitVersion + 1 || tx.data.parent !== state.commitVersion || tx.data.parentHash !== parentHash) throw new Error('变更日志存在缺口。');
        state = applyDelta(state, tx.data.delta);
        if (state.commitVersion !== tx.data.version || state.sessionId !== this.state.sessionId) throw new Error('提交身份不一致。');
        parentHash = tx.hash;
      } catch {
        if (through === Infinity) this.corrupt = true;
        this.notice = '变更日志校验失败，已恢复最近完整提交。损坏范围保留供检查。'; break;
      }
    }
    if (through === Infinity) {
      this.state = state; this.lastHash = parentHash;
      await atomicJson(join(this.directory, 'head.json'), { schemaVersion: 2, version: state.commitVersion, hash: parentHash });
    }
    return state;
  }
  async commit(next: SavedSession, expected: number, key: string): Promise<SavedSession> {
    let result!: SavedSession;
    const task = this.writing.catch(() => undefined).then(async () => {
      const release = await this.lease();
      try {
        await this.restore();
        if (this.corrupt) throw new Error('本地日志存在损坏，当前完整版本已保留；请修复存储后继续。');
        if (this.state.commitVersion !== expected) throw new Error('会话版本已变化，本次更新等待重新分析。');
        const version = expected + 1; const committed = { ...next, commitVersion: version };
        const tx = envelope<Transaction>({ version, parent: expected, parentHash: this.lastHash, key, delta: diff(this.state, committed) });
        const path = join(this.directory, 'changes', fileName(version));
        // fsync the durable transaction before moving the head pointer.
        const file = await open(path, 'wx'); try { await file.writeFile(JSON.stringify(tx)); await file.sync(); } finally { await file.close(); }
        this.state = committed; this.lastHash = tx.hash; result = committed;
        if (version % 20 === 0) await atomicJson(join(this.directory, 'checkpoints', fileName(version)), envelope({ state: committed, transactionHash: tx.hash }));
        await atomicJson(join(this.directory, 'head.json'), { schemaVersion: 2, version, hash: tx.hash });
      } finally { await release(); }
    });
    this.writing = task; await task; return result;
  }
  async historical(commit: number): Promise<SavedSession> {
    if (!Number.isSafeInteger(commit) || commit < 1 || commit > this.state.commitVersion) throw new Error('历史版本无效。');
    const state = await this.restore(commit);
    if (state.commitVersion !== commit) throw new Error('该历史版本存在日志缺口。');
    return state;
  }
  async cacheSources(sources: import('./schema.js').PublicSource[]): Promise<void> {
    await Promise.all(sources.map(s => atomicJson(join(this.directory, 'sources', `${s.id}-${s.hash}.json`), s)));
  }
  async cachedSource(id: string, hash: string): Promise<import('./schema.js').PublicSource | null> {
    if (!/^s-\d+-\d+$/.test(id) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('来源标识无效。');
    try { return JSON.parse(await readFile(join(this.directory, 'sources', `${id}-${hash}.json`), 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
}
