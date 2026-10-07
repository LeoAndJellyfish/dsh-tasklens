import type { SVGProps } from 'react';
import { TASK_LABELS, type TaskStatus } from '../schema.js';
export function LensIcon({ size = 18, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" {...props}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 4.2 4.2M7.5 11.5l2-2 2 2 2-3" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
export function Icon({ kind, spin = false }: { kind: 'refresh' | 'settings' | 'pause' | 'play' | 'chevron' | 'arrow' | 'history' | 'source'; spin?: boolean }) {
  const paths = { refresh: 'M18 8a7 7 0 1 0 1 7M18 3v5h-5', settings: 'M5 7h14M5 17h14M9 4v6M15 14v6', pause: 'M9 5v14M15 5v14', play: 'm8 5 11 7-11 7z', chevron: 'm8 10 4 4 4-4', arrow: 'M5 12h14m-6-6 6 6-6 6', history: 'M4 8V3m0 5h5M4 8a8 8 0 1 1-1 7m9-8v5l3 2', source: 'M7 3h7l4 4v14H7V3m7 0v5h4M10 12h5m-5 4h5' };
  return <svg className={spin ? 'tl-spinner' : undefined} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]}/></svg>;
}
export function StatusIcon({ status }: { status: TaskStatus }) {
  const paths: Partial<Record<TaskStatus, string>> = { done: 'm6 12 4 4 8-9', blocked: 'M12 7v6m0 4h.01', waiting: 'M12 6v6l4 2', review: 'M8 8h8m-8 4h8m-8 4h4', paused: 'M9 7v10m6-10v10', abandoned: 'm8 8 8 8m0-8-8 8', superseded: 'M7 6v8h11m-4-4 4 4-4 4' };
  return <svg className="tl-state-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {status !== 'superseded' && <circle cx="12" cy="12" r="9"/>}{status === 'active' && <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>}{paths[status] && <path d={paths[status]}/>}</svg>;
}
export function Badge({ status }: { status: TaskStatus }) { return <span className="tl-badge" data-status={status}>{TASK_LABELS[status]}</span>; }
export const time = (n: number) => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(n);
export function ranges(values: number[]): string {
  if (!values.length) return '无'; const sorted = [...new Set(values)].sort((a, b) => a - b); const chunks: string[] = []; let start = sorted[0], end = start;
  for (const n of sorted.slice(1)) { if (n === end + 1) end = n; else { chunks.push(start === end ? String(start) : `${start}—${end}`); start = end = n; } }
  chunks.push(start === end ? String(start) : `${start}—${end}`); return chunks.join('、');
}
