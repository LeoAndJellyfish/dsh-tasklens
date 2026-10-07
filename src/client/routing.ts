export interface Point { x: number; y: number }
export interface Rect { left: number; top: number; right: number; bottom: number }
export interface Segment { a: Point; b: Point; owner: string }
export function segmentClear(a: Point, b: Point, obstacles: Rect[]): boolean {
  return !obstacles.some(r => Math.abs(a.y - b.y) < .1
    ? a.y > r.top + .1 && a.y < r.bottom - .1 && Math.max(a.x, b.x) > r.left + .1 && Math.min(a.x, b.x) < r.right - .1
    : a.x > r.left + .1 && a.x < r.right - .1 && Math.max(a.y, b.y) > r.top + .1 && Math.min(a.y, b.y) < r.bottom - .1);
}
interface Cell { x: number; y: number; dir: number; key: string; cost: number; score: number }
class Heap {
  items: Cell[] = [];
  push(value: Cell) { const a = this.items; a.push(value); let i = a.length - 1;
    while (i > 0) { const p = Math.floor((i - 1) / 2); if (a[p].score <= value.score) break; a[i] = a[p]; i = p; } a[i] = value; }
  pop(): Cell { const a = this.items, first = a[0], last = a.pop()!;
    if (a.length) { let i = 0; while (true) { const l = i * 2 + 1, r = l + 1; if (l >= a.length) break;
      const c = r < a.length && a[r].score < a[l].score ? r : l; if (a[c].score >= last.score) break; a[i] = a[c]; i = c; } a[i] = last; } return first; }
}
const unique = (values: number[]) => [...new Set(values.map(v => Math.round(v * 10) / 10))].sort((a, b) => a - b);
/** Orthogonal visibility-grid A*, with bend, crossing and shared-channel costs. */
export function route(start: Point, end: Point, obstacles: Rect[], width: number, height: number, used: Segment[], owner: string): Point[] | null {
  const xs = unique([start.x, end.x, 1, width - 1, ...obstacles.flatMap(r => [r.left, r.right, r.left - 6, r.right + 6])].filter(x => x >= 0 && x <= width));
  const ys = unique([start.y, end.y, 1, height - 1, ...obstacles.flatMap(r => [r.top, r.bottom, r.top - 6, r.bottom + 6])].filter(y => y >= 0 && y <= height));
  const indexOf = (values: number[], v: number) => values.reduce((best, x, i) => Math.abs(x - v) < Math.abs(values[best] - v) ? i : best, 0);
  const sx = indexOf(xs, start.x), sy = indexOf(ys, start.y), ex = indexOf(xs, end.x), ey = indexOf(ys, end.y);
  const point = (x: number, y: number): Point => ({ x: xs[x], y: ys[y] });
  const free = (p: Point) => !obstacles.some(r => p.x > r.left + .1 && p.x < r.right - .1 && p.y > r.top + .1 && p.y < r.bottom - .1);
  const penalty = (a: Point, b: Point): number => used.reduce((total, s) => {
    if (s.owner === owner) return total;
    const horizontal = Math.abs(a.y - b.y) < .1, other = Math.abs(s.a.y - s.b.y) < .1;
    if (horizontal === other) {
      if (horizontal && Math.abs(a.y - s.a.y) < .1) total += Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(s.a.x, s.b.x)) - Math.max(Math.min(a.x, b.x), Math.min(s.a.x, s.b.x))) * 2;
      if (!horizontal && Math.abs(a.x - s.a.x) < .1) total += Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(s.a.y, s.b.y)) - Math.max(Math.min(a.y, b.y), Math.min(s.a.y, s.b.y))) * 2;
    } else { const h = horizontal ? { a, b } : s, v = horizontal ? s : { a, b };
      if (v.a.x > Math.min(h.a.x, h.b.x) + 1 && v.a.x < Math.max(h.a.x, h.b.x) - 1 && h.a.y > Math.min(v.a.y, v.b.y) + 1 && h.a.y < Math.max(v.a.y, v.b.y) - 1) total += 18; }
    return total;
  }, 0);
  const heap = new Heap(), costs = new Map<string, number>(), previous = new Map<string, string>();
  const initial = `${sx},${sy},0`; costs.set(initial, 0); heap.push({ x: sx, y: sy, dir: 0, key: initial, cost: 0, score: 0 }); let final: Cell | null = null;
  while (heap.items.length) {
    const current = heap.pop(); if (current.cost !== costs.get(current.key)) continue;
    if (current.x === ex && current.y === ey) { final = current; break; }
    for (const [dx, dy, dir] of [[-1, 0, 1], [1, 0, 1], [0, -1, 2], [0, 1, 2]]) {
      const x = current.x + dx, y = current.y + dy; if (x < 0 || y < 0 || x >= xs.length || y >= ys.length) continue;
      const a = point(current.x, current.y), b = point(x, y); if (!free(b) || !segmentClear(a, b, obstacles)) continue;
      const cost = current.cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (current.dir && current.dir !== dir ? 10 : 0) + penalty(a, b), key = `${x},${y},${dir}`;
      if (cost >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, cost); previous.set(key, current.key); heap.push({ x, y, dir, key, cost, score: cost + Math.abs(xs[x] - end.x) + Math.abs(ys[y] - end.y) });
    }
  }
  if (!final) return null;
  const points: Point[] = []; let key: string | undefined = final.key;
  while (key) { const [x, y] = key.split(',').map(Number); points.push(point(x, y)); key = previous.get(key); } points.reverse();
  const compact: Point[] = [];
  for (const p of points) { while (compact.length > 1) { const a = compact.at(-2)!, b = compact.at(-1)!;
      if (Math.abs(a.x - b.x) < .1 && Math.abs(b.x - p.x) < .1 || Math.abs(a.y - b.y) < .1 && Math.abs(b.y - p.y) < .1) compact.pop(); else break; } compact.push(p); }
  return compact;
}
export function rounded(points: Point[]): string {
  if (points.length < 2) return ''; let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) { const a = points[i - 1], b = points[i], c = points[i + 1];
    const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), r = Math.min(5, ab / 2, bc / 2); if (!ab || !bc) continue;
    const p = { x: b.x + (a.x - b.x) * r / ab, y: b.y + (a.y - b.y) * r / ab }, q = { x: b.x + (c.x - b.x) * r / bc, y: b.y + (c.y - b.y) * r / bc };
    d += ` L ${p.x} ${p.y} Q ${b.x} ${b.y} ${q.x} ${q.y}`;
  }
  const last = points.at(-1)!; return d + ` L ${last.x} ${last.y}`;
}
