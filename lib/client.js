window.__ModuleLoader__.load({id:"dsh-tasklens",factory:(require)=>{var module={exports:{}};var exports=module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/shared.ts
var CHANNEL = "/dsh-tasklens";
var PLUGIN_ID = "dsh-tasklens";
var STATUS_LABELS = {
  idle: "\u7B49\u5F85\u4EFB\u52A1",
  running: "\u6B63\u5728\u63A8\u8FDB",
  waiting: "\u7B49\u5F85\u60A8\u7684\u64CD\u4F5C",
  review: "\u672C\u8F6E\u56DE\u590D\u5DF2\u7ED3\u675F",
  blocked: "\u672C\u8F6E\u6267\u884C\u9047\u5230\u95EE\u9898",
  stopped: "\u4F1A\u8BDD\u6267\u884C\u5DF2\u4E2D\u65AD"
};

// src/client/api.ts
var TaskLensClient = class {
  constructor(rpc) {
    this.rpc = rpc;
    this.timer = setInterval(() => {
      for (const [id, e] of this.entries) if (e.refs) void this.pull(id);
    }, 5e3);
  }
  entries = /* @__PURE__ */ new Map();
  timer;
  disposed = false;
  entry(id) {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { state: { view: null, error: null, loading: true }, listeners: /* @__PURE__ */ new Set(), inFlight: false, refs: 0, controller: null };
      this.entries.set(id, entry);
    }
    return entry;
  }
  getSnapshot = (id) => this.entry(id).state;
  subscribe = (id, listener) => {
    const e = this.entry(id);
    e.listeners.add(listener);
    e.refs++;
    void this.pull(id);
    return () => {
      e.listeners.delete(listener);
      e.refs--;
      if (!e.refs) e.controller?.abort();
    };
  };
  publish(e, state) {
    e.state = state;
    for (const listener of e.listeners) listener();
  }
  async call(method, payload, signal) {
    const result = await this.rpc.call(CHANNEL, method, payload, signal);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }
  async pull(id) {
    const e = this.entry(id);
    if (e.inFlight || this.disposed) return;
    e.inFlight = true;
    const controller = new AbortController();
    e.controller = controller;
    try {
      const previous = e.state.view;
      const view = await this.call("view", { sessionId: id, knownCommit: previous?.commitVersion, knownObservedSeq: previous?.coverage.observedSeq }, controller.signal);
      if (e.state.view && view.commitVersion < e.state.view.commitVersion) return;
      const merged = view.roadmapUnchanged && e.state.view ? { ...view, roadmap: e.state.view.roadmap, timeline: e.state.view.timeline, checkpoints: e.state.view.checkpoints } : view;
      if (!controller.signal.aborted && !this.disposed) this.publish(e, { view: merged, error: null, loading: false });
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed) this.publish(e, { ...e.state, loading: false, error: error instanceof Error ? error.message : "\u4F1A\u8BDD\u8FDE\u63A5\u5931\u8D25\u3002" });
    } finally {
      e.inFlight = false;
      if (e.controller === controller) e.controller = null;
    }
  }
  async refresh(id) {
    const e = this.entry(id);
    const view = await this.call("refresh", { sessionId: id });
    this.publish(e, { view, error: null, loading: false });
  }
  async pause(id, paused) {
    const view = await this.call("pause", { sessionId: id, paused });
    this.publish(this.entry(id), { view, error: null, loading: false });
  }
  async backfill(id, paused) {
    const view = await this.call("backfill", { sessionId: id, paused });
    this.publish(this.entry(id), { view, error: null, loading: false });
  }
  history(id, entryId) {
    return this.call("history", { sessionId: id, entryId });
  }
  sources(id, refs) {
    return this.call("sources", { sessionId: id, refs });
  }
  async annotate(id, annotation) {
    const view = await this.call("annotate", { sessionId: id, annotation });
    this.publish(this.entry(id), { view, error: null, loading: false });
  }
  models() {
    return this.call("models", { force: true });
  }
  async preferences(preferences) {
    await this.call("preferences", { preferences });
    await Promise.all([...this.entries].filter(([, e]) => e.refs).map(([id]) => this.pull(id)));
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    for (const e of this.entries.values()) e.controller?.abort();
    this.entries.clear();
  }
};

// src/client/Panel.tsx
var import_react2 = require("react");

// src/schema.ts
var TASK_LABELS = {
  pending: "\u5F85\u63A8\u8FDB",
  active: "\u8FDB\u884C\u4E2D",
  waiting: "\u7B49\u5F85",
  blocked: "\u53D7\u963B",
  review: "\u5F85\u9A8C\u6536",
  done: "\u5DF2\u5B8C\u6210",
  paused: "\u6682\u7F13",
  abandoned: "\u5DF2\u653E\u5F03",
  superseded: "\u5DF2\u66FF\u6362"
};

// src/client/Graph.tsx
var import_react = require("react");

// src/client/routing.ts
function segmentClear(a, b, obstacles) {
  return !obstacles.some((r) => Math.abs(a.y - b.y) < 0.1 ? a.y > r.top + 0.1 && a.y < r.bottom - 0.1 && Math.max(a.x, b.x) > r.left + 0.1 && Math.min(a.x, b.x) < r.right - 0.1 : a.x > r.left + 0.1 && a.x < r.right - 0.1 && Math.max(a.y, b.y) > r.top + 0.1 && Math.min(a.y, b.y) < r.bottom - 0.1);
}
var Heap = class {
  items = [];
  push(value) {
    const a = this.items;
    a.push(value);
    let i = a.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (a[p].score <= value.score) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = value;
  }
  pop() {
    const a = this.items, first = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (true) {
        const l = i * 2 + 1, r = l + 1;
        if (l >= a.length) break;
        const c = r < a.length && a[r].score < a[l].score ? r : l;
        if (a[c].score >= last.score) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return first;
  }
};
var unique = (values) => [...new Set(values.map((v) => Math.round(v * 10) / 10))].sort((a, b) => a - b);
function route(start, end, obstacles, width, height, used, owner) {
  const xs = unique([start.x, end.x, 1, width - 1, ...obstacles.flatMap((r) => [r.left, r.right, r.left - 6, r.right + 6])].filter((x) => x >= 0 && x <= width));
  const ys = unique([start.y, end.y, 1, height - 1, ...obstacles.flatMap((r) => [r.top, r.bottom, r.top - 6, r.bottom + 6])].filter((y) => y >= 0 && y <= height));
  const indexOf = (values, v) => values.reduce((best, x, i) => Math.abs(x - v) < Math.abs(values[best] - v) ? i : best, 0);
  const sx = indexOf(xs, start.x), sy = indexOf(ys, start.y), ex = indexOf(xs, end.x), ey = indexOf(ys, end.y);
  const point = (x, y) => ({ x: xs[x], y: ys[y] });
  const free = (p) => !obstacles.some((r) => p.x > r.left + 0.1 && p.x < r.right - 0.1 && p.y > r.top + 0.1 && p.y < r.bottom - 0.1);
  const penalty = (a, b) => used.reduce((total, s) => {
    if (s.owner === owner) return total;
    const horizontal = Math.abs(a.y - b.y) < 0.1, other = Math.abs(s.a.y - s.b.y) < 0.1;
    if (horizontal === other) {
      if (horizontal && Math.abs(a.y - s.a.y) < 0.1) total += Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(s.a.x, s.b.x)) - Math.max(Math.min(a.x, b.x), Math.min(s.a.x, s.b.x))) * 2;
      if (!horizontal && Math.abs(a.x - s.a.x) < 0.1) total += Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(s.a.y, s.b.y)) - Math.max(Math.min(a.y, b.y), Math.min(s.a.y, s.b.y))) * 2;
    } else {
      const h = horizontal ? { a, b } : s, v = horizontal ? s : { a, b };
      if (v.a.x > Math.min(h.a.x, h.b.x) + 1 && v.a.x < Math.max(h.a.x, h.b.x) - 1 && h.a.y > Math.min(v.a.y, v.b.y) + 1 && h.a.y < Math.max(v.a.y, v.b.y) - 1) total += 18;
    }
    return total;
  }, 0);
  const heap = new Heap(), costs = /* @__PURE__ */ new Map(), previous = /* @__PURE__ */ new Map();
  const initial = `${sx},${sy},0`;
  costs.set(initial, 0);
  heap.push({ x: sx, y: sy, dir: 0, key: initial, cost: 0, score: 0 });
  let final = null;
  while (heap.items.length) {
    const current = heap.pop();
    if (current.cost !== costs.get(current.key)) continue;
    if (current.x === ex && current.y === ey) {
      final = current;
      break;
    }
    for (const [dx, dy, dir] of [[-1, 0, 1], [1, 0, 1], [0, -1, 2], [0, 1, 2]]) {
      const x = current.x + dx, y = current.y + dy;
      if (x < 0 || y < 0 || x >= xs.length || y >= ys.length) continue;
      const a = point(current.x, current.y), b = point(x, y);
      if (!free(b) || !segmentClear(a, b, obstacles)) continue;
      const cost = current.cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (current.dir && current.dir !== dir ? 10 : 0) + penalty(a, b), key2 = `${x},${y},${dir}`;
      if (cost >= (costs.get(key2) ?? Infinity)) continue;
      costs.set(key2, cost);
      previous.set(key2, current.key);
      heap.push({ x, y, dir, key: key2, cost, score: cost + Math.abs(xs[x] - end.x) + Math.abs(ys[y] - end.y) });
    }
  }
  if (!final) return null;
  const points = [];
  let key = final.key;
  while (key) {
    const [x, y] = key.split(",").map(Number);
    points.push(point(x, y));
    key = previous.get(key);
  }
  points.reverse();
  const compact = [];
  for (const p of points) {
    while (compact.length > 1) {
      const a = compact.at(-2), b = compact.at(-1);
      if (Math.abs(a.x - b.x) < 0.1 && Math.abs(b.x - p.x) < 0.1 || Math.abs(a.y - b.y) < 0.1 && Math.abs(b.y - p.y) < 0.1) compact.pop();
      else break;
    }
    compact.push(p);
  }
  return compact;
}
function rounded(points) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), r = Math.min(5, ab / 2, bc / 2);
    if (!ab || !bc) continue;
    const p = { x: b.x + (a.x - b.x) * r / ab, y: b.y + (a.y - b.y) * r / ab }, q = { x: b.x + (c.x - b.x) * r / bc, y: b.y + (c.y - b.y) * r / bc };
    d += ` L ${p.x} ${p.y} Q ${b.x} ${b.y} ${q.x} ${q.y}`;
  }
  const last = points.at(-1);
  return d + ` L ${last.x} ${last.y}`;
}

