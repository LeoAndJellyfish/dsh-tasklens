import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptyRoadmap, type Fact } from '../src/schema.js';
import { DEFAULTS } from '../src/shared.js';
import { validateBriefing, fallbackBriefing, styleProblems } from '../src/narrative.js';
import { basic } from './helpers.js';

const cases = JSON.parse(await readFile(new URL('../docs/plans/briefing-language-cases.json', import.meta.url), 'utf8')).cases as any[];
const normalize = (reference: any) => ({ emit: reference.emit, headline: reference.headline ? { text: reference.headline.text, factIds: reference.headline.fact_ids } : null,
  summary: (reference.summary_units ?? []).map((u: any) => ({ text: u.text, factIds: u.fact_ids })), agentNext: (reference.agent_next ?? []).map((u: any) => ({ text: u.text, factIds: u.fact_ids })),
  userActions: (reference.user_actions ?? []).map((u: any) => ({ text: u.text, factIds: u.fact_ids })), details: (reference.detail_units ?? []).map((u: any) => ({ text: u.text, factIds: u.fact_ids })) });
for (const c of cases) test(`表达案例 ${c.id}：引用与关键事实保留`, () => {
  const facts: Fact[] = c.facts.map((f: any) => ({ id: f.id, nodeId: null, goalId: null, scopeRevision: c.frame?.goal_revision ?? 1, claim: f.claim,
    basis: f.basis, actor: f.actor ?? 'system', scope: f.scope ?? '', valid: true, time: 1,
    sources: f.source_refs.map((id: string) => ({ id, hash: 'fixture', quote: c.sources.find((s: any) => s.id === id).text })),
    action: c.user_actions.some((a: any) => a.fact_ids?.includes(f.id)) ? 'user' : c.agent_actions.some((a: any) => a.fact_ids?.includes(f.id)) ? 'agent' : null }));
  const graph = emptyRoadmap('synthetic', 'fixture'); graph.facts = facts;
  if (!c.material_change) graph.briefing = { headline: null, summary: [], agentNext: [], userActions: [], details: [], styleVersion: 2, fallback: false };
  const input = normalize(c.reference); const result = validateBriefing(input, graph, [], new Set(facts.map(f => f.id)), DEFAULTS, c.material_change);
  const units = [result.headline, ...result.summary, ...result.agentNext, ...result.userActions, ...result.details].filter(Boolean);
  const used = new Set(units.flatMap(u => u!.factIds)); if (c.material_change) for (const id of c.required_fact_ids) assert(used.has(id), `缺少 ${id}`);
  assert.equal(result.userActions.length, c.user_actions.length); assert.equal(styleProblems(units.map(u => u!.text).join('')).length, 0);
});
test('来源外数字、扩大完成结论和虚构用户待办被拒绝', () => {
  const graph = emptyRoadmap('s', 'g'); const fact: Fact = { id: 'f', nodeId: null, goalId: null, scopeRevision: 1, claim: '12 项单元测试通过，安装待核对。', scope: '单元测试', basis: 'verified', actor: 'system', sources: [], valid: true, time: 1, action: null };
  graph.facts = [fact]; const base = { emit: true, headline: { text: '12 项单元测试通过', factIds: ['f'] }, summary: [], agentNext: [], userActions: [], details: [] };
  assert.throws(() => validateBriefing({ ...base, headline: { text: '30 项测试通过', factIds: ['f'] } }, graph, [], new Set(['f']), DEFAULTS, true), /数字/);
  assert.throws(() => validateBriefing({ ...base, headline: { text: '全部功能已完成', factIds: ['f'] } }, graph, [], new Set(['f']), DEFAULTS, true), /范围/);
  assert.throws(() => validateBriefing({ ...base, userActions: [{ text: '请您修复安装。', factIds: ['f'] }] }, graph, [], new Set(['f']), DEFAULTS, true), /用户待办/);
});
test('报告性完成需要保留报告身份，备用说明保留范围和数字', () => {
  const graph = emptyRoadmap('s', 'g'); const fact: Fact = { id: 'c-1', nodeId: null, goalId: null, scopeRevision: 1, claim: '回放测试已完成，12 项用例的测试范围待核对。', scope: '回放测试', basis: 'reported', actor: 'agent', sources: [], valid: true, time: 1, action: null };
  assert.throws(() => validateBriefing({ emit: true, headline: { text: '回放测试已完成', factIds: ['c-1'] }, summary: [], agentNext: [], userActions: [], details: [] }, graph, [fact], new Set(), DEFAULTS, true), /身份/);
  const fallback = fallbackBriefing(graph, [fact], DEFAULTS); const text = [fallback.headline?.text, ...fallback.summary.map(u => u.text)].join(''); assert(text.includes('执行 AI')); assert(text.includes('12')); assert(text.includes('范围待核对'));
});
test('没有重要变化时保留此前说明', () => { const graph = emptyRoadmap('s', 'g'); graph.briefing = { headline: { text: '自动刷新仍在检查', factIds: [] }, summary: [], agentNext: [], userActions: [], details: [], styleVersion: 2, fallback: false };
  assert.equal(validateBriefing({ emit: false }, graph, [], new Set(), DEFAULTS, false), graph.briefing);
});

test('概况保留结果标题，完整命令与退出码进入详情', () => { const f = basic(); const fact: Fact = { id: 'f', nodeId: f.check.id, goalId: f.check.goalId, scopeRevision: 1,
  claim: '12 项路线图检查通过，npm test --workspace tasklens 退出码为 0。', basis: 'verified', actor: 'system', scope: '路线图检查', sources: [], valid: true, time: 1, action: null };
  const result = validateBriefing({ emit: true, headline: { text: '12 项路线图检查通过', factIds: ['f'] }, summary: [{ text: fact.claim, factIds: ['f'] }], agentNext: [], userActions: [], details: [] }, f.graph, [fact], new Set(), DEFAULTS, true);
  assert.equal(result.headline!.text, '12 项路线图检查通过'); assert.equal(result.summary.length, 0); assert(result.details.some(u => u.text === fact.claim));
});
