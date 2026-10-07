import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { TASK_LABELS, type Roadmap, type TaskNode } from '../schema.js';
import { route, rounded, type Point, type Rect, type Segment } from './routing.js';
import { Badge, StatusIcon } from './common.js';
import { dependencyRows } from './layout.js';
interface Edge { id: string; from: string; to: string; blocked: boolean }
type Side = 'left' | 'right' | 'top' | 'bottom';
interface Port { edge: string; role: 'source' | 'target'; side: Side; position: number }
interface Path { id: string; d: string; points: Point[]; tone: 'normal' | 'selected' | 'blocked'; from: string; to: string }
export function Graph({ graph, selected, onSelect }: { graph: Roadmap; selected: string | null; onSelect: (id: string) => void }) {
  const root = useRef<HTMLDivElement>(null); const marker = useId().replace(/:/g, '');
  const [vertical, setVertical] = useState(true); const [local, setLocal] = useState(true);
  const [geometry, setGeometry] = useState<{ width: number; height: number; paths: Path[]; failed: string[] }>({ width: 1, height: 1, paths: [], failed: [] });
  const data = useMemo(() => {
    const tasks = graph.nodes.filter(n => n.kind === 'task' && !['abandoned', 'superseded'].includes(n.status));
    const phases = graph.nodes.filter(n => n.kind === 'phase' && !['abandoned', 'superseded'].includes(n.status));
    let nodes: TaskNode[] = tasks; let aggregated = false;
    if (tasks.length > 24) {
      if (local && selected && tasks.some(n => n.id === selected)) {
        const ids = new Set([selected]); for (let depth = 0; depth < 2; depth++) for (const e of graph.edges) {
          if (ids.has(e.from) || ids.has(e.to)) { if (ids.size < 24) ids.add(e.from); if (ids.size < 24) ids.add(e.to); }
        }
        nodes = tasks.filter(n => ids.has(n.id));
      } else { nodes = [...phases, ...tasks.filter(n => !n.parentId)].slice(0, 24); aggregated = true; }
    }
    const ids = new Set(nodes.map(n => n.id));
    const project = (id: string) => ids.has(id) ? id : aggregated ? graph.nodes.find(n => n.id === id)?.parentId : null;
    const edges: Edge[] = [];
    for (const e of graph.edges) { const from = project(e.from), to = project(e.to); if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) continue;
      const existing = edges.find(p => p.from === from && p.to === to); const blocked = graph.nodes.find(n => n.id === e.from)?.status === 'blocked';
      if (existing) existing.blocked ||= blocked; else edges.push({ id: e.id, from, to, blocked }); }
    // Stable order within each phase, with predecessor ordering where possible.
    const ordered: TaskNode[] = []; const waiting = nodes.slice().sort((a, b) => a.order - b.order);
    while (waiting.length) { const index = waiting.findIndex(n => !edges.some(e => e.to === n.id && waiting.some(w => w.id === e.from)));
      ordered.push(...waiting.splice(index < 0 ? 0 : index, 1)); }
    const groupIds = [...new Set(ordered.map(n => aggregated ? n.goalId : n.parentId ?? n.goalId))];
    const groups = groupIds.map(id => ({ id, title: graph.nodes.find(n => n.id === id)?.title ?? graph.goals.find(g => g.id === id)?.title ?? '任务', nodes: ordered.filter(n => (aggregated ? n.goalId : n.parentId ?? n.goalId) === id) }));
    const rows = dependencyRows(ordered, groups, edges);
    return { nodes: ordered, groups, edges, rows, rowCount: Math.max(0, ...rows.values()) + 1, aggregated, total: tasks.length };
  }, [graph, selected, local]);
  const ports = useMemo(() => {
    const map = new Map(data.nodes.map(n => [n.id, [] as Port[]]));
    const column = (id: string) => data.groups.findIndex(g => g.nodes.some(n => n.id === id));
    for (const e of data.edges) { const a = column(e.from), b = column(e.to), same = vertical || a === b;
      map.get(e.from)!.push({ edge: e.id, role: 'source', side: same ? 'bottom' : b > a ? 'right' : 'left', position: 50 });
      map.get(e.to)!.push({ edge: e.id, role: 'target', side: same ? 'top' : b > a ? 'left' : 'right', position: 50 }); }
    for (const group of map.values()) for (const port of group) { const peers = group.filter(p => p.side === port.side); port.position = (peers.indexOf(port) + 1) / (peers.length + 1) * 100; }
    return map;
  }, [data, vertical]);
  useLayoutEffect(() => {
    const canvas = root.current; if (!canvas) return;
    let frame = 0;
    const draw = () => { frame = 0; const box = canvas.getBoundingClientRect(); const width = canvas.clientWidth, height = canvas.clientHeight;
      if (!width || !height) return; const actual = width <= 540 || data.groups.length > 4;
      if (actual !== vertical) { setVertical(actual); return; }
      const rect = (el: Element, padding: number): Rect => { const r = el.getBoundingClientRect(); return { left: r.left - box.left - padding, top: r.top - box.top - padding, right: r.right - box.left + padding, bottom: r.bottom - box.top + padding }; };
      const obstacles = [...canvas.querySelectorAll('[data-graph-card]')].map(el => rect(el, 9));
      obstacles.push(...[...canvas.querySelectorAll('.tl-graph-heading')].map(el => rect(el, 6)));
      const normals: Record<Side, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };
      const used: Segment[] = [], paths: Path[] = [], failed: string[] = [];
      for (const e of data.edges) {
        const from = canvas.querySelector<HTMLElement>(`[data-port-edge="${e.id}"][data-port-role="source"]`), to = canvas.querySelector<HTMLElement>(`[data-port-edge="${e.id}"][data-port-role="target"]`);
        if (!from || !to) { failed.push(e.id); continue; }
        const a = from.getBoundingClientRect(), b = to.getBoundingClientRect(); const an = normals[from.dataset.side as Side], bn = normals[to.dataset.side as Side];
        const ac = { x: a.left - box.left + a.width / 2, y: a.top - box.top + a.height / 2 }, bc = { x: b.left - box.left + b.width / 2, y: b.top - box.top + b.height / 2 };
        const start = { x: ac.x + an.x * 4, y: ac.y + an.y * 4 }, end = { x: bc.x + bn.x * 5, y: bc.y + bn.y * 5 };
        const leadA = { x: ac.x + an.x * 12, y: ac.y + an.y * 12 }, leadB = { x: bc.x + bn.x * 12, y: bc.y + bn.y * 12 };
        const inner = route(leadA, leadB, obstacles, width, height, used, e.from); if (!inner) { failed.push(e.id); continue; }
        const points = [start, ...inner, end]; for (let i = 1; i < points.length; i++) used.push({ a: points[i - 1], b: points[i], owner: e.from });
        paths.push({ id: e.id, from: e.from, to: e.to, points, d: rounded(points), tone: e.blocked ? 'blocked' : e.from === selected || e.to === selected ? 'selected' : 'normal' });
      }
      setGeometry(before => JSON.stringify(before) === JSON.stringify({ width, height, paths, failed }) ? before : { width, height, paths, failed });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); }; schedule();
    const observer = new ResizeObserver(schedule); observer.observe(canvas); canvas.querySelectorAll('[data-graph-card]').forEach(el => observer.observe(el));
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [data, ports, vertical, selected]);
  return <div className="tl-graph-view">
    <div className="tl-graph-caption"><span>{data.aggregated ? `阶段路线 · ${data.nodes.length} 个入口 / ${data.total} 项任务` : data.total > 24 ? `相关任务 · ${data.nodes.length} / ${data.total}` : '前置 → 后续'}</span>
      {data.total > 24 && <button className="tl-text-button" onClick={() => setLocal(!local)}>{local ? '查看阶段路线' : '查看选中关联'}</button>}</div>
    <div ref={root} className="tl-graph" data-orientation={vertical ? 'vertical' : 'horizontal'} data-route-failures={geometry.failed.join(',')} style={{ '--tl-columns': data.groups.length, '--tl-rows': data.rowCount } as CSSProperties}>
      <svg className="tl-edges" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true">
        <defs>{['normal', 'selected', 'blocked'].map(tone => <marker key={tone} id={`${marker}-${tone}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1L7 4L1 7" fill="none" stroke="currentColor" className={`tl-edge-${tone}`} strokeWidth="1.3"/></marker>)}</defs>
        {geometry.paths.map(p => <path key={p.id} d={p.d} fill="none" className={`tl-edge-${p.tone}`} stroke="currentColor" strokeWidth={p.tone === 'normal' ? 1.4 : 1.7} markerEnd={`url(#${marker}-${p.tone})`} data-from={p.from} data-to={p.to} data-points={JSON.stringify(p.points)}/>)}
      </svg>
      <div className="tl-graph-groups">{data.groups.map(group => <div className="tl-graph-group" key={group.id}><strong className="tl-graph-heading">{group.title}</strong>{group.nodes.map(n => <div key={n.id} className="tl-graph-node" data-graph-card={n.id} style={{ gridRow: data.rows.get(n.id)! + 2 }}>
        <button type="button" className="tl-card" data-status={n.status} aria-label={`${n.title}，${TASK_LABELS[n.status]}`} aria-pressed={selected === n.id} onClick={() => onSelect(n.id)}><span><StatusIcon status={n.status}/><strong>{n.title}</strong></span><Badge status={n.status}/></button>
        {ports.get(n.id)?.map(p => <span key={p.edge + p.role} className="tl-port" data-side={p.side} data-port-edge={p.edge} data-port-role={p.role} style={{ '--tl-port-position': `${p.position}%` } as CSSProperties} aria-hidden="true"/>)}
      </div>)}</div>)}</div>
    </div>
    {geometry.failed.length > 0 && <p className="tl-route-note">{geometry.failed.length} 条关系的走线待调整；任务详情保留全部前置关系。</p>}
    {!data.nodes.length && <p className="tl-muted">当前范围尚无任务。</p>}
    {data.edges.length > 0 && <div className="tl-graph-legend"><span><i className="selected"/>选中任务关联</span><span><i className="blocked"/>未解除的阻碍</span></div>}
  </div>;
}
