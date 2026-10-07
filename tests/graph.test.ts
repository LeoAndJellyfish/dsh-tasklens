import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAnalysis, applyAnnotation, invalidateSources } from '../src/graph.js';
import { emptyRoadmap } from '../src/schema.js';
import { publicSources, sourceRevision } from '../src/sources.js';
import { DEFAULTS } from '../src/shared.js';
import { buildContext } from '../src/context.js';
import { apply, basic, ctx, ref, user, assistant, call, result } from './helpers.js';

test('模型省略旧任务，早期约束和稳定标识持续保留', () => {
  const f = basic(); const id = f.pdf.id;
  let graph = f.graph;
  for (let n = 2; n < 102; n++) graph = apply(graph, [assistant(n, '正在调整 HTML 页面字号。')], []).graph;
  assert.equal(graph.nodes.find(n => n.title === 'PDF 导出')!.id, id); assert.equal(graph.goals[0].constraints[0].text, '全程离线运行');
  const context = buildContext(graph, publicSources([...f.events, assistant(102, '现在开始调整模型调用。')]), DEFAULTS);
  assert(context.request.includes('全程离线运行')); assert(context.estimate <= context.limit);
});
test('助手取消用户要求产生待判定，用户明确撤回保留理由', () => {
  const f = basic(); const cancel = assistant(2, '放弃 PDF 导出，继续 HTML 导出。');
  const blocked = apply(f.graph, [cancel], [{ type: 'update_node', nodeId: f.pdf.id, expectedNodeRevision: f.pdf.revision, changes: { status: 'abandoned' }, reason: '取消 PDF', sources: ref(2, '放弃 PDF 导出，继续 HTML 导出。') }]).graph;
  assert.equal(blocked.nodes.find(n => n.id === f.pdf.id)!.status, 'pending'); assert(blocked.unresolved.length);
  const allowed = apply(f.graph, [user(3, '本版撤回 PDF 导出，继续 HTML 导出。')], [{ type: 'update_node', nodeId: f.pdf.id, expectedNodeRevision: 1, changes: { status: 'abandoned' }, reason: '用户撤回本版 PDF', sources: ref(3, '本版撤回 PDF 导出，继续 HTML 导出。') }]).graph;
  assert.equal(allowed.nodes.find(n => n.id === f.pdf.id)!.status, 'abandoned'); assert.equal(allowed.nodes.find(n => n.id === f.html.id)!.status, 'pending'); assert(allowed.changes.some(c => c.to === 'abandoned'));
});
test('普通用户需求引用无法授权撤回', () => { const f = basic();
  const graph = apply(f.graph, f.events, [{ type: 'update_node', nodeId: f.pdf.id, expectedNodeRevision: 1, changes: { status: 'abandoned' }, reason: '模型猜测', sources: ref(0, '制作 PDF 和 HTML') }]).graph;
  assert.equal(graph.nodes.find(n => n.id === f.pdf.id)!.status, 'pending');
});
test('用户暂缓 PDF 并继续 HTML，状态分别记录', () => { const f = basic(); const e = user(2, '暂缓 PDF 导出，继续制作 HTML。');
  const graph = apply(f.graph, [e], [{ type: 'update_node', nodeId: f.pdf.id, expectedNodeRevision: 1, changes: { status: 'paused' }, reason: '用户暂缓', sources: ref(2, e.data.content[0].text) },
    { type: 'update_node', nodeId: f.html.id, expectedNodeRevision: 1, changes: { status: 'active' }, reason: '继续 HTML', sources: ref(2, '继续制作 HTML。') }]).graph;
  assert.equal(graph.nodes.find(n => n.id === f.pdf.id)!.status, 'paused'); assert.equal(graph.nodes.find(n => n.id === f.html.id)!.status, 'active');
});
test('无关工具读取与助手完成报告保持待验收', () => { const f = basic(); const events = [assistant(2, 'PDF 导出全部完成。'), call(3, 'a', 'Get-Content package.json'), result(4, 'a', '{"name":"tasklens"}\nProcess exited with code 0')];
  const applied = apply(f.graph, events, [{ type: 'record_verification', nodeId: f.pdf.id, criterionTitle: f.pdf.criteria[0].title, scopeRevision: 1, state: 'passed', scope: 'PDF 导出', sources: [...ref(2, 'PDF 导出全部完成。'), ...ref(4, '{"name":"tasklens"}')] },
    { type: 'update_node', nodeId: f.pdf.id, expectedNodeRevision: 1, changes: { status: 'done' }, reason: '助手报告完成', sources: ref(2, 'PDF 导出全部完成。') }],
    [{ id: 'c-1', nodeId: f.pdf.id, claim: 'PDF 导出全部完成。', basis: 'verified', sources: [...ref(2, 'PDF 导出全部完成。'), ...ref(4, '{"name":"tasklens"}')], scope: 'PDF' }]);
  const n = applied.graph.nodes.find(n => n.id === f.pdf.id)!; assert.equal(n.status, 'review'); assert.equal(n.verifications[0].basis, 'model'); assert.equal(applied.facts[0].basis, 'reported');
});
test('匹配命令失败后重试通过，尝试历史保留', () => { const f = basic();
  const verification = (seq: number, quote: string, state: string) => ({ type: 'record_verification', nodeId: f.check.id, criterionTitle: f.check.criteria[0].title, scopeRevision: 1, state, scope: 'tasklens 单元测试', sources: ref(seq, quote) });
  let graph = apply(f.graph, [call(2, 'a', 'npm test --workspace tasklens'), result(3, 'a', '# pass 9\n# fail 1\nProcess exited with code 1')], [verification(3, '# pass 9\n# fail 1\nProcess exited with code 1', 'failed')]).graph;
  assert.notEqual(graph.nodes.find(n => n.id === f.check.id)!.status, 'done');
  graph = apply(graph, [call(4, 'b', 'npm test --workspace tasklens'), result(5, 'b', '# pass 10\n# fail 0\nProcess exited with code 0')], [verification(5, '# pass 10\n# fail 0\nProcess exited with code 0', 'passed')]).graph;
  const node = graph.nodes.find(n => n.id === f.check.id)!; assert.equal(node.status, 'done'); assert.deepEqual(node.attempts.map(a => a.state), ['failed', 'passed']);
});
test('新范围不沿用旧验收，旧版本成功仍保留', () => { const f = basic();
  let graph = apply(f.graph, [user(2, '我已核对 PDF 导出，功能符合要求，该项验收通过。')], [{ type: 'record_verification', nodeId: f.pdf.id, criterionTitle: f.pdf.criteria[0].title, scopeRevision: 1, scope: 'PDF 导出', state: 'passed', sources: ref(2, '我已核对 PDF 导出，功能符合要求，该项验收通过。') }]).graph;
  assert.equal(graph.nodes.find(n => n.id === f.pdf.id)!.status, 'done');
  const node = graph.nodes.find(n => n.id === f.pdf.id)!;
  graph = apply(graph, [user(3, 'PDF 导出新增目录要求，按新版验收。')], [{ type: 'update_node', nodeId: node.id, expectedNodeRevision: node.revision, newScope: true, changes: { status: 'done' }, reason: '新增目录', sources: ref(3, 'PDF 导出新增目录要求，按新版验收。') }]).graph;
  const expanded = graph.nodes.find(n => n.id === node.id)!; assert.equal(expanded.scopeRevision, 2); assert.equal(expanded.status, 'review'); assert.equal(expanded.verifications[0].scopeRevision, 1);
});
test('用户赞扬设计不构成功能验收', () => { const f = basic(); const graph = apply(f.graph, [user(2, 'PDF 页面设计很好。')], [{ type: 'record_verification', nodeId: f.pdf.id, criterionTitle: f.pdf.criteria[0].title, scopeRevision: 1, scope: 'PDF', state: 'passed', sources: ref(2, 'PDF 页面设计很好。') }]).graph;
  assert.equal(graph.nodes.find(n => n.id === f.pdf.id)!.status, 'review'); assert.equal(graph.nodes.find(n => n.id === f.pdf.id)!.verifications[0].basis, 'model');
});
test('缺来源、虚构编号与过期节点版本拒绝整组变更', () => { const f = basic(); const operation = { type: 'update_node', nodeId: f.pdf.id, expectedNodeRevision: 999, changes: { status: 'done' }, reason: '完成', sources: ref(0, '制作 PDF') };
  assert.throws(() => apply(f.graph, f.events, [operation]), /版本/); assert.throws(() => apply(f.graph, f.events, [{ ...operation, expectedNodeRevision: 1, sources: ref(999, '完成') }]), /来源/);
  assert.equal(f.pdf.status, 'pending');
});
test('循环依赖与跨目标关系拒绝提交', () => { const f = basic(); const sources = ref(0, '制作 PDF 和 HTML');
  assert.throws(() => apply(f.graph, f.events, [{ type: 'link_dependency', from: f.pdf.id, to: f.html.id, sources }, { type: 'link_dependency', from: f.html.id, to: f.pdf.id, sources }]), /循环/);
});
test('用户纠正锁定当前版本字段，模型冲突产生待判定', () => { const f = basic(); const graph = applyAnnotation(f.graph, { id: 'a', nodeId: f.pdf.id, sourceIds: [], nodeTitle: f.pdf.title, goalTitle: '交付报告', scopeRevision: 1, field: 'status', value: 'paused', reason: 'PDF 等待后续安排', time: 2 });
  const current = graph.nodes.find(n => n.id === f.pdf.id)!;
  const updated = apply(graph, [assistant(3, '取消 PDF 导出。')], [{ type: 'update_node', nodeId: current.id, expectedNodeRevision: current.revision, changes: { status: 'abandoned' }, reason: '取消', sources: ref(3, '取消 PDF 导出。') }]).graph;
  assert.equal(updated.nodes.find(n => n.id === current.id)!.status, 'paused'); assert(updated.unresolved.length);
});
test('来源修订失效相关验收，已保存历史对象保持原状', () => { const f = basic(); const graph = apply(f.graph, [user(2, 'PDF 导出符合要求，验收通过。')], [{ type: 'record_verification', nodeId: f.pdf.id, criterionTitle: f.pdf.criteria[0].title, scopeRevision: 1, scope: 'PDF', state: 'passed', sources: ref(2, 'PDF 导出符合要求，验收通过。') }]).graph;
  const original = structuredClone(graph); invalidateSources(graph, new Map(publicSources(f.events).map(s => [s.id, s])));
  assert.equal(graph.nodes.find(n => n.id === f.pdf.id)!.status, 'review'); assert.equal(original.nodes.find(n => n.id === f.pdf.id)!.status, 'done');
});
test('10,000 事件与 500 节点遵守有界输入，旧节点保留', () => { const f = basic(); const graph = structuredClone(f.graph);
  for (let i = 0; i < 496; i++) graph.nodes.push({ ...structuredClone(f.html), id: `large-${i}`, title: `历史任务 ${i}`, order: i + 5 });
  const events = [...f.events, ...Array.from({ length: 10000 }, (_, i) => assistant(i + 2, `界面调整记录 ${i}，继续检查字号。`))];
  const c = buildContext(graph, publicSources(events), DEFAULTS); assert(c.estimate <= 8000); assert(c.batch.length > 0); assert(c.loadedNodeIds.size < 500); assert.equal(graph.nodes.length, 500); assert(c.request.includes('全程离线运行'));
});
test('受保护约束超出预算时敏感状态变更保持待判定', () => { const f = basic(); for (let n = 0; n < 100; n++) f.graph.goals[0].constraints.push({ id: String(n), text: '离线和验收约束'.repeat(30), sources: f.graph.goals[0].sources });
  const events = [user(2, '撤回 PDF 导出。')]; const context = buildContext(f.graph, publicSources(events), DEFAULTS); assert(context.protectedOmitted > 0); assert.equal(context.protectedComplete, false);
  const raw = { graphPatch: { baseGraphVersion: f.graph.version, sourceRevision: sourceRevision(publicSources(events)), operations: [{ type: 'update_node', nodeId: f.pdf.id, expectedNodeRevision: 1, changes: { status: 'abandoned' }, reason: '撤回', sources: ref(2, '撤回 PDF 导出。') }] }, factCandidates: [] };
  context.loadedNodeIds.add(f.pdf.id); const graph = applyAnalysis(f.graph, raw, context, 3).graph; assert.equal(graph.nodes.find(n => n.id === f.pdf.id)!.status, 'pending');
});
test('未载入节点无法接受模型修改', () => { const f = basic(); const context = ctx(f.graph, f.events, []);
  assert.throws(() => applyAnalysis(f.graph, { graphPatch: { baseGraphVersion: f.graph.version, sourceRevision: context.sourceRevision, operations: [{ type: 'update_node', nodeId: f.pdf.id, expectedNodeRevision: 1, changes: { status: 'active' }, reason: '执行', sources: ref(0, '制作 PDF') }] } }, context, 3), /未载入/);
});

