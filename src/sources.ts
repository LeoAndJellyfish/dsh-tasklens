import { createHash } from 'node:crypto';
import { eventEvidence, redact, type ObservedEvent } from './core.js';
import type { PublicSource, SourceRef } from './schema.js';

export const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
function commandOf(data: Record<string, unknown>): { command?: string; workdir?: string } {
  if (!/(?:exec|shell|bash|terminal|command)/i.test(String(data.name))) return {};
  try {
    const args = record(JSON.parse(String(data.arguments)));
    const cmd = args.cmd ?? args.command ?? args.script;
    const dir = args.workdir ?? args.cwd;
    return { command: typeof cmd === 'string' ? redact(cmd).trim() : undefined, workdir: typeof dir === 'string' ? redact(dir).trim() : undefined };
  } catch { return {}; }
}
/** Registered deterministic check: an explicit command exit code, paired by call id. */
function parseCheck(text: string, command: string | undefined, error: boolean, workdir?: string): PublicSource['check'] {
  if (!command || error) return;
  const codes = [...text.matchAll(/(?:exit(?:ed)?(?:\s+with)?(?:\s+code)?|exit_code|exitCode|Process exited with code)["'\s:=]+(-?\d+)/gi)];
  const code = codes.at(-1)?.[1];
  if (code === undefined) return;
  const passed = text.match(/#\s*pass\s+(\d+)/i) ?? text.match(/(\d+)\s*(?:tests?\s+)?passed\b/i) ?? text.match(/(?:通过|passed)\s*[:：]?\s*(\d+)/i);
  const failed = text.match(/#\s*fail\s+(\d+)/i) ?? text.match(/(\d+)\s*failed/i);
  return { parser: 'command-exit-v1', command, workdir, exitCode: Number(code), passed: passed ? Number(passed[1]) : undefined, failed: failed ? Number(failed[1]) : undefined };
}
export function publicSources(events: readonly ObservedEvent[]): PublicSource[] {
  const calls = new Map<string, { seq: number; tool: string; command?: string; workdir?: string }>();
  const result: PublicSource[] = []; let round = 0;
  for (const event of events) {
    // DSH's append-origin log is the human transcript. Surface replacements serve model compaction.
    // They neither erase the original requirements nor acquire human authorization.
    if (record(event.surfaceOp).op === 'replace') continue;
    if (event.type === 'user/message') round++;
    const evidence = eventEvidence(event, Infinity); if (!evidence) continue;
    const d = record(event.data); const message = record(d.message);
    if (event.type === 'tool/call') calls.set(String(d.callId), { seq: event.seq, tool: String(d.name), ...commandOf(d) });
    const callId = event.type === 'tool/call' ? String(d.callId) : event.type === 'tool/result' ? String(message.toolCallId) : undefined;
    const call = callId ? calls.get(callId) : undefined;
    const role = event.type === 'user/message' ? 'user' : event.type === 'assistant/message' ? 'assistant' : event.type.startsWith('tool/') ? 'tool' : 'runtime';
    const hash = hashOf(`${event.type}\n${evidence.text}\n${call?.command ?? ''}\n${call?.workdir ?? ''}`);
    // Source pieces retain complete text across batches. No message tail is silently discarded.
    const pieces: string[] = []; let rest = evidence.text;
    while (rest.length) {
      let end = Math.min(1000, rest.length);
      if (end < rest.length) { const line = rest.lastIndexOf('\n', end); if (line > 500) end = line + 1; if (/^[\uDC00-\uDFFF]$/.test(rest[end] ?? '')) end--; }
      pieces.push(rest.slice(0, end)); rest = rest.slice(end);
    }
    const error = Boolean(d.error || message.isError);
    const check = event.type === 'tool/result' ? parseCheck(evidence.text, call?.command, error, call?.workdir) : undefined;
    pieces.forEach((text, part) => result.push({ id: `s-${event.seq}-${part}`, seq: event.seq, part, parts: pieces.length, round, time: event.time,
      type: event.type, role, hash, text, callId, callSeq: call?.seq, tool: call?.tool, command: call?.command, workdir: call?.workdir, error: event.type === 'tool/result' ? error : undefined,
      check: part === pieces.length - 1 ? check : undefined }));
  }
  return result;
}
export function sourceRevision(sources: readonly PublicSource[]): string { return hashOf(sources.map(s => `${s.id}:${s.hash}`).join('\n')); }
export function checkedRefs(value: unknown, sources: ReadonlyMap<string, PublicSource>, quotedOnly?: ReadonlyMap<string, string[]>): SourceRef[] {
  if (!Array.isArray(value) || !value.length || value.length > 12) throw new Error('变更需要 1—12 条公开来源。');
  return value.map(v => {
    const r = record(v); const s = sources.get(String(r.id));
    if (!s) throw new Error(`来源未载入，请通过 needsContext 请求原文：${String(r.id)}`);
    if (typeof r.quote !== 'string' || r.quote.trim().length < 2 || r.quote.length > 800 || !s.text.includes(r.quote)
      || quotedOnly?.has(s.id) && !quotedOnly.get(s.id)!.some(q => q.includes(r.quote as string))) throw new Error(`来源摘录与已载入原文不符：${String(r.id)}`);
    if (r.hash !== undefined && r.hash !== s.hash) throw new Error('来源版本已变化。');
    return { id: s.id, hash: s.hash, quote: r.quote };
  });
}
export function refsCurrent(refs: SourceRef[], sources: ReadonlyMap<string, PublicSource>): boolean {
  return refs.length > 0 && refs.every(r => { const s = sources.get(r.id); return s?.hash === r.hash && s.text.includes(r.quote); });
}
export function pendingUserSourceIds(sources: readonly PublicSource[]): Set<string> {
  const lastUser = sources.findLast(s => s.role === 'user')?.seq ?? -1;
  const decided = sources.findLast(s => s.type === 'approval/decided')?.seq ?? -1;
  return new Set(sources.filter(s => (s.type === 'approval/asked' && s.seq > decided && s.seq > lastUser)
    || (s.role === 'assistant' && s.seq > lastUser && /(?:请您|请确定|请选择|请确认|需要您|您希望|你希望).{0,100}[？?；;。.]?/s.test(s.text))
    || (s.type === 'tool/call' && s.seq > lastUser && /(?:request_user_input|ask_user|question)/i.test(s.tool ?? ''))).map(s => s.id));
}