// src/client/common.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function LensIcon({ size = 18, ...props }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.6", "aria-hidden": "true", ...props, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "10.5", cy: "10.5", r: "6.5" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m15.3 15.3 4.2 4.2M7.5 11.5l2-2 2 2 2-3", strokeLinecap: "round", strokeLinejoin: "round" })
  ] });
}
function Icon({ kind, spin = false }) {
  const paths = { refresh: "M18 8a7 7 0 1 0 1 7M18 3v5h-5", settings: "M5 7h14M5 17h14M9 4v6M15 14v6", pause: "M9 5v14M15 5v14", play: "m8 5 11 7-11 7z", chevron: "m8 10 4 4 4-4", arrow: "M5 12h14m-6-6 6 6-6 6", history: "M4 8V3m0 5h5M4 8a8 8 0 1 1-1 7m9-8v5l3 2", source: "M7 3h7l4 4v14H7V3m7 0v5h4M10 12h5m-5 4h5" };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { className: spin ? "tl-spinner" : void 0, width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: paths[kind] }) });
}
function StatusIcon({ status }) {
  const paths = { done: "m6 12 4 4 8-9", blocked: "M12 7v6m0 4h.01", waiting: "M12 6v6l4 2", review: "M8 8h8m-8 4h8m-8 4h4", paused: "M9 7v10m6-10v10", abandoned: "m8 8 8 8m0-8-8 8", superseded: "M7 6v8h11m-4-4 4 4-4 4" };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { className: "tl-state-icon", width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    status !== "superseded" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "9" }),
    status === "active" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "4", fill: "currentColor", stroke: "none" }),
    paths[status] && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: paths[status] })
  ] });
}
function Badge({ status }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tl-badge", "data-status": status, children: TASK_LABELS[status] });
}
var time = (n) => new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(n);
function ranges(values) {
  if (!values.length) return "\u65E0";
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const chunks = [];
  let start = sorted[0], end = start;
  for (const n of sorted.slice(1)) {
    if (n === end + 1) end = n;
    else {
      chunks.push(start === end ? String(start) : `${start}\u2014${end}`);
      start = end = n;
    }
  }
  chunks.push(start === end ? String(start) : `${start}\u2014${end}`);
  return chunks.join("\u3001");
}

// src/client/Graph.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function Graph({ graph, selected, onSelect }) {
  const root = (0, import_react.useRef)(null);
  const marker = (0, import_react.useId)().replace(/:/g, "");
  const [vertical, setVertical] = (0, import_react.useState)(true);
  const [local, setLocal] = (0, import_react.useState)(true);
  const [geometry, setGeometry] = (0, import_react.useState)({ width: 1, height: 1, paths: [], failed: [] });
  const data = (0, import_react.useMemo)(() => {
    const tasks = graph.nodes.filter((n) => n.kind === "task" && !["abandoned", "superseded"].includes(n.status));
    const phases = graph.nodes.filter((n) => n.kind === "phase" && !["abandoned", "superseded"].includes(n.status));
    let nodes = tasks;
    let aggregated = false;
    if (tasks.length > 24) {
      if (local && selected && tasks.some((n) => n.id === selected)) {
        const ids2 = /* @__PURE__ */ new Set([selected]);
        for (let depth = 0; depth < 2; depth++) for (const e of graph.edges) {
          if (ids2.has(e.from) || ids2.has(e.to)) {
            if (ids2.size < 24) ids2.add(e.from);
            if (ids2.size < 24) ids2.add(e.to);
          }
        }
        nodes = tasks.filter((n) => ids2.has(n.id));
      } else {
        nodes = [...phases, ...tasks.filter((n) => !n.parentId)].slice(0, 24);
        aggregated = true;
      }
    }
    const ids = new Set(nodes.map((n) => n.id));
    const project = (id) => ids.has(id) ? id : aggregated ? graph.nodes.find((n) => n.id === id)?.parentId : null;
    const edges = [];
    for (const e of graph.edges) {
      const from = project(e.from), to = project(e.to);
      if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) continue;
      const existing = edges.find((p) => p.from === from && p.to === to);
      const blocked = graph.nodes.find((n) => n.id === e.from)?.status === "blocked";
      if (existing) existing.blocked ||= blocked;
      else edges.push({ id: e.id, from, to, blocked });
    }
    const ordered = [];
    const waiting = nodes.slice().sort((a, b) => a.order - b.order);
    while (waiting.length) {
      const index = waiting.findIndex((n) => !edges.some((e) => e.to === n.id && waiting.some((w) => w.id === e.from)));
      ordered.push(...waiting.splice(index < 0 ? 0 : index, 1));
    }
    const groupIds = [...new Set(ordered.map((n) => aggregated ? n.goalId : n.parentId ?? n.goalId))];
    const groups = groupIds.map((id) => ({ id, title: graph.nodes.find((n) => n.id === id)?.title ?? graph.goals.find((g) => g.id === id)?.title ?? "\u4EFB\u52A1", nodes: ordered.filter((n) => (aggregated ? n.goalId : n.parentId ?? n.goalId) === id) }));
    return { nodes: ordered, groups, edges, aggregated, total: tasks.length };
  }, [graph, selected, local]);
  const ports = (0, import_react.useMemo)(() => {
    const map = new Map(data.nodes.map((n) => [n.id, []]));
    const column = (id) => data.groups.findIndex((g) => g.nodes.some((n) => n.id === id));
    for (const e of data.edges) {
      const a = column(e.from), b = column(e.to), same = vertical || a === b;
      map.get(e.from).push({ edge: e.id, role: "source", side: same ? "bottom" : b > a ? "right" : "left", position: 50 });
      map.get(e.to).push({ edge: e.id, role: "target", side: same ? "top" : b > a ? "left" : "right", position: 50 });
    }
    for (const group of map.values()) for (const port of group) {
      const peers = group.filter((p) => p.side === port.side);
      port.position = (peers.indexOf(port) + 1) / (peers.length + 1) * 100;
    }
    return map;
  }, [data, vertical]);
  (0, import_react.useLayoutEffect)(() => {
    const canvas = root.current;
    if (!canvas) return;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const box = canvas.getBoundingClientRect();
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (!width || !height) return;
      const actual = width <= 540 || data.groups.length > 4;
      if (actual !== vertical) {
        setVertical(actual);
        return;
      }
      const rect = (el, padding) => {
        const r = el.getBoundingClientRect();
        return { left: r.left - box.left - padding, top: r.top - box.top - padding, right: r.right - box.left + padding, bottom: r.bottom - box.top + padding };
      };
      const obstacles = [...canvas.querySelectorAll("[data-graph-card]")].map((el) => rect(el, 9));
      obstacles.push(...[...canvas.querySelectorAll(".tl-graph-heading")].map((el) => rect(el, 6)));
      const normals = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };
      const used = [], paths = [], failed = [];
      for (const e of data.edges) {
        const from = canvas.querySelector(`[data-port-edge="${e.id}"][data-port-role="source"]`), to = canvas.querySelector(`[data-port-edge="${e.id}"][data-port-role="target"]`);
        if (!from || !to) {
          failed.push(e.id);
          continue;
        }
        const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
        const an = normals[from.dataset.side], bn = normals[to.dataset.side];
        const ac = { x: a.left - box.left + a.width / 2, y: a.top - box.top + a.height / 2 }, bc = { x: b.left - box.left + b.width / 2, y: b.top - box.top + b.height / 2 };
        const start = { x: ac.x + an.x * 4, y: ac.y + an.y * 4 }, end = { x: bc.x + bn.x * 5, y: bc.y + bn.y * 5 };
        const leadA = { x: ac.x + an.x * 12, y: ac.y + an.y * 12 }, leadB = { x: bc.x + bn.x * 12, y: bc.y + bn.y * 12 };
        const inner = route(leadA, leadB, obstacles, width, height, used, e.from);
        if (!inner) {
          failed.push(e.id);
          continue;
        }
        const points = [start, ...inner, end];
        for (let i = 1; i < points.length; i++) used.push({ a: points[i - 1], b: points[i], owner: e.from });
        paths.push({ id: e.id, from: e.from, to: e.to, points, d: rounded(points), tone: e.blocked ? "blocked" : e.from === selected || e.to === selected ? "selected" : "normal" });
      }
      setGeometry((before) => JSON.stringify(before) === JSON.stringify({ width, height, paths, failed }) ? before : { width, height, paths, failed });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    canvas.querySelectorAll("[data-graph-card]").forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [data, ports, vertical, selected]);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "tl-graph-view", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "tl-graph-caption", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: data.aggregated ? `\u9636\u6BB5\u8DEF\u7EBF \xB7 ${data.nodes.length} \u4E2A\u5165\u53E3 / ${data.total} \u9879\u4EFB\u52A1` : data.total > 24 ? `\u76F8\u5173\u4EFB\u52A1 \xB7 ${data.nodes.length} / ${data.total}` : "\u524D\u7F6E \u2192 \u540E\u7EED" }),
      data.total > 24 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "tl-text-button", onClick: () => setLocal(!local), children: local ? "\u67E5\u770B\u9636\u6BB5\u8DEF\u7EBF" : "\u67E5\u770B\u9009\u4E2D\u5173\u8054" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { ref: root, className: "tl-graph", "data-orientation": vertical ? "vertical" : "horizontal", "data-route-failures": geometry.failed.join(","), style: { "--tl-columns": data.groups.length }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { className: "tl-edges", viewBox: `0 0 ${geometry.width} ${geometry.height}`, "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("defs", { children: ["normal", "selected", "blocked"].map((tone) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("marker", { id: `${marker}-${tone}`, viewBox: "0 0 8 8", refX: "7", refY: "4", markerWidth: "7", markerHeight: "7", markerUnits: "userSpaceOnUse", orient: "auto", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M1 1L7 4L1 7", fill: "none", stroke: "currentColor", className: `tl-edge-${tone}`, strokeWidth: "1.3" }) }, tone)) }),
        geometry.paths.map((p) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: p.d, fill: "none", className: `tl-edge-${p.tone}`, stroke: "currentColor", strokeWidth: p.tone === "normal" ? 1.4 : 1.7, markerEnd: `url(#${marker}-${p.tone})`, "data-from": p.from, "data-to": p.to, "data-points": JSON.stringify(p.points) }, p.id))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "tl-graph-groups", children: data.groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "tl-graph-group", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { className: "tl-graph-heading", children: group.title }),
        group.nodes.map((n) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "tl-graph-node", "data-graph-card": n.id, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: "tl-card", "data-status": n.status, "aria-label": `${n.title}\uFF0C${TASK_LABELS[n.status]}`, "aria-pressed": selected === n.id, onClick: () => onSelect(n.id), children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(StatusIcon, { status: n.status }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: n.title })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Badge, { status: n.status })
          ] }),
          ports.get(n.id)?.map((p) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "tl-port", "data-side": p.side, "data-port-edge": p.edge, "data-port-role": p.role, style: { "--tl-port-position": `${p.position}%` }, "aria-hidden": "true" }, p.edge + p.role))
        ] }, n.id))
      ] }, group.id)) })
    ] }),
    geometry.failed.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: "tl-route-note", children: [
      geometry.failed.length,
      " \u6761\u5173\u7CFB\u7684\u8D70\u7EBF\u5F85\u8C03\u6574\uFF1B\u4EFB\u52A1\u8BE6\u60C5\u4FDD\u7559\u5168\u90E8\u524D\u7F6E\u5173\u7CFB\u3002"
    ] }),
    !data.nodes.length && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "tl-muted", children: "\u5F53\u524D\u8303\u56F4\u5C1A\u65E0\u4EFB\u52A1\u3002" })
  ] });
}