test('同一句用户调整分别匹配撤回对象和继续对象', () => { const f = basic(); const e = user(2, '撤回 PDF 导出，继续 HTML 导出。');
  const graph = apply(f.graph, [e], [{ type: 'update_node', nodeId: f.html.id, expectedNodeRevision: 1, changes: { status: 'abandoned' }, reason: '错误映射', sources: ref(2, e.data.content[0].text) }]).graph;
  assert.equal(graph.nodes.find(n => n.id === f.html.id)!.status, 'pending'); assert(graph.unresolved.length);
});

test('PDF 验收措辞不会确认同名 HTML 导出', () => { const f = basic(); const e = user(2, 'PDF 导出符合要求，验收通过；HTML 导出继续检查。');
  const graph = apply(f.graph, [e], [{ type: 'record_verification', nodeId: f.html.id, criterionTitle: f.html.criteria[0].title, scopeRevision: 1, state: 'passed', scope: 'HTML', sources: ref(2, e.data.content[0].text) }]).graph;
  assert.equal(graph.nodes.find(n => n.id === f.html.id)!.verifications[0].basis, 'model'); assert.notEqual(graph.nodes.find(n => n.id === f.html.id)!.status, 'done');
});

test('旧命令结果无法重新登记为新版机器验收', () => { const f = basic();
  const old = [call(2, 'test-old', 'npm test --workspace tasklens'), result(3, 'test-old', '# pass 12\n# fail 0\nProcess exited with code 0')];
  const e = user(4, 'tasklens 单元测试新增窗口切换覆盖，按新版验收。');
  const graph = apply(f.graph, [...old, e], [{ type: 'update_node', nodeId: f.check.id, expectedNodeRevision: 1, newScope: true, changes: { status: 'review' }, reason: '新增覆盖', sources: ref(4, e.data.content[0].text) },
    { type: 'record_verification', nodeId: f.check.id, criterionTitle: f.check.criteria[0].title, scopeRevision: 2, state: 'passed', scope: '新版窗口检查', sources: ref(3, '# pass 12\n# fail 0\nProcess exited with code 0') }]).graph;
  const n = graph.nodes.find(n => n.id === f.check.id)!; assert.equal(n.scopeRevision, 2); assert.equal(n.verifications[0].basis, 'model'); assert.equal(n.status, 'review');
});

