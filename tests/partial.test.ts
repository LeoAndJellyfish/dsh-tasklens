import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeGraphPrefix } from '../src/partial.js';
const patch = { baseGraphVersion: 0, sourceRevision: 'current', operations: [{ type: 'add_goal', title: '原文中的 {括号}、"引号" 与 \\ 路径', sources: [] }] };
test('摘要截断时提取已完整序列化的任务图，保留模型原版本字段', () => {
  const text = JSON.stringify({ graphPatch: patch }).slice(0, -1) + ',"factCandidates":[{"claim":"未结束';
  const recovered = completeGraphPrefix(text) as any;
  assert.deepEqual(recovered.graphPatch, patch); assert.deepEqual(recovered.factCandidates, []);
});
test('任务操作序列截断时仅恢复完整对象，不补全残缺文字或来源', () => {
  const text = '{"graphPatch":{"baseGraphVersion":0,"sourceRevision":"current","operations":[' + JSON.stringify(patch.operations[0]) + ',{"type":"add_node","sources":[{"quote":"尚未结束';
  assert.deepEqual((completeGraphPrefix(text) as any).graphPatch.operations, patch.operations);
});
test('版本未结束、首项无完整对象和伪嵌套字段均不接受恢复', () => {
  assert.equal(completeGraphPrefix('{"graphPatch":{"sourceRevision":"unfinished'), null);
  assert.equal(completeGraphPrefix('{"graphPatch":{"baseGraphVersion":0,"sourceRevision":"current","operations":[{"type":"unfinished'), null);
  assert.equal(completeGraphPrefix('{"someText":"fake","graphPatch":{"baseGraphVersion":0,"sourceRevision":"current","operations":[{}]}}'), null);
  assert.equal(completeGraphPrefix('{"graphPatch":{"baseGraphVersion":0,"sourceRevision":"current","operations":[]}}'), null);
});
