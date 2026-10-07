import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmRuntime, GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import type { SessionId } from '@deepseek-ai/dsh-session';
import { projectActivity, PRIORITY_EVENTS, importantResult, canCall, clipped, type ObservedEvent } from './core.js';
import { publicSources, sourceRevision, hashOf, pendingUserSourceIds } from './sources.js';
import { buildContext, estimateTokens, type WorkContext } from './context.js';
import { applyAnalysis, applyAnnotation, invalidateSources, object, textValue } from './graph.js';
import { fallbackBriefing, validateBriefing, stableBriefing } from './narrative.js';
import { completeGraphPrefix } from './partial.js';
import { RoadmapStore, atomicJson, type SavedSession } from './storage.js';
import { emptyRoadmap, type PublicSource, type Roadmap, type TimelineEntry, type Coverage, type Annotation, type SourceRef } from './schema.js';
import { preferencesOf, type Preferences, type SessionView, type ModelRoute, type Checkpoint } from './shared.js';

interface Usage { id: string; sessionId?: string; time: number; tokens: number; estimated: boolean }
interface SessionState {
  id: string; store: RoadmapStore; events: readonly ObservedEvent[]; sources: PublicSource[];
  route: { provider: string; model: string } | null; busy: boolean; due: number | null; trigger: string;
  lastStart: number; failures: number; error: string | null; notice: string | null;
  controller: AbortController | null; hydrated: boolean; lastTouched: number;
  inputEstimate: number; inputLimit: number; protectedOmitted: number;
}
export interface RuntimeServices { llm: LlmRuntime; query: SessionQueryEngine; directory: string; now?: () => number }
const TRIGGERS: Record<string, string> = { 'user/message': '需求更新', 'turn/start': '任务开始', 'turn/end': '本轮结束',
  'todo/write': '计划更新', 'goal/change': '目标更新', 'approval/asked': '等待操作', 'approval/decided': '操作已确认', 'deliverables/presented': '交付更新', 'tool/result': '行动结果' };
