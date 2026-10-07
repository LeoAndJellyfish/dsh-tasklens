import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TaskLensRuntime, type RuntimeServices } from '../src/runtime.js';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { ObservedEvent } from '../src/core.js';
import { hashOf } from '../src/sources.js';
import { ev, user, assistant } from './helpers.js';

function response(data: any) {
  const source = data.sources.find((s: any) => s.role === 'user') ?? data.sources[0]; const sources = [{ id: source.id, quote: source.text }];
  const task = data.goals[0]?.title ?? source.text;
  return { graphPatch: { baseGraphVersion: data.frame.baseGraphVersion, sourceRevision: data.frame.sourceRevision, operations: data.goals.length ? [] : [
    { type: 'add_goal', id: 'new-g', title: task, sources },
    { type: 'add_node', id: 'new-n', goalId: 'new-g', title: '实现任务', status: 'pending', reason: '等待实现', criteria: [{ title: '交付检查' }], sources },
  ] }, factCandidates: data.goals.length ? [] : [{ id: 'c-1', nodeId: 'new-n', claim: '用户要求实现当前任务。', basis: 'decision', scope: '任务要求', sources }],
    needsContext: [], briefing: data.goals.length ? { emit: false, headline: null, summary: [], agentNext: [], userActions: [], details: [] }
      : { emit: true, headline: { text: '任务要求已记录', factIds: ['c-1'] }, summary: [], agentNext: [], userActions: [], details: [] } };
}
async function fixture(options: { deferred?: boolean; blocking?: boolean; fail?: boolean; long?: boolean; invalid?: boolean; automatic?: boolean; invalidFact?: boolean; truncated?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tasklens-test-')); let now = 100000, release!: () => void;
  const deferred = new Promise<void>(r => { release = r; });
  const initial = (task: string) => [ev('request/header', 0, { header: { config: { provider: 'configured', model: 'test-model' } } }), user(1, task), ev('turn/start', 2, {})];
  const logs = new Map<string, ObservedEvent[]>([['a', initial('任务 A')], ['b', initial('任务 B')], ['c', initial('任务 C')]]);
  if (options.long) logs.get('a')!.push(...Array.from({ length: 50 }, (_, i) => assistant(i + 3, '正在核对历史文件的版式，继续检查字号与标题。'.repeat(4))));
  const requests: GenerateOptions[] = [];
  const query = { async observeSession(id: string) { return { events: structuredClone(logs.get(id)!), [Symbol.dispose]() {} }; } };
  const llm = { listProviders: () => [{ id: 'configured', name: '已配置' }], async listModels() { return [{ id: 'test-model', name: '测试模型' }]; },
    async *stream(request: GenerateOptions) {
      requests.push(request); if (options.deferred) await deferred;
      if (options.blocking) await new Promise<void>(r => { if (request.signal?.aborted) r(); else request.signal?.addEventListener('abort', () => r(), { once: true }); });
      if (options.fail) { yield { type: 'finish', reason: { kind: 'error', failure: { message: '测试错误' } } }; return; }
      const data = JSON.parse((request.messages[0].content[0] as { text: string }).text);
      const raw = response(data); if (options.invalid) raw.graphPatch.baseGraphVersion = -10;
      if (options.invalidFact && raw.factCandidates.length) {
        const fact = { ...raw.factCandidates[0], id: 'c-invalid', claim: '27 项检查已经通过。' };
        raw.factCandidates.push(fact); raw.briefing.headline = { text: fact.claim, factIds: [fact.id] };
      }
      const output = options.truncated ? JSON.stringify({ graphPatch: raw.graphPatch }).slice(0, -1) + ',"factCandidates":[{"id":"c-unfinished' : JSON.stringify(raw);
      yield { type: 'text-delta', text: output }; yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } }; yield { type: 'finish', reason: { kind: options.truncated ? 'max-tokens' : 'stop' } };
    },
  };
  const services = { llm, query, directory: dir, now: () => now } as unknown as RuntimeServices;
  const runtime = new TaskLensRuntime(services); await runtime.initialize();
  if (options.automatic) await runtime.pause('a', false);
  return { runtime, services, logs, requests, dir, release: () => release(), advance: (n: number) => { now += n; },
    async cleanup() { release(); await runtime.dispose(); const target = resolve(dir); assert(target.startsWith(resolve(tmpdir()) + '\\tasklens-test-') || target.startsWith(resolve(tmpdir()) + '/tasklens-test-')); await rm(target, { recursive: true, force: true }); } };
}
async function settled(runtime: TaskLensRuntime, id = 'a') { for (let i = 0; i < 300; i++) { const view = await runtime.view(id); if (!view.busy) return view; await delay(5); } throw new Error('解释未完成'); }
test('配置模型独立调用、来源不变、任务图重启后恢复', async () => { const f = await fixture(); try {
  const before = JSON.stringify([...f.logs]); await f.runtime.requestRefresh('a'); const a = await settled(f.runtime);
  assert.equal(a.error, null); assert.equal(f.requests[0].provider, 'configured'); assert.equal(f.requests[0].tools, undefined); assert.equal(f.requests[0].sessionId, undefined);
  assert.equal(a.timeline.length, 1); assert.equal(a.roadmap!.goals[0].title, '任务 A'); assert.equal(a.tokensTotal, 150); assert.equal(JSON.stringify([...f.logs]), before);
  const restart = new TaskLensRuntime(f.services); await restart.initialize(); const restored = await restart.view('a'); assert.equal(restored.roadmap!.nodes[0].id, a.roadmap!.nodes[0].id); assert.equal(restored.callsThisHour, 1); await restart.dispose();
} finally { await f.cleanup(); } });
test('会话目标、暂停与历史分别保存', async () => { const f = await fixture({ automatic: true }); try { await f.runtime.requestRefresh('a'); await settled(f.runtime); await f.runtime.pause('b', false); await f.runtime.requestRefresh('b'); const b = await settled(f.runtime, 'b');
  assert.equal(b.roadmap!.goals[0].title, '任务 B'); await f.runtime.pause('a', true); assert.equal((await f.runtime.view('a')).paused, true); assert.equal((await f.runtime.view('b')).paused, false);
} finally { await f.cleanup(); } });
test('事件触发更新，静止和重复手动读取跳过调用', async () => { const f = await fixture({ automatic: true }); try {
  f.runtime.onEvent('a', f.logs.get('a')![2]); f.advance(11000); await f.runtime.tick(); await settled(f.runtime); assert.equal(f.requests.length, 1);
  f.advance(100000); await f.runtime.tick(); await settled(f.runtime); await f.runtime.requestRefresh('a'); await settled(f.runtime); assert.equal(f.requests.length, 1);
  const end = ev('turn/end', 3, { reason: { kind: 'completed' } }); f.logs.get('a')!.push(end); f.runtime.onEvent('a', end); f.advance(4000); await f.runtime.tick(); const view = await settled(f.runtime);
  assert.equal(f.requests.length, 2); assert.equal(view.activity.status, 'review'); assert.equal(view.roadmap!.nodes[0].status, 'pending');
} finally { await f.cleanup(); } });
test('单会话单次调用，暂停取消在途解释', async () => { const f = await fixture({ blocking: true }); try {
  await f.runtime.requestRefresh('a'); await delay(30); await f.runtime.requestRefresh('a'); assert.equal(f.requests.length, 1); await f.runtime.pause('a', true);
  const view = await settled(f.runtime); assert.equal(view.paused, true); assert.equal(view.timeline.length, 0); assert.equal(view.error, null);
} finally { await f.cleanup(); } });
test('最多两个会话同时解释', async () => { const f = await fixture({ deferred: true }); try {
  await f.runtime.requestRefresh('a'); await f.runtime.requestRefresh('b'); await f.runtime.requestRefresh('c'); await delay(40); assert.equal(f.requests.length, 2); f.release(); await settled(f.runtime); await settled(f.runtime, 'b');
} finally { await f.cleanup(); } });
test('错误退避，连续三次失败停止自动调用', async () => { const f = await fixture({ fail: true, automatic: true }); try {
  await f.runtime.requestRefresh('a'); await settled(f.runtime); f.advance(190000); await f.runtime.tick(); await settled(f.runtime); f.advance(370000); await f.runtime.tick(); const view = await settled(f.runtime);
  assert.equal(f.requests.length, 3); assert(view.notice?.includes('三次')); assert.equal(view.nextAutomaticAt, null); assert.equal(view.coverage.analyzedParts, 0);
} finally { await f.cleanup(); } });
test('未知模型拒绝，全部手动与回溯调用共用小时上限', async () => { const f = await fixture(); try {
  await assert.rejects(f.runtime.configure({ model: { provider: 'missing', model: 'fake' } })); await f.runtime.configure({ maxCallsPerHour: 6 });
  for (let i = 0; i < 7; i++) { if (i) f.logs.get('a')!.push(assistant(i + 2, `调整记录 ${i}`)); await f.runtime.requestRefresh('a'); await settled(f.runtime); }
  assert.equal(f.requests.length, 6); assert((await f.runtime.view('a')).notice?.includes('预算'));
} finally { await f.cleanup(); } });
test('token 上限预留输入和输出，超预算保留队列', async () => { const f = await fixture(); try {
  await f.runtime.configure({ maxTokensPerHour: 10000, inputBudget: 8000 }); await f.runtime.requestRefresh('a'); const view = await settled(f.runtime);
  assert(view.callsThisHour <= 1); if (!f.requests.length) assert.equal(view.coverage.analyzedParts, 0);
} finally { await f.cleanup(); } });
test('子代理独立记录不触发额外解释', async () => { const f = await fixture({ automatic: true }); try { await f.runtime.requestRefresh('a'); await settled(f.runtime); f.runtime.onEvent('a', assistant(99, '子代理汇报'), true); f.advance(100000); await f.runtime.tick(); await settled(f.runtime); assert.equal(f.requests.length, 1); } finally { await f.cleanup(); } });
test('新用户指示到达后旧响应丢弃，队列继续保存', async () => { const f = await fixture({ deferred: true, automatic: true }); try {
  await f.runtime.requestRefresh('a'); await delay(30); f.advance(40000); const e = user(3, '暂缓任务 A。'); f.logs.get('a')!.push(e); f.runtime.onEvent('a', e); f.release(); const view = await settled(f.runtime);
  assert.equal(view.timeline.length, 0); assert(view.notice?.includes('过期')); assert(view.nextAutomaticAt !== null); assert.equal(view.coverage.analyzedParts, 0);
} finally { await f.cleanup(); } });
test('历史回填分批提交，完成后保留旧历史切面', async () => { const f = await fixture({ long: true, automatic: true }); try {
  await f.runtime.requestRefresh('a'); let view = await settled(f.runtime); assert.equal(view.error, null); assert(view.coverage.rebuilding); assert(view.timeline[0].preview);
  const first = view.timeline[0].id; const previewNodeId = view.roadmap!.nodes[0].id;
  for (let i = 0; i < 40 && view.coverage.rebuilding; i++) { f.advance(31000); await f.runtime.tick(); view = await settled(f.runtime); if (view.error) throw new Error(view.error); }
  assert.equal(view.coverage.rebuilding, false); assert.equal(view.coverage.analyzedParts, view.coverage.totalParts); assert(view.timeline.length > 2); assert.equal(view.roadmap!.nodes[0].id, previewNodeId);
  const historical = await f.runtime.historical('a', first); assert(historical.entry.preview); assert.equal(historical.roadmap.version, 1);
} finally { await f.cleanup(); } });
test('纠正保存为历史版本并拒绝过期页面提交', async () => { const f = await fixture(); try {
  await f.runtime.requestRefresh('a'); const view = await settled(f.runtime); const node = view.roadmap!.nodes[0];
  const corrected = await f.runtime.annotate('a', { commitVersion: view.commitVersion, nodeId: node.id, field: 'status', value: 'paused', reason: '等待安排' });
  assert.equal(corrected.roadmap!.nodes[0].status, 'paused'); assert.equal(corrected.timeline.at(-1)!.trigger, '用户纠正');
  await assert.rejects(f.runtime.annotate('a', { commitVersion: view.commitVersion, nodeId: node.id, field: 'status', value: 'abandoned', reason: '撤回' }), /版本/);
  assert.equal((await f.runtime.historical('a', view.timeline[0].id)).roadmap.nodes[0].status, 'pending');
} finally { await f.cleanup(); } });
test('v0.1 原记录迁移为参考，旧工具引用不获得新图完成状态', async () => { const f = await fixture(); try {
  const checkpoint = { id: 'old', time: 1, throughSeq: 2, trigger: '旧更新', model: { provider: 'configured', model: 'test-model' }, briefing: { goal: '任务 A', headline: '已完成', summary: '旧版完成声明。', stages: [{ id: 'old-node', state: 'done', title: '实现' }] }, evidence: [] };
  await writeFile(join(f.dir, `session-${hashOf('a')}.json`), JSON.stringify({ sessionId: 'a', checkpoints: [checkpoint], callsTotal: 5 }));
  const view = await f.runtime.view('a'); assert.equal(view.paused, true); assert.equal(view.checkpoints.length, 1); assert.equal(view.roadmap, null); await f.runtime.requestRefresh('a'); const next = await settled(f.runtime); assert.equal(next.roadmap!.nodes[0].status, 'pending'); assert.equal(next.checkpoints[0].id, 'old');
} finally { await f.cleanup(); } });

