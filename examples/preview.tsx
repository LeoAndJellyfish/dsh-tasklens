import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from '../src/client/Panel.js';
import { TaskLensClient } from '../src/client/api.js';
import { CSS } from '../src/client/styles.js';
import { DEFAULTS, EMPTY_ACTIVITY, type SessionView } from '../src/shared.js';
import { emptyRoadmap, type Roadmap, type TaskNode, type TimelineEntry, type SourceRef } from '../src/schema.js';

// This example uses synthetic records and the production React components. It makes no model calls.
const sessionId = 'tasklens-ui-example';
const now = Date.parse('2026-10-07T08:30:00Z');
const source = (seq: number, quote: string): SourceRef[] => [{ id: `s-${seq}-0`, hash: '0'.repeat(64), quote }];
const nodes: Array<[string, string, string | null, TaskNode['status'], string]> = [
  ['phase-a', '基础能力', null, 'done', '需求和侧栏入口已完成核对。'],
  ['phase-b', '持续记忆', null, 'active', '任务记录已经保存，历史正在分批回溯。'],
  ['phase-c', '验收与发布', null, 'active', '先检查长对话，再验收实际任务。'],
  ['requirements', '明确需求与接入接口', 'phase-a', 'done', '侧栏入口和模型列表已核对。'],
  ['sidebar', '原生侧栏总览', 'phase-a', 'done', '侧栏可以随会话切换，检查已通过。'],
  ['memory', '持久任务图与增量更新', 'phase-b', 'active', '正在检查新增要求和旧任务的对应关系。'],
  ['backfill', '完整历史回溯', 'phase-b', 'blocked', '第 1—4 轮原始记录尚未读齐，真实任务验收正在等待这段历史。'],
  ['replay', '长对话回放验证', 'phase-c', 'active', '正在核对早期约束、需求改版和失败后的重试记录。'],
  ['accept', '真实任务验收', 'phase-c', 'waiting', '等待历史回溯补齐，再检查当前需求的完成依据。'],
  ['release', '发布路线图版本', 'phase-c', 'pending', '完成验收后发布。'],
  ['old-summary', '连续压缩上一份摘要', null, 'superseded', '用户已选择持久任务图，原摘要方案保留在历史中。'],
  ['cross-session', '本版跨会话合并', null, 'abandoned', '用户撤回本版跨会话合并要求。'],
];
function fixture(round: number, count = 0): Roadmap {
  const graph = emptyRoadmap(sessionId, 'example'); graph.version = round; graph.sourceRevision = `example-${round}`;
  graph.goals.push({ id: 'goal', title: 'TaskLens 路线图升级', revision: 1, active: true, requirements: ['记录整个对话的任务变化'], constraints: [{ id: 'c1', text: '完成状态需要当前版本的验收依据', sources: source(1, '请保留每项任务的验收依据。') }], sources: source(1, '请升级 TaskLens 路线图。') });
  graph.nodes = nodes.map(([id, title, parentId, status, reason], i) => ({ id, goalId: 'goal', title, parentId, status: round < 11 && status === 'blocked' ? 'active' : status,
    kind: id.startsWith('phase-') ? 'phase' : 'task', reason, authority: 'user', aliases: [], order: i, revision: 1, scopeRevision: 1, valid: true,
    criteria: id.startsWith('phase-') ? [] : [{ id: `check-${id}`, title: `${title}满足本版要求`, required: true, sources: source(i + 1, reason) }],
    attempts: [], verifications: status === 'done' ? [{ id: `v-${id}`, criterionId: `check-${id}`, attemptId: `a-${id}`, scopeRevision: 1, state: 'passed', basis: 'user', scope: '当前版本', sources: source(i + 1, reason), time: now, valid: true }] : [],
    sources: source(i + 1, reason), changedAt: now, changedSeq: i + 1, replaces: id === 'old-summary' ? 'memory' : null, locks: {} }));
  const pairs = [['requirements', 'sidebar'], ['sidebar', 'memory'], ['sidebar', 'backfill'], ['memory', 'replay'], ['backfill', 'accept'], ['memory', 'accept'], ['replay', 'release'], ['accept', 'release']];
  graph.edges = pairs.map(([from, to], i) => ({ id: `edge-${i}`, from, to, sources: source(2, '先完成前置任务，再进行验收。') }));
  if (round < 6) graph.nodes = graph.nodes.filter(n => !['replay', 'accept', 'release', 'cross-session', 'old-summary'].includes(n.id));
  if (round < 11) graph.nodes = graph.nodes.filter(n => !['cross-session', 'old-summary'].includes(n.id));
  graph.edges = graph.edges.filter(e => graph.nodes.some(n => n.id === e.from) && graph.nodes.some(n => n.id === e.to));
  for (let i = 0; i < count; i++) graph.nodes.push({ ...structuredClone(graph.nodes[3]), id: `extra-${i}`, title: `历史任务 ${i + 1}`, parentId: i % 2 ? 'phase-a' : 'phase-c', status: i % 7 === 0 ? 'pending' : 'done', order: 30 + i });
  graph.briefing = { headline: { text: round < 11 ? '任务图已保存，正在回溯历史' : '历史缺口正在影响任务验收', factIds: [] },
    summary: [{ text: round < 11 ? '早期需求正在分批核对，侧栏入口和模型列表已完成检查。' : '侧栏和任务记录已完成检查。第 1—4 轮原始记录尚未读齐，真实任务验收需要等待历史补齐。', factIds: [] }],
    agentNext: [{ text: '执行 AI 计划继续读取早期记录，并核对需求改版后的验收依据。', factIds: [] }], userActions: [], details: [], styleVersion: 2, fallback: false };
  return graph;
}
const entries: TimelineEntry[] = [2, 6, 11, 15].map((round, i) => ({ id: `history-${round}`, commit: i + 1, branch: 'live', generation: 'example', throughSeq: round * 4, round,
  time: now - (3 - i) * 600000, title: ['确认需求', '接入侧栏', '调整路线', '检查历史'][i], trigger: ['确认需求', '接入侧栏', '调整路线', '当前'][i], model: null, key: true, preview: false }));