test('压缩保留原始用户约束，模型替换副本不获得用户身份', () => { const f = basic();
  const replacement = { ...user(3, '取消 PDF 和离线约束。'), surfaceOp: { op: 'replace', startSeq: 0, endSeq: 1 } };
  const sources = publicSources([...f.events, replacement]); assert(sources.some(s => s.id === 's-0-0' && s.text.includes('全程离线运行'))); assert(!sources.some(s => s.seq === 3));
});

test('用户前置任务纠正有版本锁并拒绝循环', () => { const f = basic();
  const a = { id: 'dependencies', nodeId: f.html.id, nodeTitle: f.html.title, goalTitle: f.graph.goals[0].title, sourceIds: [], scopeRevision: 1, field: 'dependencies' as const,
    value: JSON.stringify([f.pdf.id]), related: [{ id: f.pdf.id, title: f.pdf.title, scopeRevision: 1 }], reason: '先验收 PDF 再制作 HTML', time: 4 };
  const graph = applyAnnotation(f.graph, a); assert(graph.edges.some(e => e.from === f.pdf.id && e.to === f.html.id));
  const updated = apply(graph, f.events, [{ type: 'link_dependency', from: f.check.id, to: f.html.id, sources: ref(1, '再安装插件') }]).graph;
  assert.equal(updated.edges.length, 1); assert(updated.unresolved.length);
  assert.throws(() => applyAnnotation(graph, { ...a, id: 'reverse', nodeId: f.pdf.id, value: JSON.stringify([f.html.id]) }), /循环/);
});