test('新对话默认暂停，打开侧栏、事件与定时器均不调用模型', async () => { const f = await fixture(); try {
  f.runtime.onEvent('c', f.logs.get('c')![2]);
  for (const id of ['a', 'b', 'c']) { const view = await f.runtime.view(id); assert.equal(view.paused, true); assert.equal(view.nextAutomaticAt, null); }
  const next = user(3, '继续任务 A。'); f.logs.get('a')!.push(next); f.runtime.onEvent('a', next);
  f.advance(7200000); await f.runtime.tick(); await delay(20); assert.equal(f.requests.length, 0);
} finally { await f.cleanup(); } });

test('手动生成一次保持暂停，未分析历史与新消息不触发后续调用', async () => { const f = await fixture({ long: true }); try {
  await f.runtime.requestRefresh('a'); const view = await settled(f.runtime);
  assert.equal(f.requests.length, 1); assert.equal(view.paused, true); assert(view.coverage.rebuilding); assert.equal(view.nextAutomaticAt, null);
  const next = user(53, '再检查页面。'); f.logs.get('a')!.push(next); f.runtime.onEvent('a', next);
  await f.runtime.pause('a', false, true); f.advance(7200000); await f.runtime.tick(); await settled(f.runtime); assert.equal(f.requests.length, 1);
} finally { await f.cleanup(); } });

