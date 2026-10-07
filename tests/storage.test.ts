import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RoadmapStore } from '../src/storage.js';
async function fixture() { const dir = await mkdtemp(join(tmpdir(), 'tasklens-storage-')); const store = new RoadmapStore(dir, 's'); await store.initialize(); return { dir, store,
  async clean() { assert(resolve(dir).startsWith(resolve(tmpdir()) + '\\tasklens-storage-') || resolve(dir).startsWith(resolve(tmpdir()) + '/tasklens-storage-')); await rm(dir, { recursive: true, force: true }); } }; }
test('超过 40 个历史提交仍可逐版本恢复', async () => { const f = await fixture(); try {
  for (let i = 1; i <= 45; i++) { const state = structuredClone(f.store.state); state.callsTotal = i; await f.store.commit(state, i - 1, String(i)); }
  const restart = new RoadmapStore(f.dir, 's'); await restart.initialize(); assert.equal(restart.state.commitVersion, 45); assert.equal((await restart.historical(1)).callsTotal, 1); assert.equal((await restart.historical(40)).callsTotal, 40);
} finally { await f.clean(); } });
test('崩溃后有效日志尾部恢复，即使 head 尚未切换', async () => { const f = await fixture(); try {
  const state = structuredClone(f.store.state); state.paused = true; await f.store.commit(state, 0, 'one'); await writeFile(join(f.store.directory, 'head.json'), '{"version":0}');
  const restart = new RoadmapStore(f.dir, 's'); await restart.initialize(); assert.equal(restart.state.commitVersion, 1); assert(restart.state.paused);
} finally { await f.clean(); } });
test('损坏日志停止在完整提交，阻止覆盖损坏段', async () => { const f = await fixture(); try {
  await f.store.commit(structuredClone(f.store.state), 0, 'one'); await writeFile(join(f.store.directory, 'changes', '0000000002.json'), '{');
  const restart = new RoadmapStore(f.dir, 's'); await restart.initialize(); assert.equal(restart.state.commitVersion, 1); assert(restart.notice?.includes('校验失败')); await assert.rejects(restart.commit(structuredClone(restart.state), 1, 'two'), /损坏/);
} finally { await f.clean(); } });
test('跨实例写入使用 CAS，过期提交不覆盖最新状态', async () => { const f = await fixture(); try {
  const other = new RoadmapStore(f.dir, 's'); await other.initialize(); const first = structuredClone(f.store.state); first.paused = true; await f.store.commit(first, 0, 'one');
  const stale = structuredClone(other.state); stale.backfillPaused = true; await assert.rejects(other.commit(stale, 0, 'stale'), /版本/); assert(other.state.paused); assert.equal(other.state.backfillPaused, false);
} finally { await f.clean(); } });
test('损坏恢复检查点改用早期日志重放', async () => { const f = await fixture(); try {
  for (let i = 0; i < 21; i++) { const state = structuredClone(f.store.state); state.callsTotal++; await f.store.commit(state, i, String(i)); }
  await writeFile(join(f.store.directory, 'checkpoints', '0000000020.json'), '{"hash":"bad"}');
  const restart = new RoadmapStore(f.dir, 's'); await restart.initialize(); assert.equal(restart.state.callsTotal, 21); assert(restart.notice?.includes('检查点'));
} finally { await f.clean(); } });
