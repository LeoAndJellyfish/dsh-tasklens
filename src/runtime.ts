import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import type { SessionId } from '@deepseek-ai/dsh-session';
import { contextFor, projectActivity, PRIORITY_EVENTS, canCall, clipped, type ObservedEvent } from './core.js';
import { parseBriefing, promptFor } from './briefing.js';
import { preferencesOf, type Preferences, type SessionView, type ModelRoute, type Checkpoint } from './shared.js';

interface SessionState {
  id: string;
  paused: boolean;
  checkpoints: Checkpoint[];
  events: readonly ObservedEvent[];
  route: { provider: string; model: string } | null;
  busy: boolean;
  due: number | null;
  trigger: string;
  lastStart: number;
  callsTotal: number;
  tokensTotal: number;
  failures: number;
  error: string | null;
  notice: string | null;
  controller: AbortController | null;
  hydrated: boolean;
  lastTouched: number;
}
export interface RuntimeServices { llm: LlmRuntime; query: SessionQueryEngine; directory: string; now?: () => number }
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
const TRIGGERS: Record<string,string> = {
  'turn/start': '任务开始', 'turn/end': '本轮结束', 'todo/write': '任务清单更新', 'goal/change': '任务目标更新',
  'approval/asked': '等待操作', 'approval/decided': '操作已确认', 'deliverables/presented': '交付内容更新',
};
export class TaskLensRuntime {
  private preferences: Preferences;
  private sessions = new Map<string, SessionState>();
  private loads = new Map<string, Promise<SessionState>>();
  private writes = new Map<string, Promise<void>>();
  private callTimes: number[] = [];
  private active = 0;
  private disposed = false;
  private readonly now: () => number;
  private modelsCache: { time: number; routes: ModelRoute[] } | null = null;
  constructor(private services: RuntimeServices, defaults?: unknown) {
    this.preferences = preferencesOf(defaults);
    this.now = services.now ?? Date.now;
  }
  async initialize(): Promise<void> {
    await mkdir(this.services.directory, { recursive: true });
    try { this.preferences = preferencesOf(JSON.parse(await readFile(join(this.services.directory, 'preferences.json'), 'utf8')), this.preferences); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('任务透镜的设置文件读取失败，请检查本地存储。'); }
    try {
      const times = JSON.parse(await readFile(join(this.services.directory, 'usage.json'), 'utf8')) as unknown;
      if (Array.isArray(times)) this.callTimes = times.filter((t): t is number => typeof t === 'number' && t > this.now() - 3600000 && t <= this.now());
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('任务透镜的调用计数文件读取失败。'); }
  }
  private state(id: string): SessionState {
    let s = this.sessions.get(id);
    if (!s) {
      // Bound live memory. Persistent histories remain available when a session is reopened.
      if (this.sessions.size >= 50) {
        const idle = [...this.sessions.values()].filter(v => !v.busy && projectActivity(v.events).status !== 'running').sort((a,b) => a.lastTouched - b.lastTouched)[0];
        if (idle) this.sessions.delete(idle.id);
      }
      s = { id, paused: false, checkpoints: [], events: [], route: null, busy: false, due: null, trigger: '定时更新', lastStart: -Infinity,
        callsTotal: 0, tokensTotal: 0, failures: 0, error: null, notice: null, controller: null, hydrated: false, lastTouched: this.now() };
      this.sessions.set(id, s);
    }
    s.lastTouched = this.now();
    return s;
  }
  private path(id: string): string { return join(this.services.directory, `session-${createHash('sha256').update(id).digest('hex')}.json`); }
  private async hydrate(id: string): Promise<SessionState> {
    const s = this.state(id);
    if (s.hydrated) return s;
    const pending = this.loads.get(id); if (pending) return pending;
    const load = (async () => {
      try {
        const saved = record(JSON.parse(await readFile(this.path(id), 'utf8')));
        if (saved.sessionId === id && Array.isArray(saved.checkpoints)) {
          s.paused = saved.paused === true;
          s.checkpoints = (saved.checkpoints as Checkpoint[]).filter(c => c && typeof c.id === 'string' && c.briefing && Array.isArray(c.evidence)).slice(-40);
          s.callsTotal = typeof saved.callsTotal === 'number' ? saved.callsTotal : 0;
          s.tokensTotal = typeof saved.tokensTotal === 'number' ? saved.tokensTotal : 0;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') s.notice = '历史解释读取失败，本次将从会话记录重新生成。';
      }
      await this.refreshEvents(s);
      s.hydrated = true;
      return s;
    })();
    this.loads.set(id, load);
    try { return await load; } finally { this.loads.delete(id); }
  }
  private async refreshEvents(s: SessionState): Promise<void> {
    const observation = await this.services.query.observeSession(s.id as SessionId, { projectionMode: 'none' });
    try {
      s.events = observation.events;
      // Route metadata is read locally and never added to model evidence.
      const header = observation.events.findLast(e => e.type === 'request/header');
      const cfg = record(record(header?.data).header).config;
      const route = record(cfg);
      if (typeof route.provider === 'string' && typeof route.model === 'string') s.route = { provider: route.provider, model: route.model };
    } finally { observation[Symbol.dispose](); }
  }
  onEvent(id: string, event: ObservedEvent, subagent = false): void {
    if (this.disposed || subagent) return;
    const s = this.state(id);
    // Event callbacks do no disk or model I/O and cannot slow the agent append path.
    if (!this.preferences.enabled || s.paused) return;
    if (event.type === 'turn/start') this.schedule(s, 10000, '任务开始');
    else if (PRIORITY_EVENTS.has(event.type)) this.schedule(s, 3000, TRIGGERS[event.type] ?? '阶段变化');
  }
  private schedule(s: SessionState, delay: number, trigger: string): void {
    const due = Math.max(this.now() + delay, s.lastStart + this.preferences.minGapSeconds * 1000);
    if (s.due === null || due < s.due) { s.due = due; s.trigger = trigger; }
  }
  async tick(): Promise<void> {
    if (this.disposed || !this.preferences.enabled) return;
    for (const initial of [...this.sessions.values()]) {
      if (this.active >= 2) break;
      if (initial.paused || initial.busy || initial.due === null || initial.due > this.now()) continue;
      // Single flight is set inside run before its first await. The caller never awaits model work here.
      void this.run(initial.id, false).catch(() => undefined);
    }
  }
  async models(force = false): Promise<ModelRoute[]> {
    if (!force && this.modelsCache && this.now() - this.modelsCache.time < 60000) return this.modelsCache.routes;
    const providers = this.services.llm.listProviders();
    const results = await Promise.allSettled(providers.map(async p => {
      const models = await this.services.llm.listModels(p.id);
      return models.map(m => ({ provider: p.id, providerName: p.name ?? p.id, model: m.id, name: m.name ?? m.id }));
    }));
    const routes = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    this.modelsCache = { time: this.now(), routes }; return routes;
  }
  async view(id: string): Promise<SessionView> {
    const s = await this.hydrate(id);
    await this.refreshEvents(s);
    if (this.preferences.enabled && !s.paused && s.due === null && s.failures < 3 && projectActivity(s.events).status === 'running') this.schedule(s, 10000, '开始观察');
    return this.viewOf(s);
  }
  private viewOf(s: SessionState): SessionView {
    this.callTimes = this.callTimes.filter(t => t > this.now() - 3600000);
    return { sessionId: s.id, preferences: this.preferences, paused: s.paused, activity: projectActivity(s.events), checkpoints: s.checkpoints,
      busy: s.busy, error: s.error, notice: s.notice, nextAutomaticAt: this.preferences.enabled && !s.paused ? s.due : null,
      callsThisHour: this.callTimes.length, callsTotal: s.callsTotal, tokensTotal: s.tokensTotal };
  }
  async configure(value: unknown): Promise<Preferences> {
    const next = preferencesOf(value, this.preferences);
    if (next.model) {
      const routes = await this.models(true);
      if (!routes.some(r => r.provider === next.model!.provider && r.model === next.model!.model)) throw new Error('该模型尚未在 DSH 的可用模型列表中配置。');
    }
    this.preferences = next;
    if (!next.enabled) for (const s of this.sessions.values()) { s.due = null; s.controller?.abort('tasklens-disabled'); }
    else for (const s of this.sessions.values()) if (!s.paused && projectActivity(s.events).status === 'running') this.schedule(s, next.intervalSeconds * 1000, '设置更新');
    await this.write('preferences', join(this.services.directory, 'preferences.json'), next);
    return next;
  }
  async pause(id: string, paused: boolean): Promise<SessionView> {
    const s = await this.hydrate(id); s.paused = paused;
    if (paused) { s.due = null; s.controller?.abort('tasklens-pause'); }
    else this.schedule(s, 1000, '恢复观察');
    await this.persist(s); return this.viewOf(s);
  }
  async requestRefresh(id: string): Promise<SessionView> {
    const s = await this.hydrate(id);
    if (s.busy) return this.viewOf(s);
    // A manual refresh is one explicit call, still accounted against the same hourly cap.
    void this.run(id, true).catch(() => undefined);
    return this.viewOf(s);
  }
  private async run(id: string, manual: boolean): Promise<void> {
    const initial = this.state(id);
    if (initial.busy || this.active >= 2 || this.disposed) { if (!initial.busy) this.schedule(initial, 5000, '等待解释资源'); return; }
    initial.busy = true; this.active++;
    let s = initial;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      s = await this.hydrate(id); await this.refreshEvents(s);
      if (this.disposed || (!manual && (!this.preferences.enabled || s.paused))) return;
      const activity = projectActivity(s.events);
      const previous = s.checkpoints.at(-1);
      const context = contextFor(s.events, previous?.throughSeq ?? -1);
      if (!context.goal || (!manual && !context.changed)) {
        if (manual && !context.goal) s.notice = '当前会话尚无用户任务。发送任务后可生成阶段解释。';
        s.due = activity.status === 'running' ? this.now() + this.preferences.intervalSeconds * 1000 : null;
        return;
      }
      this.callTimes = this.callTimes.filter(t => t > this.now() - 3600000);
      if (this.callTimes.length >= this.preferences.maxCallsPerHour) {
        s.notice = `自动解释已达到每小时 ${this.preferences.maxCallsPerHour} 次上限。`;
        s.due = Math.min(...this.callTimes) + 3600000 + 1000; return;
      }
      if (!manual && !canCall(this.now(), s.lastStart, this.preferences.minGapSeconds, this.callTimes, this.preferences.maxCallsPerHour)) {
        s.due = s.lastStart + this.preferences.minGapSeconds * 1000; return;
      }
      const route = this.preferences.model ?? s.route;
      if (!route) { s.error = '请先在 DSH 配置模型，并在任务透镜设置中选择解释模型。'; s.due = null; return; }
      s.error = null; s.notice = null; s.lastStart = this.now(); s.callsTotal++;
      this.callTimes.push(s.lastStart);
      const preferences = this.preferences;
      // Consume the current trigger; events arriving during inference can enqueue their own deadline.
      s.due = null;
      const controller = new AbortController(); s.controller = controller;
      timer = setTimeout(() => controller.abort(), 90000);
      await this.write('usage', join(this.services.directory, 'usage.json'), this.callTimes);
      await this.persist(s);
      const request = JSON.stringify({
        goal: context.goal, latestRequest: context.latestRequest, activity,
        previous: previous ? { throughSeq: previous.throughSeq, briefing: previous.briefing } : null,
        evidence: context.evidence,
      });
      let output = ''; let terminal = false; let responseTokens = 0;
      for await (const chunk of this.services.llm.stream({
        provider: route.provider, model: route.model,
        system: promptFor(preferences.detail), messages: [{ role: 'user', content: [{ type: 'text', text: request }] }],
        maxTokens: preferences.detail === 'detailed' ? 6144 : 4096, signal: controller.signal,
      })) {
        if (controller.signal.aborted) throw new Error('解释已暂停或达到 90 秒超时，可稍后重试。');
        if (chunk.type === 'text-delta') { output += chunk.text; if (output.length > 24000) throw new Error('模型输出超过解释长度限制。'); }
        if (chunk.type === 'usage') responseTokens += chunk.usage.totalTokens ??
          ((chunk.usage.inputTokens ?? 0) + (chunk.usage.cacheReadTokens ?? 0) + (chunk.usage.cacheWriteTokens ?? 0) + (chunk.usage.outputTokens ?? 0));
        if (chunk.type === 'finish') {
          terminal = true;
          if (chunk.reason.kind === 'error') throw new Error(clipped(chunk.reason.failure.message, 300));
          if (chunk.reason.kind === 'aborted') throw new Error('解释已暂停或超时。');
          if (chunk.reason.kind === 'max-tokens') throw new Error('解释模型达到输出上限，请选择精简模式或更换模型。');
        }
      }
      if (controller.signal.aborted || this.disposed) return;
      if (!terminal || !output.trim()) throw new Error('解释模型没有返回完整内容，请重试。');
      const briefing = parseBriefing(output, context.evidence, activity);
      const cited = new Set([
        ...briefing.stages.flatMap(v => v.evidence), ...briefing.completed.flatMap(v => v.evidence), ...briefing.acceptance.flatMap(v => v.evidence),
      ]);
      const checkpoint: Checkpoint = { id: randomUUID(), time: this.now(), throughSeq: activity.throughSeq,
        trigger: manual ? '手动更新' : s.trigger, model: route, briefing,
        evidence: context.evidence.filter(e => cited.has(e.seq)) };
      s.checkpoints = [...s.checkpoints, checkpoint].slice(-40); s.tokensTotal += responseTokens; s.failures = 0;
      await this.persist(s);
      // Preserve an event-triggered check that arrived while the summary model was working.
      if (s.due === null) s.due = this.now() + preferences.intervalSeconds * 1000;
      await this.refreshEvents(s);
      const latest = projectActivity(s.events);
      if (latest.status !== 'running' && latest.throughSeq <= checkpoint.throughSeq) s.due = null;
      else if (latest.throughSeq > checkpoint.throughSeq && latest.status !== 'running') this.schedule(s, 3000, '本轮结束');
    } catch (error) {
      if (['tasklens-pause', 'tasklens-disabled', 'tasklens-disposed'].includes(String(s.controller?.signal.reason))) {
        s.error = null; s.due = null; return;
      }
      s.error = clipped(error instanceof Error ? error.message : String(error), 400);
      s.failures++;
      s.due = this.preferences.enabled && !s.paused && s.failures < 3 ? this.now() + Math.min(600, this.preferences.intervalSeconds * 2 ** s.failures) * 1000 : null;
      if (s.failures >= 3) s.notice = '连续三次解释失败，自动调用已停止。请检查模型设置后手动更新。';
    } finally {
      if (timer) clearTimeout(timer);
      s.controller = null; s.busy = false; this.active--;
      if (s.hydrated) await this.persist(s).catch(() => { s.notice = '解释记录保存失败，请检查本地存储。'; });
    }
  }
  private persist(s: SessionState): Promise<void> {
    return this.write(s.id, this.path(s.id), { version: 1, sessionId: s.id, paused: s.paused,
      callsTotal: s.callsTotal, tokensTotal: s.tokensTotal, checkpoints: s.checkpoints });
  }
  private write(key: string, path: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    const previous = this.writes.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const temporary = `${path}.${randomUUID()}.tmp`;
      await mkdir(this.services.directory, { recursive: true }); await writeFile(temporary, serialized, 'utf8'); await rename(temporary, path);
    });
    this.writes.set(key, next);
    void next.finally(() => { if (this.writes.get(key) === next) this.writes.delete(key); }).catch(() => undefined);
    return next;
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const s of this.sessions.values()) s.controller?.abort('tasklens-disposed');
    await Promise.allSettled([...this.writes.values()]);
  }
}