test('合并保留旧节点和别名，并为合并目标新增验收版本', () => { const f = basic();
  const a = { id: 'merge', nodeId: f.pdf.id, nodeTitle: f.pdf.title, goalTitle: f.graph.goals[0].title, sourceIds: [], scopeRevision: 1, field: 'merge' as const,
    value: f.html.id, related: [{ id: f.html.id, title: f.html.title, scopeRevision: 1 }], reason: '两种导出共用交付验收', time: 4 };
  const graph = applyAnnotation(f.graph, a); const original = graph.nodes.find(n => n.id === f.pdf.id)!, target = graph.nodes.find(n => n.id === f.html.id)!;
  assert.equal(original.status, 'superseded'); assert.equal(original.replaces, target.id); assert(target.aliases.includes(f.pdf.id)); assert.equal(target.scopeRevision, 2); assert.equal(target.criteria.length, 2); assert.equal(target.status, 'review');
  assert.equal(f.pdf.status, 'pending'); assert.deepEqual(applyAnnotation(graph, a), graph);
});

test('拆分保留原验收条件，新子任务逐项核验，重复重放保持幂等', () => { const f = basic();
  const a = { id: 'split', nodeId: f.pdf.id, nodeTitle: f.pdf.title, goalTitle: f.graph.goals[0].title, sourceIds: [], scopeRevision: 1, field: 'split' as const,
    value: 'PDF 页面排版\nPDF 文件导出', reason: '分别检查页面与文件', time: 4 };
  const graph = applyAnnotation(f.graph, a); const parent = graph.nodes.find(n => n.id === f.pdf.id)!;
  assert.equal(parent.kind, 'phase'); assert.equal(parent.criteria[0].id, f.pdf.criteria[0].id); assert.equal(graph.nodes.filter(n => n.parentId === parent.id).length, 2);
  assert.deepEqual(applyAnnotation(graph, a), graph);
  assert.throws(() => applyAnnotation(graph, { ...a, id: 'complete', field: 'status', value: 'done' }), /子任务/);
});

