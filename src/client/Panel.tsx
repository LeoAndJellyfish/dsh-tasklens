import { useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { STATUS_LABELS, type Preferences, type ModelRoute, type SessionView } from '../shared.js';
import { TASK_LABELS, type Roadmap, type TaskNode, type SourceRef, type PublicSource, type TimelineEntry, type Annotation } from '../schema.js';
import { TaskLensClient } from './api.js';
import { Graph } from './Graph.js';
import { Badge, Icon, LensIcon, StatusIcon, time, ranges } from './common.js';
export { LensIcon } from './common.js';

export interface BoundProps { api: TaskLensClient; boundSessionId: string }
interface UiState { layout: 'tree' | 'graph'; layoutChosen: boolean; selected: string | null; history: string | null; phaseOpen: Record<string, boolean>; archiveOpen: boolean; evidenceOpen: boolean }
const initialUi = (): UiState => ({ layout: 'graph', layoutChosen: false, selected: null, history: null, phaseOpen: {}, archiveOpen: false, evidenceOpen: false });
function readUi(id: string): UiState {
  try { const v = JSON.parse(localStorage.getItem(`tasklens-ui-v2:${id}`) ?? 'null'); if (!v || typeof v !== 'object') return initialUi();
    return { ...initialUi(), layout: v.layoutChosen && v.layout === 'tree' ? 'tree' : 'graph', layoutChosen: v.layoutChosen === true, selected: typeof v.selected === 'string' ? v.selected : null,
      history: typeof v.history === 'string' ? v.history : null, phaseOpen: Object.fromEntries(Object.entries(v.phaseOpen ?? {}).filter(([, value]) => typeof value === 'boolean')) as Record<string, boolean>, archiveOpen: v.archiveOpen === true, evidenceOpen: v.evidenceOpen === true };
  } catch { return initialUi(); }
}
function useView(api: TaskLensClient, id: string) { return useSyncExternalStore(useCallback(l => api.subscribe(id, l), [api, id]), useCallback(() => api.getSnapshot(id), [api, id])); }
function Sources({ api, id, refs, open, onOpen, revision }: { api: TaskLensClient; id: string; refs: SourceRef[]; open: boolean; onOpen: (v: boolean) => void; revision: string }) {
  const [data, setData] = useState<Array<{ source: PublicSource | null; ref: SourceRef; validity: 'current' | 'revised' | 'missing' }>>([]); const [error, setError] = useState<string | null>(null); const [page, setPage] = useState(0);
  const unique = [...new Map(refs.map(r => [`${r.id}:${r.hash}`, r])).values()].reverse(); const key = JSON.stringify(unique.slice(page * 12, page * 12 + 12));
  useEffect(() => { if (!open) return; let alive = true; setError(null);
    api.sources(id, JSON.parse(key)).then(v => { if (alive) setData(v); }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; };
  }, [api, id, key, open, revision]);
  useEffect(() => setPage(0), [id, revision, refs.at(-1)?.id]);
  if (!unique.length) return null;
  const roles = { user: '用户指示', assistant: '执行 AI 回复', tool: '工具记录', runtime: '运行记录' };
  return <details className="tl-evidence" open={open} onToggle={e => onOpen(e.currentTarget.open)}><summary><Icon kind="source"/>查看 {unique.length} 条依据<Icon kind="chevron"/></summary>
    {error && <p role="status">{error}</p>}{data.map(v => <div className="tl-source" key={v.ref.id}><strong>{v.source ? `第 ${v.source.round} 轮 · ${roles[v.source.role]} · 记录 ${v.source.seq}` : v.ref.id}</strong>
      {v.validity !== 'current' && <span className="tl-source-validity">{v.validity === 'revised' ? '当前来源已有修订 · 展示当时摘录' : '当前来源不可读取 · 展示保存的摘录'}</span>}
      <p>{v.ref.quote}</p>{v.source && <details><summary>本段原文</summary><pre>{v.source.text}</pre></details>}</div>)}
    {unique.length > 12 && <div className="tl-actions"><button className="tl-text-button" disabled={page === 0} onClick={() => setPage(page - 1)}>较新依据</button><span className="tl-muted">{page + 1} / {Math.ceil(unique.length / 12)} 页</span><button className="tl-text-button" disabled={(page + 1) * 12 >= unique.length} onClick={() => setPage(page + 1)}>较早依据</button></div>}
  </details>;
}
function Settings({ api, value, onClose, onError }: { api: TaskLensClient; value: Preferences; onClose: () => void; onError: (v: string) => void }) {
  const [form, setForm] = useState(value), [models, setModels] = useState<ModelRoute[]>([]), [saving, setSaving] = useState(false);
  useEffect(() => { let alive = true; api.models().then(m => { if (alive) setModels(m); }).catch(e => { if (alive) onError(e.message); }); return () => { alive = false; }; }, [api]);
  const save = async () => { setSaving(true); try { await api.preferences(form); onClose(); } catch (e) { onError(e instanceof Error ? e.message : '设置保存失败。'); } finally { setSaving(false); } };
  return <section className="tl-settings" aria-label="解释设置"><h2>解释设置</h2><label className="tl-field"><span>解释模型</span><select aria-label="解释模型" value={form.model ? JSON.stringify([form.model.provider, form.model.model]) : ''} onChange={e => { const pair = e.target.value ? JSON.parse(e.target.value) : null; setForm({ ...form, model: pair ? { provider: pair[0], model: pair[1] } : null }); }}><option value="">跟随当前会话模型</option>{models.map(m => <option key={JSON.stringify([m.provider, m.model])} value={JSON.stringify([m.provider, m.model])}>{m.name} · {m.providerName}</option>)}</select></label>
    <div className="tl-settings-row"><label className="tl-field"><span>阅读层级</span><select aria-label="阅读层级" value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value as Preferences['audience'] })}><option value="overview">工作概况</option><option value="technical">技术详情</option></select></label><label className="tl-field"><span>说明详略</span><select aria-label="说明详略" value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value as Preferences['detail'] })}><option value="brief">精简</option><option value="standard">标准</option><option value="detailed">详细</option></select></label></div>
    <div className="tl-settings-row"><label className="tl-field"><span>常规更新间隔</span><select value={form.intervalSeconds} onChange={e => setForm({ ...form, intervalSeconds: Number(e.target.value) })}>{[45, 90, 180, 300, 600].map(n => <option key={n} value={n}>{n} 秒</option>)}</select></label><label className="tl-field"><span>自动调用最短间隔</span><select value={form.minGapSeconds} onChange={e => setForm({ ...form, minGapSeconds: Number(e.target.value) })}>{[15, 30, 60, 120].map(n => <option key={n} value={n}>{n} 秒</option>)}</select></label></div>
    <div className="tl-settings-row"><label className="tl-field"><span>每小时调用上限</span><input type="number" min="6" max="120" value={form.maxCallsPerHour} onChange={e => setForm({ ...form, maxCallsPerHour: Number(e.target.value) })}/></label><label className="tl-field"><span>每小时 token 预算</span><input type="number" min="10000" max="2000000" step="10000" value={form.maxTokensPerHour} onChange={e => setForm({ ...form, maxTokensPerHour: Number(e.target.value) })}/></label></div>
    <label className="tl-field"><span>单次估算输入上限 · tokens</span><input type="number" min="8000" max="32000" step="1000" value={form.inputBudget} onChange={e => setForm({ ...form, inputBudget: Number(e.target.value) })}/></label>
    <label className="tl-toggle"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })}/>允许已开启的对话自动解释</label>
    <p className="tl-setting-help">历史回溯、补充分析和手动更新共用预算。没有新增记录时跳过调用。查看历史及任务详情读取本地记录。</p><p className="tl-setting-help">公开需求、回复和工具记录发送至所选模型；路线图及历史保存在本机。</p>
    <div className="tl-actions"><button className="tl-button primary" disabled={saving} onClick={() => void save()}>保存设置</button><button className="tl-button" disabled={saving} onClick={onClose}>取消</button></div>
  </section>;
}
function Timeline({ entries, selected, onSelect }: { entries: TimelineEntry[]; selected: string | null; onSelect: (id: string | null) => void }) {
  if (!entries.length) return null; const last = entries.length - 1, found = entries.findIndex(e => e.id === selected), index = found < 0 ? last : found, entry = entries[index];
  const keys = entries.map((e, i) => e.key ? i : -1).filter(i => i > 0 && i < last);
  const intermediate = keys.length <= 2 ? keys : [keys[Math.ceil(keys.length / 3) - 1], keys[Math.ceil(keys.length * 2 / 3) - 1]];
  const positions = [...new Set([0, ...intermediate, last])].sort((a, b) => a - b);
  const choose = (i: number) => onSelect(i === last ? null : entries[i].id);
  return <section className="tl-timeline" aria-label="对话历史"><div className="tl-timeline-heading"><strong>对话进度</strong><span>{selected ? '历史' : '当前'} · 第 {entry.round} 轮{entry.preview ? ' · 近期视图' : ''}</span>{selected && <button className="tl-text-button" onClick={() => onSelect(null)}>回到最新</button>}</div>
    <input className="tl-scrubber" type="range" min="0" max={last} step="1" value={index} disabled={last === 0} aria-label="对话进度" aria-valuetext={`第 ${entry.round} 轮，${entry.title}`} style={{ '--tl-progress': `${last ? index / last * 100 : 100}%` } as CSSProperties} onChange={e => choose(Number(e.target.value))}/>
    <div className="tl-ticks">{positions.map(i => <button type="button" key={entries[i].id} aria-pressed={i === index} title={entries[i].title} onClick={() => choose(i)}><strong>第 {entries[i].round} 轮</strong><span>{i === last ? '当前' : entries[i].trigger}</span></button>)}</div>
  </section>;
}
function TaskRow({ node, selected, onSelect }: { node: TaskNode; selected: string | null; onSelect: (id: string) => void }) {
  return <button className="tl-row" type="button" data-status={node.status} aria-pressed={selected === node.id} onClick={() => onSelect(node.id)}><StatusIcon status={node.status}/><span className="tl-row-title">{node.title}</span><Badge status={node.status}/></button>;
}
function Tree({ graph, selected, phaseOpen, onPhase, onSelect }: { graph: Roadmap; selected: string | null; phaseOpen: Record<string, boolean>; onPhase: (id: string, open: boolean) => void; onSelect: (id: string) => void }) {
  const [more, setMore] = useState<Record<string, boolean>>({});
  const live = graph.nodes.filter(n => !['abandoned', 'superseded'].includes(n.status));
  const renderPhase = (node: TaskNode, number: number) => {
    const children = live.filter(n => n.parentId === node.id); const completed = children.filter(n => n.status === 'done').length;
    const open = phaseOpen[node.id] ?? (completed < children.length || !children.length); const visible = more[node.id] ? children : children.slice(0, 40);
    return <details key={node.id} className="tl-phase" open={open}><summary onClick={e => { e.preventDefault(); onPhase(node.id, !open); }}><span className="tl-stage-number">{String(number + 1).padStart(2, '0')}</span><strong>{node.title}</strong><span className="tl-phase-count">{completed} / {children.length} 已完成</span><Icon kind="chevron"/></summary><div>
      {!children.length && <TaskRow node={node} selected={selected} onSelect={onSelect}/>}{visible.map(n => n.kind === 'phase' ? renderPhase(n, number) : <TaskRow key={n.id} node={n} selected={selected} onSelect={onSelect}/>)}
      {visible.length < children.length && <button className="tl-text-button" onClick={() => setMore({ ...more, [node.id]: true })}>展开其余 {children.length - visible.length} 项</button>}</div></details>;
  };
  return <div className="tl-tree">{graph.goals.map(goal => { const top = live.filter(n => n.goalId === goal.id && !n.parentId); return <section key={goal.id} className="tl-goal-group">{graph.goals.length > 1 && <h3>{goal.title}{!goal.active && <span className="tl-muted"> · 暂缓目标</span>}</h3>}{top.map((n, i) => n.kind === 'phase' ? renderPhase(n, i) : <TaskRow key={n.id} node={n} selected={selected} onSelect={onSelect}/>)}</section>; })}</div>;
}
function Correction({ api, view, node, onError }: { api: TaskLensClient; view: SessionView; node: TaskNode; onError: (text: string) => void }) {
  const [field, setField] = useState<Annotation['field']>('status'), [value, setValue] = useState(node.status as string), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const candidates = view.roadmap?.nodes.filter(n => n.goalId === node.goalId && n.id !== node.id && !['abandoned', 'superseded'].includes(n.status)) ?? [];
  const dependencies: string[] = field === 'dependencies' ? JSON.parse(value || '[]') : [];
  const save = async () => { setBusy(true); try { await api.annotate(view.sessionId, { commitVersion: view.commitVersion, nodeId: node.id, field, value: field === 'parentId' && !value ? null : value, reason }); setReason(''); } catch (e) { onError(e instanceof Error ? e.message : '纠正保存失败。'); } finally { setBusy(false); } };
  return <details className="tl-correction"><summary>纠正此任务</summary><div className="tl-settings-row"><label className="tl-field"><span>字段</span><select value={field} onChange={e => { const f = e.target.value as typeof field; setField(f); setValue(f === 'title' ? node.title : f === 'status' ? node.status : f === 'parentId' ? node.parentId ?? '' : f === 'dependencies' ? JSON.stringify(view.roadmap?.edges.filter(e => e.to === node.id).map(e => e.from) ?? []) : ''); setConfirmed(false); }}><option value="status">状态</option><option value="title">名称</option><option value="parentId">所属阶段</option><option value="dependencies">前置任务</option>{node.kind === 'task' && !['abandoned', 'superseded'].includes(node.status) && <><option value="merge">合并到另一任务</option><option value="split">拆分子任务</option></>}</select></label>
    {field !== 'dependencies' && <label className="tl-field"><span>纠正内容</span>{field === 'title' ? <input value={value} maxLength={100} onChange={e => setValue(e.target.value)}/> : field === 'split' ? <textarea value={value} maxLength={810} placeholder="每行一个子任务名称，填写 2—8 项" onChange={e => setValue(e.target.value)}/> : <select value={value} onChange={e => { setValue(e.target.value); setConfirmed(false); }}>{field === 'status' ? Object.entries(TASK_LABELS).map(([id, title]) => <option key={id} value={id}>{title}</option>) : <><option value="">{field === 'merge' ? '选择合并目标' : '独立任务'}</option>{candidates.filter(n => n.kind === (field === 'merge' ? 'task' : 'phase')).map(n => <option value={n.id} key={n.id}>{n.title}</option>)}</>}</select>}</label>}</div>
    {field === 'dependencies' && <fieldset className="tl-dependency-options"><legend>选择前置任务</legend>{candidates.map(n => <label className="tl-toggle" key={n.id}><input type="checkbox" checked={dependencies.includes(n.id)} onChange={e => setValue(JSON.stringify(e.target.checked ? [...dependencies, n.id] : dependencies.filter(id => id !== n.id)))}/>{n.title}</label>)}</fieldset>}
    <label className="tl-field"><span>依据或原因</span><textarea value={reason} maxLength={400} placeholder="说明已核对的范围或实际调整原因" onChange={e => setReason(e.target.value)}/></label>
    {field === 'status' && value === 'done' && <label className="tl-toggle"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>确认当前需求版本已满足必需验收项</label>}
    <p className="tl-setting-help">{field === 'merge' ? '原任务及依据保留在历史方案中，合并目标新增需求版本并重新验收。' : field === 'split' ? '原任务保留为阶段，已有验收条件继续保留；新子任务分别核验。' : '纠正记录附属于当前需求版本，后续模型更新保留该字段。新需求版本会重新核对。'}</p><button className="tl-button" disabled={busy || !reason.trim() || !value && field !== 'parentId' || field === 'status' && value === 'done' && !confirmed} onClick={() => void save()}>{busy ? '保存中…' : '保存纠正'}</button>
  </details>;
}
function Inspector({ api, view, graph, node, historical, onSelect, evidenceOpen, onEvidence, onError }: { api: TaskLensClient; view: SessionView; graph: Roadmap; node: TaskNode; historical: boolean; onSelect: (id: string) => void; evidenceOpen: boolean; onEvidence: (v: boolean) => void; onError: (v: string) => void }) {
  const deps = graph.edges.filter(e => e.to === node.id).map(e => graph.nodes.find(n => n.id === e.from)).filter((n): n is TaskNode => Boolean(n));
  const sources = [...node.sources, ...node.criteria.flatMap(c => c.sources), ...node.verifications.flatMap(v => v.sources)];
  const issues = graph.unresolved.filter(u => u.nodeId === node.id);
  return <section className="tl-inspector" aria-label="任务详情"><span className="tl-eyebrow">选中任务 · 需求版本 {node.scopeRevision}</span><div className="tl-detail-heading"><h3>{node.title}</h3><Badge status={node.status}/></div>
    {node.reason && <p className="tl-detail-reason">{node.reason}</p>}{!node.valid && <p className="tl-warning">来源已有修订，当前结论正在复核。</p>}
    {node.authority === 'proposed' && <span className="tl-muted">执行 AI 提出的步骤</span>}
    {node.criteria.length > 0 && <div className="tl-criteria"><h4>验收条件</h4>{node.criteria.map(c => { const v = node.verifications.filter(v => v.criterionId === c.id && v.scopeRevision === node.scopeRevision && v.valid).at(-1); return <div key={c.id}><p>{c.title}</p><span className="tl-muted">{v ? `${v.state === 'passed' ? '通过' : v.state === 'failed' ? '发现问题' : '待核对'} · ${v.basis === 'machine' ? '匹配的命令检查' : v.basis === 'user' ? '用户确认' : '模型判断'}${v.scope ? ' · ' + v.scope : ''}` : '待核对'}{!c.required ? ' · 可选' : ''}</span></div>; })}</div>}
    {deps.length > 0 && <div className="tl-dependencies"><span>前置任务</span>{deps.map(n => <button className="tl-text-button" key={n.id} onClick={() => onSelect(n.id)}>{n.title}</button>)}</div>}
    {node.replaces && <div className="tl-dependencies"><span>替代方案</span><button className="tl-text-button" onClick={() => onSelect(node.replaces!)}>{graph.nodes.find(n => n.id === node.replaces)?.title ?? '查看替代方案'}</button></div>}
    {issues.length > 0 && <details className="tl-details"><summary>{issues.length} 项判断待核对</summary>{issues.map(u => <p key={u.id}>{u.text}</p>)}</details>}
    {node.attempts.length > 0 && <details className="tl-details"><summary>执行记录 · {node.attempts.length} 次</summary>{node.attempts.map(a => <p key={a.id}>需求版本 {a.scopeRevision} · {time(a.time)} · {{ running: '执行中', passed: '通过记录', failed: '失败记录', reported: '完成报告' }[a.state]}</p>)}</details>}
    {graph.changes.some(c => c.nodeId === node.id) && <details className="tl-details"><summary>状态变化记录</summary>{graph.changes.filter(c => c.nodeId === node.id).map(c => <p key={c.id}>{time(c.time)} · {c.from ? TASK_LABELS[c.from] + ' → ' : ''}{TASK_LABELS[c.to]} · 需求版本 {c.scopeRevision}{c.reason ? ' · ' + c.reason : ''}</p>)}</details>}
    <Sources api={api} id={view.sessionId} refs={sources} open={evidenceOpen} onOpen={onEvidence} revision={graph.sourceRevision}/>
    {Object.keys(node.locks).length > 0 && <p className="tl-muted">已有用户纠正 · 当前版本保留</p>}
    {!historical && <Correction key={`${node.id}:${node.scopeRevision}`} api={api} view={view} node={node} onError={onError}/>}
  </section>;
}
function impacts(graph: Roadmap, id: string): TaskNode[] { const ids = new Set([id]); for (let i = 0; i < graph.nodes.length; i++) { const before = ids.size; for (const e of graph.edges) if (ids.has(e.from)) ids.add(e.to); if (ids.size === before) break; }
  return graph.nodes.filter(n => n.id !== id && ids.has(n.id) && !['abandoned', 'superseded'].includes(n.status)); }
