import { EMPTY_ACTIVITY, type Evidence, type LiveActivity, type RunStatus } from './shared.js';

/** Deliberately excludes request headers, system prompts, reasoning blocks and adapter secrets. */
export interface ObservedEvent { type: string; seq: number; time: number; data: unknown; surfaceOp?: unknown }
const records = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
const PUBLIC_EVENTS = new Set(['user/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/start', 'turn/end',
  'todo/write', 'goal/change', 'plan/mode', 'deliverables/presented', 'approval/asked', 'approval/decided', 'team/task', 'tool-workflow/run-end']);
export function redact(text: string): string {
  return text
    .replace(/\b(?:sk|ghp|gho|github_pat)-[A-Za-z0-9_-]{12,}\b/g, '[已隐藏凭据]')
    .replace(/\b(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{12,}\b/g, '[已隐藏凭据]')
    .replace(/(bearer\s+)[\w.+/=-]{12,}/gi, '$1[已隐藏凭据]')
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret|authorization)["']?\s*[:=]\s*["']?)[^\s,"'\n}]{6,}/gi, '$1[已隐藏凭据]');
}
export function clipped(text: string, size: number): string {
  const safe = redact(text).trim();
  return safe.length > size ? safe.slice(0, size) + '…' : safe;
}
function visibleText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.flatMap(block => {
    const b = records(block);
    return b.type === 'text' && typeof b.text === 'string' ? [b.text] : [];
  }).join('\n');
}
const END_LABELS: Record<string, { status: RunStatus; label: string }> = {
  completed: { status: 'review', label: '助手已结束本轮回复，交付结果等待核验' },
  blocked: { status: 'waiting', label: '助手正在等待输入或授权' },
  error: { status: 'blocked', label: '本轮执行发生错误' },
  aborted: { status: 'stopped', label: '本轮任务已停止' },
  interrupted: { status: 'stopped', label: '会话执行中断' },
  'max-tokens': { status: 'blocked', label: '本轮达到输出长度上限' },
};
export function eventEvidence(event: ObservedEvent, limit?: number): Evidence | null {
  const d = records(event.data);
  let text = '';
  switch (event.type) {
    case 'user/message': text = visibleText(d.content); break;
    case 'assistant/message': text = visibleText(records(d.message).content); break;
    case 'tool/call': text = `调用工具 ${String(d.name ?? '')}：${typeof d.arguments === 'string' ? d.arguments : ''}`; break;
    case 'tool/result': text = `${d.error || records(d.message).isError ? '工具执行错误：' : '工具返回：'}${visibleText(records(d.message).content)}`; break;
    case 'turn/start': text = '开始新一轮任务'; break;
    case 'turn/end': {
      const reason = records(d.reason);
      text = `${END_LABELS[String(reason.kind)]?.label ?? '本轮结束'}${records(reason.error).message ? `：${records(reason.error).message}` : ''}`;
      break;
    }
    case 'todo/write': case 'goal/change': case 'plan/mode': case 'deliverables/presented':
    case 'approval/asked': case 'approval/decided': case 'team/task': case 'tool-workflow/run-end':
      // Public structured state is useful; private per-request material never enters this allowlist.
      text = JSON.stringify(event.data); break;
    default: return null;
  }
  if (!text.trim()) return null;
  return { seq: event.seq, type: event.type, time: event.time, text: clipped(text, limit ?? (event.type === 'tool/result' ? 1800 : 1400)) };
}
export function projectActivity(events: readonly ObservedEvent[]): LiveActivity {
  const state: LiveActivity = { ...EMPTY_ACTIVITY, pendingTools: [] };
  const pending = new Map<string, string>();
  const approvals = new Set<string>();
  for (const event of events) {
    const d = records(event.data);
    if (event.type === 'turn/start') {
      state.status = 'running'; state.label = '助手正在规划或执行当前任务'; pending.clear(); approvals.clear();
    } else if (event.type === 'tool/call') {
      pending.set(String(d.callId), String(d.name ?? '工具')); state.toolCount++;
      state.label = `正在执行 ${String(d.name ?? '工具')}`;
    } else if (event.type === 'tool/result') {
      pending.delete(String(records(d.message).toolCallId));
      state.label = d.error ? '工具遇到错误，助手正在处理' : '已收到工具结果，助手正在继续推进';
    } else if (event.type === 'approval/asked') {
      approvals.add(String(d.callId ?? d.id ?? event.seq));
    } else if (event.type === 'approval/decided') {
      const key = String(d.callId ?? d.id ?? '');
      if (key) approvals.delete(key); else approvals.clear();
    } else if (event.type === 'turn/end') {
      const terminal = END_LABELS[String(records(d.reason).kind)] ?? { status: 'review' as const, label: '本轮已结束' };
      state.status = terminal.status; state.label = terminal.label; pending.clear(); approvals.clear();
    }
    if (PUBLIC_EVENTS.has(event.type)) { state.lastEventAt = event.time; state.throughSeq = event.seq; }
  }
  state.pendingTools = [...pending.values()];
  if (approvals.size && state.status === 'running') { state.status = 'waiting'; state.label = '有操作请求正在等待您的确认'; }
  return state;
}
export function contextFor(events: readonly ObservedEvent[], throughSeq = -1, limit = 18000): {
  evidence: Evidence[]; goal: string; latestRequest: string; changed: boolean;
} {
  // Replaced transcript messages are removed so a deleted/corrected request does not stay authoritative.
  const shadowed = new Set<number>();
  for (const e of events) {
    const op = records(e.surfaceOp);
    if (op.op === 'replace' && typeof op.startSeq === 'number' && typeof op.endSeq === 'number') {
      for (const old of events) if (old.seq >= op.startSeq && old.seq <= op.endSeq) shadowed.add(old.seq);
    }
  }
  const all = events.filter(e => !shadowed.has(e.seq)).flatMap(e => { const v = eventEvidence(e); return v ? [v] : []; });
  const requests = all.filter(e => e.type === 'user/message');
  const goal = clipped(requests[0]?.text ?? '', 1200);
  const latestRequest = clipped(requests.at(-1)?.text ?? '', 1200);
  const selected = new Map<number, Evidence>();
  for (const type of ['user/message', 'todo/write', 'goal/change', 'deliverables/presented']) {
    const latest = all.findLast(e => e.type === type); if (latest) selected.set(latest.seq, latest);
  }
  // Favor the new interval and keep the recent context. Bound both event count and UTF-16 characters.
  let remaining = Math.max(0, limit - [...selected.values()].reduce((n,e) => n + e.text.length + 100, 0));
  for (const e of all.slice(-160).reverse()) {
    if (selected.has(e.seq)) continue;
    if (selected.size >= 40 || remaining <= 150) break;
    const text = e.text.slice(0, Math.min(e.text.length, remaining - 100));
    selected.set(e.seq, { ...e, text }); remaining -= text.length + 100;
  }
  return { evidence: [...selected.values()].sort((a,b) => a.seq - b.seq), goal, latestRequest, changed: all.some(e => e.seq > throughSeq) };
}
export const PRIORITY_EVENTS = new Set(['user/message', 'turn/end', 'approval/asked', 'approval/decided', 'goal/change', 'todo/write', 'deliverables/presented']);
export function importantResult(event: ObservedEvent): boolean {
  if (event.type !== 'tool/result') return false;
  const d = records(event.data), message = records(d.message);
  return Boolean(d.error || message.isError) || /(?:Process exited with code|exit_code|tests?\s+(?:passed|failed)|# (?:pass|fail)|验收通过|测试.{0,10}(?:通过|失败))/i.test(visibleText(message.content));
}
/** Event-driven checks still obey the shared spacing, budget and single-flight gate. */
export function canCall(now: number, lastStart: number, minGapSeconds: number, calls: readonly number[], cap: number): boolean {
  return now - lastStart >= minGapSeconds * 1000 && calls.filter(t => t > now - 3600000).length < cap;
}