const OUTPUT_LIMIT = 8192;
function coverageOf(saved: SavedSession, sources: PublicSource[]): Coverage {
  const maps = [saved.live.analyzed, ...(saved.rebuild ? [saved.rebuild.analyzed] : [])];
  const covered = (s: PublicSource) => maps.some(m => m[s.id] === s.hash);
  const rounds = [...new Set(sources.map(s => s.round))].filter(n => n > 0);
  const completeRounds = rounds.filter(r => sources.filter(s => s.round === r).every(covered));
  const current = new Map(sources.map(s => [s.id, s.hash]));
  const invalid = [...new Set(maps.flatMap(m => Object.entries(m).filter(([id, hash]) => current.get(id) !== hash).map(([id]) => id)))];
  return { analyzedParts: sources.filter(covered).length, totalParts: sources.length, completeRounds,
    pendingRounds: rounds.filter(r => !completeRounds.includes(r)), invalidSources: invalid.length,
    rebuilding: saved.rebuild !== null, backfillPaused: saved.backfillPaused,
    observedSeq: sources.at(-1)?.seq ?? -1, analyzedSeq: sources.filter(covered).at(-1)?.seq ?? -1 };
}
function orderedTimeline(saved: SavedSession): TimelineEntry[] { return saved.history.slice().sort((a, b) => a.throughSeq - b.throughSeq || a.commit - b.commit); }
/** Preserve preview identities and replay version-specific user corrections at the handoff. */
export function finishRebuild(saved: SavedSession): Roadmap {
  const graph = structuredClone(saved.rebuild!); const old = saved.live;
  const goalIds = new Map<string, string>(); const nodeIds = new Map<string, string>();
  for (const goal of graph.goals) {
    const matches = old.goals.filter(g => g.title === goal.title || g.sources.some(s => goal.sources.some(r => s.id === r.id)));
    if (matches.length === 1) goalIds.set(goal.id, matches[0].id);
  }
  for (const n of graph.nodes) {
    const matches = old.nodes.filter(o => o.goalId === (goalIds.get(n.goalId) ?? n.goalId) && o.kind === n.kind
      && (o.title === n.title || o.aliases.includes(n.title) || n.aliases.includes(o.title)));
    if (matches.length === 1 && ![...nodeIds.values()].includes(matches[0].id)) nodeIds.set(n.id, matches[0].id);
  }
  graph.goals.forEach(g => { g.id = goalIds.get(g.id) ?? g.id; });
  graph.nodes.forEach(n => { n.id = nodeIds.get(n.id) ?? n.id; n.goalId = goalIds.get(n.goalId) ?? n.goalId;
    n.parentId = n.parentId ? nodeIds.get(n.parentId) ?? n.parentId : null; n.replaces = n.replaces ? nodeIds.get(n.replaces) ?? n.replaces : null; });
  graph.edges.forEach(e => { e.from = nodeIds.get(e.from) ?? e.from; e.to = nodeIds.get(e.to) ?? e.to; });
  graph.facts.forEach(f => { f.nodeId = f.nodeId ? nodeIds.get(f.nodeId) ?? f.nodeId : null; f.goalId = f.goalId ? goalIds.get(f.goalId) ?? f.goalId : null; });
  graph.episodes.forEach(e => { e.nodeIds = e.nodeIds.map(id => nodeIds.get(id) ?? id); });
  graph.changes.forEach(c => { c.nodeId = nodeIds.get(c.nodeId) ?? c.nodeId; });
  const unmatched = new Set(old.nodes.filter(n => !graph.nodes.some(o => o.id === n.id)).map(n => n.id));
  for (const n of old.nodes) if (unmatched.has(n.id)) {
    if (!graph.goals.some(g => g.id === n.goalId)) { const goal = old.goals.find(g => g.id === n.goalId); if (goal) graph.goals.push(goal); }
    graph.nodes.push({ ...n, status: n.status === 'done' ? 'review' : n.status });
    graph.unresolved.push({ id: randomUUID(), nodeId: n.id, text: `${n.title}在近期视图与历史重建中的对应关系待核对。`, sources: n.sources, time: n.changedAt });
  }
  for (const edge of old.edges.filter(e => unmatched.has(e.from) || unmatched.has(e.to))) {
    if (graph.edges.some(e => e.from === edge.from && e.to === edge.to)) continue;
    const reachable = new Set<string>(); const queue = [edge.to];
    while (queue.length) { const id = queue.pop()!; if (reachable.has(id)) continue; reachable.add(id); queue.push(...graph.edges.filter(e => e.from === id).map(e => e.to)); }
    if (!reachable.has(edge.from)) graph.edges.push(edge);
    else graph.unresolved.push({ id: randomUUID(), nodeId: edge.to, text: '历史任务的前置关系与重建路线冲突，原关系保留在历史中。', sources: edge.sources, time: old.nodes.find(n => n.id === edge.to)?.changedAt ?? 0 });
  }
  let corrected = graph;
  for (const a of saved.annotations) {
    try { corrected = applyAnnotation(corrected, a, true); }
    catch { corrected.unresolved.push({ id: a.id, nodeId: a.nodeId, text: '历史重建后的任务版本与用户纠正存在差异，请查看原纠正记录。', sources: [], time: a.time }); }
  }
  return corrected;
}
export class TaskLensRuntime {
  private preferences: Preferences;
  private sessions = new Map<string, SessionState>(); private loads = new Map<string, Promise<SessionState>>();
  private writes = new Map<string, Promise<void>>(); private jobs = new Set<Promise<void>>();
  private usage: Usage[] = []; private active = 0; private disposed = false;
  private preferenceEpoch = 0;
  private readonly now: () => number;
  private modelsCache: { time: number; routes: ModelRoute[] } | null = null;
  constructor(private services: RuntimeServices, defaults?: unknown) { this.preferences = preferencesOf(defaults); this.now = services.now ?? Date.now; }
  async initialize(): Promise<void> {
    await mkdir(this.services.directory, { recursive: true });
    try { this.preferences = preferencesOf(JSON.parse(await readFile(join(this.services.directory, 'preferences.json'), 'utf8')), this.preferences); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('任务透镜设置文件读取失败。'); }
    try {
      const raw = JSON.parse(await readFile(join(this.services.directory, 'usage.json'), 'utf8')) as unknown;
      if (Array.isArray(raw)) this.usage = raw.map(v => typeof v === 'number' ? { id: randomUUID(), time: v, tokens: 0, estimated: false } : v as Usage)
        .filter(v => typeof v.time === 'number' && v.time > this.now() - 3600000 && v.time <= this.now());
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('任务透镜调用计数读取失败。'); }
  }
  private state(id: string): SessionState {
    let s = this.sessions.get(id);
    if (!s) {
      if (this.sessions.size >= 50) { const idle = [...this.sessions.values()].filter(v => !v.busy && projectActivity(v.events).status !== 'running').sort((a, b) => a.lastTouched - b.lastTouched)[0]; if (idle) this.sessions.delete(idle.id); }
      s = { id, store: new RoadmapStore(this.services.directory, id), events: [], sources: [], route: null, busy: false, due: null, trigger: '定时更新',
        lastStart: this.usage.filter(u => u.sessionId === id).at(-1)?.time ?? -Infinity, failures: 0, error: null, notice: null, controller: null, hydrated: false, lastTouched: this.now(),
        inputEstimate: 0, inputLimit: this.preferences.inputBudget, protectedOmitted: 0 };
      this.sessions.set(id, s);
    }
    s.lastTouched = this.now(); return s;
  }
  private async hydrate(id: string): Promise<SessionState> {
    const s = this.state(id); if (s.hydrated) return s;
    if (this.loads.has(id)) return this.loads.get(id)!;
    const load = (async () => {
      await s.store.initialize(); s.notice = s.store.notice;
      if (s.store.state.commitVersion === 0) {
        try {
          const saved = object(JSON.parse(await readFile(join(this.services.directory, `session-${hashOf(id)}.json`), 'utf8')));
          if (saved.sessionId === id && Array.isArray(saved.checkpoints)) {
            const next = structuredClone(s.store.state); next.legacy = (saved.checkpoints as Checkpoint[]).filter(c => c && c.briefing && Array.isArray(c.evidence));
            next.paused = true; next.callsTotal = Number(saved.callsTotal) || 0; next.tokensTotal = Number(saved.tokensTotal) || 0;
            await s.store.commit(next, 0, 'migrate-v1'); s.notice = '旧版解释已保留，路线图正在从公开历史重新核对。';
          }
        } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') s.notice = '旧版解释读取失败，原文件保留；路线图将读取 DSH 公开历史。'; }
      }
      await this.refreshEvents(s); s.hydrated = true; return s;
    })(); this.loads.set(id, load);
    try { return await load; } finally { this.loads.delete(id); }
  }
  private async refreshEvents(s: SessionState): Promise<void> {
    const observation = await this.services.query.observeSession(s.id as SessionId, { projectionMode: 'none' });
    try {
      s.events = observation.events; s.sources = publicSources(s.events);
      const header = observation.events.findLast(e => e.type === 'request/header');
      const route = object(object(object(header?.data).header).config);
      if (typeof route.provider === 'string' && typeof route.model === 'string') s.route = { provider: route.provider, model: route.model };
    } finally { observation[Symbol.dispose](); }
  }
  onEvent(id: string, event: ObservedEvent, subagent = false): void {
    if (this.disposed || subagent) return; const s = this.state(id);
    // Loading the saved opt-in is local work. A new session remains paused.
    if (!s.hydrated) { void this.hydrate(id).then(() => this.onEvent(id, event)).catch(e => {
      s.error = clipped(e instanceof Error ? e.message : String(e), 400);
    }); return; }
    if (!this.preferences.enabled || s.store.state.paused) return;
    if (event.type === 'turn/start') this.schedule(s, 10000, '任务开始');
    else if (PRIORITY_EVENTS.has(event.type) || importantResult(event)) this.schedule(s, 3000, TRIGGERS[event.type] ?? '阶段变化');
    else if (s.due === null) this.schedule(s, this.preferences.intervalSeconds * 1000, '行动更新');
  }
  private schedule(s: SessionState, delay: number, trigger: string): void {
    const due = Math.max(this.now() + delay, s.lastStart + this.preferences.minGapSeconds * 1000);
    if (s.due === null || due < s.due) { s.due = due; s.trigger = trigger; }
  }
  private launch(id: string, manual: boolean): void {
    const job = this.run(id, manual).catch(() => undefined); this.jobs.add(job); void job.finally(() => this.jobs.delete(job));
  }
  async tick(): Promise<void> {
    if (this.disposed || !this.preferences.enabled) return;
    for (const s of this.sessions.values()) { if (this.active >= 2) break;
      if (!s.store.state.paused && !s.busy && s.due !== null && s.due <= this.now()) this.launch(s.id, false); }
  }
  async models(force = false): Promise<ModelRoute[]> {
    if (!force && this.modelsCache && this.now() - this.modelsCache.time < 60000) return this.modelsCache.routes;
    const results = await Promise.allSettled(this.services.llm.listProviders().map(async p => (await this.services.llm.listModels(p.id))
      .map(m => ({ provider: p.id, providerName: p.name ?? p.id, model: m.id, name: m.name ?? m.id }))));
    const routes = results.flatMap(r => r.status === 'fulfilled' ? r.value : []); this.modelsCache = { time: this.now(), routes }; return routes;
  }
  private pending(s: SessionState, graph = s.store.state.live): PublicSource[] {
    return s.sources.filter(source => (s.store.state.liveFloor === null || graph !== s.store.state.live || source.seq >= s.store.state.liveFloor)
      && graph.analyzed[source.id] !== source.hash);
  }
  async view(id: string): Promise<SessionView> {
    const s = await this.hydrate(id); await this.refreshEvents(s);
    if (!s.busy) await this.prepare(s);
    if (this.preferences.enabled && !s.store.state.paused && s.due === null && s.failures < 3
      && s.sources.some(e => e.role === 'user') && (this.pending(s).length || s.store.state.rebuild && !s.store.state.backfillPaused)) this.schedule(s, 1000, '开始观察');
    return this.viewOf(s);
  }
  private viewOf(s: SessionState): SessionView {
    this.usage = this.usage.filter(t => t.time > this.now() - 3600000); const saved = s.store.state;
    let graph = saved.live.nodes.length || saved.live.goals.length ? saved.live : null;
    // A reply resolves the pending request immediately, including while a new model call is waiting.
    if (graph?.briefing?.userActions.length) { const pending = pendingUserSourceIds(s.sources);
      graph = { ...graph, briefing: { ...graph.briefing, userActions: graph.briefing.userActions.filter(u => u.factIds.some(id =>
        graph!.facts.find(f => f.id === id)?.sources.some(r => pending.has(r.id)))) } }; }
    return { sessionId: s.id, preferences: this.preferences, paused: saved.paused, activity: projectActivity(s.events),
      checkpoints: saved.legacy, roadmap: graph, timeline: orderedTimeline(saved), coverage: coverageOf(saved, s.sources), commitVersion: saved.commitVersion,
      budget: { estimatedInput: s.inputEstimate, inputLimit: s.inputLimit, protectedOmitted: s.protectedOmitted,
        tokensThisHour: this.usage.reduce((n, u) => n + u.tokens, 0), tokenLimit: this.preferences.maxTokensPerHour },
      busy: s.busy, error: s.error, notice: s.notice ?? s.store.notice, nextAutomaticAt: this.preferences.enabled && !saved.paused ? s.due : null,
      callsThisHour: this.usage.length, callsTotal: saved.callsTotal, tokensTotal: saved.tokensTotal };
  }
  async historical(id: string, entryId: string): Promise<{ roadmap: Roadmap; entry: TimelineEntry }> {
    const s = await this.hydrate(id); const entry = s.store.state.history.find(e => e.id === entryId); if (!entry) throw new Error('历史版本不存在。');
    const historical = await s.store.historical(entry.commit); const roadmap = entry.branch === 'rebuild' ? historical.rebuild ?? historical.live : historical.live;
    return { roadmap, entry };
  }
  async sources(id: string, refs: unknown): Promise<Array<{ source: PublicSource | null; ref: SourceRef; validity: 'current' | 'revised' | 'missing' }>> {
    const s = await this.hydrate(id); await this.refreshEvents(s);
    if (!Array.isArray(refs) || refs.length > 40) throw new Error('来源请求范围无效。');
    return Promise.all(refs.map(async raw => {
      const ref = object(raw) as unknown as SourceRef; const current = s.sources.find(v => v.id === ref.id);
      const source = current?.hash === ref.hash ? current : await s.store.cachedSource(ref.id, ref.hash);
      return { source, ref, validity: current?.hash === ref.hash ? 'current' as const : current ? 'revised' as const : 'missing' as const };
    }));
  }
  async configure(value: unknown): Promise<Preferences> {
    const next = preferencesOf(value, this.preferences);
    if (next.model && !(await this.models(true)).some(r => r.provider === next.model!.provider && r.model === next.model!.model)) throw new Error('该模型尚未在 DSH 的模型列表中配置。');
    this.preferences = next; this.preferenceEpoch++;
    for (const s of this.sessions.values()) {
      if (!next.enabled) { s.due = null; s.controller?.abort('tasklens-disabled'); }
      else if (!s.store.state.paused) this.schedule(s, 1000, '设置更新');
    }
    await this.write('preferences', join(this.services.directory, 'preferences.json'), next); return next;
  }
  async pause(id: string, paused: boolean, backfill = false): Promise<SessionView> {
    const s = await this.hydrate(id); const next = structuredClone(s.store.state);
    if (backfill) next.backfillPaused = paused; else next.paused = paused;
    if (!backfill && paused) { s.due = null; s.controller?.abort('tasklens-pause'); }
    else if (!paused && !next.paused && this.preferences.enabled) { s.failures = 0; this.schedule(s, 1000, '开启自动解释'); }
    await s.store.commit(next, next.commitVersion, backfill ? 'backfill-pause' : 'pause'); return this.viewOf(s);
  }
  async annotate(id: string, value: unknown): Promise<SessionView> {
    const s = await this.hydrate(id); const input = object(value); const saved = s.store.state;
    if (input.commitVersion !== saved.commitVersion) throw new Error('页面版本已变化，请读取最新任务后纠正。');
    const node = saved.live.nodes.find(n => n.id === input.nodeId); if (!node) throw new Error('任务不存在。');
    if (!['title', 'status', 'parentId', 'dependencies', 'merge', 'split'].includes(String(input.field))) throw new Error('纠正字段无效。');
    const relatedIds = input.field === 'merge' ? [String(input.value)] : input.field === 'dependencies' ? JSON.parse(String(input.value)) : [];
    if (!Array.isArray(relatedIds) || relatedIds.length > 40) throw new Error('关联任务列表无效。');
    const annotation: Annotation = { id: randomUUID(), nodeId: node.id, sourceIds: node.sources.map(s => s.id), nodeTitle: node.title,
      goalTitle: saved.live.goals.find(g => g.id === node.goalId)?.title ?? '', scopeRevision: node.scopeRevision,
      field: input.field as Annotation['field'], value: input.value === null ? null : textValue(input.value, ['dependencies', 'split'].includes(String(input.field)) ? 4000 : 100),
      related: relatedIds.map(id => { const p = saved.live.nodes.find(p => p.id === id); if (!p) throw new Error('关联任务不存在。'); return { id: p.id, title: p.title, scopeRevision: p.scopeRevision }; }), reason: textValue(input.reason, 400), time: this.now() };
    const next = structuredClone(saved); next.live = applyAnnotation(next.live, annotation); next.annotations.push(annotation); next.pendingWork = null;
    next.history.push({ id: randomUUID(), commit: saved.commitVersion + 1, branch: 'live', generation: next.live.generation,
      throughSeq: s.sources.at(-1)?.seq ?? -1, round: s.sources.at(-1)?.round ?? 0, time: this.now(), title: '用户纠正', trigger: '用户纠正', model: null, key: true, preview: saved.rebuild !== null });
    await s.store.commit(next, saved.commitVersion, annotation.id); return this.viewOf(s);
  }
  async requestRefresh(id: string): Promise<SessionView> { const s = await this.hydrate(id); if (!s.busy) this.launch(id, true); return this.viewOf(s); }
  private async prepare(s: SessionState): Promise<void> {
    const saved = s.store.state; const next = structuredClone(saved); const sources = new Map(s.sources.map(v => [v.id, v]));
    const revised = Object.entries(saved.live.analyzed).some(([id, hash]) => sources.get(id)?.hash !== hash)
      || Boolean(saved.rebuild && Object.entries(saved.rebuild.analyzed).some(([id, hash]) => sources.get(id)?.hash !== hash));
    if (revised) {
      if (invalidateSources(next.live, sources)) next.live.version++; next.rebuild = emptyRoadmap(s.id, randomUUID()); next.rebuildTarget = sourceRevision(s.sources); next.pendingWork = null;
      next.liveFloor = s.sources.at(-1)?.seq ?? 0;
      for (const [id, hash] of Object.entries(next.live.analyzed)) if (sources.get(id)?.hash !== hash) delete next.live.analyzed[id];
      s.notice = '公开来源已有修订，相关结论已进入复核；历史路线图正在重新回溯。';
    } else if (saved.live.version === 0 && !saved.rebuild && estimateTokens(JSON.stringify(s.sources)) > 1800) {
      next.rebuild = emptyRoadmap(s.id, randomUUID()); next.rebuildTarget = sourceRevision(s.sources);
    }
    if (JSON.stringify(next) !== JSON.stringify(saved)) await s.store.commit(next, saved.commitVersion, 'prepare-history');
  }
  private async invoke(s: SessionState, context: WorkContext, route: { provider: string; model: string }, signal: AbortSignal, reasoningEffort?: GenerateOptions['reasoningEffort']): Promise<{ response: unknown; complete: boolean } | null> {
    const reserve = context.estimate + OUTPUT_LIMIT;
    this.usage = this.usage.filter(t => t.time > this.now() - 3600000);
    if (this.usage.length >= this.preferences.maxCallsPerHour || this.usage.reduce((n, u) => n + u.tokens, 0) + reserve > this.preferences.maxTokensPerHour) {
      s.notice = '解释调用已达到小时预算；队列已保存，预算恢复后继续。';
      s.due = this.usage.length ? Math.min(...this.usage.map(u => u.time)) + 3600001 : this.now() + 3600001; return null;
    }
    const usage: Usage = { id: randomUUID(), sessionId: s.id, time: this.now(), tokens: reserve, estimated: true }; this.usage.push(usage);
    s.lastStart = this.now(); const next = structuredClone(s.store.state); next.callsTotal++;
    await this.write('usage', join(this.services.directory, 'usage.json'), this.usage); await s.store.commit(next, next.commitVersion, 'call-reserved');
    let output = ''; let terminal = false; let tokens = 0; let truncated = false;
    try {
      for await (const chunk of this.services.llm.stream({ provider: route.provider, model: route.model, system: context.system,
        messages: [{ role: 'user', content: [{ type: 'text', text: context.request }] }], maxTokens: OUTPUT_LIMIT, reasoningEffort, signal })) {
        if (signal.aborted) throw new Error('解释已暂停或达到超时。');
        if (chunk.type === 'text-delta') { output += chunk.text; if (output.length > 60000) throw new Error('解释输出超出限制。'); }
        if (chunk.type === 'usage') tokens = Math.max(tokens, chunk.usage.totalTokens ?? (chunk.usage.inputTokens ?? 0) + (chunk.usage.cacheReadTokens ?? 0) + (chunk.usage.cacheWriteTokens ?? 0) + (chunk.usage.outputTokens ?? 0));
        if (chunk.type === 'finish') { terminal = true;
          if (chunk.reason.kind === 'error') throw new Error(clipped(chunk.reason.failure.message, 300));
          if (chunk.reason.kind === 'aborted') throw new Error('解释已暂停或超时。');
          if (chunk.reason.kind === 'max-tokens') truncated = true; }
      }
      if (!terminal || !output.trim()) throw new Error('解释模型未返回完整内容。');
      if (truncated) {
        const response = completeGraphPrefix(output);
        if (!response) throw new Error('解释输出未完成，本批公开记录保留在队列中。');
        return { response, complete: false };
      }
      return { response: JSON.parse(output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')), complete: true };
    } finally {
      if (tokens > 0) { usage.tokens = tokens; usage.estimated = false; }
      await this.write('usage', join(this.services.directory, 'usage.json'), this.usage);
      const latest = structuredClone(s.store.state); latest.tokensTotal += tokens; await s.store.commit(latest, latest.commitVersion, 'call-usage');
    }
  }
  private async run(id: string, manual: boolean): Promise<void> {
    let s = this.state(id); if (s.busy || this.active >= 2 || this.disposed) { if (!s.busy) this.schedule(s, 5000, '等待解释资源'); return; }
    s.busy = true; this.active++; let timer: ReturnType<typeof setTimeout> | undefined; let context: WorkContext | undefined; let branch: 'live' | 'rebuild' = 'live'; let rejectedRaw: unknown;
    try {
      s = await this.hydrate(id); await this.refreshEvents(s);
      if (this.disposed || !manual && (!this.preferences.enabled || s.store.state.paused)) return;
      if (!s.sources.some(v => v.role === 'user')) { s.notice = '当前会话尚无用户任务。'; s.due = null; return; }
      await this.prepare(s);
      if (!manual && !canCall(this.now(), s.lastStart, this.preferences.minGapSeconds, this.usage.map(u => u.time), this.preferences.maxCallsPerHour)) {
        s.due = Math.max(s.lastStart + this.preferences.minGapSeconds * 1000, this.usage.length >= this.preferences.maxCallsPerHour ? Math.min(...this.usage.map(u => u.time)) + 3600001 : this.now()); return;
      }
      const saved = s.store.state; const pending = saved.pendingWork;
      const observedBefore = s.sources.at(-1)?.seq ?? -1; const preferenceEpoch = this.preferenceEpoch;
      const preview = saved.live.version === 0 && saved.rebuild !== null;
      branch = pending?.branch ?? (preview || this.pending(s).length ? 'live' : saved.rebuild && !saved.backfillPaused ? 'rebuild' : 'live');
      const graph = branch === 'rebuild' ? saved.rebuild! : saved.live;
      let inputSources = branch === 'live' && saved.liveFloor !== null ? s.sources.filter(v => v.seq >= saved.liveFloor! || graph.analyzed[v.id] === v.hash) : s.sources;
      if (preview) inputSources = s.sources;
      const working = structuredClone(graph);
      if (pending) for (const sourceId of pending.batchIds) delete working.analyzed[sourceId];
      if (!inputSources.some(v => working.analyzed[v.id] !== v.hash)) { s.due = null; s.notice = '路线图已分析至当前公开记录。'; return; }
      const route = this.preferences.model ?? s.route; if (!route) { s.error = '请在 DSH 配置模型，并在任务透镜设置中选择解释模型。'; s.due = null; return; }
      s.error = null; s.notice = null; s.due = null;
      const controller = new AbortController(); s.controller = controller; timer = setTimeout(() => controller.abort('tasklens-timeout'), 120000);
      let windowLimit = this.preferences.inputBudget;
      let reasoningEffort: GenerateOptions['reasoningEffort'];
      if (typeof this.services.llm.resolveModelInfo === 'function') {
        const metadata = await this.services.llm.resolveModelInfo(route.provider, route.model, controller.signal);
        if (metadata.context) windowLimit = Math.min(windowLimit, metadata.context.contextWindow - OUTPUT_LIMIT - 512);
        const efforts = metadata.reasoning?.efforts ?? [];
        reasoningEffort = ['low', 'minimal', 'none', 'off', 'disabled'].map(id => efforts.find(e => String(e.id) === id)?.id).find(Boolean);
      }
      context = buildContext(working, inputSources, this.preferences, { preview, limit: windowLimit,
        extraSourceIds: pending?.extraSourceIds, extraNodeIds: pending?.extraNodeIds, protectedComplete: branch === 'rebuild' || saved.rebuild === null });
      context.sourceRevision = sourceRevision(s.sources);
      const request = JSON.parse(context.request); request.frame.sourceRevision = context.sourceRevision;
      if (pending?.error) request.previousValidationError = pending.error;
      context.request = JSON.stringify(request); context.estimate = estimateTokens(context.system) + estimateTokens(context.request) + 200;
      if (context.estimate > context.limit) throw new Error('修复上下文超出输入预算。');
      s.inputEstimate = context.estimate; s.inputLimit = context.limit; s.protectedOmitted = context.protectedOmitted;
      const generated = await this.invoke(s, context, route, controller.signal, reasoningEffort); if (generated === null || controller.signal.aborted || this.disposed) return;
      const { response: raw, complete } = generated;
      rejectedRaw = raw;
      const afterCall = s.store.state; const expectedCommit = afterCall.commitVersion;
      await this.refreshEvents(s);
      const current = new Map(s.sources.map(v => [v.id, v]));
      if ([...context.sources.values()].some(v => current.get(v.id)?.hash !== v.hash)
        || (branch === 'live' && s.sources.some(v => v.role === 'user' && v.seq > observedBefore)) || preferenceEpoch !== this.preferenceEpoch
        || (branch === 'live' ? afterCall.live.version : afterCall.rebuild?.version) !== graph.version) {
        s.notice = '分析期间需求或任务版本发生变化，过期响应已丢弃，队列将重新分析。'; this.schedule(s, 3000, '需求复核'); return;
      }
      const result = applyAnalysis(graph, raw, complete ? context : { ...context, batch: [] }, this.now());
      try { result.graph.briefing = stableBriefing(validateBriefing(result.rawBriefing, result.graph, result.facts, context.factsLoaded, this.preferences, result.changed), result.graph, result.facts); }
      catch { result.graph.briefing = result.changed ? stableBriefing(fallbackBriefing(result.graph, result.facts, this.preferences), result.graph, result.facts) : graph.briefing; }
      const next = structuredClone(afterCall); next[branch] = result.graph; next.pendingWork = null;
      if (preview) next.liveFloor = context.batch[0].seq;
      const needs = Array.isArray(object(raw).needsContext) ? (object(raw).needsContext as unknown[]).slice(0, 3) : [];
      if (needs.length && (pending?.supplement ?? 0) < 1) {
        const extraIds: string[] = []; const nodeIds: string[] = [];
        for (const item of needs) { const need = object(item); if (typeof need.nodeId === 'string') nodeIds.push(need.nodeId);
          if (typeof need.sourceId === 'string' && current.has(need.sourceId)) extraIds.push(need.sourceId);
          if (typeof need.query === 'string' && need.query.length <= 100) extraIds.push(...s.sources.filter(v => v.seq <= context!.throughSeq && v.text.includes(String(need.query))).slice(-3).map(v => v.id)); }
        next.pendingWork = { branch, batchIds: context.batch.map(v => v.id), extraSourceIds: extraIds.slice(0, 6), extraNodeIds: nodeIds.slice(0, 3), repair: 0, supplement: 1, error: null };
      }
      const entry: TimelineEntry = { id: randomUUID(), commit: expectedCommit + 1, branch, generation: result.graph.generation,
        throughSeq: context.throughSeq, round: context.round, time: this.now(),
        title: result.graph.briefing?.headline?.text ?? (branch === 'rebuild' ? '历史回溯' : '任务更新'), trigger: manual ? '手动更新' : branch === 'rebuild' ? '历史回溯' : s.trigger,
        model: route, key: result.changed, preview: branch === 'live' && saved.rebuild !== null };
      next.history.push(entry);
      if (next.rebuild && s.sources.every(v => next.rebuild!.analyzed[v.id] === v.hash) && !next.pendingWork) {
        next.live = finishRebuild(next); next.rebuild = null; next.rebuildTarget = null; next.liveFloor = null; entry.preview = false;
        s.notice = '历史回溯已完成，当前路线图已核对至最新公开记录。';
      }
      await s.store.cacheSources([...context.sources.values()]);
      await s.store.commit(next, expectedCommit, `${result.graph.generation}:${result.graph.version}:${context.sourceRevision}`);
      if (result.omittedFacts) s.notice = '路线图已更新；部分摘要的依据尚待核对，暂未展示。';
      if (!complete) s.notice = '本批已核对的任务已保存，模型输出尚未结束；剩余记录保留待继续分析。';
      s.failures = 0;
      if (this.pending(s).length || s.store.state.pendingWork || s.store.state.rebuild && !s.store.state.backfillPaused) this.schedule(s, this.preferences.minGapSeconds * 1000, '继续分析');
      else if (projectActivity(s.events).status === 'running') this.schedule(s, this.preferences.intervalSeconds * 1000, '定时更新');
    } catch (e) {
      if (['tasklens-pause', 'tasklens-disabled', 'tasklens-disposed'].includes(String(s.controller?.signal.reason))) { s.error = null; s.due = null; return; }
      s.error = clipped(e instanceof Error ? e.message : String(e), 400); s.failures++;
      if (rejectedRaw && context) await s.store.rejectedAnalysis({ time: this.now(), error: s.error, response: rejectedRaw,
        sources: [...context.sources.values()], frame: { sourceRevision: context.sourceRevision, throughSeq: context.throughSeq, round: context.round } }).catch(() => undefined);
      if (context && s.failures === 1) {
        const next = structuredClone(s.store.state); const graph = branch === 'rebuild' ? next.rebuild : next.live;
        const nodeIds = (s.error.match(/task-[0-9a-f-]+/g) ?? []).filter(id => graph?.nodes.some(n => n.id === id));
        const sourceIds = (s.error.match(/s-\d+-\d+/g) ?? []).filter(id => s.sources.some(v => v.id === id));
        next.pendingWork = { branch, batchIds: context.batch.map(v => v.id), extraSourceIds: [...new Set([...sourceIds, ...context.extraUsed])].slice(0, 6), extraNodeIds: nodeIds.slice(0, 3), repair: 1, supplement: 0, error: s.error };
        await s.store.commit(next, next.commitVersion, 'bounded-repair').catch(() => undefined);
      } else if (s.store.state.pendingWork?.repair) {
        const next = structuredClone(s.store.state); next.pendingWork = null; await s.store.commit(next, next.commitVersion, 'repair-ended').catch(() => undefined);
      }
      s.due = this.preferences.enabled && !s.store.state.paused && s.failures < 3 ? this.now() + Math.min(600, this.preferences.intervalSeconds * 2 ** s.failures) * 1000 : null;
      if (s.failures >= 3) s.notice = '连续三次解释失败，自动调用已停止。请检查模型设置后手动更新。';
    } finally { if (timer) clearTimeout(timer); s.controller = null; s.busy = false; this.active--; }
  }
  private write(key: string, path: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value); const next = (this.writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => atomicJson(path, JSON.parse(serialized)));
    this.writes.set(key, next); void next.finally(() => { if (this.writes.get(key) === next) this.writes.delete(key); }).catch(() => undefined); return next;
  }
  async dispose(): Promise<void> { this.disposed = true; for (const s of this.sessions.values()) s.controller?.abort('tasklens-disposed');
    await Promise.allSettled([...this.loads.values(), ...this.jobs, ...this.writes.values()]); }
}