test('模型窗口载入依赖和当前证明，大量旧尝试持续保存在完整图中', () => { const f = basic();
  f.graph.edges.push({ id: 'dependency', from: f.pdf.id, to: f.check.id, sources: f.pdf.sources });
  for (let n = 0; n < 1000; n++) f.check.attempts.push({ id: `attempt-${n}`, scopeRevision: 1, state: 'failed', time: n, sources: f.check.sources });
  const c = buildContext(f.graph, publicSources([...f.events, assistant(4, '接下来核对 tasklens 单元测试。')]), { ...DEFAULTS, inputBudget: 12000 });
  const packet = JSON.parse(c.request); assert(c.loadedNodeIds.has(f.check.id)); assert(packet.edges.some((e: any) => e.id === 'dependency'));
  assert.equal(packet.nodes.find((n: any) => n.id === f.check.id).attempts.length, 2); assert.equal(f.check.attempts.length, 1000); assert(c.estimate <= c.limit);
});

test('目标级事实和用户要求分别识别，普通要求没有用户待办', () => { const f = basic();
  const applied = apply(f.graph, f.events, [], [{ id: 'c-goal', nodeId: f.graph.goals[0].id, scopeRevision: null, claim: '用户要求制作 PDF 和 HTML。', basis: 'requested', action: 'user', sources: ref(0, '制作 PDF 和 HTML') }]);
  assert.equal(applied.facts[0].goalId, f.graph.goals[0].id); assert.equal(applied.facts[0].nodeId, null); assert.equal(applied.facts[0].action, null); assert.equal(applied.facts[0].basis, 'decision');
});

test('用户明确否定验收时维持待核对', () => { const f = basic(); const e = user(2, '我确认 PDF 导出未通过验收，尚未满足要求。');
  const graph = apply(f.graph, [e], [{ type: 'record_verification', nodeId: f.pdf.id, criterionTitle: f.pdf.criteria[0].title, scopeRevision: 1, state: 'passed', scope: 'PDF', sources: ref(2, e.data.content[0].text) }]).graph;
  assert.equal(graph.nodes.find(n => n.id === f.pdf.id)!.status, 'review'); assert.equal(graph.nodes.find(n => n.id === f.pdf.id)!.verifications[0].basis, 'model');
});