export function Panel({ api, boundSessionId }: BoundProps) {
  const state = useView(api, boundSessionId), view = state.view;
  const [ui, setUi] = useState(() => readUi(boundSessionId)), [settings, setSettings] = useState(false), [error, setError] = useState<string | null>(null), [acting, setActing] = useState(false);
  const [history, setHistory] = useState<{ roadmap: Roadmap; entry: TimelineEntry } | null>(null), [historyBusy, setHistoryBusy] = useState(false);
  useEffect(() => { setUi(readUi(boundSessionId)); setError(null); setSettings(false); setHistory(null); }, [boundSessionId]);
  useEffect(() => { try { localStorage.setItem(`tasklens-ui-v2:${boundSessionId}`, JSON.stringify(ui)); } catch { /* UI preferences are optional. */ } }, [boundSessionId, ui]);
  useEffect(() => { if (!ui.history) { setHistory(null); setHistoryBusy(false); return; } let alive = true; setHistory(null); setHistoryBusy(true);
    api.history(boundSessionId, ui.history).then(v => { if (alive) setHistory(v); }).catch(e => { if (alive) { setError(e.message); setUi(u => ({ ...u, history: null })); } }).finally(() => { if (alive) setHistoryBusy(false); }); return () => { alive = false; };
  }, [api, boundSessionId, ui.history]);
  const graph = ui.history ? history?.entry.id === ui.history ? history.roadmap : null : view?.roadmap;
  const current = graph?.nodes.filter(n => n.kind === 'task' && !['abandoned', 'superseded'].includes(n.status)) ?? [];
  const selected = graph?.nodes.find(n => n.id === ui.selected) ?? current.find(n => n.status === 'blocked') ?? current.find(n => n.status === 'active') ?? current[0] ?? graph?.nodes[0];
  const blockers = current.filter(n => n.status === 'blocked'); const archived = graph?.nodes.filter(n => ['abandoned', 'superseded'].includes(n.status)) ?? [];
  const goal = graph?.goals.find(g => g.active)?.title ?? graph?.goals[0]?.title;
  const select = (id: string) => setUi(u => ({ ...u, selected: id }));
  const action = async (fn: () => Promise<void>) => { setActing(true); setError(null); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败。'); } finally { setActing(false); } };
  const b = graph?.briefing, failure = error || state.error || view?.error;
  const validationFailure = failure && /数字|来源|摘录|引用|任务图|格式|JSON/.test(failure);
  return <div className="tl-panel" data-tasklens-panel data-version="0.2.1"><header className="tl-top"><div className="tl-brand"><span className="tl-mark"><LensIcon size={22}/></span><strong>TaskLens<span>任务透镜 <small className="tl-version">v0.2.1</small></span></strong></div><div className="tl-tools">
    <button className="tl-icon" aria-label="立即更新路线图" title="立即更新路线图" disabled={acting || view?.busy} onClick={() => void action(() => api.refresh(boundSessionId))}><Icon kind="refresh" spin={view?.busy}/></button>
    <button className="tl-icon" aria-label={view?.paused ? '开启自动解释' : '暂停自动解释'} title={view?.paused ? '开启自动解释' : '暂停自动解释'} disabled={!view || acting || !view.preferences.enabled && view.paused} onClick={() => void action(() => api.pause(boundSessionId, !view!.paused))}><Icon kind={view?.paused ? 'play' : 'pause'}/></button>
    <button className="tl-icon" aria-label="解释设置" title="解释设置" aria-expanded={settings} onClick={() => setSettings(!settings)}><Icon kind="settings"/></button>
  </div></header>
    {settings && view && <Settings key={boundSessionId} api={api} value={view.preferences} onClose={() => setSettings(false)} onError={setError}/>}
    {failure && <section className="tl-error" role="status"><div className="tl-error-heading"><StatusIcon status="blocked"/><strong>{graph ? '本次更新未完成' : '首批分析未完成'}</strong>{graph && <button className="tl-text-button" disabled={acting || !view || view.busy} onClick={() => void action(() => api.refresh(boundSessionId))}>重试本批<Icon kind="refresh"/></button>}</div><p>{validationFailure ? '模型返回的内容未通过依据校验，重试会重新处理本批记录。' : '本批记录仍在队列中，可重试分析。'}</p><details><summary>查看错误详情</summary><p>{failure}</p></details></section>}
    <div className="tl-activity"><span><i className={`tl-dot ${view?.activity.status ?? 'idle'}`}/>{view ? STATUS_LABELS[view.activity.status] : '正在读取会话'}</span><span>{view?.busy ? '正在解释…' : view && !view.preferences.enabled ? '全局自动解释已关闭' : view?.paused ? '自动解释已暂停' : view?.timeline.length ? time(view.timeline.at(-1)!.time) : ''}</span></div>
    {!graph && ui.history && <Timeline entries={view?.timeline ?? []} selected={ui.history} onSelect={id => setUi(u => ({ ...u, history: id }))}/>}
    {graph ? <><div className="tl-heading"><span className="tl-eyebrow">会话路线图</span><h1>{goal ?? '当前任务'}</h1><div className="tl-counts"><span><strong>{current.length}</strong> 项任务</span><span className="tl-good-text"><strong>{current.filter(n => n.status === 'done').length}</strong> 项已核验</span>{blockers.length > 0 && <span className="tl-danger-text"><strong>{blockers.length}</strong> 项受阻</span>}</div></div>
      <Timeline entries={view?.timeline ?? []} selected={ui.history} onSelect={id => setUi(u => ({ ...u, history: id }))}/>
      {historyBusy && <p className="tl-muted" role="status">正在读取所选历史…</p>}
      {b && (b.headline || b.summary.length > 0) && <section className="tl-focus"><span className="tl-eyebrow">{ui.history ? '当时重点' : '当前重点'}</span>{b.headline && <h2>{b.headline.text}</h2>}{b.summary.map((u, i) => <p key={i}>{u.text}</p>)}</section>}
      {b && b.userActions.length > 0 && <section className="tl-user-actions"><h2>待您处理</h2>{b.userActions.map((u, i) => <p key={i}>{u.text}</p>)}</section>}
      {blockers.slice(0, 3).map(n => { const affected = impacts(graph, n.id); return <button key={n.id} className="tl-attention" type="button" onClick={() => select(n.id)}><StatusIcon status="blocked"/><span><strong>{n.title}受阻</strong><small>{n.reason}{affected.length > 0 ? ` · 影响${affected.slice(0, 2).map(n => n.title).join('、')}${affected.length > 2 ? `等 ${affected.length} 项` : ''}` : ''}</small></span><Icon kind="arrow"/></button>; })}
      <div className="tl-section-heading"><h2>{ui.layout === 'graph' ? '依赖路线' : '阶段与任务'}</h2><div className="tl-view-switch" role="group" aria-label="路线图视图"><button aria-pressed={ui.layout === 'tree'} onClick={() => setUi(u => ({ ...u, layout: 'tree', layoutChosen: true }))}>阶段总览</button><button aria-pressed={ui.layout === 'graph'} onClick={() => setUi(u => ({ ...u, layout: 'graph', layoutChosen: true }))}>依赖路线</button></div></div>
      {ui.layout === 'tree' ? <Tree graph={graph} selected={selected?.id ?? null} phaseOpen={ui.phaseOpen} onPhase={(id, open) => setUi(u => u.phaseOpen[id] === open ? u : { ...u, phaseOpen: { ...u.phaseOpen, [id]: open } })} onSelect={select}/> : <Graph graph={graph} selected={selected?.id ?? null} onSelect={select}/>}
      {selected && view && <Inspector api={api} view={view} graph={graph} node={selected} historical={Boolean(ui.history)} onSelect={select} evidenceOpen={ui.evidenceOpen} onEvidence={open => setUi(u => u.evidenceOpen === open ? u : { ...u, evidenceOpen: open })} onError={setError}/>}
      {b && b.agentNext.length > 0 && <section className="tl-next"><h2>执行 AI 接下来</h2>{b.agentNext.map((u, i) => <p key={i}>{u.text}</p>)}</section>}
      {b && b.details.length > 0 && <details className="tl-details"><summary>技术详情</summary>{b.details.map((u, i) => <p key={i}>{u.text}</p>)}</details>}
      {archived.length > 0 && <details className="tl-archive" open={ui.archiveOpen} onToggle={e => { const open = e.currentTarget.open; setUi(u => u.archiveOpen === open ? u : { ...u, archiveOpen: open }); }}><summary><strong>历史方案</strong><span>{archived.filter(n => n.status === 'superseded').length} 项替换 · {archived.filter(n => n.status === 'abandoned').length} 项放弃</span><Icon kind="chevron"/></summary>{archived.map(n => <TaskRow node={n} key={n.id} selected={selected?.id ?? null} onSelect={select}/>)}</details>}
    </> : <section className="tl-empty"><div className="tl-empty-hero"><span className="tl-eyebrow"><LensIcon size={16}/>会话路线图</span><h1>{state.loading ? '正在读取会话' : ui.history ? '正在读取历史版本' : view?.busy ? '正在梳理本批任务' : '会话路线待生成'}</h1><p>{ui.history ? '正在读取所选切面的任务与依据。' : view?.busy ? '分析完成后展示任务、当前重点与前置关系。' : '从整个对话梳理任务，持续查看完成结果、阻碍与范围变化。'}</p><span className="tl-empty-label">{view?.busy ? '本批分析进行中' : '自动解释默认暂停'}</span></div>{!ui.history && <><div className="tl-onboarding"><div className="tl-onboarding-title"><strong>首次生成流程</strong><span>尚未生成任务</span></div><ol aria-label="路线图生成流程示意"><li><Icon kind="source"/><strong>读取对话</strong><span>公开记录</span></li><li><LensIcon size={19}/><strong>梳理任务</strong><span>状态与依赖</span></li><li><StatusIcon status="review"/><strong>核对依据</strong><span>成果与验收</span></li></ol></div><div className="tl-empty-actions"><button className="tl-button primary" disabled={!view || acting || view.busy} onClick={() => void action(() => api.refresh(boundSessionId))}><Icon kind="refresh" spin={view?.busy}/>{view?.busy ? '正在分析…' : failure ? '重试本批' : '仅生成一次'}</button>{view?.paused && <button className="tl-button" disabled={acting || view.busy || !view.preferences.enabled} onClick={() => void action(() => api.pause(boundSessionId, false))}><Icon kind="play"/>开启自动解释</button>}</div><p className="tl-empty-note">单次生成后继续暂停。开启自动解释后，当前对话才会持续更新。</p></>}</section>}
    {view && <footer className="tl-footer"><div className="tl-coverage"><Icon kind="history"/><div>
      <strong>{ui.history ? '当前累计分析范围' : '分析范围'}</strong>
      {ui.history && history && <p>所选切面：第 {history.entry.round} 轮 · 分析截至记录 {history.entry.throughSeq}</p>}
      <p>{view.coverage.completeRounds.length ? `已分析第 ${ranges(view.coverage.completeRounds)} 轮` : '尚无完整分析轮次'} · {view.coverage.analyzedParts} / {view.coverage.totalParts} 段公开记录</p>
      {view.coverage.pendingRounds.length > 0 && <p>第 {ranges(view.coverage.pendingRounds)} 轮尚待补齐</p>}
      {view.coverage.rebuilding && <div className="tl-backfill"><span>{view.coverage.backfillPaused ? '历史回溯已暂停' : view.paused || !view.preferences.enabled ? '历史回溯待开启' : '历史回溯进行中'}</span><button className="tl-text-button" disabled={acting || view.paused || !view.preferences.enabled} onClick={() => void action(() => api.backfill(boundSessionId, !view.coverage.backfillPaused))}>{view.coverage.backfillPaused ? '继续回溯' : '暂停回溯'}</button></div>}
      {view.coverage.invalidSources > 0 && <p className="tl-warning">{view.coverage.invalidSources} 段来源已有修订或缺失</p>}{view.notice && <p>{view.notice}</p>}</div></div>
      {view.budget.protectedOmitted > 0 && <p className="tl-warning">{view.budget.protectedOmitted} 组约束尚待载入；涉及完成与范围调整的判断已保留待核对。</p>}
      <details className="tl-usage"><summary>调用用量 · {view.callsThisHour} / {view.preferences.maxCallsPerHour} 次 / 小时</summary><p>{view.tokensTotal.toLocaleString()} tokens · 累计 {view.callsTotal} 次调用</p><p>本批估算输入 {view.budget.estimatedInput.toLocaleString()} / {view.budget.inputLimit.toLocaleString()} tokens</p><p>本小时用量与预留 {view.budget.tokensThisHour.toLocaleString()} / {view.budget.tokenLimit.toLocaleString()} tokens</p><p>模型 · {view.timeline.at(-1)?.model?.model ?? '跟随会话'}</p></details>
      {view.checkpoints.length > 0 && <details className="tl-details"><summary>旧版解释 · {view.checkpoints.length} 份（原样保留）</summary>{view.checkpoints.map(c => <div className="tl-legacy" key={c.id}><strong>{time(c.time)} · {c.briefing.headline}</strong><p>{c.briefing.summary}</p></div>)}</details>}
    </footer>}
  </div>;
}
export function Header({ api, boundSessionId, open }: BoundProps & { open: () => void }) { const state = useView(api, boundSessionId);
  return <button className="tl-launch" title="打开任务透镜，查看路线图" aria-label="打开任务透镜" onClick={open}><LensIcon size={15}/>任务透镜{state.view?.roadmap && <span>{state.view.roadmap.nodes.filter(n => n.kind === 'task').length}</span>}</button>; }
