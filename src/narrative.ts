import { object } from './graph.js';
import type { Fact, ProseUnit, Roadmap, WorkBriefing } from './schema.js';
import type { Preferences } from './shared.js';
import { STYLE_VERSION } from './protocol.js';

export const styleProblems = (text: string): string[] => [
  /把[^。\n]{0,80}变成/.test(text) ? '转化模板' : '',
  /(?:不是[^。\n]{0,80}而是|不意味着|不代表|不能认为|本方法只)/.test(text) ? '翻案或自限句式' : '',
  /(?:综上所述|值得注意的是|赋能|全面提升|持续推进.{0,10}(?:能力|建设)|夯实|闭环|全方位|深度赋能)/.test(text) ? '空泛套话' : '',
  /(?:我会|我将|我们将|接下来我)/.test(text) ? '观察者执行承诺' : '',
].filter(Boolean);
function qualify(fact: Fact): string {
  if (fact.basis === 'reported' && !/执行\s*AI\s*报告/.test(fact.claim)) return `执行 AI 报告${fact.claim.replace(/[。；]$/, '')}。`;
  if (fact.basis === 'planned' && !/执行\s*AI/.test(fact.claim)) return `执行 AI 计划${fact.claim.replace(/[。；]$/, '')}。`;
  if (fact.basis === 'assessed' && !/待核对|待验收|模型判断/.test(fact.claim)) return `模型判断：${fact.claim.replace(/[。；]$/, '')}，依据待核对。`;
  return /[。！？]$/.test(fact.claim) ? fact.claim : fact.claim + '。';
}
const technicalExpression = (text: string) => /(?:\b(?:node|npm|pnpm|yarn|python|git|Get-Content|Invoke-WebRequest)\s+[-\w./]|[A-Za-z][\w-]*\.(?:test\.)?(?:mjs|cjs|tsx?|jsx?|json|ya?ml)\b|[A-Z]:[\\/])/i.test(text);
function displayFact(fact: Fact, graph: Roadmap, preferences: Preferences): string {
  if (preferences.audience === 'technical') return qualify(fact);
  const node = graph.nodes.find(n => n.id === fact.nodeId); let claim = fact.claim;
  for (const c of node?.criteria ?? []) if (c.check && claim.includes(c.check.command)) claim = claim.replaceAll(c.check.command, node!.title);
  return qualify({ ...fact, claim });
}
export function fallbackBriefing(graph: Roadmap, candidates: Fact[], preferences: Preferences): WorkBriefing {
  const usable = candidates.filter(f => f.valid && styleProblems(f.claim).length === 0);
  const priority = (f: Fact) => f.action === 'user' ? 9 : f.basis === 'unknown' ? 8 : f.basis === 'verified' || f.basis === 'confirmed' ? 7 : f.basis === 'reported' ? 5 : f.action === 'agent' ? 1 : 4;
  const selected = usable.filter(f => !f.action).sort((a, b) => priority(b) - priority(a)).slice(0, preferences.detail === 'brief' ? 1 : 3);
  const units = selected.map(f => ({ text: displayFact(f, graph, preferences), factIds: [f.id] }));
  const details = preferences.audience === 'overview' ? usable.filter(f => technicalExpression(f.claim)).map(f => ({ text: qualify(f), factIds: [f.id] })) : [];
  const primary = units.filter(u => !technicalExpression(u.text));
  if (!primary.length && selected.length) { const fact = selected[0]; const node = graph.nodes.find(n => n.id === fact.nodeId);
    primary.push({ text: `${node?.title ?? '任务检查'}有新的结果，具体范围见详情。`, factIds: [fact.id] }); }
  let headline = primary[0] ?? null; let summary = primary.slice(1);
  if (headline && headline.text.length > 36) { const fact = usable.find(f => f.id === headline!.factIds[0])!;
    const node = graph.nodes.find(n => n.id === fact.nodeId) ?? graph.nodes.filter(n => n.kind === 'task' && fact.claim.includes(n.title)).sort((a, b) => b.title.length - a.title.length)[0];
    const name = node?.title ?? '当前事项'; const failed = /失败|未通过/.test(fact.claim.replace(/(?:0|零)\s*(?:项|个)?\s*失败/g, ''));
    const text = fact.basis === 'reported' ? node ? `执行 AI 报告${name}的进展` : '执行 AI 已提交进展报告'
      : fact.basis === 'decision' ? /撤回|取消|新增|调整|改为/.test(fact.claim) ? '本版任务范围已调整' : '任务要求已记录'
      : fact.basis === 'verified' ? `${name}${failed ? '检查发现问题' : '检查通过'}`
      : fact.basis === 'confirmed' ? `用户已确认${name}` : `${name}结果待核对`;
    summary = primary; headline = { text, factIds: headline.factIds }; }
  return { headline, summary, agentNext: usable.filter(f => f.action === 'agent').slice(0, 2).map(f => { const text = displayFact(f, graph, preferences); const node = graph.nodes.find(n => n.id === f.nodeId);
    return { text: preferences.audience === 'overview' && technicalExpression(text) && node ? `执行 AI 计划继续${node.title}。` : text, factIds: [f.id] }; }),
    userActions: usable.filter(f => f.action === 'user').slice(0, 3).map(f => ({ text: qualify(f), factIds: [f.id] })), details, styleVersion: STYLE_VERSION, fallback: true };
}
export function validateBriefing(raw: unknown, graph: Roadmap, candidates: Fact[], loadedFacts: Set<string>, preferences: Preferences, changed: boolean): WorkBriefing {
  const input = object(raw);
  if (input.emit === false && !changed && graph.briefing) return graph.briefing;
  const facts = new Map([...graph.facts.filter(f => loadedFacts.has(f.id) && f.valid), ...candidates].map(f => [f.id, f]));
  const technicalUnits: ProseUnit[] = [];
  const unit = (v: unknown, purpose: 'headline' | 'summary' | 'agent' | 'user' | 'details'): ProseUnit | null => {
    const u = object(v); if (typeof u.text !== 'string' || !u.text.trim() || u.text.length > (purpose === 'headline' ? 120 : 500) || !Array.isArray(u.factIds) || !u.factIds.length) throw new Error('说明缺少事实引用。');
    const refs = [...new Set(u.factIds.map(String))]; const supporting = refs.map(id => facts.get(id));
    if (supporting.some(f => !f || !f.valid || f.nodeId && graph.nodes.find(n => n.id === f.nodeId)?.scopeRevision !== f.scopeRevision
      || !f.nodeId && f.goalId && graph.goals.find(g => g.id === f.goalId)?.revision !== f.scopeRevision)) throw new Error('说明引用了无效事实或旧需求版本。');
    const valid = supporting as Fact[]; let text = u.text.trim();
    if (styleProblems(text).length) throw new Error('说明含禁用表达。');
    if ((text.match(/\d+(?:\.\d+)?/g) ?? []).some(d => !valid.some(f => f.claim.includes(d) || f.scope.includes(d)))) throw new Error('说明新增了来源外数字。');
    if (valid.some(f => f.basis === 'reported') && /(?:完成|通过|修复|成功|已交付|已发布)/.test(text)
      && !/(?:执行\s*AI\s*报告|助手报告|据执行\s*AI)/.test(text)) throw new Error('完成报告的身份限定缺失。');
    if (valid.some(f => f.basis === 'planned') && (/(?:已完成|已经|通过了|已发布)/.test(text)
      || purpose !== 'agent' && !/(?:计划|接下来|准备|拟|等待|需要|仍待|尚待|执行\s*AI\s*(?:会|将))/.test(text)
      && !(purpose === 'details' && /(?:命令|接口|标准|检查绑定|产物|路径)/.test(text)))) throw new Error('计划的确定程度扩大。');
    if (valid.some(f => f.basis === 'assessed') && !/(?:模型判断|待核对|待验收)/.test(text)) throw new Error('模型判断的核验限定缺失。');
    if (/(?:全部|所有|整体).{0,15}(?:完成|通过)|(?:可以|可).{0,8}(?:发布|交付)/.test(text)
      && !valid.some(f => /(?:全部|所有|整体).{0,15}(?:完成|通过)|(?:可以|可).{0,8}(?:发布|交付)/.test(f.claim))) throw new Error('说明扩大了交付范围。');
    if (/(?:由于|因此|导致|所以)/.test(text) && !valid.some(f => /(?:由于|因此|导致|所以|原因)/.test(f.claim) || f.sources.some(s => /(?:由于|因此|导致|所以|原因)/.test(s.quote)))) throw new Error('因果缺少来源。');
    if (purpose === 'user' && valid.some(f => f.action !== 'user')) throw new Error('说明虚构了用户待办。');
    if (purpose === 'agent' && valid.some(f => f.action !== 'agent')) throw new Error('说明新增了执行计划。');
    if (preferences.audience === 'overview' && purpose !== 'details' && purpose !== 'user' && technicalExpression(text)) {
      technicalUnits.push({ text, factIds: refs });
      if (purpose === 'headline') throw new Error('标题需要直接说明工作对象与结果。');
      if (purpose === 'summary') return null;
      const node = valid.map(f => graph.nodes.find(n => n.id === f.nodeId)).find(Boolean);
      if (!node) return null;
      text = `执行 AI 计划继续${node.title}。`;
    }
    return { text, factIds: refs };
  };
  const units = (key: string, purpose: Parameters<typeof unit>[1], maximum: number) => {
    if (!Array.isArray(input[key]) || input[key].length > maximum) throw new Error('说明结构无效。');
    return input[key].map(v => unit(v, purpose)).filter((v): v is ProseUnit => v !== null);
  };
  const briefing: WorkBriefing = { headline: input.headline === null ? null : unit(input.headline, 'headline'),
    summary: units('summary', 'summary', 5), agentNext: units('agentNext', 'agent', 3), userActions: units('userActions', 'user', 4),
    details: units('details', 'details', 8), styleVersion: STYLE_VERSION, fallback: false };
  if (technicalUnits.length) briefing.details = [...new Map([...briefing.details, ...technicalUnits].map(u => [u.text, u])).values()].slice(0, 8);
  // Required pending decisions must survive prose selection.
  for (const fact of candidates.filter(f => f.action === 'user')) if (!briefing.userActions.some(u => u.factIds.includes(fact.id))) throw new Error('待用户处理的明确请求遗漏。');
  if (changed && !briefing.headline && !briefing.summary.length) throw new Error('重要变化缺少说明。');
  return briefing;
}
/** Candidate references are converted to stable fact ids before persistence. */
export function stableBriefing(briefing: WorkBriefing, graph: Roadmap, candidates: Fact[]): WorkBriefing {
  const ids = new Map(candidates.map(c => [c.id, graph.facts.find(f => f.valid && f.claim === c.claim && f.basis === c.basis && f.nodeId === c.nodeId && f.goalId === c.goalId && f.scopeRevision === c.scopeRevision && f.sources.map(s => s.id).join() === c.sources.map(s => s.id).join())?.id ?? c.id]));
  const convert = (u: ProseUnit) => ({ ...u, factIds: u.factIds.map(id => ids.get(id) ?? id) });
  return { ...briefing, headline: briefing.headline ? convert(briefing.headline) : null,
    summary: briefing.summary.map(convert), agentNext: briefing.agentNext.map(convert), userActions: briefing.userActions.map(convert), details: briefing.details.map(convert) };
}