test('机器核验的失败保留结果身份，过去的行动不进入后续计划', () => { const f = basic(); const quote = '# tests 10\n# pass 9\n# fail 1\nProcess exited with code 1';
  const source = publicSources([call(2, 'failed', 'npm test --workspace tasklens'), result(3, 'failed', quote)]).at(-1)!; assert.equal(source.check!.passed, 9); assert.equal(source.check!.failed, 1);
  const applied = apply(f.graph, [call(2, 'failed', 'npm test --workspace tasklens'), result(3, 'failed', quote)],
    [{ type: 'record_verification', nodeId: f.check.id, criterionTitle: f.check.criteria[0].title, scopeRevision: 1, state: 'failed', scope: 'tasklens 单元测试', sources: ref(3, quote) }],
    [{ id: 'c-result', nodeId: f.check.id, claim: '9 项检查通过，1 项失败。', basis: 'verified', action: 'agent', scope: 'tasklens 单元测试', sources: ref(3, quote) }]);
  assert.equal(applied.facts[0].basis, 'verified'); assert.equal(applied.facts[0].action, null);
  const passed = '# pass 10\n# fail 0\nProcess exited with code 0';
  const retry = apply(applied.graph, [call(4, 'retry', 'npm test --workspace tasklens'), result(5, 'retry', passed)],
    [{ type: 'record_verification', nodeId: f.check.id, criterionTitle: f.check.criteria[0].title, scopeRevision: 1, state: 'passed', scope: 'tasklens 单元测试', sources: ref(5, passed) }],
    [{ id: 'c-passed', nodeId: f.check.id, claim: '10 项检查通过，0 项失败。', basis: 'verified', scope: 'tasklens 单元测试', sources: ref(5, passed) }]);
  assert.equal(retry.facts[0].basis, 'verified'); assert.equal(retry.graph.nodes.find(n => n.id === f.check.id)!.status, 'done');
});

test('引用已载入节点的历史摘录时，仅接受已展示的连续文字', () => { const f = basic();
  const long = user(0, '制作 PDF 和 HTML，保持全程离线运行。' + '历史细节。'.repeat(150));
  const initial = publicSources([long]); const original = initial[0];
  f.graph.nodes = [f.pdf]; f.graph.edges = []; f.pdf.parentId = null; f.pdf.sources = [{ id: original.id, hash: original.hash, quote: '制作 PDF 和 HTML' }];
  f.pdf.criteria = []; f.graph.goals[0].sources = f.pdf.sources; f.graph.goals[0].constraints = []; f.graph.goals[0].requirements = [];
  for (const s of initial) f.graph.analyzed[s.id] = s.hash;
  const c = buildContext(f.graph, [...initial, ...publicSources([assistant(2, '继续 PDF 导出。')])], { ...DEFAULTS, inputBudget: 8000 });
  // Force the citable excerpt path independently of discretionary raw-source admission.
  c.quotedOnly = new Map([[original.id, ['制作 PDF 和 HTML']]]); c.sources = new Map([...c.sources, [original.id, original]]);
  const raw = (quote: string) => ({ graphPatch: { baseGraphVersion: f.graph.version, sourceRevision: c.sourceRevision, operations: [] }, factCandidates: [{ id: 'c-old', nodeId: f.pdf.id, claim: '用户要求制作 PDF。', basis: 'decision', sources: [{ id: original.id, quote }] }] });
  assert.equal(applyAnalysis(f.graph, raw('制作 PDF'), c, 3).facts[0].basis, 'decision');
  const rejected = applyAnalysis(f.graph, raw('历史细节。'), c, 3);
  assert.equal(rejected.facts.length, 0); assert.equal(rejected.omittedFacts, 1); assert(rejected.warnings.some(w => /摘录/.test(w)));
});

test('目标更新未列出的早期要求仍保留', () => { const f = basic(); f.graph.goals[0].requirements = ['制作 PDF', '制作 HTML']; const e = user(2, '增加离线验收要求。');
  const graph = apply(f.graph, [e], [{ type: 'update_goal', goalId: f.graph.goals[0].id, expectedRevision: 1, requirements: ['离线验收'], sources: ref(2, e.data.content[0].text) }]).graph;
  assert.deepEqual(graph.goals[0].requirements, ['制作 PDF', '制作 HTML', '离线验收']);
});