// src/client/Panel.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var initialUi = () => ({ layout: "tree", selected: null, history: null, phaseOpen: {}, archiveOpen: false, evidenceOpen: false });
function readUi(id) {
  try {
    const v = JSON.parse(localStorage.getItem(`tasklens-ui-v2:${id}`) ?? "null");
    if (!v || typeof v !== "object") return initialUi();
    return {
      ...initialUi(),
      layout: v.layout === "graph" ? "graph" : "tree",
      selected: typeof v.selected === "string" ? v.selected : null,
      history: typeof v.history === "string" ? v.history : null,
      phaseOpen: Object.fromEntries(Object.entries(v.phaseOpen ?? {}).filter(([, value]) => typeof value === "boolean")),
      archiveOpen: v.archiveOpen === true,
      evidenceOpen: v.evidenceOpen === true
    };
  } catch {
    return initialUi();
  }
}
function useView(api, id) {
  return (0, import_react2.useSyncExternalStore)((0, import_react2.useCallback)((l) => api.subscribe(id, l), [api, id]), (0, import_react2.useCallback)(() => api.getSnapshot(id), [api, id]));
}
function Sources({ api, id, refs, open, onOpen, revision }) {
  const [data, setData] = (0, import_react2.useState)([]);
  const [error, setError] = (0, import_react2.useState)(null);
  const [page, setPage] = (0, import_react2.useState)(0);
  const unique2 = [...new Map(refs.map((r) => [`${r.id}:${r.hash}`, r])).values()].reverse();
  const key = JSON.stringify(unique2.slice(page * 12, page * 12 + 12));
  (0, import_react2.useEffect)(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    api.sources(id, JSON.parse(key)).then((v) => {
      if (alive) setData(v);
    }).catch((e) => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [api, id, key, open, revision]);
  (0, import_react2.useEffect)(() => setPage(0), [id, revision, refs.at(-1)?.id]);
  if (!unique2.length) return null;
  const roles = { user: "\u7528\u6237\u6307\u793A", assistant: "\u6267\u884C AI \u56DE\u590D", tool: "\u5DE5\u5177\u8BB0\u5F55", runtime: "\u8FD0\u884C\u8BB0\u5F55" };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "tl-evidence", open, onToggle: (e) => onOpen(e.currentTarget.open), children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("summary", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { kind: "source" }),
      "\u67E5\u770B ",
      unique2.length,
      " \u6761\u4F9D\u636E",
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { kind: "chevron" })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "status", children: error }),
    data.map((v) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-source", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: v.source ? `\u7B2C ${v.source.round} \u8F6E \xB7 ${roles[v.source.role]} \xB7 \u8BB0\u5F55 ${v.source.seq}` : v.ref.id }),
      v.validity !== "current" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "tl-source-validity", children: v.validity === "revised" ? "\u5F53\u524D\u6765\u6E90\u5DF2\u6709\u4FEE\u8BA2 \xB7 \u5C55\u793A\u5F53\u65F6\u6458\u5F55" : "\u5F53\u524D\u6765\u6E90\u4E0D\u53EF\u8BFB\u53D6 \xB7 \u5C55\u793A\u4FDD\u5B58\u7684\u6458\u5F55" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: v.ref.quote }),
      v.source && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: "\u672C\u6BB5\u539F\u6587" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("pre", { children: v.source.text })
      ] })
    ] }, v.ref.id)),
    unique2.length > 12 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "tl-text-button", disabled: page === 0, onClick: () => setPage(page - 1), children: "\u8F83\u65B0\u4F9D\u636E" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "tl-muted", children: [
        page + 1,
        " / ",
        Math.ceil(unique2.length / 12),
        " \u9875"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "tl-text-button", disabled: (page + 1) * 12 >= unique2.length, onClick: () => setPage(page + 1), children: "\u8F83\u65E9\u4F9D\u636E" })
    ] })
  ] });
}
function Settings({ api, value, onClose, onError }) {
  const [form, setForm] = (0, import_react2.useState)(value), [models, setModels] = (0, import_react2.useState)([]), [saving, setSaving] = (0, import_react2.useState)(false);
  (0, import_react2.useEffect)(() => {
    let alive = true;
    api.models().then((m) => {
      if (alive) setModels(m);
    }).catch((e) => {
      if (alive) onError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [api]);
  const save = async () => {
    setSaving(true);
    try {
      await api.preferences(form);
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\u3002");
    } finally {
      setSaving(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "tl-settings", "aria-label": "\u89E3\u91CA\u8BBE\u7F6E", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { children: "\u89E3\u91CA\u8BBE\u7F6E" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "tl-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u89E3\u91CA\u6A21\u578B" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { "aria-label": "\u89E3\u91CA\u6A21\u578B", value: form.model ? JSON.stringify([form.model.provider, form.model.model]) : "", onChange: (e) => {
        const pair = e.target.value ? JSON.parse(e.target.value) : null;
        setForm({ ...form, model: pair ? { provider: pair[0], model: pair[1] } : null });
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "", children: "\u8DDF\u968F\u5F53\u524D\u4F1A\u8BDD\u6A21\u578B" }),
        models.map((m) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("option", { value: JSON.stringify([m.provider, m.model]), children: [
          m.name,
          " \xB7 ",
          m.providerName
        ] }, JSON.stringify([m.provider, m.model])))
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-settings-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "tl-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u9605\u8BFB\u5C42\u7EA7" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { "aria-label": "\u9605\u8BFB\u5C42\u7EA7", value: form.audience, onChange: (e) => setForm({ ...form, audience: e.target.value }), children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "overview", children: "\u5DE5\u4F5C\u6982\u51B5" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "technical", children: "\u6280\u672F\u8BE6\u60C5" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "tl-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u8BF4\u660E\u8BE6\u7565" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { "aria-label": "\u8BF4\u660E\u8BE6\u7565", value: form.detail, onChange: (e) => setForm({ ...form, detail: e.target.value }), children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "brief", children: "\u7CBE\u7B80" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "standard", children: "\u6807\u51C6" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "detailed", children: "\u8BE6\u7EC6" })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-settings-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "tl-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u5E38\u89C4\u66F4\u65B0\u95F4\u9694" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("select", { value: form.intervalSeconds, onChange: (e) => setForm({ ...form, intervalSeconds: Number(e.target.value) }), children: [45, 90, 180, 300, 600].map((n) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("option", { value: n, children: [
          n,
          " \u79D2"
        ] }, n)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "tl-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u81EA\u52A8\u8C03\u7528\u6700\u77ED\u95F4\u9694" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("select", { value: form.minGapSeconds, onChange: (e) => setForm({ ...form, minGapSeconds: Number(e.target.value) }), children: [15, 30, 60, 120].map((n) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("option", { value: n, children: [
          n,
          " \u79D2"
        ] }, n)) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-settings-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "tl-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u6BCF\u5C0F\u65F6\u8C03\u7528\u4E0A\u9650" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "number", min: "6", max: "120", value: form.maxCallsPerHour, onChange: (e) => setForm({ ...form, maxCallsPerHour: Number(e.target.value) }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "tl-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u6BCF\u5C0F\u65F6 token \u9884\u7B97" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "number", min: "10000", max: "2000000", step: "10000", value: form.maxTokensPerHour, onChange: (e) => setForm({ ...form, maxTokensPerHour: Number(e.target.value) }) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "tl-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u5355\u6B21\u4F30\u7B97\u8F93\u5165\u4E0A\u9650 \xB7 tokens" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "number", min: "8000", max: "32000", step: "1000", value: form.inputBudget, onChange: (e) => setForm({ ...form, inputBudget: Number(e.target.value) }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "tl-toggle", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "checkbox", checked: form.enabled, onChange: (e) => setForm({ ...form, enabled: e.target.checked }) }),
      "\u5141\u8BB8\u5DF2\u5F00\u542F\u7684\u5BF9\u8BDD\u81EA\u52A8\u89E3\u91CA"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "tl-setting-help", children: "\u5386\u53F2\u56DE\u6EAF\u3001\u8865\u5145\u5206\u6790\u548C\u624B\u52A8\u66F4\u65B0\u5171\u7528\u9884\u7B97\u3002\u6CA1\u6709\u65B0\u589E\u8BB0\u5F55\u65F6\u8DF3\u8FC7\u8C03\u7528\u3002\u67E5\u770B\u5386\u53F2\u53CA\u4EFB\u52A1\u8BE6\u60C5\u8BFB\u53D6\u672C\u5730\u8BB0\u5F55\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "tl-setting-help", children: "\u516C\u5F00\u9700\u6C42\u3001\u56DE\u590D\u548C\u5DE5\u5177\u8BB0\u5F55\u53D1\u9001\u81F3\u6240\u9009\u6A21\u578B\uFF1B\u8DEF\u7EBF\u56FE\u53CA\u5386\u53F2\u4FDD\u5B58\u5728\u672C\u673A\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "tl-button primary", disabled: saving, onClick: () => void save(), children: "\u4FDD\u5B58\u8BBE\u7F6E" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "tl-button", disabled: saving, onClick: onClose, children: "\u53D6\u6D88" })
    ] })
  ] });
}
function Timeline({ entries, selected, onSelect }) {
  if (!entries.length) return null;
  const last = entries.length - 1, found = entries.findIndex((e) => e.id === selected), index = found < 0 ? last : found, entry = entries[index];
  const positions = [.../* @__PURE__ */ new Set([0, last, ...entries.map((e, i) => e.key ? i : -1).filter((i) => i >= 0 && i !== 0 && i !== last).filter((_, i, a) => i === Math.floor(a.length / 2))])].sort((a, b) => a - b);
  const choose = (i) => onSelect(i === last ? null : entries[i].id);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "tl-timeline", "aria-label": "\u5BF9\u8BDD\u5386\u53F2", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-timeline-heading", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "\u5BF9\u8BDD\u8FDB\u5EA6" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
        selected ? "\u5386\u53F2" : "\u5F53\u524D",
        " \xB7 \u7B2C ",
        entry.round,
        " \u8F6E",
        entry.preview ? " \xB7 \u8FD1\u671F\u89C6\u56FE" : ""
      ] }),
      selected && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "tl-text-button", onClick: () => onSelect(null), children: "\u56DE\u5230\u6700\u65B0" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { className: "tl-scrubber", type: "range", min: "0", max: last, step: "1", value: index, disabled: last === 0, "aria-label": "\u5BF9\u8BDD\u8FDB\u5EA6", "aria-valuetext": `\u7B2C ${entry.round} \u8F6E\uFF0C${entry.title}`, style: { "--tl-progress": `${last ? index / last * 100 : 100}%` }, onChange: (e) => choose(Number(e.target.value)) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "tl-ticks", children: positions.map((i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { type: "button", "aria-pressed": i === index, title: entries[i].title, onClick: () => choose(i), children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("strong", { children: [
        "\u7B2C ",
        entries[i].round,
        " \u8F6E"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: i === last ? "\u5F53\u524D" : entries[i].trigger })
    ] }, entries[i].id)) })
  ] });
}
function TaskRow({ node, selected, onSelect }) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { className: "tl-row", type: "button", "data-status": node.status, "aria-pressed": selected === node.id, onClick: () => onSelect(node.id), children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(StatusIcon, { status: node.status }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "tl-row-title", children: node.title }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Badge, { status: node.status })
  ] });
}
function Tree({ graph, selected, phaseOpen, onPhase, onSelect }) {
  const [more, setMore] = (0, import_react2.useState)({});
  const live = graph.nodes.filter((n) => !["abandoned", "superseded"].includes(n.status));
  const renderPhase = (node, number) => {
    const children = live.filter((n) => n.parentId === node.id);
    const completed = children.filter((n) => n.status === "done").length;
    const open = phaseOpen[node.id] ?? (completed < children.length || !children.length);
    const visible = more[node.id] ? children : children.slice(0, 40);
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "tl-phase", open, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("summary", { onClick: (e) => {
        e.preventDefault();
        onPhase(node.id, !open);
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "tl-stage-number", children: String(number + 1).padStart(2, "0") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: node.title }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "tl-phase-count", children: [
          completed,
          " / ",
          children.length,
          " \u5DF2\u5B8C\u6210"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { kind: "chevron" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
        !children.length && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(TaskRow, { node, selected, onSelect }),
        visible.map((n) => n.kind === "phase" ? renderPhase(n, number) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(TaskRow, { node: n, selected, onSelect }, n.id)),
        visible.length < children.length && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { className: "tl-text-button", onClick: () => setMore({ ...more, [node.id]: true }), children: [
          "\u5C55\u5F00\u5176\u4F59 ",
          children.length - visible.length,
          " \u9879"
        ] })
      ] })
    ] }, node.id);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "tl-tree", children: graph.goals.map((goal) => {
    const top = live.filter((n) => n.goalId === goal.id && !n.parentId);
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "tl-goal-group", children: [
      graph.goals.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("h3", { children: [
        goal.title,
        !goal.active && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "tl-muted", children: " \xB7 \u6682\u7F13\u76EE\u6807" })
      ] }),
      top.map((n, i) => n.kind === "phase" ? renderPhase(n, i) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(TaskRow, { node: n, selected, onSelect }, n.id))
    ] }, goal.id);
  }) });
}
function Correction({ api, view, node, onError }) {
  const [field, setField] = (0, import_react2.useState)("status"), [value, setValue] = (0, import_react2.useState)(node.status), [reason, setReason] = (0, import_react2.useState)(""), [confirmed, setConfirmed] = (0, import_react2.useState)(false), [busy, setBusy] = (0, import_react2.useState)(false);
  const candidates = view.roadmap?.nodes.filter((n) => n.goalId === node.goalId && n.id !== node.id && !["abandoned", "superseded"].includes(n.status)) ?? [];
  const dependencies = field === "dependencies" ? JSON.parse(value || "[]") : [];
  const save = async () => {
    setBusy(true);
    try {
      await api.annotate(view.sessionId, { commitVersion: view.commitVersion, nodeId: node.id, field, value: field === "parentId" && !value ? null : value, reason });
      setReason("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "\u7EA0\u6B63\u4FDD\u5B58\u5931\u8D25\u3002");
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "tl-correction", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: "\u7EA0\u6B63\u6B64\u4EFB\u52A1" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-settings-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "tl-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u5B57\u6BB5" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { value: field, onChange: (e) => {
          const f = e.target.value;
          setField(f);
          setValue(f === "title" ? node.title : f === "status" ? node.status : f === "parentId" ? node.parentId ?? "" : f === "dependencies" ? JSON.stringify(view.roadmap?.edges.filter((e2) => e2.to === node.id).map((e2) => e2.from) ?? []) : "");
          setConfirmed(false);
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "status", children: "\u72B6\u6001" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "title", children: "\u540D\u79F0" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "parentId", children: "\u6240\u5C5E\u9636\u6BB5" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "dependencies", children: "\u524D\u7F6E\u4EFB\u52A1" }),
          node.kind === "task" && !["abandoned", "superseded"].includes(node.status) && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "merge", children: "\u5408\u5E76\u5230\u53E6\u4E00\u4EFB\u52A1" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "split", children: "\u62C6\u5206\u5B50\u4EFB\u52A1" })
          ] })
        ] })
      ] }),
      field !== "dependencies" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "tl-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u7EA0\u6B63\u5185\u5BB9" }),
        field === "title" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { value, maxLength: 100, onChange: (e) => setValue(e.target.value) }) : field === "split" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { value, maxLength: 810, placeholder: "\u6BCF\u884C\u4E00\u4E2A\u5B50\u4EFB\u52A1\u540D\u79F0\uFF0C\u586B\u5199 2\u20148 \u9879", onChange: (e) => setValue(e.target.value) }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("select", { value, onChange: (e) => {
          setValue(e.target.value);
          setConfirmed(false);
        }, children: field === "status" ? Object.entries(TASK_LABELS).map(([id, title]) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: id, children: title }, id)) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "", children: field === "merge" ? "\u9009\u62E9\u5408\u5E76\u76EE\u6807" : "\u72EC\u7ACB\u4EFB\u52A1" }),
          candidates.filter((n) => n.kind === (field === "merge" ? "task" : "phase")).map((n) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: n.id, children: n.title }, n.id))
        ] }) })
      ] })
    ] }),
    field === "dependencies" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("fieldset", { className: "tl-dependency-options", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("legend", { children: "\u9009\u62E9\u524D\u7F6E\u4EFB\u52A1" }),
      candidates.map((n) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "tl-toggle", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "checkbox", checked: dependencies.includes(n.id), onChange: (e) => setValue(JSON.stringify(e.target.checked ? [...dependencies, n.id] : dependencies.filter((id) => id !== n.id))) }),
        n.title
      ] }, n.id))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "tl-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u4F9D\u636E\u6216\u539F\u56E0" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { value: reason, maxLength: 400, placeholder: "\u8BF4\u660E\u5DF2\u6838\u5BF9\u7684\u8303\u56F4\u6216\u5B9E\u9645\u8C03\u6574\u539F\u56E0", onChange: (e) => setReason(e.target.value) })
    ] }),
    field === "status" && value === "done" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "tl-toggle", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "checkbox", checked: confirmed, onChange: (e) => setConfirmed(e.target.checked) }),
      "\u786E\u8BA4\u5F53\u524D\u9700\u6C42\u7248\u672C\u5DF2\u6EE1\u8DB3\u5FC5\u9700\u9A8C\u6536\u9879"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "tl-setting-help", children: field === "merge" ? "\u539F\u4EFB\u52A1\u53CA\u4F9D\u636E\u4FDD\u7559\u5728\u5386\u53F2\u65B9\u6848\u4E2D\uFF0C\u5408\u5E76\u76EE\u6807\u65B0\u589E\u9700\u6C42\u7248\u672C\u5E76\u91CD\u65B0\u9A8C\u6536\u3002" : field === "split" ? "\u539F\u4EFB\u52A1\u4FDD\u7559\u4E3A\u9636\u6BB5\uFF0C\u5DF2\u6709\u9A8C\u6536\u6761\u4EF6\u7EE7\u7EED\u4FDD\u7559\uFF1B\u65B0\u5B50\u4EFB\u52A1\u5206\u522B\u6838\u9A8C\u3002" : "\u7EA0\u6B63\u8BB0\u5F55\u9644\u5C5E\u4E8E\u5F53\u524D\u9700\u6C42\u7248\u672C\uFF0C\u540E\u7EED\u6A21\u578B\u66F4\u65B0\u4FDD\u7559\u8BE5\u5B57\u6BB5\u3002\u65B0\u9700\u6C42\u7248\u672C\u4F1A\u91CD\u65B0\u6838\u5BF9\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "tl-button", disabled: busy || !reason.trim() || !value && field !== "parentId" || field === "status" && value === "done" && !confirmed, onClick: () => void save(), children: busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u7EA0\u6B63" })
  ] });
}
function Inspector({ api, view, graph, node, historical, onSelect, evidenceOpen, onEvidence, onError }) {
  const deps = graph.edges.filter((e) => e.to === node.id).map((e) => graph.nodes.find((n) => n.id === e.from)).filter((n) => Boolean(n));
  const sources = [...node.sources, ...node.criteria.flatMap((c) => c.sources), ...node.verifications.flatMap((v) => v.sources)];
  const issues = graph.unresolved.filter((u) => u.nodeId === node.id);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "tl-inspector", "aria-label": "\u4EFB\u52A1\u8BE6\u60C5", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "tl-eyebrow", children: [
      "\u9009\u4E2D\u4EFB\u52A1 \xB7 \u9700\u6C42\u7248\u672C ",
      node.scopeRevision
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-detail-heading", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: node.title }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Badge, { status: node.status })
    ] }),
    node.reason && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "tl-detail-reason", children: node.reason }),
    !node.valid && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "tl-warning", children: "\u6765\u6E90\u5DF2\u6709\u4FEE\u8BA2\uFF0C\u5F53\u524D\u7ED3\u8BBA\u6B63\u5728\u590D\u6838\u3002" }),
    node.authority === "proposed" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "tl-muted", children: "\u6267\u884C AI \u63D0\u51FA\u7684\u6B65\u9AA4" }),
    node.criteria.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-criteria", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h4", { children: "\u9A8C\u6536\u6761\u4EF6" }),
      node.criteria.map((c) => {
        const v = node.verifications.filter((v2) => v2.criterionId === c.id && v2.scopeRevision === node.scopeRevision && v2.valid).at(-1);
        return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: c.title }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "tl-muted", children: [
            v ? `${v.state === "passed" ? "\u901A\u8FC7" : v.state === "failed" ? "\u53D1\u73B0\u95EE\u9898" : "\u5F85\u6838\u5BF9"} \xB7 ${v.basis === "machine" ? "\u5339\u914D\u7684\u547D\u4EE4\u68C0\u67E5" : v.basis === "user" ? "\u7528\u6237\u786E\u8BA4" : "\u6A21\u578B\u5224\u65AD"}${v.scope ? " \xB7 " + v.scope : ""}` : "\u5F85\u6838\u5BF9",
            !c.required ? " \xB7 \u53EF\u9009" : ""
          ] })
        ] }, c.id);
      })
    ] }),
    deps.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-dependencies", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u524D\u7F6E\u4EFB\u52A1" }),
      deps.map((n) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "tl-text-button", onClick: () => onSelect(n.id), children: n.title }, n.id))
    ] }),
    node.replaces && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-dependencies", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u66FF\u4EE3\u65B9\u6848" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "tl-text-button", onClick: () => onSelect(node.replaces), children: graph.nodes.find((n) => n.id === node.replaces)?.title ?? "\u67E5\u770B\u66FF\u4EE3\u65B9\u6848" })
    ] }),
    issues.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "tl-details", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("summary", { children: [
        issues.length,
        " \u9879\u5224\u65AD\u5F85\u6838\u5BF9"
      ] }),
      issues.map((u) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: u.text }, u.id))
    ] }),
    node.attempts.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "tl-details", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("summary", { children: [
        "\u6267\u884C\u8BB0\u5F55 \xB7 ",
        node.attempts.length,
        " \u6B21"
      ] }),
      node.attempts.map((a) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
        "\u9700\u6C42\u7248\u672C ",
        a.scopeRevision,
        " \xB7 ",
        time(a.time),
        " \xB7 ",
        { running: "\u6267\u884C\u4E2D", passed: "\u901A\u8FC7\u8BB0\u5F55", failed: "\u5931\u8D25\u8BB0\u5F55", reported: "\u5B8C\u6210\u62A5\u544A" }[a.state]
      ] }, a.id))
    ] }),
    graph.changes.some((c) => c.nodeId === node.id) && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "tl-details", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: "\u72B6\u6001\u53D8\u5316\u8BB0\u5F55" }),
      graph.changes.filter((c) => c.nodeId === node.id).map((c) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
        time(c.time),
        " \xB7 ",
        c.from ? TASK_LABELS[c.from] + " \u2192 " : "",
        TASK_LABELS[c.to],
        " \xB7 \u9700\u6C42\u7248\u672C ",
        c.scopeRevision,
        c.reason ? " \xB7 " + c.reason : ""
      ] }, c.id))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Sources, { api, id: view.sessionId, refs: sources, open: evidenceOpen, onOpen: onEvidence, revision: graph.sourceRevision }),
    Object.keys(node.locks).length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "tl-muted", children: "\u5DF2\u6709\u7528\u6237\u7EA0\u6B63 \xB7 \u5F53\u524D\u7248\u672C\u4FDD\u7559" }),
    !historical && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Correction, { api, view, node, onError }, `${node.id}:${node.scopeRevision}`)
  ] });
}
function impacts(graph, id) {
  const ids = /* @__PURE__ */ new Set([id]);
  for (let i = 0; i < graph.nodes.length; i++) {
    const before = ids.size;
    for (const e of graph.edges) if (ids.has(e.from)) ids.add(e.to);
    if (ids.size === before) break;
  }
  return graph.nodes.filter((n) => n.id !== id && ids.has(n.id) && !["abandoned", "superseded"].includes(n.status));
}
function Panel({ api, boundSessionId }) {
  const state = useView(api, boundSessionId), view = state.view;
  const [ui, setUi] = (0, import_react2.useState)(() => readUi(boundSessionId)), [settings, setSettings] = (0, import_react2.useState)(false), [error, setError] = (0, import_react2.useState)(null), [acting, setActing] = (0, import_react2.useState)(false);
  const [history, setHistory] = (0, import_react2.useState)(null), [historyBusy, setHistoryBusy] = (0, import_react2.useState)(false);
  (0, import_react2.useEffect)(() => {
    setUi(readUi(boundSessionId));
    setError(null);
    setSettings(false);
    setHistory(null);
  }, [boundSessionId]);
  (0, import_react2.useEffect)(() => {
    try {
      localStorage.setItem(`tasklens-ui-v2:${boundSessionId}`, JSON.stringify(ui));
    } catch {
    }
  }, [boundSessionId, ui]);
  (0, import_react2.useEffect)(() => {
    if (!ui.history) {
      setHistory(null);
      setHistoryBusy(false);
      return;
    }
    let alive = true;
    setHistory(null);
    setHistoryBusy(true);
    api.history(boundSessionId, ui.history).then((v) => {
      if (alive) setHistory(v);
    }).catch((e) => {
      if (alive) {
        setError(e.message);
        setUi((u) => ({ ...u, history: null }));
      }
    }).finally(() => {
      if (alive) setHistoryBusy(false);
    });
    return () => {
      alive = false;
    };
  }, [api, boundSessionId, ui.history]);
  const graph = ui.history ? history?.entry.id === ui.history ? history.roadmap : null : view?.roadmap;
  const current = graph?.nodes.filter((n) => n.kind === "task" && !["abandoned", "superseded"].includes(n.status)) ?? [];
  const selected = graph?.nodes.find((n) => n.id === ui.selected) ?? current.find((n) => n.status === "blocked") ?? current.find((n) => n.status === "active") ?? current[0] ?? graph?.nodes[0];
  const blockers = current.filter((n) => n.status === "blocked");
  const archived = graph?.nodes.filter((n) => ["abandoned", "superseded"].includes(n.status)) ?? [];
  const goal = graph?.goals.find((g) => g.active)?.title ?? graph?.goals[0]?.title;
  const select = (id) => setUi((u) => ({ ...u, selected: id }));
  const action = async (fn) => {
    setActing(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "\u64CD\u4F5C\u5931\u8D25\u3002");
    } finally {
      setActing(false);
    }
  };
  const b = graph?.briefing;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-panel", "data-tasklens-panel": true, "data-version": "0.2.0", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: "tl-top", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-brand", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "tl-mark", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(LensIcon, { size: 22 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("strong", { children: [
          "\u4EFB\u52A1\u900F\u955C",
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "TASKLENS" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-tools", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "tl-icon", "aria-label": "\u7ACB\u5373\u66F4\u65B0\u8DEF\u7EBF\u56FE", title: "\u7ACB\u5373\u66F4\u65B0\u8DEF\u7EBF\u56FE", disabled: acting || view?.busy, onClick: () => void action(() => api.refresh(boundSessionId)), children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { kind: "refresh", spin: view?.busy }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "tl-icon", "aria-label": view?.paused ? "\u5F00\u542F\u81EA\u52A8\u89E3\u91CA" : "\u6682\u505C\u81EA\u52A8\u89E3\u91CA", title: view?.paused ? "\u5F00\u542F\u81EA\u52A8\u89E3\u91CA" : "\u6682\u505C\u81EA\u52A8\u89E3\u91CA", disabled: !view || acting || !view.preferences.enabled && view.paused, onClick: () => void action(() => api.pause(boundSessionId, !view.paused)), children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { kind: view?.paused ? "play" : "pause" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "tl-icon", "aria-label": "\u89E3\u91CA\u8BBE\u7F6E", title: "\u89E3\u91CA\u8BBE\u7F6E", "aria-expanded": settings, onClick: () => setSettings(!settings), children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { kind: "settings" }) })
      ] })
    ] }),
    settings && view && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Settings, { api, value: view.preferences, onClose: () => setSettings(false), onError: setError }, boundSessionId),
    (error || state.error || view?.error) && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "tl-error", role: "status", children: error || state.error || view?.error }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-activity", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("i", { className: `tl-dot ${view?.activity.status ?? "idle"}` }),
        view ? STATUS_LABELS[view.activity.status] : "\u6B63\u5728\u8BFB\u53D6\u4F1A\u8BDD"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: view?.busy ? "\u6B63\u5728\u89E3\u91CA\u2026" : view && !view.preferences.enabled ? "\u5168\u5C40\u81EA\u52A8\u89E3\u91CA\u5DF2\u5173\u95ED" : view?.paused ? "\u81EA\u52A8\u89E3\u91CA\u5DF2\u6682\u505C" : view?.timeline.length ? time(view.timeline.at(-1).time) : "" })
    ] }),
    !graph && ui.history && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Timeline, { entries: view?.timeline ?? [], selected: ui.history, onSelect: (id) => setUi((u) => ({ ...u, history: id })) }),
    graph ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-heading", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "tl-eyebrow", children: "\u4F1A\u8BDD\u8DEF\u7EBF\u56FE" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h1", { children: goal ?? "\u5F53\u524D\u4EFB\u52A1" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-counts", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: current.length }),
            " \u9879\u4EFB\u52A1"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "tl-good-text", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: current.filter((n) => n.status === "done").length }),
            " \u9879\u5DF2\u6838\u9A8C"
          ] }),
          blockers.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "tl-danger-text", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: blockers.length }),
            " \u9879\u53D7\u963B"
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Timeline, { entries: view?.timeline ?? [], selected: ui.history, onSelect: (id) => setUi((u) => ({ ...u, history: id })) }),
      historyBusy && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "tl-muted", role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u6240\u9009\u5386\u53F2\u2026" }),
      b && (b.headline || b.summary.length > 0) && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "tl-focus", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "tl-eyebrow", children: ui.history ? "\u5F53\u65F6\u91CD\u70B9" : "\u5F53\u524D\u91CD\u70B9" }),
        b.headline && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { children: b.headline.text }),
        b.summary.map((u, i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: u.text }, i))
      ] }),
      b && b.userActions.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "tl-user-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { children: "\u5F85\u60A8\u5904\u7406" }),
        b.userActions.map((u, i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: u.text }, i))
      ] }),
      blockers.slice(0, 3).map((n) => {
        const affected = impacts(graph, n.id);
        return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { className: "tl-attention", type: "button", onClick: () => select(n.id), children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(StatusIcon, { status: "blocked" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("strong", { children: [
              n.title,
              "\u53D7\u963B"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("small", { children: [
              n.reason,
              affected.length > 0 ? ` \xB7 \u5F71\u54CD${affected.slice(0, 2).map((n2) => n2.title).join("\u3001")}${affected.length > 2 ? `\u7B49 ${affected.length} \u9879` : ""}` : ""
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { kind: "arrow" })
        ] }, n.id);
      }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-section-heading", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { children: "\u9636\u6BB5\u4E0E\u4EFB\u52A1" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-view-switch", role: "group", "aria-label": "\u8DEF\u7EBF\u56FE\u89C6\u56FE", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { "aria-pressed": ui.layout === "tree", onClick: () => setUi((u) => ({ ...u, layout: "tree" })), children: "\u9636\u6BB5\u603B\u89C8" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { "aria-pressed": ui.layout === "graph", onClick: () => setUi((u) => ({ ...u, layout: "graph" })), children: "\u4F9D\u8D56\u8DEF\u7EBF" })
        ] })
      ] }),
      ui.layout === "tree" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Tree, { graph, selected: selected?.id ?? null, phaseOpen: ui.phaseOpen, onPhase: (id, open) => setUi((u) => u.phaseOpen[id] === open ? u : { ...u, phaseOpen: { ...u.phaseOpen, [id]: open } }), onSelect: select }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Graph, { graph, selected: selected?.id ?? null, onSelect: select }),
      selected && view && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Inspector, { api, view, graph, node: selected, historical: Boolean(ui.history), onSelect: select, evidenceOpen: ui.evidenceOpen, onEvidence: (open) => setUi((u) => u.evidenceOpen === open ? u : { ...u, evidenceOpen: open }), onError: setError }),
      b && b.agentNext.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "tl-next", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { children: "\u6267\u884C AI \u63A5\u4E0B\u6765" }),
        b.agentNext.map((u, i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: u.text }, i))
      ] }),
      b && b.details.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "tl-details", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: "\u6280\u672F\u8BE6\u60C5" }),
        b.details.map((u, i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: u.text }, i))
      ] }),
      archived.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "tl-archive", open: ui.archiveOpen, onToggle: (e) => {
        const open = e.currentTarget.open;
        setUi((u) => u.archiveOpen === open ? u : { ...u, archiveOpen: open });
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("summary", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "\u5386\u53F2\u65B9\u6848" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
            archived.filter((n) => n.status === "superseded").length,
            " \u9879\u66FF\u6362 \xB7 ",
            archived.filter((n) => n.status === "abandoned").length,
            " \u9879\u653E\u5F03"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { kind: "chevron" })
        ] }),
        archived.map((n) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(TaskRow, { node: n, selected: selected?.id ?? null, onSelect: select }, n.id))
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "tl-eyebrow", children: "\u6301\u7EED\u8BB0\u5F55\u6574\u4E2A\u4EFB\u52A1" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h1", { children: state.loading ? "\u6B63\u5728\u8BFB\u53D6\u4F1A\u8BDD" : ui.history ? "\u6B63\u5728\u8BFB\u53D6\u5386\u53F2\u7248\u672C" : "\u67E5\u770B\u4EFB\u52A1\u3001\u53D8\u5316\u4E0E\u4F9D\u636E" }),
      !ui.history && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u65B0\u5BF9\u8BDD\u9ED8\u8BA4\u6682\u505C\u3002\u5F00\u542F\u540E\uFF0C\u8DEF\u7EBF\u56FE\u4F1A\u6301\u7EED\u8BB0\u5F55\u4EFB\u52A1\u3001\u5B8C\u6210\u7ED3\u679C\u3001\u963B\u788D\u53CA\u64A4\u56DE\u51B3\u5B9A\u3002" }),
        view?.paused && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { className: "tl-button primary", disabled: acting || view.busy || !view.preferences.enabled, onClick: () => void action(() => api.pause(boundSessionId, false)), children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { kind: "play" }),
          "\u5F00\u542F\u81EA\u52A8\u89E3\u91CA"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { className: `tl-button${view?.paused ? "" : " primary"}`, disabled: !view || acting || view.busy, onClick: () => void action(() => api.refresh(boundSessionId)), children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { kind: "refresh", spin: view?.busy }),
          view?.busy ? "\u6B63\u5728\u89E3\u91CA\u2026" : "\u4EC5\u751F\u6210\u4E00\u6B21"
        ] })
      ] })
    ] }),
    view && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("footer", { className: "tl-footer", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-coverage", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { kind: "history" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: ui.history ? "\u5F53\u524D\u7D2F\u8BA1\u5206\u6790\u8303\u56F4" : "\u5206\u6790\u8303\u56F4" }),
          ui.history && history && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
            "\u6240\u9009\u5207\u9762\uFF1A\u7B2C ",
            history.entry.round,
            " \u8F6E \xB7 \u5206\u6790\u622A\u81F3\u8BB0\u5F55 ",
            history.entry.throughSeq
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
            view.coverage.completeRounds.length ? `\u5DF2\u5206\u6790\u7B2C ${ranges(view.coverage.completeRounds)} \u8F6E` : "\u5C1A\u65E0\u5B8C\u6574\u5206\u6790\u8F6E\u6B21",
            " \xB7 ",
            view.coverage.analyzedParts,
            " / ",
            view.coverage.totalParts,
            " \u6BB5\u516C\u5F00\u8BB0\u5F55"
          ] }),
          view.coverage.pendingRounds.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
            "\u7B2C ",
            ranges(view.coverage.pendingRounds),
            " \u8F6E\u5C1A\u5F85\u8865\u9F50"
          ] }),
          view.coverage.rebuilding && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-backfill", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: view.coverage.backfillPaused ? "\u5386\u53F2\u56DE\u6EAF\u5DF2\u6682\u505C" : view.paused || !view.preferences.enabled ? "\u5386\u53F2\u56DE\u6EAF\u5F85\u5F00\u542F" : "\u5386\u53F2\u56DE\u6EAF\u8FDB\u884C\u4E2D" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "tl-text-button", disabled: acting || view.paused || !view.preferences.enabled, onClick: () => void action(() => api.backfill(boundSessionId, !view.coverage.backfillPaused)), children: view.coverage.backfillPaused ? "\u7EE7\u7EED\u56DE\u6EAF" : "\u6682\u505C\u56DE\u6EAF" })
          ] }),
          view.coverage.invalidSources > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "tl-warning", children: [
            view.coverage.invalidSources,
            " \u6BB5\u6765\u6E90\u5DF2\u6709\u4FEE\u8BA2\u6216\u7F3A\u5931"
          ] }),
          view.notice && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: view.notice })
        ] })
      ] }),
      view.budget.protectedOmitted > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "tl-warning", children: [
        view.budget.protectedOmitted,
        " \u7EC4\u7EA6\u675F\u5C1A\u5F85\u8F7D\u5165\uFF1B\u6D89\u53CA\u5B8C\u6210\u4E0E\u8303\u56F4\u8C03\u6574\u7684\u5224\u65AD\u5DF2\u4FDD\u7559\u5F85\u6838\u5BF9\u3002"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "tl-usage", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("summary", { children: [
          "\u8C03\u7528\u7528\u91CF \xB7 ",
          view.callsThisHour,
          " / ",
          view.preferences.maxCallsPerHour,
          " \u6B21 / \u5C0F\u65F6"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
          view.tokensTotal.toLocaleString(),
          " tokens \xB7 \u7D2F\u8BA1 ",
          view.callsTotal,
          " \u6B21\u8C03\u7528"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
          "\u672C\u6279\u4F30\u7B97\u8F93\u5165 ",
          view.budget.estimatedInput.toLocaleString(),
          " / ",
          view.budget.inputLimit.toLocaleString(),
          " tokens"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
          "\u672C\u5C0F\u65F6\u7528\u91CF\u4E0E\u9884\u7559 ",
          view.budget.tokensThisHour.toLocaleString(),
          " / ",
          view.budget.tokenLimit.toLocaleString(),
          " tokens"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
          "\u6A21\u578B \xB7 ",
          view.timeline.at(-1)?.model?.model ?? "\u8DDF\u968F\u4F1A\u8BDD"
        ] })
      ] }),
      view.checkpoints.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "tl-details", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("summary", { children: [
          "\u65E7\u7248\u89E3\u91CA \xB7 ",
          view.checkpoints.length,
          " \u4EFD\uFF08\u539F\u6837\u4FDD\u7559\uFF09"
        ] }),
        view.checkpoints.map((c) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tl-legacy", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("strong", { children: [
            time(c.time),
            " \xB7 ",
            c.briefing.headline
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: c.briefing.summary })
        ] }, c.id))
      ] })
    ] })
  ] });
}
function Header({ api, boundSessionId, open }) {
  const state = useView(api, boundSessionId);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { className: "tl-launch", title: "\u6253\u5F00\u4EFB\u52A1\u900F\u955C\uFF0C\u67E5\u770B\u8DEF\u7EBF\u56FE", "aria-label": "\u6253\u5F00\u4EFB\u52A1\u900F\u955C", onClick: open, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(LensIcon, { size: 15 }),
    "\u4EFB\u52A1\u900F\u955C",
    state.view?.roadmap && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: state.view.roadmap.nodes.filter((n) => n.kind === "task").length })
  ] });
}

