import type { Preferences } from './shared.js';
import type { PublicSource, Roadmap, TaskNode, SourceRef } from './schema.js';
import { pendingUserSourceIds, sourceRevision } from './sources.js';
import { roadmapPrompt, STYLE_VERSION } from './protocol.js';
import type { GraphContext } from './graph.js';

/** Conservative fallback, including JSON and protocol bytes; the UI labels it as estimated. */
export function estimateTokens(text: string): number { return Math.ceil(Buffer.byteLength(text, 'utf8') / 2); }
export interface WorkContext extends GraphContext {
  request: string; system: string; estimate: number; limit: number; protectedOmitted: number;
  throughSeq: number; round: number; factsLoaded: Set<string>; extraUsed: string[];
}
function scoreNode(node: TaskNode, text: string): number {
  const keys = [node.id, node.title, ...node.aliases, ...node.criteria.flatMap(c => [c.title, c.check?.command ?? '', c.check?.artifact ?? ''])].flatMap(v => v.match(/[A-Za-z][\w./-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? []);
  return keys.reduce((sum, key) => sum + (text.includes(key) ? 8 : key.length > 4 && text.includes(key.slice(-4)) ? 2 : 0), 0)
    + (node.status === 'active' ? 3 : node.status === 'blocked' ? 2 : 0);
}
/** Only the current proof and a small recent history enter the model window. The full record stays on disk. */
function workingNode(node: TaskNode): TaskNode & { historyCounts: { attempts: number; verifications: number; sources: number } } {
  const latest = node.criteria.flatMap(c => node.verifications.filter(v => v.criterionId === c.id && v.scopeRevision === node.scopeRevision && v.valid).slice(-1));
  return { ...node, sources: [...new Map([...node.sources.slice(0, 1), ...node.sources.slice(-2)].map(r => [r.id + r.quote, r])).values()],
    attempts: node.attempts.slice(-2), verifications: latest,
    historyCounts: { attempts: node.attempts.length, verifications: node.verifications.length, sources: node.sources.length } };
}
export function buildContext(graph: Roadmap, sources: PublicSource[], preferences: Preferences, options: {
  preview?: boolean; limit?: number; extraSourceIds?: string[]; extraNodeIds?: string[]; styleVersion?: number; protectedComplete?: boolean;
} = {}): WorkContext {
  const system = roadmapPrompt(preferences); const limit = Math.min(preferences.inputBudget, options.limit ?? preferences.inputBudget);
  const available = sources.filter(s => graph.analyzed[s.id] !== s.hash);
  const stream = options.preview ? available.slice().reverse() : available;
  if (!stream.length) throw new Error('没有尚待分析的公开记录。');
  const revision = sourceRevision(sources);
  const goals: unknown[] = []; let protectedOmitted = 0;
  const payload: Record<string, unknown> = {
    frame: { sessionId: graph.sessionId, generation: graph.generation, baseGraphVersion: graph.version,
      sourceRevision: revision, throughSeq: -1, styleVersion: options.styleVersion ?? STYLE_VERSION },
    goals, nodeIndex: [], nodes: [], edges: [], facts: [], episodes: [], unresolved: [], sources: [], batchIds: [],
    protectedComplete: true, pendingUserSourceIds: [], previousBriefing: graph.briefing,
  };
  const cost = () => estimateTokens(system) + estimateTokens(JSON.stringify(payload)) + 200;
  // Protected records are admitted whole. Omitted protected groups block sensitive graph operations.
  for (const goal of graph.goals) {
    const protectedGoal = { ...goal, sources: goal.sources.slice(0, 2) };
    goals.push(protectedGoal);
    if (cost() > limit - 1500) { goals.pop(); protectedOmitted += goal.constraints.length + goal.requirements.length + 1; }
  }
  const batch: PublicSource[] = []; const publicInput = payload.sources as PublicSource[];
  const eventBudget = Math.max(1000, Math.min(2400, limit - cost() - 1800)); let eventCost = 0;
  for (const source of stream) {
    const n = estimateTokens(JSON.stringify(source));
    if (batch.length && eventCost + n > eventBudget) break;
    if (cost() + n > limit - 350) { if (!batch.length) throw new Error('当前模型输入预算不足以容纳协议、约束和一条来源，请增加输入预算。'); break; }
    batch.push(source); publicInput.push(source); eventCost += n;
    if (batch.length >= 32) break;
  }
  batch.sort((a, b) => a.seq - b.seq || a.part - b.part); publicInput.sort((a, b) => a.seq - b.seq || a.part - b.part);
  const cut = batch.at(-1)!; const text = batch.map(s => s.text).join('\n');
  const ranked = graph.nodes.map(n => ({ node: n, score: scoreNode(n, text) + (options.extraNodeIds?.includes(n.id) ? 100 : 0) })).sort((a, b) => b.score - a.score || a.node.order - b.node.order);
  const selected = new Set<string>();
  for (const { node, score } of ranked) {
    if (selected.size >= 16 || (score === 0 && selected.size >= 4)) break;
    selected.add(node.id); if (node.parentId) selected.add(node.parentId);
    for (const edge of graph.edges) if (edge.to === node.id) selected.add(edge.from);
  }
  const nodes = payload.nodes as TaskNode[];
  for (const id of selected) { const n = graph.nodes.find(n => n.id === id); if (!n) continue;
    nodes.push(workingNode(n)); if (cost() > limit - 750) nodes.pop(); }
  const loaded = new Set(nodes.map(n => n.id));
  const edges = payload.edges as Roadmap['edges'];
  for (const edge of graph.edges.filter(e => loaded.has(e.from) && loaded.has(e.to))) { edges.push(edge); if (cost() > limit - 600) edges.pop(); }
  const facts = graph.facts.filter(f => f.valid && (!f.nodeId || loaded.has(f.nodeId) && graph.nodes.find(n => n.id === f.nodeId)?.scopeRevision === f.scopeRevision)
    && (f.nodeId || !f.goalId || graph.goals.find(g => g.id === f.goalId)?.revision === f.scopeRevision)).slice(-20);
  const loadedFacts: Roadmap['facts'] = payload.facts as Roadmap['facts'];
  for (const fact of facts.reverse()) { loadedFacts.push(fact); if (cost() > limit - 500) loadedFacts.pop(); }
  const unresolved = payload.unresolved as Roadmap['unresolved'];
  for (const item of graph.unresolved.filter(u => !u.nodeId || loaded.has(u.nodeId)).slice(-6)) { unresolved.push(item); if (cost() > limit - 400) unresolved.pop(); }
  const episodes: Roadmap['episodes'] = payload.episodes as Roadmap['episodes'];
  for (const episode of graph.episodes.slice(-6).reverse()) { episodes.push(episode); if (cost() > limit - 250) episodes.pop(); }
  const existing = new Set(publicInput.map(s => s.id));
  const olderIds = [...(options.extraSourceIds ?? []), ...nodes.flatMap(n => n.sources.slice(-2).map(r => r.id)), ...loadedFacts.flatMap(f => f.sources.map(r => r.id))];
  // The initial user task supplies identity for a partial preview; it is not counted as a backfilled interval.
  if (options.preview) olderIds.push(...sources.filter(s => s.role === 'user').slice(0, 2).map(s => s.id));
  for (const id of [...new Set(olderIds)]) {
    const s = sources.find(s => s.id === id && (s.seq < cut.seq || s.seq === cut.seq && s.part <= cut.part));
    if (!s || existing.has(id)) continue;
    publicInput.push(s); if (cost() > limit - 180) publicInput.pop(); else existing.add(id);
  }
  const index = payload.nodeIndex as unknown[];
  for (const { node } of ranked) {
    if (loaded.has(node.id)) continue;
    index.push({ id: node.id, goalId: node.goalId, parentId: node.parentId, title: node.title, aliases: node.aliases, status: node.status, revision: node.revision });
    if (cost() > limit - 180) { index.pop(); break; }
  }
  const pending = pendingUserSourceIds(sources.filter(s => s.seq <= cut.seq));
  payload.pendingUserSourceIds = [...pending].filter(id => existing.has(id));
  const complete = protectedOmitted === 0 && options.protectedComplete !== false;
  payload.protectedComplete = complete;
  payload.batchIds = batch.map(s => s.id);
  payload.frame = { ...payload.frame as object, throughSeq: cut.seq, round: cut.round };
  // Previous prose is expendable; protected facts and source pieces retain their boundaries.
  if (cost() > limit) payload.previousBriefing = null;
  const request = JSON.stringify(payload);
  if (estimateTokens(system) + estimateTokens(request) + 200 > limit) throw new Error('输入预算检查失败，本批来源保留在队列中。');
  // Quotes already disclosed in loaded records remain citable, without loading the full old event.
  // Every such quote is rechecked against the current append-origin source and the historical cut.
  const sourceMap = new Map(publicInput.map(s => [s.id, s])); const quotedOnly = new Map<string, string[]>();
  const sourceIndex = new Map(sources.map(s => [s.id, s]));
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const item = value as Record<string, unknown>;
    if (typeof item.id === 'string' && typeof item.hash === 'string' && typeof item.quote === 'string') {
      const ref = item as unknown as SourceRef; const original = sourceIndex.get(ref.id);
      if (original?.hash === ref.hash && original.text.includes(ref.quote) && (original.seq < cut.seq || original.seq === cut.seq && original.part <= cut.part)) {
        if (!existing.has(ref.id)) { sourceMap.set(ref.id, original); quotedOnly.set(ref.id, [...(quotedOnly.get(ref.id) ?? []), ref.quote]); }
      }
    }
    Object.values(item).forEach(visit);
  };
  [goals, nodes, edges, loadedFacts, unresolved].forEach(visit);
  return { system, request, estimate: cost(), limit, sources: sourceMap, quotedOnly, batch,
    loadedNodeIds: loaded, protectedComplete: complete, pendingUserIds: pending, sourceRevision: revision,
    throughSeq: cut.seq, round: cut.round, protectedOmitted, factsLoaded: new Set(loadedFacts.map(f => f.id)), extraUsed: [...existing].filter(id => !batch.some(s => s.id === id)) };
}
