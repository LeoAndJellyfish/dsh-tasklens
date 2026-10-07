import { publicSources, sourceRevision, pendingUserSourceIds } from '../src/sources.js';
import { applyAnalysis, type GraphContext } from '../src/graph.js';
import { emptyRoadmap, type Roadmap } from '../src/schema.js';
import type { ObservedEvent } from '../src/core.js';
export const ev = (type: string, seq: number, data: unknown): ObservedEvent => ({ type, seq, time: 100000 + seq, data });
export const msg = (text: string) => ({ content: [{ type: 'text', text }] });
export const user = (seq: number, text: string) => ev('user/message', seq, msg(text));
export const assistant = (seq: number, text: string) => ev('assistant/message', seq, { message: msg(text) });
export const call = (seq: number, id: string, command: string) => ev('tool/call', seq, { callId: id, name: 'exec_command', arguments: JSON.stringify({ cmd: command }) });
export const result = (seq: number, id: string, text: string) => ev('tool/result', seq, { message: { ...msg(text), toolCallId: id } });
export const ref = (seq: number, quote: string) => [{ id: `s-${seq}-0`, quote }];
export function ctx(graph: Roadmap, events: ObservedEvent[], loaded = graph.nodes.map(n => n.id)): GraphContext {
  const sources = publicSources(events); return { sources: new Map(sources.map(s => [s.id, s])), batch: sources,
    loadedNodeIds: new Set(loaded), protectedComplete: true, pendingUserIds: pendingUserSourceIds(sources), sourceRevision: sourceRevision(sources) };
}
export function apply(graph: Roadmap, events: ObservedEvent[], operations: unknown[], factCandidates: unknown[] = []) {
  const context = ctx(graph, events); return applyAnalysis(graph, { graphPatch: { baseGraphVersion: graph.version, sourceRevision: context.sourceRevision, operations }, factCandidates, briefing: {} }, context, 100000 + events.at(-1)!.seq);
}
export function basic() {
  const events = [user(0, '制作 PDF 和 HTML；全程离线运行；测试后发布。'), assistant(1, '先运行 npm test --workspace tasklens 验证 tasklens 单元测试，再安装插件。')];
  const sources = ref(0, '制作 PDF 和 HTML；全程离线运行；测试后发布。');
  const graph = apply(emptyRoadmap('s', 'g'), events, [
    { type: 'add_goal', id: 'new-g', title: '交付报告', requirements: ['PDF', 'HTML'], constraints: [{ text: '全程离线运行', sources }], sources },
    { type: 'add_node', id: 'new-p', goalId: 'new-g', kind: 'phase', title: '制作', sources },
    { type: 'add_node', id: 'new-pdf', goalId: 'new-g', parentId: 'new-p', title: 'PDF 导出', criteria: [{ title: 'PDF 导出符合要求' }], sources },
    { type: 'add_node', id: 'new-html', goalId: 'new-g', parentId: 'new-p', title: 'HTML 导出', criteria: [{ title: 'HTML 导出符合要求' }], sources },
    { type: 'add_node', id: 'new-test', goalId: 'new-g', title: 'tasklens 单元测试', criteria: [{ title: 'tasklens 单元测试通过', check: { command: 'npm test --workspace tasklens', artifact: 'tasklens' } }], sources: ref(1, '先运行 npm test --workspace tasklens 验证 tasklens 单元测试，再安装插件。') },
  ]).graph;
  return { graph, events, pdf: graph.nodes.find(n => n.title === 'PDF 导出')!, html: graph.nodes.find(n => n.title === 'HTML 导出')!, check: graph.nodes.find(n => n.title === 'tasklens 单元测试')! };
}