// src/client/styles.ts
var CSS = `
.tl-panel{--tl-paper:var(--dsw-alias-background-primary,#fff);--tl-ink:#192538;--tl-muted:#576579;--tl-line:#dce3ec;--tl-soft:#f3f5f8;--tl-blue:#1d4ed8;--tl-blue-bg:#edf3ff;--tl-green:#176347;--tl-green-bg:#eaf5ef;--tl-red:#aa2a3a;--tl-red-bg:#fff0f2;--tl-amber:#87500c;--tl-amber-bg:#fff5e3;--tl-edge:#8190a6;box-sizing:border-box;height:100%;min-width:0;color:var(--tl-ink);background:var(--tl-paper);overflow:auto;font-family:inherit;font-size:13px;line-height:1.65;padding:22px 22px 32px;container-type:inline-size}
body[data-ds-dark-theme] .tl-panel,[data-theme=dark] .tl-panel{--tl-paper:#171d27;--tl-ink:#edf2fa;--tl-muted:#b0bdd0;--tl-line:#354253;--tl-soft:#242f3e;--tl-blue:#9dbbff;--tl-blue-bg:#243553;--tl-green:#93d8b5;--tl-green-bg:#203b31;--tl-red:#ffadb6;--tl-red-bg:#432b35;--tl-amber:#f2ca88;--tl-amber-bg:#403521;--tl-edge:#8492a8}
.tl-panel *{box-sizing:border-box}.tl-panel h1,.tl-panel h2,.tl-panel h3,.tl-panel h4,.tl-panel p{margin:0;overflow-wrap:anywhere}.tl-panel button,.tl-panel select,.tl-panel input,.tl-panel textarea{font:inherit}.tl-panel button{cursor:pointer;color:inherit}.tl-panel button:disabled{cursor:default;opacity:.5}.tl-panel :focus-visible,.tl-launch:focus-visible{outline:2px solid var(--tl-blue,#1d4ed8);outline-offset:3px}.tl-panel button,.tl-panel summary,.tl-panel input,.tl-panel select{touch-action:manipulation}.tl-panel summary{cursor:pointer}.tl-top{display:flex;justify-content:space-between;gap:8px;align-items:center;padding-bottom:17px;border-bottom:1px solid var(--tl-line)}.tl-brand{display:flex;gap:9px;align-items:center}.tl-mark{width:32px;height:32px;border:1px solid var(--tl-line);border-radius:9px;display:grid;place-items:center;color:var(--tl-blue)}.tl-brand>strong{font-size:14px;font-weight:700;line-height:1.4}.tl-brand>strong>span{display:block;color:var(--tl-muted);font-size:10px;font-weight:500;letter-spacing:1px;margin-top:2px}.tl-tools{display:flex;gap:2px}.tl-icon{width:36px;height:36px;display:grid;place-items:center;border:0;border-radius:7px;background:transparent;color:var(--tl-muted)!important}.tl-icon:hover{background:var(--tl-soft)}.tl-activity{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:15px 0 18px;color:var(--tl-muted);font-size:11px}.tl-activity>span:first-child{display:flex;align-items:center;gap:6px}.tl-dot{width:6px;height:6px;border-radius:50%;display:inline-block;background:var(--tl-muted)}.tl-dot.running{background:var(--tl-blue)}.tl-dot.waiting{background:var(--tl-amber)}.tl-dot.blocked{background:var(--tl-red)}.tl-eyebrow{display:block;font-size:11px;font-weight:500;letter-spacing:.5px;color:var(--tl-muted);margin-bottom:4px}.tl-heading h1,.tl-empty h1{font-size:22px;line-height:1.45;font-weight:700;letter-spacing:-.3px}.tl-counts{display:flex;align-items:center;gap:8px 15px;flex-wrap:wrap;margin-top:9px;font-size:12px;color:var(--tl-muted)}.tl-counts strong{font-size:14px;font-weight:700}.tl-good-text{color:var(--tl-green)}.tl-danger-text{color:var(--tl-red)}.tl-muted{font-size:11px;color:var(--tl-muted)}
.tl-timeline{margin:22px 0 18px;border-top:1px solid var(--tl-line);padding-top:15px}.tl-timeline-heading{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px}.tl-timeline-heading>strong{font-weight:600}.tl-timeline-heading>span{margin-left:auto;color:var(--tl-muted);font-size:11px}.tl-text-button{border:0;border-radius:5px;background:transparent;color:var(--tl-blue)!important;min-height:32px;padding:3px 6px;font-size:11px!important}.tl-text-button:hover{background:var(--tl-blue-bg)}.tl-scrubber{display:block;width:100%;height:32px;margin:7px 0 0;appearance:none;background:transparent;accent-color:var(--tl-blue)}.tl-scrubber::-webkit-slider-runnable-track{height:5px;border-radius:4px;background:linear-gradient(to right,var(--tl-blue) 0 var(--tl-progress),var(--tl-line) var(--tl-progress) 100%)}.tl-scrubber::-webkit-slider-thumb{appearance:none;width:15px;height:15px;margin-top:-5px;border-radius:50%;background:var(--tl-paper);border:4px solid var(--tl-blue);box-shadow:0 0 0 3px var(--tl-blue-bg)}.tl-scrubber::-moz-range-track{height:5px;border-radius:4px;background:var(--tl-line)}.tl-scrubber::-moz-range-progress{height:5px;border-radius:4px;background:var(--tl-blue)}.tl-scrubber::-moz-range-thumb{height:10px;width:10px;border-radius:50%;background:var(--tl-paper);border:4px solid var(--tl-blue)}.tl-ticks{display:flex;gap:8px;justify-content:space-between}.tl-ticks>button{flex:1;min-width:0;min-height:40px;border:0;background:transparent;text-align:center;color:var(--tl-muted);font-size:11px;border-radius:5px;padding:3px 0}.tl-ticks>button:first-child{text-align:left}.tl-ticks>button:last-child{text-align:right}.tl-ticks>button>strong{display:block;font-size:12px;font-weight:600}.tl-ticks>button>span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tl-ticks>button[aria-pressed=true]{color:var(--tl-blue)}
.tl-focus{padding:14px 16px;border-radius:9px;background:var(--tl-blue-bg);margin-bottom:12px}.tl-focus>.tl-eyebrow{color:var(--tl-blue);font-weight:600}.tl-focus h2{font-size:17px;line-height:1.5;font-weight:700}.tl-focus p{font-size:12px;line-height:1.8;margin-top:5px;color:var(--tl-muted)}.tl-user-actions{border-radius:9px;background:var(--tl-amber-bg);color:var(--tl-amber);padding:13px 15px;margin-bottom:12px}.tl-user-actions h2{font-size:13px;font-weight:700}.tl-user-actions p{font-size:12px;margin-top:5px}.tl-attention{display:flex;align-items:center;gap:9px;text-align:left;width:100%;border:0;border-radius:8px;padding:12px 14px;background:var(--tl-red-bg);margin-bottom:10px;color:var(--tl-red)!important}.tl-attention>svg{flex:none}.tl-attention>span{flex:1;min-width:0}.tl-attention strong{display:block;font-size:13px;font-weight:700}.tl-attention small{display:block;font-size:11px;font-weight:400;margin-top:3px;overflow-wrap:anywhere}
.tl-section-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:23px 0 10px}.tl-section-heading h2{font-size:14px;font-weight:700}.tl-view-switch{display:flex;gap:2px;border-radius:6px;background:var(--tl-soft);padding:3px}.tl-view-switch>button{border:0;background:transparent;border-radius:4px;padding:4px 7px;min-height:30px;color:var(--tl-muted);font-size:11px}.tl-view-switch>button[aria-pressed=true]{background:var(--tl-paper);color:var(--tl-blue);box-shadow:0 1px 3px #0001}.tl-goal-group>h3{font-size:14px;margin:15px 0 8px}.tl-phase{margin-bottom:8px;border-bottom:1px solid var(--tl-line);padding-bottom:8px}.tl-phase>summary,.tl-archive>summary,.tl-evidence>summary{display:flex;align-items:center;gap:9px;list-style:none}.tl-phase>summary::-webkit-details-marker,.tl-archive>summary::-webkit-details-marker,.tl-evidence>summary::-webkit-details-marker{display:none}.tl-phase>summary{min-height:42px;padding:8px 0;font-size:13px;font-weight:600}.tl-stage-number{font-size:11px;color:var(--tl-muted);width:22px;flex:none;font-variant-numeric:tabular-nums}.tl-phase>summary>strong{min-width:0;overflow-wrap:anywhere}.tl-phase-count{margin-left:auto;font-size:11px;font-weight:400;color:var(--tl-muted);white-space:nowrap}.tl-phase>summary>svg,.tl-archive>summary>svg,.tl-evidence>summary>svg:last-child{width:13px;color:var(--tl-muted);flex:none}.tl-panel details[open]>summary>svg:last-child{transform:rotate(180deg)}.tl-row{display:flex;align-items:center;gap:9px;width:100%;min-height:46px;padding:10px 9px;text-align:left;border:0;background:var(--tl-paper);border-radius:7px;margin:2px 0}.tl-row:hover{background:var(--tl-soft)}.tl-row[aria-pressed=true]{box-shadow:inset 3px 0 var(--tl-blue);background:var(--tl-blue-bg)}.tl-row[data-status=blocked]{background:var(--tl-red-bg)}.tl-row[data-status=blocked][aria-pressed=true]{box-shadow:inset 3px 0 var(--tl-red)}.tl-row-title{font-size:13px;font-weight:600;flex:1;min-width:0;overflow-wrap:anywhere}.tl-row[data-status=done] .tl-row-title{font-weight:400;color:var(--tl-muted)}.tl-state-icon{flex:none;color:var(--tl-muted)}[data-status=done]>.tl-state-icon,[data-status=done] .tl-state-icon{color:var(--tl-green)}[data-status=active]>.tl-state-icon,[data-status=active] .tl-state-icon{color:var(--tl-blue)}[data-status=blocked]>.tl-state-icon,[data-status=blocked] .tl-state-icon{color:var(--tl-red)}[data-status=waiting] .tl-state-icon,[data-status=review] .tl-state-icon{color:var(--tl-amber)}.tl-badge{font-size:11px;font-weight:500;padding:2px 6px;white-space:nowrap;background:var(--tl-soft);color:var(--tl-muted);border-radius:4px;flex:none}.tl-badge[data-status=done]{color:var(--tl-green);background:var(--tl-green-bg)}.tl-badge[data-status=active]{color:var(--tl-blue);background:var(--tl-blue-bg)}.tl-badge[data-status=blocked]{color:var(--tl-red);background:var(--tl-red-bg)}.tl-badge[data-status=waiting],.tl-badge[data-status=review]{color:var(--tl-amber);background:var(--tl-amber-bg)}
.tl-inspector{border-top:1px solid var(--tl-line);margin-top:20px;padding-top:17px}.tl-detail-heading{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.tl-detail-heading h3{font-size:15px;font-weight:700}.tl-detail-reason{font-size:12px;margin-top:8px!important}.tl-warning{color:var(--tl-amber);font-size:11px}.tl-criteria{margin-top:12px}.tl-criteria h4{font-size:12px;font-weight:600;margin-bottom:5px}.tl-criteria>div{font-size:12px;margin:6px 0}.tl-criteria>div>span{display:block;font-size:11px}.tl-dependencies{display:flex;gap:5px;flex-wrap:wrap;align-items:center;font-size:11px;color:var(--tl-muted);margin-top:10px}.tl-dependencies>button{background:var(--tl-soft);color:var(--tl-muted)!important}.tl-evidence{margin-top:11px;font-size:11px}.tl-evidence>summary{min-height:36px;color:var(--tl-blue);font-weight:500}.tl-evidence>summary>svg:last-child{margin-left:auto}.tl-source{margin:8px 0;background:var(--tl-soft);border-radius:6px;padding:10px 11px}.tl-source>strong{display:block;font-size:11px;font-weight:600;color:var(--tl-muted);margin-bottom:4px}.tl-source p{font-size:12px;white-space:pre-wrap}.tl-source-validity{display:block;color:var(--tl-amber);font-size:11px;margin-bottom:5px}.tl-source pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 0;max-height:260px;overflow:auto}.tl-source details{margin-top:7px;color:var(--tl-muted)}.tl-details,.tl-correction{font-size:11px;margin-top:12px}.tl-details>summary,.tl-correction>summary{min-height:32px;line-height:32px;color:var(--tl-muted)}.tl-details p{font-size:12px;margin:5px 0}.tl-correction{border-top:1px solid var(--tl-line);padding-top:6px}.tl-correction .tl-button{margin-top:9px}.tl-next{margin-top:18px;padding-top:14px;border-top:1px solid var(--tl-line)}.tl-next h2{font-size:12px;font-weight:600}.tl-next p{font-size:12px;color:var(--tl-muted);margin-top:5px}.tl-archive{border-top:1px solid var(--tl-line);margin-top:20px;padding-top:8px}.tl-archive>summary{min-height:42px;font-size:12px}.tl-archive>summary>span{margin-left:auto;font-size:11px;color:var(--tl-muted)}
.tl-graph-caption{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--tl-muted);margin:5px 0}.tl-graph{position:relative;min-width:0}.tl-graph-groups{display:grid;grid-template-columns:repeat(var(--tl-columns),minmax(0,1fr));gap:42px;padding:16px 24px 20px;position:relative}.tl-graph-group{display:flex;flex-direction:column;gap:30px;min-width:0}.tl-graph-heading{font-size:11px;font-weight:600;color:var(--tl-muted);align-self:flex-start;max-width:100%;overflow-wrap:anywhere;position:relative}.tl-graph-node{position:relative;min-width:0}.tl-card{width:100%;min-height:76px;padding:12px 10px;border:1px solid var(--tl-line);border-radius:8px;background:var(--tl-paper);position:relative;text-align:left;z-index:1}.tl-card>span:first-child{display:flex;gap:6px;align-items:flex-start;margin-bottom:6px}.tl-card strong{font-size:13px;line-height:1.5;font-weight:700;overflow-wrap:anywhere;min-width:0}.tl-card .tl-state-icon{width:16px;height:16px;margin-top:2px}.tl-card>.tl-badge{display:inline-block;margin-left:22px}.tl-card:hover{background:var(--tl-soft)}.tl-card[aria-pressed=true]{box-shadow:0 0 0 2px var(--tl-blue);background:var(--tl-blue-bg)}.tl-card[data-status=blocked]{background:var(--tl-red-bg)}.tl-card[data-status=blocked][aria-pressed=true]{box-shadow:0 0 0 2px var(--tl-red)}.tl-port{position:absolute;z-index:2;width:7px;height:7px;border:1px solid var(--tl-edge);border-radius:50%;background:var(--tl-paper);pointer-events:none}.tl-port[data-side=left]{left:-3.5px;top:var(--tl-port-position);transform:translateY(-50%)}.tl-port[data-side=right]{right:-3.5px;top:var(--tl-port-position);transform:translateY(-50%)}.tl-port[data-side=top]{top:-3.5px;left:var(--tl-port-position);transform:translateX(-50%)}.tl-port[data-side=bottom]{bottom:-3.5px;left:var(--tl-port-position);transform:translateX(-50%)}.tl-edges{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.tl-edge-normal{color:var(--tl-edge)}.tl-edge-selected{color:var(--tl-blue)}.tl-edge-blocked{color:var(--tl-red)}.tl-edges>path{stroke-linecap:round;stroke-linejoin:round}.tl-route-note{font-size:11px;color:var(--tl-amber);margin-top:6px!important}.tl-graph[data-orientation=vertical] .tl-graph-groups{display:flex;flex-direction:column;gap:28px;padding:10px 28px 20px}.tl-graph[data-orientation=vertical] .tl-graph-group{gap:27px}.tl-graph[data-orientation=vertical] .tl-graph-heading{margin-bottom:-10px}.tl-graph[data-orientation=vertical] .tl-card{min-height:64px}
.tl-settings{margin-top:16px;background:var(--tl-soft);border:1px solid var(--tl-line);border-radius:9px;padding:14px}.tl-settings h2{font-size:14px;font-weight:600}.tl-field{display:block;margin-top:12px}.tl-field>span{display:block;color:var(--tl-muted);font-size:11px;margin-bottom:5px}.tl-field select,.tl-field input,.tl-field textarea{width:100%;min-width:0;border:1px solid var(--tl-line);border-radius:6px;background:var(--tl-paper);color:var(--tl-ink);padding:8px;font-size:12px}.tl-field textarea{min-height:70px;resize:vertical}.tl-settings-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.tl-toggle{display:flex;gap:7px;align-items:flex-start;font-size:12px;margin-top:13px}.tl-toggle input{margin-top:4px;accent-color:var(--tl-blue)}.tl-setting-help{font-size:11px;color:var(--tl-muted);margin-top:8px!important}.tl-actions{display:flex;gap:8px;margin-top:15px}.tl-button{border:1px solid var(--tl-line);border-radius:7px;padding:7px 11px;min-height:36px;color:var(--tl-ink);background:var(--tl-paper);display:inline-flex;gap:6px;align-items:center;font-size:12px}.tl-button:hover{background:var(--tl-soft)}.tl-button.primary{background:#1d4ed8;color:white;border-color:#1d4ed8}.tl-error{font-size:12px;margin-top:14px;padding:10px 12px;border-radius:7px;background:var(--tl-amber-bg);color:var(--tl-amber)}.tl-empty{padding:26px 0 34px}.tl-empty p{font-size:12px;color:var(--tl-muted);margin:10px 0 18px}.tl-footer{margin-top:24px;padding-top:15px;border-top:1px solid var(--tl-line);font-size:11px;color:var(--tl-muted)}.tl-coverage{display:flex;gap:7px;align-items:flex-start}.tl-coverage>svg{width:14px;margin-top:3px;flex:none}.tl-coverage>div{min-width:0}.tl-coverage p{font-size:11px;margin-top:3px}.tl-coverage strong{font-size:11px;font-weight:600}.tl-backfill{display:flex;gap:8px;align-items:center}.tl-usage{margin-top:12px}.tl-usage>summary{min-height:32px;line-height:32px}.tl-usage p{margin:3px 0}.tl-legacy{padding:8px 0;border-bottom:1px solid var(--tl-line)}.tl-launch{font:inherit;display:inline-flex;align-items:center;gap:5px;cursor:pointer;border:1px solid var(--dsw-alias-border-l1,#dce3ec);border-radius:7px;color:var(--dsw-alias-label-secondary,#576579);background:transparent;font-size:12px;padding:5px 8px;line-height:18px}.tl-launch>span{font-size:10px;background:var(--dsw-alias-state-business-tertiary,#edf3ff);padding:0 4px;border-radius:4px}.tl-spinner{animation:tl-spin 1.1s linear infinite}@keyframes tl-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.tl-spinner{animation:none}}
.tl-dependency-options{margin:10px 0;padding:8px 12px;min-width:0;max-height:240px;overflow:auto;border:1px solid var(--tl-line);border-radius:6px}.tl-dependency-options legend{font-size:11px;color:var(--tl-muted)}.tl-dependency-options .tl-toggle{margin:8px 0;overflow-wrap:anywhere}.tl-dependency-options input{flex:none}
@container(width<340px){.tl-heading h1,.tl-empty h1{font-size:20px}.tl-phase-count{font-size:10px}.tl-row{gap:7px;padding:10px 7px}.tl-row-title{font-size:12px}.tl-section-heading{gap:6px}.tl-section-heading h2{font-size:13px}.tl-counts{gap:7px 12px}.tl-settings-row{grid-template-columns:1fr}.tl-timeline-heading{gap:5px}.tl-timeline-heading>span{font-size:10px}.tl-archive>summary{gap:6px}.tl-archive>summary>span{font-size:10px}}
@media(pointer:coarse){.tl-panel button,.tl-panel summary,.tl-panel select,.tl-scrubber{min-height:44px}.tl-icon{width:44px}.tl-ticks button{min-height:44px}}
`;

