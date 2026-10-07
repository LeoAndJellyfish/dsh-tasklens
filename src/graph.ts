import { randomUUID } from 'node:crypto';
import { checkedRefs, refsCurrent } from './sources.js';
import { TASK_LABELS, type Roadmap, type TaskNode, type PublicSource, type SourceRef, type Fact, type FactBasis, type Annotation, type Criterion } from './schema.js';

export const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
export function textValue(v: unknown, max: number, required = true): string {
  if (typeof v !== 'string' || v.trim().length > max || (required && !v.trim())) throw new Error('文字字段缺失或超出长度限制。');
  return v.trim();
}
const strings = (v: unknown, max = 12) => list(v).slice(0, max).map(s => textValue(s, 400));
const unionRefs = (a: SourceRef[], b: SourceRef[]) => [...new Map([...a, ...b].map(r => [`${r.id}:${r.quote}`, r])).values()];
const isUser = (refs: SourceRef[], sources: ReadonlyMap<string, PublicSource>) => refs.some(r => sources.get(r.id)?.role === 'user');
const explicitAcceptance = (quote: string) => !/(?:未|尚未|没有|不|没能).{0,4}(?:完成|符合|满足|通过|接受)|(?:验收|确认).{0,8}失败/.test(quote)
  && /(?:验收通过|确认.{0,35}(?:完成|符合|满足|通过)|已核对.{0,35}(?:符合|满足|通过)|(?:符合|满足).{0,20}(?:要求|预期)|接受.{0,20}(?:交付|结果))/s.test(quote);
const clauses = (quote: string) => quote.split(/[，,；;。！!？?\n]/).map(v => v.trim()).filter(Boolean);
const scopePermission = (refs: SourceRef[], sources: ReadonlyMap<string, PublicSource>, node: TaskNode) => refs.some(r => sources.get(r.id)?.role === 'user'
  && clauses(r.quote).some(c => /(?:撤回|取消|放弃|移除|不再|暂缓|替换|改为|采用|改用)/.test(c) && namesObject(c, node)));