test('摘要数字缺少来源时仅筛除该陈述，已核对的任务更新继续保存', () => {
  const f = basic(), sources = ref(0, '制作 PDF 和 HTML');
  const output = apply(f.graph, f.events, [{ type: 'update_node', nodeId: f.pdf.id, expectedNodeRevision: 1,
    changes: { status: 'active' }, reason: '正在制作 PDF', sources }], [
    { id: 'c-good', nodeId: f.pdf.id, claim: '用户要求制作 PDF。', basis: 'decision', sources },
    { id: 'c-bad', nodeId: f.pdf.id, claim: '27 项检查已经通过。', basis: 'verified', sources },
  ]);
  assert.equal(output.graph.nodes.find(n => n.id === f.pdf.id)!.status, 'active');
  assert.equal(f.pdf.status, 'pending'); assert.equal(output.facts.length, 1); assert.equal(output.omittedFacts, 1);
  assert(output.warnings.some(w => /数字/.test(w))); assert(!output.graph.facts.some(f => f.claim.includes('27')));
});

test('候选摘要格式、旧版本及无效来源互相隔离，任务操作仍采用严格事务', () => {
  const f = basic(), sources = ref(0, '制作 PDF 和 HTML');
  const output = apply(f.graph, f.events, [], [null, { id: 'c-old', nodeId: f.pdf.id, scopeRevision: 99, claim: '要求制作 PDF。', sources },
    { id: 'c-missing', nodeId: f.pdf.id, claim: '要求制作 PDF。', sources: ref(999, '制作 PDF') },
    { id: 'c-good', nodeId: f.pdf.id, claim: '要求制作 PDF。', sources }]);
  assert.equal(output.omittedFacts, 3); assert.equal(output.facts.length, 1);
  assert.throws(() => apply(f.graph, f.events, [{ type: 'update_node', nodeId: f.pdf.id, expectedNodeRevision: 1,
    changes: { status: 'active' }, reason: '核对', sources: ref(999, '制作 PDF') }]), /来源/);
});

test('首版同批重复任务合并临时标识和来源，后续引用继续有效', () => {
  const sources = ref(0, '制作 PDF，先核对文字，再核对排版。'), events = [user(0, sources[0].quote)];
  const output = apply(emptyRoadmap('s', 'g'), events, [
    { type: 'add_goal', id: 'new-g', title: 'PDF 交付', sources },
    { type: 'add_node', id: 'new-a', goalId: 'new-g', title: 'PDF 导出', sources, criteria: [{ title: '文字符合要求', required: false }] },
    { type: 'add_node', id: 'new-b', goalId: 'new-g', title: 'PDF 导出', sources, criteria: [{ title: '文字符合要求' }, { title: '排版符合要求' }] },
    { type: 'update_node', nodeId: 'new-b', changes: { status: 'active' }, reason: '核对排版', sources },
  ], [{ id: 'c-1', nodeId: 'new-b', claim: '用户要求制作 PDF。', sources }]);
  assert.equal(output.graph.nodes.length, 1); assert.equal(output.graph.nodes[0].criteria.length, 2);
  assert.equal(output.graph.nodes[0].criteria[0].required, true);
  assert.equal(output.graph.nodes[0].status, 'active'); assert.equal(output.facts[0].nodeId, output.graph.nodes[0].id);
  const existing = output.graph.nodes[0];
  assert.throws(() => apply(output.graph, events, [{ type: 'add_node', id: 'new-duplicate', goalId: existing.goalId, title: existing.title, sources }]), /沿用节点标识/);
});

test('阶段与子任务同名时仍有各自身份，同批层级冲突保持拒绝', () => {
  const sources = ref(0, '制作报告，并完成报告排版。'), events = [user(0, sources[0].quote)];
  const ops = [{ type: 'add_goal', id: 'new-g', title: '交付报告', sources },
    { type: 'add_node', id: 'new-p', goalId: 'new-g', title: '报告排版', kind: 'phase', sources },
    { type: 'add_node', id: 'new-task', goalId: 'new-g', parentId: 'new-p', title: '报告排版', kind: 'task', sources }];
  assert.equal(apply(emptyRoadmap('s', 'g'), events, ops).graph.nodes.length, 2);
  assert.throws(() => apply(emptyRoadmap('s', 'g'), events, [...ops, { type: 'add_node', id: 'new-other', goalId: 'new-g', title: '报告排版', kind: 'task', sources }]), /阶段冲突/);
});