let view: SessionView = { sessionId, preferences: { ...DEFAULTS }, activity: { ...EMPTY_ACTIVITY, status: 'running', label: '执行 AI 正在回溯历史' }, paused: true,
  checkpoints: [], roadmap: fixture(15), timeline: entries, coverage: { analyzedParts: 64, totalParts: 80, completeRounds: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], pendingRounds: [1, 2, 3, 4], invalidSources: 0, rebuilding: true, backfillPaused: false, observedSeq: 80, analyzedSeq: 80 },
  commitVersion: 4, budget: { estimatedInput: 7520, inputLimit: 8000, protectedOmitted: 0, tokensThisHour: 58000, tokenLimit: 400000 }, busy: false, error: null,
  notice: '此页面使用合成任务记录；模型调用已关闭。', nextAutomaticAt: null, callsThisHour: 7, callsTotal: 12, tokensTotal: 78000 };
const initialView = structuredClone(view);
const api = new TaskLensClient({ call: async (_channel: string, method: string, input: any) => {
  let value: unknown;
  if (method === 'history') { const entry = entries.find(e => e.id === input.entryId)!; value = { entry, roadmap: fixture(entry.round) }; }
  else if (method === 'sources') value = input.refs.map((ref: SourceRef) => ({ ref, validity: 'current', source: { id: ref.id, seq: Number(ref.id.split('-')[1]), part: 0, parts: 1, round: 11, time: now, type: 'user/message', role: 'user', hash: ref.hash, text: ref.quote } }));
  else if (method === 'models') value = [{ provider: 'example', providerName: '示例供应商', model: 'example-model', name: '示例模型' }];
  else { if (method === 'pause') view = { ...view, paused: input.paused }; if (method === 'backfill') view = { ...view, coverage: { ...view.coverage, backfillPaused: input.paused } }; if (method === 'preferences') view = { ...view, preferences: input.preferences }; value = view; }
  return { ok: true, value };
} } as any);
function App() {
  const [width, setWidth] = useState(736), [dark, setDark] = useState(false), [bound, setBound] = useState(sessionId);
  const reset = (fresh: boolean) => { const id = fresh ? 'tasklens-paused-example' : sessionId; view = { ...structuredClone(initialView), sessionId: id };
    if (fresh) view = { ...view, activity: { ...EMPTY_ACTIVITY }, roadmap: null, timeline: [], commitVersion: 0, callsThisHour: 0, callsTotal: 0, tokensTotal: 0,
      coverage: { ...view.coverage, analyzedParts: 0, totalParts: 0, completeRounds: [], pendingRounds: [], rebuilding: false } };
    setBound(id); void api.pull(id); };
  return <div className="example-page" data-theme={dark ? 'dark' : 'light'}><style>{CSS + '.example-toolbar{color:#192538}'}</style><div className="example-toolbar"><strong>TaskLens · 界面验收</strong><span>合成记录 · 使用正式版组件</span>{[736, 480, 320].map(w => <button key={w} aria-pressed={width === w} onClick={() => setWidth(w)}>{w}px</button>)}<button onClick={() => setDark(!dark)}>{dark ? '浅色' : '深色'}</button><button onClick={() => { view = { ...view, roadmap: fixture(15, 500) }; void api.pull(bound); }}>500 项</button><button onClick={() => reset(true)}>新对话</button><button onClick={() => reset(false)}>示例路线</button></div><main style={{ width }}><Panel api={api} boundSessionId={bound}/></main></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
