import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TaskLensRuntime, type RuntimeServices } from '../src/runtime.js';
import type { ObservedEvent } from '../src/core.js';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';

const ev = (type: string, seq: number, data: unknown): ObservedEvent => ({ type, seq, time: 100000 + seq, data });
const initial = (task: string): ObservedEvent[] => [
  ev('request/header',0,{ header: { config: { provider: 'configured', model: 'test-model' } } }),
  ev('user/message',1,{ content: [{ type: 'text', text: task }] }), ev('turn/start',2,{ turn: 0 }),
];
const response = (task: string) => ({ goal: task, headline: '正在实现', stage: '实现', summary: '正在完成需求对应的实现，后续进行验证。', status: 'running',
  stages: [{ id: 'implementation', title: '实现', state: 'active', reason: '任务已开始', evidence: [2] }], completed: [], next: ['验证'], attention: [], acceptance: [{ text: '完成验证', state: 'pending', evidence: [] }] });
async function fixture(options: { fail?: boolean; blocking?: boolean; deferred?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(),'tasklens-test-'));
  const logs = new Map<string,ObservedEvent[]>([['a', initial('任务 A')], ['b', initial('任务 B')]]);
  const requests: GenerateOptions[] = []; let now = 100000; let release = () => {};
  const query = { async observeSession(id: string) {
    if (!logs.has(id)) throw new Error('会话不存在');
    return { events: [...logs.get(id)!], header: { id }, [Symbol.dispose]() {} };
  } };
  const llm = {
    listProviders: () => [{ id: 'configured', name: '已配置服务' }],
    listModels: async () => [{ id: 'test-model', name: '测试模型' }],
    async *stream(request: GenerateOptions) {
      requests.push(request);
      if (options.deferred) await new Promise<void>(resolve => { release = resolve; });
      if (options.blocking) await new Promise<void>(r => request.signal!.addEventListener('abort', () => r(), { once: true }));
      if (options.fail) { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TEST', message: '测试错误' } } }; return; }
      const data = JSON.parse((request.messages[0].content[0] as { text: string }).text);
      yield { type: 'text-delta', index: 0, text: JSON.stringify(response(data.goal)) };
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
  const services = { llm, query, directory: dir, now: () => now } as unknown as RuntimeServices;
  const runtime = new TaskLensRuntime(services); await runtime.initialize();
  return { runtime, services, logs, requests, release: () => release(), advance: (n: number) => { now += n; },
    async cleanup() {
      await runtime.dispose();
      const target = resolve(dir); assert(target.startsWith(resolve(tmpdir()) + '\\tasklens-test-') || target.startsWith(resolve(tmpdir()) + '/tasklens-test-'));
      await rm(target, { recursive: true, force: true });
    } };
}
async function settled(runtime: TaskLensRuntime, id='a') {
  for(let i=0;i<100;i++) { const view=await runtime.view(id); if (!view.busy) return view; await delay(5); }
  throw new Error('解释未完成');
}
test('使用已配置模型，摘要与主会话保持独立并持久保存', async () => {
  const f=await fixture(); try {
    const before = JSON.stringify(f.logs); await f.runtime.requestRefresh('a'); const a=await settled(f.runtime);
    assert.equal(f.requests[0].provider, 'configured'); assert.equal(f.requests[0].model, 'test-model'); assert.equal(f.requests[0].tools, undefined); assert.equal(f.requests[0].sessionId, undefined);
    assert.equal(a.checkpoints.length, 1); assert.equal(a.tokensTotal, 150); assert.equal(JSON.stringify(f.logs), before);
    const restart = new TaskLensRuntime(f.services); await restart.initialize(); const restored = await restart.view('a');
    assert.equal(restored.checkpoints[0].briefing.goal, '任务 A'); assert.equal(restored.callsThisHour, 1); await restart.dispose();
  } finally { await f.cleanup(); }
});
test('两个会话的目标、阶段与暂停状态相互隔离', async () => {
  const f=await fixture(); try {
    await f.runtime.requestRefresh('a'); await settled(f.runtime,'a'); await f.runtime.requestRefresh('b'); const b=await settled(f.runtime,'b');
    assert.equal(b.checkpoints[0].briefing.goal, '任务 B'); await f.runtime.pause('a',true);
    assert.equal((await f.runtime.view('a')).paused,true); assert.equal((await f.runtime.view('b')).paused,false);
  } finally { await f.cleanup(); }
});
test('事件变化触发更新，静止会话不重复调用', async () => {
  const f=await fixture(); try {
    f.runtime.onEvent('a',f.logs.get('a')![2]); f.advance(11000); await f.runtime.tick(); await settled(f.runtime);
    assert.equal(f.requests.length,1); f.advance(100000); await f.runtime.tick(); await settled(f.runtime); assert.equal(f.requests.length,1);
    const ending=ev('turn/end',3,{ turn: 0, reason: { kind: 'completed' } }); f.logs.get('a')!.push(ending); f.runtime.onEvent('a',ending);
    f.advance(4000); await f.runtime.tick(); const view=await settled(f.runtime); assert.equal(f.requests.length,2); assert.equal(view.checkpoints.at(-1)!.briefing.status,'review'); assert.equal(view.nextAutomaticAt,null);
  } finally { await f.cleanup(); }
});
test('同一会话单次调用，暂停取消正在运行的解释', async () => {
  const f=await fixture({ blocking:true }); try {
    await f.runtime.requestRefresh('a'); await delay(20); await f.runtime.requestRefresh('a'); assert.equal(f.requests.length,1);
    await f.runtime.pause('a',true); const view=await settled(f.runtime); assert.equal(view.paused,true); assert.equal(view.checkpoints.length,0); assert.equal(view.error,null);
  } finally { await f.cleanup(); }
});
test('错误指数退避，连续三次失败停止自动调用', async () => {
  const f=await fixture({ fail:true }); try {
    await f.runtime.requestRefresh('a'); await settled(f.runtime); f.advance(190000); await f.runtime.tick(); await settled(f.runtime);
    f.advance(370000); await f.runtime.tick(); const view=await settled(f.runtime); assert.equal(f.requests.length,3); assert(view.notice?.includes('三次')); assert.equal(view.nextAutomaticAt,null);
  } finally { await f.cleanup(); }
});
test('未知模型被拒绝，小时上限涵盖手动调用', async () => {
  const f=await fixture(); try {
    await assert.rejects(f.runtime.configure({ model: { provider:'missing',model:'fake' } })); await f.runtime.configure({ maxCallsPerHour:6 });
    for(let i=0;i<7;i++) { await f.runtime.requestRefresh('a'); await settled(f.runtime); }
    assert.equal(f.requests.length,6); assert((await f.runtime.view('a')).notice?.includes('上限'));
  } finally { await f.cleanup(); }
});
test('子代理行动不触发额外独立解释', async () => {
  const f=await fixture(); try { f.runtime.onEvent('a',f.logs.get('a')![2],true); f.advance(20000); await f.runtime.tick(); assert.equal(f.requests.length,0); }
  finally { await f.cleanup(); }
});
test('生成解释期间出现阶段变化，保留提前更新的截止时间', async () => {
  const f=await fixture({deferred:true}); try {
    await f.runtime.requestRefresh('a'); await delay(20); f.advance(40000);
    const change=ev('todo/write',3,{items:[{title:'验证',state:'in_progress'}]});
    f.logs.get('a')!.push(change); f.runtime.onEvent('a',change); f.release();
    const view=await settled(f.runtime); assert.equal(view.nextAutomaticAt,143000);
  } finally { f.release(); await f.cleanup(); }
});
