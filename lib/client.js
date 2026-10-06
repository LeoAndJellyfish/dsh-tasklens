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
  review: "\u672C\u8F6E\u7ED3\u675F\uFF0C\u5F85\u6838\u9A8C",
  blocked: "\u9047\u5230\u963B\u788D",
  stopped: "\u4EFB\u52A1\u5DF2\u4E2D\u65AD"
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
      const view = await this.call("view", { sessionId: id }, controller.signal);
      if (!controller.signal.aborted && !this.disposed) this.publish(e, { view, error: null, loading: false });
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
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function LensIcon({ size = 18, ...props }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", "aria-hidden": "true", ...props, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "10.5", cy: "10.5", r: "6.5" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m15.3 15.3 4.2 4.2M7.5 11.5l2-2 2 2 2-3", strokeLinecap: "round", strokeLinejoin: "round" })
  ] });
}
function Icon({ kind, spinning = false }) {
  const paths = { refresh: "M18 8a7 7 0 1 0 1 7M18 3v5h-5", settings: "M10 3h4l1 3 3 1 2 3-2 2 1 3-3 2-3-1-2 2-3-2 1-3-2-2 2-3 3-1z", pause: "M9 5v14M15 5v14", play: "m8 5 11 7-11 7z", check: "m5 12 4 4L19 6", arrow: "M4 12h15m-6-6 6 6-6 6" };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { className: spinning ? "tl-spinner" : void 0, width: "15", height: "15", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: paths[kind] }),
    kind === "settings" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "2.5" })
  ] });
}
function useView(api, id) {
  return (0, import_react.useSyncExternalStore)((0, import_react.useCallback)((l) => api.subscribe(id, l), [api, id]), (0, import_react.useCallback)(() => api.getSnapshot(id), [api, id]));
}
function time(value) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(value);
}
var evidenceTypes = { "user/message": "\u7528\u6237\u9700\u6C42", "assistant/message": "\u52A9\u624B\u56DE\u590D", "tool/call": "\u5DE5\u5177\u8C03\u7528", "tool/result": "\u5DE5\u5177\u7ED3\u679C", "todo/write": "\u4EFB\u52A1\u6E05\u5355", "goal/change": "\u4EFB\u52A1\u76EE\u6807", "turn/end": "\u672C\u8F6E\u7ED3\u675F", "approval/asked": "\u64CD\u4F5C\u8BF7\u6C42", "deliverables/presented": "\u4EA4\u4ED8\u8BB0\u5F55" };
function Sources({ refs, evidence }) {
  const sources = evidence.filter((e) => refs.includes(e.seq));
  if (!sources.length) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "tl-evidence", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", { children: [
      "\u67E5\u770B\u4F9D\u636E \xB7 ",
      sources.length,
      " \u6761"
    ] }),
    sources.map((e) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-source", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-source-meta", children: [
        evidenceTypes[e.type] ?? e.type,
        " \xB7 \u8BB0\u5F55 ",
        e.seq,
        " \xB7 ",
        time(e.time)
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: e.text })
    ] }, e.seq))
  ] });
}
function Settings({ api, value, onClose, onError }) {
  const [form, setForm] = (0, import_react.useState)(value);
  const [models, setModels] = (0, import_react.useState)([]);
  const [saving, setSaving] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
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
  const select = form.model ? JSON.stringify([form.model.provider, form.model.model]) : "";
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-settings", "data-tasklens-settings": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u89E3\u91CA\u8BBE\u7F6E" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "tl-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u89E3\u91CA\u6A21\u578B" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { "aria-label": "\u89E3\u91CA\u6A21\u578B", value: select, onChange: (e) => {
        const v = e.target.value;
        const pair = v ? JSON.parse(v) : null;
        setForm({ ...form, model: pair ? { provider: pair[0], model: pair[1] } : null });
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u8DDF\u968F\u5F53\u524D\u4F1A\u8BDD\u6A21\u578B" }),
        models.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: JSON.stringify([m.provider, m.model]), children: [
          m.name,
          " \xB7 ",
          m.providerName
        ] }, JSON.stringify([m.provider, m.model])))
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-settings-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "tl-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u5B9A\u65F6\u89E3\u91CA\u95F4\u9694" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", { "aria-label": "\u5B9A\u65F6\u89E3\u91CA\u95F4\u9694", value: form.intervalSeconds, onChange: (e) => setForm({ ...form, intervalSeconds: Number(e.target.value) }), children: [45, 90, 180, 300, 600].map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: n, children: n < 60 ? `${n} \u79D2` : `${n / 60} \u5206\u949F` }, n)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "tl-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u89E3\u91CA\u8BE6\u7565" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { "aria-label": "\u89E3\u91CA\u8BE6\u7565", value: form.detail, onChange: (e) => setForm({ ...form, detail: e.target.value }), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "brief", children: "\u7CBE\u7B80 \xB7 \u7EA6 120 \u5B57" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "standard", children: "\u6807\u51C6 \xB7 \u7EA6 300 \u5B57" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "detailed", children: "\u8BE6\u7EC6 \xB7 \u7EA6 600 \u5B57" })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-settings-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "tl-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u6BCF\u5C0F\u65F6\u8C03\u7528\u4E0A\u9650" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { "aria-label": "\u6BCF\u5C0F\u65F6\u8C03\u7528\u4E0A\u9650", type: "number", min: "6", max: "120", value: form.maxCallsPerHour, onChange: (e) => setForm({ ...form, maxCallsPerHour: Number(e.target.value) }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "tl-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u81EA\u52A8\u8C03\u7528\u6700\u77ED\u95F4\u9694" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", { "aria-label": "\u81EA\u52A8\u8C03\u7528\u6700\u77ED\u95F4\u9694", value: form.minGapSeconds, onChange: (e) => setForm({ ...form, minGapSeconds: Number(e.target.value) }), children: [15, 30, 60, 120].map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: n, children: [
          n,
          " \u79D2"
        ] }, n)) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "tl-toggle", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: form.enabled, onChange: (e) => setForm({ ...form, enabled: e.target.checked }) }),
      "\u81EA\u52A8\u89E3\u91CA\u65B0\u4EFB\u52A1"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tl-setting-help", children: "\u9636\u6BB5\u53D8\u5316\u4E0E\u672C\u8F6E\u7ED3\u675F\u4F1A\u63D0\u524D\u89E6\u53D1\u66F4\u65B0\u3002\u6CA1\u6709\u65B0\u589E\u884C\u52A8\u65F6\u8DF3\u8FC7\u8C03\u7528\u3002\u8C03\u7528\u4E0A\u9650\u9002\u7528\u4E8E\u5168\u90E8\u4F1A\u8BDD\uFF0C\u624B\u52A8\u66F4\u65B0\u8BA1\u5165\u4E0A\u9650\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tl-setting-help", children: "\u4F1A\u8BDD\u4E2D\u7684\u9700\u6C42\u3001\u516C\u5F00\u56DE\u590D\u548C\u5DE5\u5177\u6458\u8981\u5C06\u53D1\u9001\u81F3\u6240\u9009\u6A21\u578B\u3002\u89E3\u91CA\u8BB0\u5F55\u4FDD\u5B58\u5728\u672C\u673A\uFF0C\u6700\u591A\u4FDD\u7559 40 \u4E2A\u68C0\u67E5\u70B9\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-setting-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "tl-button primary", disabled: saving, onClick: () => void save(), children: saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u8BBE\u7F6E" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "tl-button", disabled: saving, onClick: onClose, children: "\u53D6\u6D88" })
    ] })
  ] });
}
function Report({ checkpoint }) {
  const b = checkpoint.briefing;
  const done = b.stages.filter((s) => s.state === "done").length;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-goal", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tl-overline", children: "\u4EFB\u52A1\u76EE\u6807" }),
      b.goal
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-current", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tl-overline", children: b.stage || "\u5F53\u524D\u9636\u6BB5" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { className: "tl-headline", children: b.headline }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tl-summary", children: b.summary })
    ] }),
    b.attention.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-attention", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u9700\u8981\u60A8\u5173\u6CE8" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: b.attention.map((v, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: v }, i)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "tl-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-section-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u9636\u6BB5\u8FDB\u5C55" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "tl-counter", children: [
          done,
          " / ",
          b.stages.length,
          " \u9636\u6BB5\u5DF2\u8BB0\u5F55\u5B8C\u6210"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", { className: "tl-stages", children: b.stages.map((s, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { className: `tl-stage ${s.state}`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tl-stage-index", children: s.state === "done" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { kind: "check" }) : String(i + 1).padStart(2, "0") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-stage-title", children: [
            s.title,
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tl-badge", children: { done: "\u5DF2\u5B8C\u6210", active: "\u8FDB\u884C\u4E2D", pending: "\u5F85\u63A8\u8FDB", blocked: "\u53D7\u963B" }[s.state] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tl-stage-reason", children: s.reason }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sources, { refs: s.evidence, evidence: checkpoint.evidence })
        ] })
      ] }, `${s.id}:${i}`)) })
    ] }),
    b.completed.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "tl-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tl-section-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u5DF2\u5B8C\u6210\u4E8B\u9879" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "tl-findings", children: b.completed.map((f, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { className: "tl-finding", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-finding-top", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tl-finding-dot", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { kind: "check" }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: f.text })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tl-basis", children: { tool: "\u4F9D\u636E\uFF1A\u5DE5\u5177\u7ED3\u679C", reported: "\u4F9D\u636E\uFF1A\u4F1A\u8BDD\u9648\u8FF0", inferred: "\u6A21\u578B\u5224\u65AD \xB7 \u5F85\u6838\u9A8C" }[f.basis] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sources, { refs: f.evidence, evidence: checkpoint.evidence })
      ] }, i)) })
    ] }),
    b.next.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "tl-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-section-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u63A5\u4E0B\u6765" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { kind: "arrow" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", { className: "tl-next", children: b.next.map((v, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: v }, i)) })
    ] }),
    b.acceptance.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "tl-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-section-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u9A8C\u6536\u8BB0\u5F55" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tl-counter", children: "\u968F\u9636\u6BB5\u66F4\u65B0" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "tl-findings", children: b.acceptance.map((a, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { className: "tl-finding", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-finding-top", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `tl-finding-dot ${a.state}`, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { kind: a.state === "passed" ? "check" : "arrow" }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: a.text })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tl-basis", children: { passed: "\u5DF2\u6709\u5DE5\u5177\u4F9D\u636E", pending: "\u5F85\u6838\u9A8C", failed: "\u9A8C\u6536\u53D1\u73B0\u95EE\u9898" }[a.state] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sources, { refs: a.evidence, evidence: checkpoint.evidence })
      ] }, i)) })
    ] })
  ] });
}
function Panel({ api, boundSessionId }) {
  const state = useView(api, boundSessionId);
  const view = state.view;
  const [settings, setSettings] = (0, import_react.useState)(false);
  const [selected, setSelected] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(null);
  const [acting, setActing] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    setSelected(null);
    setError(null);
    setSettings(false);
  }, [boundSessionId]);
  const latest = view?.checkpoints.at(-1);
  const checkpoint = view?.checkpoints.find((c) => c.id === selected) ?? latest;
  const historical = Boolean(checkpoint && latest && checkpoint.id !== latest.id);
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
  const refresh = () => void action(() => api.refresh(boundSessionId));
  const paused = view?.paused || !view?.preferences.enabled;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-panel", "data-tasklens-panel": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-top", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-brand", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tl-mark", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LensIcon, { size: 22 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tl-name", children: "\u4EFB\u52A1\u900F\u955C" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tl-subname", children: "TASKLENS" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-tools", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "tl-icon", "aria-label": "\u7ACB\u5373\u66F4\u65B0\u89E3\u91CA", title: "\u7ACB\u5373\u66F4\u65B0\u89E3\u91CA", disabled: acting || view?.busy, onClick: refresh, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { kind: "refresh", spinning: view?.busy }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "tl-icon", "aria-label": view?.paused ? "\u6062\u590D\u672C\u4F1A\u8BDD\u81EA\u52A8\u89E3\u91CA" : "\u6682\u505C\u672C\u4F1A\u8BDD\u81EA\u52A8\u89E3\u91CA", title: view?.paused ? "\u6062\u590D\u81EA\u52A8\u89E3\u91CA" : "\u6682\u505C\u81EA\u52A8\u89E3\u91CA", disabled: !view || acting, onClick: () => void action(() => api.pause(boundSessionId, !view.paused)), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { kind: view?.paused ? "play" : "pause" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "tl-icon", "aria-label": "\u89E3\u91CA\u8BBE\u7F6E", title: "\u89E3\u91CA\u8BBE\u7F6E", "aria-expanded": settings, onClick: () => setSettings(!settings), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { kind: "settings" }) })
      ] })
    ] }),
    settings && view && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Settings, { api, value: view.preferences, onClose: () => setSettings(false), onError: setError }, boundSessionId),
    (error || state.error || view?.error) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tl-error", role: "status", children: error || state.error || view?.error }),
    view?.notice && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tl-error", role: "status", children: view.notice }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-status", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "tl-status-label", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `tl-dot ${view?.activity.status ?? "idle"}` }),
        view ? STATUS_LABELS[view.activity.status] : "\u6B63\u5728\u8BFB\u53D6\u4F1A\u8BDD"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: view?.busy ? "\u6B63\u5728\u751F\u6210\u89E3\u91CA\u2026" : paused && view ? "\u81EA\u52A8\u89E3\u91CA\u5DF2\u6682\u505C" : checkpoint ? time(checkpoint.time) : "\u5C1A\u65E0\u89E3\u91CA" })
    ] }),
    view && view.activity.status !== "idle" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-live", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LensIcon, { size: 14 }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        view.activity.label,
        latest && view.activity.throughSeq > latest.throughSeq && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tl-basis", children: "\u5DF2\u6709\u65B0\u589E\u884C\u52A8\uFF0C\u7B49\u5F85\u4E0B\u4E00\u6B21\u9636\u6BB5\u89E3\u91CA\u3002" })
      ] })
    ] }),
    checkpoint ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      view && view.checkpoints.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tl-history", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { "aria-label": "\u9636\u6BB5\u89E3\u91CA\u5386\u53F2", value: selected ?? "latest", onChange: (e) => setSelected(e.target.value === "latest" ? null : e.target.value), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: "latest", children: [
          "\u6700\u65B0\u89E3\u91CA \xB7 ",
          latest?.briefing.stage
        ] }),
        view.checkpoints.slice().reverse().map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: c.id, children: [
          time(c.time),
          " \xB7 ",
          c.trigger,
          " \xB7 ",
          c.briefing.stage
        ] }, c.id))
      ] }) }),
      historical && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "tl-historical", children: [
        "\u6B63\u5728\u67E5\u770B\u5386\u53F2\u68C0\u67E5\u70B9 \xB7 ",
        time(checkpoint.time)
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Report, { checkpoint })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tl-overline", children: "\u6309\u9636\u6BB5\u7406\u89E3\u4EFB\u52A1" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: state.loading ? "\u6B63\u5728\u8BFB\u53D6\u4EFB\u52A1\u8BB0\u5F55" : "\u4EFB\u52A1\u7684\u5168\u5C40\u8FDB\u5C55\uFF0C\u96C6\u4E2D\u67E5\u770B" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u8FD9\u91CC\u5C55\u793A\u4EFB\u52A1\u76EE\u6807\u3001\u5F53\u524D\u9636\u6BB5\u3001\u5DF2\u5B8C\u6210\u4E8B\u9879\u548C\u9A8C\u6536\u8BB0\u5F55\u3002\u5F00\u59CB\u4EFB\u52A1\u540E\u81EA\u52A8\u751F\u6210\u89E3\u91CA\uFF0C\u60A8\u4E5F\u53EF\u4EE5\u7ACB\u5373\u66F4\u65B0\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { className: "tl-button primary", disabled: state.loading || acting || view?.busy, onClick: refresh, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { kind: "refresh", spinning: view?.busy }),
        view?.busy ? "\u6B63\u5728\u751F\u6210\u89E3\u91CA\u2026" : "\u751F\u6210\u9636\u6BB5\u89E3\u91CA"
      ] })
    ] }),
    view && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-footer", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tl-footer-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: checkpoint ? `\u89E3\u91CA\u6A21\u578B \xB7 ${checkpoint.model.model}` : "\u6A21\u578B \xB7 \u8DDF\u968F\u4F1A\u8BDD\u6216\u5728\u8BBE\u7F6E\u4E2D\u9009\u62E9" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          view.callsThisHour,
          " / ",
          view.preferences.maxCallsPerHour,
          " \u6B21 / \u5C0F\u65F6"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        "\u95F4\u9694 ",
        view.preferences.intervalSeconds,
        " \u79D2 \xB7 ",
        view.callsTotal,
        " \u6B21\u8C03\u7528 \xB7 ",
        view.tokensTotal.toLocaleString(),
        " tokens"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: "\u6458\u8981\u4F9D\u636E\u4F1A\u8BDD\u8BB0\u5F55\u751F\u6210\uFF0C\u9A8C\u6536\u4F9D\u636E\u53EF\u9010\u9879\u5C55\u5F00\u3002" })
    ] })
  ] });
}
function Header({ api, boundSessionId, open }) {
  const state = useView(api, boundSessionId);
  const view = state.view;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { className: "tl-launch", title: "\u6253\u5F00\u4EFB\u52A1\u900F\u955C\uFF0C\u67E5\u770B\u9636\u6BB5\u8FDB\u5C55", "aria-label": "\u6253\u5F00\u4EFB\u52A1\u900F\u955C", onClick: open, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LensIcon, { size: 15 }),
    "\u4EFB\u52A1\u900F\u955C",
    view && view.checkpoints.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tl-launch-count", children: view.checkpoints.length })
  ] });
}