function namesObject(quote: string, node: TaskNode, criterion?: Criterion): boolean {
  const names = [node.title, ...node.aliases];
  const formats = names.flatMap(t => t.match(/\b(?:PDF|HTML|CSV|JSON|YAML|PNG|DOCX|PPTX|XLSX)\b/gi) ?? []);
  if (formats.length) return formats.some(format => new RegExp(`\\b${format}\\b`, 'i').test(quote));
  if (names.some(t => quote.replace(/\s/g, '').includes(t.replace(/\s/g, '')))) return true;
  if (criterion?.check?.artifact && quote.includes(criterion.check.artifact)) return true;
  const words = names.flatMap(t => t.match(/[A-Za-z][\w./-]{2,}|[\u4e00-\u9fff]{3,}/g) ?? []);
  return words.some(w => quote.includes(w) || (w.length >= 4 && Array.from({ length: w.length - 2 }, (_, i) => w.slice(i, i + 3)).some(part => quote.includes(part))));
}
function acceptsObject(quote: string, node: TaskNode, criterion: Criterion, nodes: TaskNode[]): boolean {
  let subject: TaskNode[] = [];
  for (const clause of clauses(quote)) {
    if (explicitAcceptance(clause) && namesObject(clause, node, criterion)) return true;
    const named = nodes.filter(n => n.goalId === node.goalId && n.kind === node.kind && namesObject(clause, n));
    if (named.length) subject = named;
    if (explicitAcceptance(clause) && subject.length === 1 && subject[0].id === node.id) return true;
  }
  return false;
}
export interface GraphContext {
  sources: ReadonlyMap<string, PublicSource>; batch: PublicSource[]; loadedNodeIds: Set<string>;
  quotedOnly?: ReadonlyMap<string, string[]>;
  protectedComplete: boolean; pendingUserIds: Set<string>; sourceRevision: string;
}
export interface AnalysisResult { graph: Roadmap; facts: Fact[]; changed: boolean; rawBriefing: unknown; warnings: string[] }
function acyclic(nodes: TaskNode[], edges: Array<{ from: string; to: string }>): void {
  const ids = new Set(nodes.map(n => n.id)); const out = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) throw new Error('关系端点无效。');
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  const walk = (id: string) => { if (visiting.has(id)) throw new Error('任务关系出现循环。'); if (visited.has(id)) return;
    visiting.add(id); for (const next of out.get(id) ?? []) walk(next); visiting.delete(id); visited.add(id); };
  for (const id of ids) walk(id);
}
function fullyVerified(node: TaskNode): boolean {
  const required = node.criteria.filter(c => c.required);
  return node.valid && required.length > 0 && required.every(c => {
    const latest = node.verifications.filter(v => v.criterionId === c.id && v.scopeRevision === node.scopeRevision && v.valid).at(-1);
    return latest?.state === 'passed' && latest.basis !== 'model';
  });
}
function criteriaOf(v: unknown, refs: SourceRef[], sources: ReadonlyMap<string, PublicSource>): Criterion[] {
  if (list(v).length > 12) throw new Error('单个任务的验收项过多。');
  return list(v).map(item => {
    const c = object(item); const check = object(c.check);
    const command = typeof check.command === 'string' ? textValue(check.command, 500) : '';
    const artifact = typeof check.artifact === 'string' ? textValue(check.artifact, 160) : '';
    // A check binding is established from a public plan/call, before accepting its result.
    const binding = command && artifact && refs.some(r => sources.get(r.id)?.type !== 'tool/result' && r.quote.includes(command) && r.quote.includes(artifact));
    return { id: `check-${randomUUID()}`, title: textValue(c.title, 160), required: c.required !== false,
      check: binding ? { command, artifact } : undefined, sources: refs };
  });
}
export function applyAnalysis(previous: Roadmap, raw: unknown, context: GraphContext, now: number): AnalysisResult {
  const input = object(raw); const patch = object(input.graphPatch);
  if (patch.baseGraphVersion !== previous.version || patch.sourceRevision !== context.sourceRevision) throw new Error('分析版本已过期。');
  if (!Array.isArray(patch.operations) || patch.operations.length > 80) throw new Error('任务图变更格式无效。');
  if (patch.operations.filter(v => object(v).type === 'add_node').length > 30) throw new Error('单批新增任务超过上限。');
  const graph = structuredClone(previous); const aliases = new Map<string, string>(); const warnings: string[] = [];
  const idOf = (v: unknown) => aliases.get(String(v)) ?? String(v);
  const nodeOf = (v: unknown, expected?: unknown): TaskNode => {
    const id = idOf(v); const n = graph.nodes.find(n => n.id === id);
    if (!n || (!context.loadedNodeIds.has(id) && ![...aliases.values()].includes(id))) throw new Error(`任务未载入：${id}`);
    if (expected !== undefined && previous.nodes.find(old => old.id === id)?.revision !== expected && ![...aliases.values()].includes(id)) throw new Error('任务版本冲突。');
    return n;
  };
  const changedNodes = new Set<string>();
  const note = (nodeId: string | null, message: string, refs: SourceRef[]) => {
    if (!graph.unresolved.some(u => u.nodeId === nodeId && u.text === message)) graph.unresolved.push({ id: randomUUID(), nodeId, text: message, sources: refs, time: now });
    warnings.push(message);
  };
  for (const item of patch.operations) {
    const op = object(item); const refs = checkedRefs(op.sources, context.sources, context.quotedOnly); const kind = String(op.type);
    if (kind === 'add_goal') {
      const temporaryId = textValue(op.id, 100); if (!temporaryId.startsWith('new-') || aliases.has(temporaryId)) throw new Error('新目标需要独立临时标识。');
      const id = `goal-${randomUUID()}`;
      graph.goals.push({ id, title: textValue(op.title, 100), revision: 1, active: op.active !== false,
        requirements: strings(op.requirements, 30), constraints: list(op.constraints).map(v => {
          const c = object(v); const cr = checkedRefs(c.sources, context.sources, context.quotedOnly); if (!isUser(cr, context.sources)) throw new Error('约束缺少用户来源。');
          return { id: randomUUID(), text: textValue(c.text, 400), sources: cr };
        }), sources: refs });
      aliases.set(temporaryId, id);
    } else if (kind === 'update_goal') {
      const goal = graph.goals.find(g => g.id === idOf(op.goalId));
      if (!goal || goal.revision !== op.expectedRevision || !isUser(refs, context.sources)) throw new Error('目标变更需要当前版本和用户来源。');
      if (!context.protectedComplete) { note(null, '目标范围变更等待全部约束核对。', refs); continue; }
      if (op.title !== undefined) goal.title = textValue(op.title, 100);
      if (op.active !== undefined) goal.active = op.active === true;
      if (op.requirements !== undefined) goal.requirements = [...new Set([...goal.requirements, ...strings(op.requirements, 30)])];
      for (const v of list(op.constraints)) { const c = object(v); const cr = checkedRefs(c.sources, context.sources, context.quotedOnly);
        if (!isUser(cr, context.sources)) throw new Error('约束缺少用户来源。');
        goal.constraints.push({ id: randomUUID(), text: textValue(c.text, 400), sources: cr }); }
      goal.revision++; goal.sources = unionRefs(goal.sources, refs);
    } else if (kind === 'add_node') {
      const temp = textValue(op.id, 100); if (!temp.startsWith('new-') || aliases.has(temp)) throw new Error('新任务需要独立临时标识。');
      const goalId = idOf(op.goalId); if (!graph.goals.some(g => g.id === goalId)) throw new Error('任务目标不存在。');
      const existing = graph.nodes.find(n => n.goalId === goalId && (n.title === op.title || n.aliases.includes(String(op.title))));
      if (existing) throw new Error(`相同目标已有此任务，请沿用节点标识 ${existing.id}；原节点可通过 needsContext 请求。`);
      const parentId = op.parentId ? nodeOf(op.parentId).id : null;
      if (parentId && graph.nodes.find(n => n.id === parentId)?.goalId !== goalId) throw new Error('任务父级属于其他目标。');
      if (parentId) { const parent = graph.nodes.find(n => n.id === parentId)!; if (parent.kind === 'task') { parent.kind = 'phase'; parent.revision++; changedNodes.add(parent.id); } }
      const status = String(op.status ?? 'pending'); if (!(status in TASK_LABELS)) throw new Error('任务状态无效。');
      const authority = isUser(refs, context.sources) ? 'user' : op.authority === 'adopted' ? 'adopted' : 'proposed';
      const n: TaskNode = { id: `task-${randomUUID()}`, goalId, parentId, kind: op.kind === 'phase' ? 'phase' : 'task', title: textValue(op.title, 100), aliases: [],
        order: graph.nodes.length, revision: 1, scopeRevision: 1, scopeStartSeq: Math.min(...refs.map(r => context.sources.get(r.id)!.seq)), authority, status: status === 'done' ? 'review' : status as TaskNode['status'],
        reason: textValue(op.reason ?? '', 500, false), criteria: criteriaOf(op.criteria, refs, context.sources), attempts: [], verifications: [], sources: refs,
        changedAt: now, changedSeq: Math.max(...refs.map(r => context.sources.get(r.id)!.seq)), replaces: null, valid: true, locks: {} };
      if ((n.status === 'abandoned' || n.status === 'superseded') && authority !== 'proposed' && !scopePermission(refs, context.sources, n)) throw new Error('范围撤回缺少用户明确来源。');
      graph.nodes.push(n); aliases.set(temp, n.id); changedNodes.add(n.id);
    } else if (kind === 'update_node' || kind === 'replace_node') {
      const n = nodeOf(op.nodeId, op.expectedNodeRevision);
      if (op.expectedNodeRevision === undefined && ![...aliases.values()].includes(n.id)) throw new Error('修改任务需要预期版本。');
      const changes = kind === 'replace_node' ? { status: 'superseded' } : object(op.changes);
      if (op.newScope === true) {
        if (!refs.some(r => context.sources.get(r.id)?.role === 'user' && clauses(r.quote).some(c => namesObject(c, n) && /(?:新增|增加|补充|扩大|改为|改用|修改|调整|新版|新版本|重新|恢复)/.test(c))) || !context.protectedComplete) { note(n.id, '需求版本变更等待用户来源和约束核对。', refs); continue; }
        n.scopeRevision++; n.scopeStartSeq = Math.max(...refs.filter(r => context.sources.get(r.id)?.role === 'user').map(r => context.sources.get(r.id)!.seq));
        n.criteria = op.criteria === undefined ? n.criteria : criteriaOf(op.criteria, refs, context.sources);
        n.locks = {}; n.status = 'review'; n.valid = true;
      }
      for (const field of ['title', 'status', 'parentId'] as const) {
        if (changes[field] === undefined) continue;
        if (n.locks[field]?.scopeRevision === n.scopeRevision) { note(n.id, `${n.title}的${field === 'status' ? '状态' : field === 'title' ? '名称' : '父级'}已有用户纠正，候选变更待核对。`, refs); continue; }
        if (field === 'title') { const title = textValue(changes.title, 100); if (title !== n.title) n.aliases = [...new Set([...n.aliases, n.title])]; n.title = title; }
        if (field === 'parentId') { const parent = changes.parentId ? nodeOf(changes.parentId).id : null;
          if (parent && graph.nodes.find(v => v.id === parent)?.goalId !== n.goalId) throw new Error('父级目标不一致。'); n.parentId = parent; }
        if (field === 'status') {
          const value = String(changes.status); if (!(value in TASK_LABELS)) throw new Error('任务状态无效。');
          if ((value === 'abandoned' || value === 'superseded') && ((n.authority !== 'proposed' && !scopePermission(refs, context.sources, n)) || !context.protectedComplete)) {
            note(n.id, `${n.title}的撤回或替换缺少有效范围依据。`, refs); continue;
          }
          if (value === 'done' && (!fullyVerified(n) || !context.protectedComplete || n.kind === 'phase' && graph.nodes.some(c => c.parentId === n.id && !['done', 'abandoned', 'superseded'].includes(c.status)))) {
            n.status = 'review'; note(n.id, `${n.title}已报告完成，当前版本验收依据待补。`, refs);
          } else n.status = value as TaskNode['status'];
        }
      }
      if (kind === 'replace_node' && n.status === 'superseded') { n.replaces = nodeOf(op.replacementId).id; if (n.replaces === n.id) throw new Error('任务无法替换自身。'); }
      n.reason = textValue(op.reason, 500); n.sources = unionRefs(n.sources, refs); n.revision++; n.changedAt = now;
      n.changedSeq = Math.max(...refs.map(r => context.sources.get(r.id)!.seq)); changedNodes.add(n.id);
    } else if (kind === 'link_dependency') {
      const from = nodeOf(op.from); const to = nodeOf(op.to);
      if (from.goalId !== to.goalId) throw new Error('依赖属于不同目标。');
      if (to.locks.dependencies?.scopeRevision === to.scopeRevision) { note(to.id, `${to.title}的前置任务已有用户纠正，新增依赖待核对。`, refs); continue; }
      if (!graph.edges.some(e => e.from === from.id && e.to === to.id)) graph.edges.push({ id: randomUUID(), from: from.id, to: to.id, sources: refs });
    } else if (kind === 'record_verification') {
      const n = nodeOf(op.nodeId); const criterion = n.criteria.find(c => c.id === op.criterionId || c.title === op.criterionTitle);
      if (!criterion) throw new Error('验收项不存在。');
      if (op.scopeRevision !== n.scopeRevision) throw new Error('验收来源属于其他需求版本。');
      const evidence = refs.map(r => context.sources.get(r.id)!); const state = op.state === 'passed' || op.state === 'failed' ? op.state : 'unknown';
      const machine = evidence.some(s => s.check && criterion.check && s.seq >= (n.scopeStartSeq ?? 0) && (s.callSeq ?? -1) >= (n.scopeStartSeq ?? 0) && s.check.command.trim() === criterion.check.command.trim()
        && `${s.check.command}\n${s.check.workdir ?? ''}`.includes(criterion.check.artifact) && (state === 'passed' ? s.check.exitCode === 0 && (s.check.failed ?? 0) === 0 : state === 'failed' && (s.check.exitCode !== 0 || (s.check.failed ?? 0) > 0)));
      const confirmed = refs.some(r => context.sources.get(r.id)?.role === 'user' && context.sources.get(r.id)!.seq >= (n.scopeStartSeq ?? 0) && acceptsObject(r.quote, n, criterion, graph.nodes));
      const basis = machine ? 'machine' : confirmed ? 'user' : 'model';
      const sourceKey = refs.map(r => r.id).sort().join(',');
      const attemptId = `attempt-${n.scopeRevision}-${evidence.find(s => s.callId)?.callId ?? sourceKey}`;
      const attempt = n.attempts.find(a => a.id === attemptId);
      if (attempt) { attempt.state = state === 'unknown' ? 'reported' : state; attempt.sources = unionRefs(attempt.sources, refs); attempt.time = now; }
      else n.attempts.push({ id: attemptId, scopeRevision: n.scopeRevision, state: state === 'unknown' ? 'reported' : state, sources: refs, time: now });
      if (!n.verifications.some(v => v.criterionId === criterion.id && v.attemptId === attemptId && v.state === state)) n.verifications.push({
        id: randomUUID(), criterionId: criterion.id, attemptId, scopeRevision: n.scopeRevision, state,
        basis, scope: textValue(op.scope, 240), sources: refs, time: now, valid: true });
      if (!n.locks.status && n.status !== 'abandoned' && n.status !== 'superseded') {
        if (fullyVerified(n) && context.protectedComplete && (n.kind !== 'phase' || graph.nodes.filter(c => c.parentId === n.id && !['abandoned', 'superseded'].includes(c.status)).every(c => c.status === 'done'))) n.status = 'done'; else if (n.status === 'done' || state === 'passed') n.status = 'review';
      }
      n.revision++; n.changedAt = now; n.sources = unionRefs(n.sources, refs); changedNodes.add(n.id);
    } else if (kind === 'record_decision') {
      const nodeId = op.nodeId ? nodeOf(op.nodeId).id : null;
      note(nodeId, textValue(op.text, 500), refs);
    } else throw new Error(`未知任务图操作：${kind}`);
  }
  acyclic(graph.nodes, graph.edges);
  acyclic(graph.nodes, graph.nodes.filter(n => n.parentId).map(n => ({ from: n.parentId!, to: n.id })));
  for (const id of aliases.values()) { const n = graph.nodes.find(n => n.id === id); if (n?.kind === 'phase' && !graph.nodes.some(c => c.parentId === n.id)) n.kind = 'task'; }
  // Phase states follow the required live children; archived alternatives stay in history.
  for (const phase of graph.nodes.filter(n => n.kind === 'phase').reverse()) {
    const children = graph.nodes.filter(n => n.parentId === phase.id && !['abandoned', 'superseded'].includes(n.status));
    if (children.length && children.every(n => n.status === 'done') && (phase.criteria.length === 0 || fullyVerified(phase)) && !phase.locks.status) phase.status = 'done';
    else if (phase.status === 'done' && children.some(n => n.status !== 'done') && !phase.locks.status) phase.status = 'active';
    else if (phase.status === 'pending' && children.some(n => n.status !== 'pending') && !phase.locks.status) phase.status = 'active';
    if (phase.status !== previous.nodes.find(n => n.id === phase.id)?.status && phase.revision === previous.nodes.find(n => n.id === phase.id)?.revision) { phase.revision++; phase.changedAt = now; changedNodes.add(phase.id); }
  }
  const facts: Fact[] = [];
  if (list(input.factCandidates).length > 40) throw new Error('候选事实过多。');
  for (const item of list(input.factCandidates)) {
    const f = object(item); const id = textValue(f.id, 100); if (!id.startsWith('c-') || facts.some(v => v.id === id)) throw new Error('候选事实标识无效。');
    const refs = checkedRefs(f.sources, context.sources, context.quotedOnly); const evidence = refs.map(r => context.sources.get(r.id)!);
    const nodeIsGoal = f.nodeId && graph.goals.some(g => g.id === idOf(f.nodeId));
    const goalRef = f.goalId ?? (nodeIsGoal ? f.nodeId : null);
    const goal = goalRef ? graph.goals.find(g => g.id === idOf(goalRef)) : null;
    if (goalRef && !goal) throw new Error('事实目标不存在。');
    const node = f.nodeId && !nodeIsGoal ? nodeOf(f.nodeId) : null; const claim = textValue(f.claim, 300);
    if (node && goal && node.goalId !== goal.id) throw new Error('事实的任务与目标不一致。');
    if (node && f.scopeRevision != null && f.scopeRevision !== node.scopeRevision) throw new Error('事实属于其他需求版本。');
    const digits = claim.match(/\d+(?:\.\d+)?/g) ?? [];
    if (digits.some(d => !refs.some(r => r.quote.includes(d)))) throw new Error('事实中的数字缺少来源。');
    const requested = f.action === 'user' && refs.some(r => context.pendingUserIds.has(r.id));
    if (f.action === 'user' && !requested && !evidence.every(s => s.role === 'user')) throw new Error('用户待办缺少尚待处理的请求。');
    let basis: FactBasis = requested ? 'requested' : evidence.some(s => s.role === 'assistant') ? (f.basis === 'planned' ? 'planned' : 'reported')
      : f.basis === 'planned' ? 'planned' : requested ? 'requested' : evidence.some(s => s.role === 'tool') ? 'observed' : 'decision';
    if (f.basis === 'verified' || f.basis === 'confirmed') {
      const state = /(?:失败|未通过|不符合|未满足|发现.{0,8}问题)/.test(claim.replace(/(?:0|零)\s*(?:项|个)?\s*(?:失败|错误|问题)/g, '')) ? 'failed' : 'passed';
      const verifications = node?.verifications.filter(v => v.valid && v.scopeRevision === node.scopeRevision && v.state === state && v.sources.some(r => refs.some(fr => fr.id === r.id))) ?? [];
      basis = verifications.some(v => v.basis === 'machine') ? 'verified' : verifications.some(v => v.basis === 'user') ? 'confirmed' : evidence.some(s => s.role === 'assistant') ? 'reported' : 'assessed';
    }
    if (basis === 'observed' && /(?:已完成|全部.{0,8}通过|已发布|已安装|已交付|成功发布|完成了)/.test(claim)
      && (!node || !fullyVerified(node))) basis = 'assessed';
    if (f.basis === 'unknown') basis = 'unknown';
    if (basis === 'planned' && !refs.some(r => /(?:计划|接下来|将|准备|继续|需要|先|再)/.test(r.quote)
      || context.sources.get(r.id)?.role === 'assistant' && /(?:计划|接下来|将|准备|先|再|最后|然后)/.test(context.sources.get(r.id)!.text) && !/(?:已完成|已经|通过了|已发布)/.test(r.quote))) throw new Error('下一步计划缺少来源。');
    if (basis === 'unknown' && !refs.some(r => /(?:缺失|缺少|未|待|暂无|没有|未知|等待)/.test(r.quote))) throw new Error('信息缺口缺少来源。');
    const existing = graph.facts.find(old => old.valid && old.nodeId === (node?.id ?? null) && old.goalId === (node?.goalId ?? goal?.id ?? null) && old.claim === claim && old.basis === basis && old.sources.map(r => r.id).join() === refs.map(r => r.id).join());
    const fact: Fact = { id, nodeId: node?.id ?? null, goalId: node?.goalId ?? goal?.id ?? null, scopeRevision: node?.scopeRevision ?? goal?.revision ?? 1,
      claim, basis, actor: requested || evidence.every(s => s.role === 'user') ? 'user' : evidence.every(s => s.role === 'assistant') || basis === 'planned' ? 'agent' : 'system',
      scope: textValue(f.scope ?? '', 240, false), sources: refs, valid: true, time: now, action: f.action === 'agent' && basis === 'planned' ? 'agent' : requested ? 'user' : null };
    facts.push(fact); if (!existing) graph.facts.push({ ...fact, id: `fact-${randomUUID()}` });
  }
  const meaningful = (value: unknown) => JSON.stringify(value, (key, item) => ['revision', 'changedAt', 'changedSeq', 'time'].includes(key) ? undefined : item);
  const changed = meaningful({ goals: previous.goals, nodes: previous.nodes, edges: previous.edges, facts: previous.facts, unresolved: previous.unresolved })
    !== meaningful({ goals: graph.goals, nodes: graph.nodes, edges: graph.edges, facts: graph.facts, unresolved: graph.unresolved });
  graph.version++; graph.sourceRevision = context.sourceRevision;
  for (const n of graph.nodes) { const old = previous.nodes.find(o => o.id === n.id);
    if (!old || n.status !== old.status || n.scopeRevision !== old.scopeRevision || n.reason !== old.reason) graph.changes.push({ id: randomUUID(), nodeId: n.id, time: now, from: old?.status ?? null, to: n.status, scopeRevision: n.scopeRevision, reason: n.reason, sources: n.sources.slice(-12) }); }
  for (const s of context.batch) graph.analyzed[s.id] = s.hash;
  if (context.batch.length) graph.episodes.push({ id: randomUUID(), fromSeq: context.batch[0].seq, toSeq: context.batch.at(-1)!.seq,
    nodeIds: [...changedNodes], factIds: graph.facts.filter(f => f.time === now).map(f => f.id), sources: context.batch.map(s => s.id) });
  return { graph, facts, changed, rawBriefing: input.briefing, warnings };
}
export function invalidateSources(graph: Roadmap, sources: ReadonlyMap<string, PublicSource>): boolean {
  let changed = false;
  for (const node of graph.nodes) {
    for (const verification of node.verifications) if (verification.valid && verification.sources.length && !refsCurrent(verification.sources, sources)) { verification.valid = false; changed = true; }
    if (node.valid && !refsCurrent(node.sources, sources)) { node.valid = false; changed = true; if (node.status === 'done') node.status = 'review'; }
  }
  for (const fact of graph.facts) if (fact.valid && fact.sources.length && !refsCurrent(fact.sources, sources)) { fact.valid = false; changed = true; }
  if (changed) graph.briefing = null;
  return changed;
}
export function applyAnnotation(previous: Roadmap, a: Annotation, remap = false): Roadmap {
  const graph = structuredClone(previous);
  if (graph.changes.some(c => c.id === a.id)) return graph;
  const n = graph.nodes.find(n => n.id === a.nodeId) ?? (remap ? graph.nodes.find(n => n.goalId === graph.goals.find(g => g.title === a.goalTitle)?.id
    && (n.title === a.nodeTitle || n.aliases.includes(a.nodeTitle) || n.sources.some(s => a.sourceIds.includes(s.id)))) : undefined);
  if (!n || n.scopeRevision !== a.scopeRevision) throw new Error('纠正对应的任务版本已变化。');
  const oldStatus = n.status;
  if (a.field === 'title') { n.aliases = [...new Set([...n.aliases, n.title])]; n.title = textValue(a.value, 100); }
  else if (a.field === 'status') {
    if (!a.value || !(a.value in TASK_LABELS)) throw new Error('纠正状态无效。');
    n.status = a.value as TaskNode['status'];
    if (n.status === 'done' && n.kind === 'phase' && graph.nodes.some(c => c.parentId === n.id && !['done', 'abandoned', 'superseded'].includes(c.status))) throw new Error('此阶段仍有未完成子任务，请先核对子任务。');
    if (n.status === 'done') for (const c of n.criteria) n.verifications.push({ id: a.id + ':' + c.id, criterionId: c.id, attemptId: a.id,
      scopeRevision: n.scopeRevision, state: 'passed', basis: 'user', scope: a.reason, sources: [], time: a.time, valid: true });
  } else if (a.field === 'parentId') { if (a.value && !graph.nodes.some(p => p.id === a.value && p.goalId === n.goalId && p.kind === 'phase')) throw new Error('纠正父级无效。'); n.parentId = a.value;
  } else if (a.field === 'dependencies') {
    const ids = JSON.parse(a.value ?? '[]') as unknown; if (!Array.isArray(ids) || ids.length > 40 || ids.some(id => typeof id !== 'string')) throw new Error('前置任务列表无效。');
    const resolve = (id: string) => graph.nodes.find(p => p.id === id) ?? (remap ? graph.nodes.find(p => p.goalId === n.goalId && p.title === a.related?.find(r => r.id === id)?.title) : undefined);
    const predecessors = [...new Set(ids)].map(id => resolve(id));
    if (predecessors.some(p => !p || p.goalId !== n.goalId || p.id === n.id)) throw new Error('前置任务已变化，请重新核对。');
    graph.edges = graph.edges.filter(e => e.to !== n.id);
    predecessors.forEach((p, i) => graph.edges.push({ id: `${a.id}:${i}`, from: p!.id, to: n.id, sources: [] }));
  } else if (a.field === 'merge') {
    const target = graph.nodes.find(p => p.id === a.value) ?? (remap ? graph.nodes.find(p => p.goalId === n.goalId && p.title === a.related?.[0]?.title) : undefined);
    if (!target || target.id === n.id || target.kind !== 'task' || n.kind !== 'task' || target.goalId !== n.goalId || ['superseded', 'abandoned'].includes(target.status)
      || target.scopeRevision !== a.related?.[0]?.scopeRevision) throw new Error('合并目标或需求版本已变化。');
    target.aliases = [...new Set([...target.aliases, n.id, n.title, ...n.aliases])]; target.sources = unionRefs(target.sources, n.sources);
    target.criteria.push(...n.criteria.filter(c => !target.criteria.some(t => t.title === c.title)));
    target.attempts.push(...n.attempts); target.verifications.push(...n.verifications.map(v => ({ ...v, valid: false })));
    target.scopeRevision++; target.scopeStartSeq = Math.max(n.changedSeq, target.changedSeq) + 1; target.status = 'review'; target.reason = a.reason; target.revision++; target.changedAt = a.time; target.locks = {};
    n.status = 'superseded'; n.replaces = target.id;
    const rewired = graph.edges.map(e => ({ ...e, from: e.from === n.id ? target.id : e.from, to: e.to === n.id ? target.id : e.to })).filter(e => e.from !== e.to);
    graph.edges = [...new Map(rewired.map(e => [e.from + ':' + e.to, e])).values()];
    target.locks.dependencies = { value: JSON.stringify(graph.edges.filter(e => e.to === target.id).map(e => e.from)), scopeRevision: target.scopeRevision, annotationId: a.id };
    graph.changes.push({ id: `${a.id}:target`, nodeId: target.id, time: a.time, from: previous.nodes.find(p => p.id === target.id)?.status ?? null, to: target.status, scopeRevision: target.scopeRevision, reason: `用户合并：${a.reason}`, sources: [] });
  } else if (a.field === 'split') {
    const titles = (a.value ?? '').split('\n').map(t => t.trim()).filter(Boolean);
    if (n.kind !== 'task' || titles.length < 2 || titles.length > 8 || new Set(titles).size !== titles.length || titles.some(t => t.length > 100)) throw new Error('拆分需要 2—8 个不同的子任务名称。');
    if (graph.nodes.some(p => p.parentId === n.id)) throw new Error('此任务已有子项，请直接调整子任务。');
    n.kind = 'phase'; n.status = 'active';
    titles.forEach((title, i) => { const id = `task-${a.id}-${i}`;
      graph.nodes.push({ ...structuredClone(n), id, parentId: n.id, kind: 'task', title, aliases: [], order: graph.nodes.length,
        revision: 1, status: 'pending', criteria: [{ id: `check-${a.id}-${i}`, title: `${title}符合要求`, required: true, sources: n.sources }],
        attempts: [], verifications: [], replaces: null, reason: `用户拆分：${a.reason}`, locks: { parentId: { value: n.id, scopeRevision: n.scopeRevision, annotationId: a.id } } });
      graph.changes.push({ id: `${a.id}:${i}`, nodeId: id, time: a.time, from: null, to: 'pending', scopeRevision: n.scopeRevision, reason: `用户拆分：${a.reason}`, sources: n.sources });
    });
  }
  const lockField = a.field === 'merge' || a.field === 'split' ? 'structure' : a.field;
  n.locks[lockField] = { value: a.value, scopeRevision: n.scopeRevision, annotationId: a.id };
  if (a.field === 'merge') n.locks.status = { value: 'superseded', scopeRevision: n.scopeRevision, annotationId: a.id };
  n.reason = a.reason; n.valid = true; n.revision++; n.changedAt = a.time;
  acyclic(graph.nodes, graph.nodes.filter(n => n.parentId).map(n => ({ from: n.parentId!, to: n.id })));
  acyclic(graph.nodes, graph.edges);
  graph.changes.push({ id: a.id, nodeId: n.id, time: a.time, from: oldStatus, to: n.status, scopeRevision: n.scopeRevision, reason: `用户纠正：${a.reason}`, sources: [] });
  const description = { title: '名称', parentId: '所属阶段', dependencies: '前置任务', merge: '合并关系', split: '拆分结构' };
  const fact: Fact = { id: `annotation-${a.id}`, nodeId: n.id, goalId: n.goalId, scopeRevision: n.scopeRevision, claim: a.field === 'status' ? `用户已确认${n.title}的状态为${TASK_LABELS[n.status]}。` : `用户已纠正${n.title}的${description[a.field]}。`, basis: 'confirmed', actor: 'user', scope: a.reason, sources: [], valid: true, time: a.time, action: null };
  graph.facts.push(fact); graph.version++;
  graph.briefing = { headline: { text: fact.claim, factIds: [fact.id] }, summary: [], agentNext: [], userActions: [], details: [], styleVersion: 2, fallback: true };
  return graph;
}