// src/client/index.tsx
var inject = ["connection", "slots", "sidebarRight", "sidebarRightTabs"];
function apply(ctx) {
  const browserConnection = ctx.connection;
  const api = new TaskLensClient(browserConnection.rpc);
  ctx.effect(() => () => api.dispose(), "tasklens: client lifecycle");
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = PLUGIN_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, "tasklens: theme");
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PLUGIN_ID,
    kind: "tasklens",
    keepMounted: false,
    title: () => "\u4EFB\u52A1\u900F\u955C",
    guide: [{ id: "tasklens", order: 25, title: () => "\u4EFB\u52A1\u900F\u955C", description: () => "\u67E5\u770B\u4EFB\u52A1\u9636\u6BB5\u3001\u5168\u5C40\u8FDB\u5C55\u4E0E\u9A8C\u6536\u4F9D\u636E", icon: LensIcon }]
  }), "tasklens: native sidebar page");
  ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
    name: "sidebar.right.pane.tab",
    key: PLUGIN_ID,
    inject: (sessionId) => ({ api, boundSessionId: String(sessionId) })
  }, Panel));
  ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
    name: "conversation.session.header.actions",
    id: PLUGIN_ID,
    order: 25,
    inject: (sessionId) => ({ api, boundSessionId: String(sessionId), open: () => ctx.sidebarRight.openTabIn(sessionId, "tasklens") })
  }, Header));
}

return module.exports;}});