// src/client/styles.ts
var CSS = `
.tl-panel{--tl-ink:var(--dsw-alias-label-primary,#1b2635);--tl-muted:var(--dsw-alias-label-secondary,#617081);--tl-line:var(--dsw-alias-border-l1,#dde3e8);--tl-paper:var(--dsw-alias-background-primary,#fff);--tl-soft:var(--dsw-static-neutral-50,#f5f7f9);--tl-accent:var(--dsw-alias-state-business-primary,#2864da);--tl-good:#218161;--tl-warn:#a86516;box-sizing:border-box;height:100%;min-width:0;color:var(--tl-ink);background:var(--tl-paper);overflow:auto;font-size:13px;line-height:1.65;padding:22px 22px 36px;container-type:inline-size}
body[data-ds-dark-theme] .tl-panel{--tl-paper:var(--dsw-static-neutral-900,#15191e);--tl-soft:var(--dsw-static-neutral-850,#20262c);--tl-good:#64bb99;--tl-warn:#e0b370}
.tl-panel *{box-sizing:border-box}.tl-panel button,.tl-panel select,.tl-panel input{font:inherit}.tl-panel button{cursor:pointer}.tl-panel button:disabled{cursor:default;opacity:.5}.tl-panel :focus-visible,.tl-launch:focus-visible{outline:2px solid var(--tl-accent,var(--dsw-alias-state-business-primary,#2864da));outline-offset:3px}.tl-panel h1,.tl-panel h2,.tl-panel h3,.tl-panel p{margin:0}.tl-top{display:flex;justify-content:space-between;gap:12px;align-items:center;padding-bottom:20px;border-bottom:1px solid var(--tl-line)}.tl-brand{display:flex;gap:10px;align-items:center}.tl-mark{width:34px;height:34px;border:1px solid var(--tl-line);border-radius:10px;display:grid;place-items:center;color:var(--tl-accent)}.tl-name{font-size:15px;letter-spacing:.02em;font-weight:650}.tl-subname{color:var(--tl-muted);font-size:11px;letter-spacing:.12em}.tl-tools{display:flex;gap:4px}.tl-icon{width:30px;height:30px;display:grid;place-items:center;border:1px solid transparent;border-radius:7px;color:var(--tl-muted);background:transparent}.tl-icon:hover{background:var(--tl-soft);border-color:var(--tl-line)}.tl-status{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 0 10px;font-size:11px;color:var(--tl-muted)}.tl-status-label{display:flex;align-items:center;gap:7px}.tl-dot{width:6px;height:6px;border-radius:50%;background:var(--tl-muted);flex:none}.tl-dot.running{background:var(--tl-accent)}.tl-dot.review{background:var(--tl-good)}.tl-dot.waiting,.tl-dot.blocked{background:var(--tl-warn)}.tl-overline{font-size:10px;font-weight:600;letter-spacing:.15em;color:var(--tl-muted);margin-bottom:6px!important}.tl-goal{font-size:12px;color:var(--tl-muted);padding:14px 0;border-bottom:1px solid var(--tl-line);overflow-wrap:anywhere}.tl-headline{font-size:20px;font-weight:650;line-height:1.4;letter-spacing:-.025em;margin:0 0 12px!important}.tl-summary{font-size:13px;line-height:1.9;overflow-wrap:anywhere;white-space:pre-wrap}.tl-current{border-left:3px solid var(--tl-accent);padding:6px 0 6px 14px;margin:22px 0}.tl-live{padding:12px 14px;background:var(--tl-soft);border-radius:9px;font-size:12px;display:flex;gap:8px;align-items:flex-start;margin:16px 0;color:var(--tl-muted);overflow-wrap:anywhere}.tl-live svg{margin-top:3px;flex:none}.tl-section{margin-top:25px}.tl-section-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.tl-section h2{font-size:12px;letter-spacing:.05em;font-weight:650}.tl-counter{font-size:10px;color:var(--tl-muted);font-variant-numeric:tabular-nums}.tl-stages{list-style:none;padding:0;margin:0}.tl-stage{position:relative;display:grid;grid-template-columns:23px 1fr;gap:9px;padding-bottom:17px}.tl-stage:not(:last-child):before{content:'';position:absolute;left:9px;top:22px;bottom:0;width:1px;background:var(--tl-line)}.tl-stage-index{width:20px;height:20px;border:1px solid var(--tl-line);border-radius:50%;display:grid;place-items:center;font-size:10px;color:var(--tl-muted);background:var(--tl-paper);margin-top:2px;font-variant-numeric:tabular-nums}.tl-stage.done .tl-stage-index{color:var(--tl-good);border-color:color-mix(in srgb,var(--tl-good) 35%,var(--tl-line))}.tl-stage.active .tl-stage-index{color:var(--tl-accent);border-color:var(--tl-accent);background:color-mix(in srgb,var(--tl-accent) 9%,var(--tl-paper));box-shadow:0 0 0 3px color-mix(in srgb,var(--tl-accent) 7%,transparent)}.tl-stage.blocked .tl-stage-index{color:var(--tl-warn);border-color:var(--tl-warn)}.tl-stage-title{font-size:13px;font-weight:550;line-height:23px}.tl-stage.active .tl-stage-title{color:var(--tl-accent)}.tl-stage.pending .tl-stage-title{color:var(--tl-muted)}.tl-stage-reason{font-size:12px;color:var(--tl-muted);margin-top:3px;overflow-wrap:anywhere}.tl-badge{font-size:10px;color:var(--tl-muted);font-weight:400;padding:2px 5px;background:var(--tl-soft);border-radius:4px;margin-left:7px;white-space:nowrap}.tl-findings{padding:0;margin:0;list-style:none}.tl-finding{padding:10px 0;border-bottom:1px solid var(--tl-line);font-size:12px;overflow-wrap:anywhere}.tl-finding:last-child{border-bottom:none}.tl-finding-top{display:flex;gap:8px;align-items:flex-start}.tl-finding-dot{color:var(--tl-good);flex:none;margin-top:3px}.tl-finding-dot.pending{color:var(--tl-muted)}.tl-finding-dot.failed{color:var(--tl-warn)}.tl-basis{font-size:10px;color:var(--tl-muted);margin-top:4px}.tl-evidence{font-size:11px;margin-top:7px;color:var(--tl-muted)}.tl-evidence summary{cursor:pointer;display:list-item;list-style:revert}.tl-source{margin:7px 0;padding:9px 10px;background:var(--tl-soft);border-radius:5px}.tl-source-meta{font-size:10px;margin-bottom:4px}.tl-source pre{font:inherit;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto;margin:0;font-size:11px}.tl-next{margin:0;padding:0 0 0 18px;color:var(--tl-ink);font-size:12px}.tl-next li{padding:3px 0}.tl-attention{border:1px solid color-mix(in srgb,var(--tl-warn) 30%,var(--tl-line));background:color-mix(in srgb,var(--tl-warn) 5%,var(--tl-paper));padding:12px 14px;border-radius:8px;margin-top:18px}.tl-attention h2{font-size:12px;color:var(--tl-warn);margin-bottom:6px}.tl-attention ul{padding-left:16px;margin:0;font-size:12px}.tl-error{background:var(--tl-soft);border:1px solid var(--tl-line);border-radius:7px;padding:10px 12px;font-size:12px;margin-top:14px;color:var(--tl-warn)}.tl-empty{padding:35px 0}.tl-empty h2{font-size:19px;font-weight:600;line-height:1.5;margin:12px 0}.tl-empty p{color:var(--tl-muted);font-size:12px;line-height:1.8}.tl-button{border:1px solid var(--tl-line);border-radius:7px;padding:6px 11px;color:var(--tl-ink);background:var(--tl-paper);display:inline-flex;gap:6px;align-items:center;font-size:12px}.tl-button:hover{background:var(--tl-soft)}.tl-button.primary{background:var(--tl-accent);color:white;border-color:var(--tl-accent)}.tl-empty .tl-button{margin-top:18px}.tl-footer{margin-top:26px;padding-top:14px;border-top:1px solid var(--tl-line);font-size:10px;line-height:1.8;color:var(--tl-muted)}.tl-footer-row{display:flex;justify-content:space-between;gap:10px}.tl-history{border:1px solid var(--tl-line);border-radius:7px;padding:10px;margin-top:15px}.tl-history select{width:100%;border:0;background:transparent;color:var(--tl-ink);font-size:12px}.tl-history option{background:var(--tl-paper)}.tl-settings{margin-top:16px;padding:14px;background:var(--tl-soft);border:1px solid var(--tl-line);border-radius:9px}.tl-settings h2{font-size:13px;font-weight:600;margin-bottom:14px}.tl-field{display:block;margin-top:13px}.tl-field>span{display:block;font-size:11px;color:var(--tl-muted);margin-bottom:5px}.tl-field select,.tl-field input[type=number]{width:100%;min-width:0;border:1px solid var(--tl-line);border-radius:6px;background:var(--tl-paper);color:var(--tl-ink);padding:7px 8px;font-size:12px}.tl-settings-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.tl-toggle{display:flex;align-items:center;gap:8px;font-size:12px;margin-top:13px}.tl-setting-help{font-size:10px;color:var(--tl-muted);margin-top:6px!important;line-height:1.7}.tl-setting-actions{display:flex;gap:8px;margin-top:15px}.tl-launch{font:inherit;display:inline-flex;align-items:center;gap:5px;cursor:pointer;border:1px solid var(--dsw-alias-border-l1,#dde3e8);border-radius:7px;color:var(--dsw-alias-label-secondary,#617081);background:transparent;font-size:12px;padding:5px 8px;line-height:18px}.tl-launch:hover{color:var(--dsw-alias-state-business-primary,#2864da)}.tl-launch-count{font-size:10px;padding:0 4px;border-radius:4px;background:var(--dsw-alias-state-business-tertiary,#edf3fe)}.tl-historical{font-size:11px;color:var(--tl-warn);margin:15px 0}.tl-spinner{animation:tl-spin 1.1s linear infinite}@keyframes tl-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.tl-spinner{animation:none}}@container(width<290px){.tl-panel{padding:16px}.tl-top{gap:4px}.tl-name{font-size:13px}.tl-mark{width:29px;height:29px}.tl-brand{gap:6px}.tl-settings-row{grid-template-columns:1fr}.tl-headline{font-size:18px}}
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