test('主动开启仅作用于当前对话，重启后的事件读取原开启状态', async () => { const f = await fixture(); let restart: TaskLensRuntime | undefined; try {
  await f.runtime.pause('a', false); assert.equal((await f.runtime.view('b')).paused, true);
  f.advance(2000); await f.runtime.tick(); await settled(f.runtime); assert.equal(f.requests.length, 1);
  await f.runtime.dispose(); restart = new TaskLensRuntime(f.services); await restart.initialize();
  const next = user(3, '继续实现任务 A。'); f.logs.get('a')!.push(next); restart.onEvent('a', next); await delay(20);
  f.advance(10000); await restart.tick(); assert.equal(f.requests.length, 1);
  f.advance(21000); await restart.tick(); const view = await settled(restart);
  assert.equal(f.requests.length, 2); assert.equal(view.paused, false); assert.equal((await restart.view('c')).paused, true);
} finally { await restart?.dispose(); await f.cleanup(); } });

test('长记录首批含无依据数字时仍生成路线图，保持暂停且不花费修复调用', async () => {
  const f = await fixture({ invalidFact: true, long: true });
  try {
    await f.runtime.requestRefresh('a'); const view = await settled(f.runtime);
    assert.equal(view.error, null); assert.equal(view.paused, true); assert.equal(view.callsTotal, 1);
    assert.equal(view.roadmap!.nodes.length, 1); assert(view.coverage.analyzedParts > 0);
    const briefing = view.roadmap!.briefing!;
    assert(briefing.fallback); assert(![briefing.headline?.text, ...briefing.summary.map(u => u.text)].join('').includes('27'));
    assert(view.notice?.includes('依据')); f.advance(7200000); await f.runtime.tick(); await delay(20);
    assert.equal(f.requests.length, 1); assert.equal((await f.runtime.view('a')).nextAutomaticAt, null);
  } finally { await f.cleanup(); }
});

test('输出截断仅保留完整且有来源的任务更新，整批覆盖保持待分析且无额外调用', async () => {
  const f = await fixture({ truncated: true });
  try {
    await f.runtime.requestRefresh('a'); const view = await settled(f.runtime);
    assert.equal(view.error, null); assert.equal(view.roadmap!.nodes.length, 1); assert.equal(view.timeline.length, 1);
    assert.equal(view.coverage.analyzedParts, 0); assert(view.notice?.includes('输出尚未结束')); assert.equal(view.paused, true);
    f.advance(7200000); await f.runtime.tick(); await delay(20); assert.equal(f.requests.length, 1);
  } finally { await f.cleanup(); }
});
