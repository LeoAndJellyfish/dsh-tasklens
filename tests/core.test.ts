import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextFor, eventEvidence, projectActivity, redact, canCall, type ObservedEvent } from '../src/core.js';
import { parseBriefing } from '../src/briefing.js';
import { preferencesOf, EMPTY_ACTIVITY } from '../src/shared.js';

const event = (type: string, seq: number, data: unknown): ObservedEvent => ({ type, seq, time: 1000 + seq, data });
const message = (text: string) => ({ content: [{ type: 'text', text }] });
const report = () => ({ goal: '实现插件', headline: '正在验证插件', stage: '验证', summary: '界面已完成，接下来验证安装。', status: 'review',
  stages: [{ id: 'build', title: '实现', state: 'done', reason: '构建成功', evidence: [2] }],
  completed: [{ text: '测试通过', evidence: [2,999], basis: 'tool' }], next: ['安装插件'], attention: [],
  acceptance: [{ text: '接口验证通过', state: 'passed', evidence: [2] }] });
test('公开上下文排除内部推理、系统提示与请求配置', () => {
  const e = event('assistant/message', 1, { message: { content: [{ type: 'reasoning', text: 'private chain' }, { type: 'text', text: '正在构建' }] } });
  assert.equal(eventEvidence(e)?.text, '正在构建');
  assert.equal(eventEvidence(event('system/message', 2, message('private prompt'))), null);
  assert.equal(eventEvidence(event('request/header', 3, { header: { secret: 'private key' } })), null);
});
test('常见凭据从摘要上下文中脱敏', () => {
  const output = redact('api_key=abcdef0123456789 Bearer abcdef0123456789 ghp_12345678901234567 sk-12345678901234567');
  assert(!output.includes('abcdef')); assert(!output.includes('123456789012')); assert(output.includes('已隐藏凭据'));
});
test('调用中的工具保持进行中，完成回复记录为待核验', () => {
  const running = [event('turn/start', 0, { turn: 1 }), event('tool/call', 1, { callId: 'a', name: 'bash' })];
  assert.deepEqual(projectActivity(running).pendingTools, ['bash']); assert.equal(projectActivity(running).status, 'running');
  const settled = [...running, event('tool/result', 2, { message: { ...message('pass'), toolCallId: 'a' } }), event('turn/end', 3, { reason: { kind: 'completed' } })];
  assert.equal(projectActivity(settled).status, 'review'); assert.deepEqual(projectActivity(settled).pendingTools, []);
});
test('审批请求与运行错误有独立的状态', () => {
  assert.equal(projectActivity([event('turn/start', 0, {}), event('approval/asked', 1, { callId: 'a' })]).status, 'waiting');
  assert.equal(projectActivity([event('turn/end', 2, { reason: { kind: 'error' } })]).status, 'blocked');
});
test('上下文保留原始目标和最新需求，限制长度与条数', () => {
  const events = [event('user/message', 0, message('创建插件')), ...Array.from({ length: 500 }, (_,i) => event('tool/result', i+1, { message: message('x'.repeat(5000)) })), event('user/message', 501, message('增加验收'))];
  const context = contextFor(events, 400);
  assert.equal(context.goal, '创建插件'); assert.equal(context.latestRequest, '增加验收'); assert(context.changed);
  assert(context.evidence.length <= 40); assert(context.evidence.reduce((n,e) => n + e.text.length + 100, 0) <= 18000);
});
test('修订过的用户消息在有效需求中更新', () => {
  const replaced = { ...event('user/message', 2, message('新需求')), surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 } };
  const context = contextFor([event('user/message', 0, message('旧需求')), replaced]);
  assert.equal(context.goal, '新需求'); assert(!context.evidence.some(e => e.seq === 0));
});
test('静止会话跳过调用，时间间隔与小时上限共同约束', () => {
  assert.equal(contextFor([event('user/message', 0, message('需求'))], 0).changed, false);
  assert.equal(canCall(20000, 0, 30, [], 40), false); assert.equal(canCall(31000, 0, 30, [], 40), true);
  assert.equal(canCall(40000, 0, 30, [1,2], 2), false);
});
test('模型来源引用经过验证，助手陈述保留待核验', () => {
  const evidence = [eventEvidence(event('assistant/message', 2, { message: message('测试通过') }))!];
  const parsed = parseBriefing(JSON.stringify(report()), evidence, { ...EMPTY_ACTIVITY, status: 'running' });
  assert.equal(parsed.status, 'running'); assert.deepEqual(parsed.completed[0].evidence, [2]);
  assert.equal(parsed.completed[0].basis, 'reported'); assert.equal(parsed.acceptance[0].state, 'pending');
});
test('有工具结果的验收可记录来源，无来源完成阶段降为待推进', () => {
  const r = report(); const parsed = parseBriefing(JSON.stringify(r), [eventEvidence(event('tool/result', 2, { message: message('tests: passed') }))!], EMPTY_ACTIVITY);
  assert.equal(parsed.acceptance[0].state, 'passed'); assert.equal(parsed.completed[0].basis, 'tool');
  const empty = parseBriefing(JSON.stringify(r), [], EMPTY_ACTIVITY); assert.equal(empty.stages[0].state, 'pending');
});
test('无效模型 JSON 明确失败', () => {
  assert.throws(() => parseBriefing('I did it', [], EMPTY_ACTIVITY)); assert.throws(() => parseBriefing('{}', [], EMPTY_ACTIVITY));
});
test('设置有明确的合法范围', () => {
  const p = preferencesOf({ intervalSeconds: 0, maxCallsPerHour: 10000, minGapSeconds: NaN, detail: 'unknown', model: { provider: '', model: 'x' } });
  assert.equal(p.intervalSeconds, 45); assert.equal(p.maxCallsPerHour, 120); assert.equal(p.minGapSeconds, 30); assert.equal(p.detail, 'standard'); assert.equal(p.model, null);
});
