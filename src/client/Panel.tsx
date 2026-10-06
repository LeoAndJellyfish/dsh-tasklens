import { useCallback, useEffect, useState, useSyncExternalStore, type SVGProps } from 'react';
import { STATUS_LABELS, type Preferences, type ModelRoute, type Checkpoint, type Evidence } from '../shared.js';
import { TaskLensClient } from './api.js';

export interface BoundProps { api: TaskLensClient; boundSessionId: string }
export function LensIcon({ size = 18, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" {...props}>
    <circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 4.2 4.2M7.5 11.5l2-2 2 2 2-3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}
function Icon({ kind, spinning = false }: { kind: 'refresh' | 'settings' | 'pause' | 'play' | 'check' | 'arrow'; spinning?: boolean }) {
  const paths = { refresh: 'M18 8a7 7 0 1 0 1 7M18 3v5h-5', settings: 'M10 3h4l1 3 3 1 2 3-2 2 1 3-3 2-3-1-2 2-3-2 1-3-2-2 2-3 3-1z', pause: 'M9 5v14M15 5v14', play: 'm8 5 11 7-11 7z', check: 'm5 12 4 4L19 6', arrow: 'M4 12h15m-6-6 6 6-6 6' };
  return <svg className={spinning ? 'tl-spinner' : undefined} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]}/>{kind === 'settings' && <circle cx="12" cy="12" r="2.5"/>}</svg>;
}
function useView(api: TaskLensClient, id: string) {
  return useSyncExternalStore(useCallback(l => api.subscribe(id, l), [api, id]), useCallback(() => api.getSnapshot(id), [api, id]));
}
function time(value: number) { return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(value); }
const evidenceTypes: Record<string,string> = { 'user/message': '用户需求', 'assistant/message': '助手回复', 'tool/call': '工具调用', 'tool/result': '工具结果', 'todo/write': '任务清单', 'goal/change': '任务目标', 'turn/end': '本轮结束', 'approval/asked': '操作请求', 'deliverables/presented': '交付记录' };
function Sources({ refs, evidence }: { refs: number[]; evidence: Evidence[] }) {
  const sources = evidence.filter(e => refs.includes(e.seq));
  if (!sources.length) return null;
  return <details className="tl-evidence"><summary>查看依据 · {sources.length} 条</summary>{sources.map(e => <div key={e.seq} className="tl-source">
    <div className="tl-source-meta">{evidenceTypes[e.type] ?? e.type} · 记录 {e.seq} · {time(e.time)}</div><pre>{e.text}</pre>
  </div>)}</details>;
}
function Settings({ api, value, onClose, onError }: { api: TaskLensClient; value: Preferences; onClose: () => void; onError: (v: string) => void }) {
  const [form, setForm] = useState(value); const [models, setModels] = useState<ModelRoute[]>([]); const [saving, setSaving] = useState(false);
  useEffect(() => { let alive = true; api.models().then(m => { if (alive) setModels(m); }).catch(e => { if (alive) onError(e.message); }); return () => { alive = false; }; }, [api]);
  const select = form.model ? JSON.stringify([form.model.provider, form.model.model]) : '';
  const save = async () => { setSaving(true); try { await api.preferences(form); onClose(); } catch(e) { onError(e instanceof Error ? e.message : '设置保存失败。'); } finally { setSaving(false); } };
  return <div className="tl-settings" data-tasklens-settings><h2>解释设置</h2>
    <label className="tl-field"><span>解释模型</span><select aria-label="解释模型" value={select} onChange={e => { const v = e.target.value; const pair = v ? JSON.parse(v) as [string,string] : null; setForm({ ...form, model: pair ? { provider: pair[0], model: pair[1] } : null }); }}>
      <option value="">跟随当前会话模型</option>{models.map(m => <option key={JSON.stringify([m.provider,m.model])} value={JSON.stringify([m.provider,m.model])}>{m.name} · {m.providerName}</option>)}
    </select></label>
    <div className="tl-settings-row"><label className="tl-field"><span>定时解释间隔</span><select aria-label="定时解释间隔" value={form.intervalSeconds} onChange={e => setForm({ ...form, intervalSeconds: Number(e.target.value) })}>
      {[45,90,180,300,600].map(n => <option key={n} value={n}>{n < 60 ? `${n} 秒` : `${n / 60} 分钟`}</option>)}</select></label>
      <label className="tl-field"><span>解释详略</span><select aria-label="解释详略" value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value as Preferences['detail'] })}>
        <option value="brief">精简 · 约 120 字</option><option value="standard">标准 · 约 300 字</option><option value="detailed">详细 · 约 600 字</option></select></label></div>
    <div className="tl-settings-row"><label className="tl-field"><span>每小时调用上限</span><input aria-label="每小时调用上限" type="number" min="6" max="120" value={form.maxCallsPerHour} onChange={e => setForm({ ...form, maxCallsPerHour: Number(e.target.value) })}/></label>
      <label className="tl-field"><span>自动调用最短间隔</span><select aria-label="自动调用最短间隔" value={form.minGapSeconds} onChange={e => setForm({ ...form, minGapSeconds: Number(e.target.value) })}>{[15,30,60,120].map(n => <option key={n} value={n}>{n} 秒</option>)}</select></label></div>
    <label className="tl-toggle"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })}/>自动解释新任务</label>
    <p className="tl-setting-help">阶段变化与本轮结束会提前触发更新。没有新增行动时跳过调用。调用上限适用于全部会话，手动更新计入上限。</p>
    <p className="tl-setting-help">会话中的需求、公开回复和工具摘要将发送至所选模型。解释记录保存在本机，最多保留 40 个检查点。</p>
    <div className="tl-setting-actions"><button className="tl-button primary" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存设置'}</button><button className="tl-button" disabled={saving} onClick={onClose}>取消</button></div>
  </div>;
}
function Report({ checkpoint }: { checkpoint: Checkpoint }) {
  const b = checkpoint.briefing; const done = b.stages.filter(s => s.state === 'done').length;
  return <>
    <div className="tl-goal"><p className="tl-overline">任务目标</p>{b.goal}</div>
    <div className="tl-current"><p className="tl-overline">{b.stage || '当前阶段'}</p><h1 className="tl-headline">{b.headline}</h1><p className="tl-summary">{b.summary}</p></div>
    {b.attention.length > 0 && <div className="tl-attention"><h2>需要您关注</h2><ul>{b.attention.map((v,i) => <li key={i}>{v}</li>)}</ul></div>}
    <section className="tl-section"><div className="tl-section-head"><h2>阶段进展</h2><span className="tl-counter">{done} / {b.stages.length} 阶段已记录完成</span></div><ol className="tl-stages">
      {b.stages.map((s,i) => <li key={`${s.id}:${i}`} className={`tl-stage ${s.state}`}><span className="tl-stage-index">{s.state === 'done' ? <Icon kind="check"/> : String(i+1).padStart(2,'0')}</span><div>
        <div className="tl-stage-title">{s.title}<span className="tl-badge">{{ done: '已完成', active: '进行中', pending: '待推进', blocked: '受阻' }[s.state]}</span></div>
        <p className="tl-stage-reason">{s.reason}</p><Sources refs={s.evidence} evidence={checkpoint.evidence}/>
      </div></li>)}
    </ol></section>
    {b.completed.length > 0 && <section className="tl-section"><div className="tl-section-head"><h2>已完成事项</h2></div><ul className="tl-findings">{b.completed.map((f,i) => <li className="tl-finding" key={i}>
      <div className="tl-finding-top"><span className="tl-finding-dot"><Icon kind="check"/></span><span>{f.text}</span></div><div className="tl-basis">{{ tool: '依据：工具结果', reported: '依据：会话陈述', inferred: '模型判断 · 待核验' }[f.basis]}</div><Sources refs={f.evidence} evidence={checkpoint.evidence}/>
    </li>)}</ul></section>}
    {b.next.length > 0 && <section className="tl-section"><div className="tl-section-head"><h2>接下来</h2><Icon kind="arrow"/></div><ol className="tl-next">{b.next.map((v,i) => <li key={i}>{v}</li>)}</ol></section>}
    {b.acceptance.length > 0 && <section className="tl-section"><div className="tl-section-head"><h2>验收记录</h2><span className="tl-counter">随阶段更新</span></div><ul className="tl-findings">{b.acceptance.map((a,i) => <li className="tl-finding" key={i}>
      <div className="tl-finding-top"><span className={`tl-finding-dot ${a.state}`}><Icon kind={a.state === 'passed' ? 'check' : 'arrow'}/></span><span>{a.text}</span></div>
      <div className="tl-basis">{{ passed: '已有工具依据', pending: '待核验', failed: '验收发现问题' }[a.state]}</div><Sources refs={a.evidence} evidence={checkpoint.evidence}/>
    </li>)}</ul></section>}
  </>;
}
export function Panel({ api, boundSessionId }: BoundProps) {
  const state = useView(api, boundSessionId); const view = state.view;
  const [settings, setSettings] = useState(false); const [selected, setSelected] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [acting, setActing] = useState(false);
  useEffect(() => { setSelected(null); setError(null); setSettings(false); }, [boundSessionId]);
  const latest = view?.checkpoints.at(-1); const checkpoint = view?.checkpoints.find(c => c.id === selected) ?? latest;
  const historical = Boolean(checkpoint && latest && checkpoint.id !== latest.id);
  const action = async (fn: () => Promise<void>) => { setActing(true); setError(null); try { await fn(); } catch(e) { setError(e instanceof Error ? e.message : '操作失败。'); } finally { setActing(false); } };
  const refresh = () => void action(() => api.refresh(boundSessionId));
  const paused = view?.paused || !view?.preferences.enabled;
  return <div className="tl-panel" data-tasklens-panel>
    <div className="tl-top"><div className="tl-brand"><span className="tl-mark"><LensIcon size={22}/></span><div><div className="tl-name">任务透镜</div><div className="tl-subname">TASKLENS</div></div></div><div className="tl-tools">
      <button className="tl-icon" aria-label="立即更新解释" title="立即更新解释" disabled={acting || view?.busy} onClick={refresh}><Icon kind="refresh" spinning={view?.busy}/></button>
      <button className="tl-icon" aria-label={view?.paused ? '恢复本会话自动解释' : '暂停本会话自动解释'} title={view?.paused ? '恢复自动解释' : '暂停自动解释'} disabled={!view || acting} onClick={() => void action(() => api.pause(boundSessionId, !view!.paused))}><Icon kind={view?.paused ? 'play' : 'pause'}/></button>
      <button className="tl-icon" aria-label="解释设置" title="解释设置" aria-expanded={settings} onClick={() => setSettings(!settings)}><Icon kind="settings"/></button>
    </div></div>
    {settings && view && <Settings key={boundSessionId} api={api} value={view.preferences} onClose={() => setSettings(false)} onError={setError}/>}
    {(error || state.error || view?.error) && <div className="tl-error" role="status">{error || state.error || view?.error}</div>}
    {view?.notice && <div className="tl-error" role="status">{view.notice}</div>}
    <div className="tl-status"><span className="tl-status-label"><span className={`tl-dot ${view?.activity.status ?? 'idle'}`}/>{view ? STATUS_LABELS[view.activity.status] : '正在读取会话'}</span><span>{view?.busy ? '正在生成解释…' : paused && view ? '自动解释已暂停' : checkpoint ? time(checkpoint.time) : '尚无解释'}</span></div>
    {view && view.activity.status !== 'idle' && <div className="tl-live"><LensIcon size={14}/><div>{view.activity.label}{latest && view.activity.throughSeq > latest.throughSeq && <div className="tl-basis">已有新增行动，等待下一次阶段解释。</div>}</div></div>}
    {checkpoint ? <>
      {view && view.checkpoints.length > 1 && <div className="tl-history"><select aria-label="阶段解释历史" value={selected ?? 'latest'} onChange={e => setSelected(e.target.value === 'latest' ? null : e.target.value)}><option value="latest">最新解释 · {latest?.briefing.stage}</option>{view.checkpoints.slice().reverse().map(c => <option key={c.id} value={c.id}>{time(c.time)} · {c.trigger} · {c.briefing.stage}</option>)}</select></div>}
      {historical && <p className="tl-historical">正在查看历史检查点 · {time(checkpoint.time)}</p>}<Report checkpoint={checkpoint}/>
    </> : <div className="tl-empty"><p className="tl-overline">按阶段理解任务</p><h2>{state.loading ? '正在读取任务记录' : '任务的全局进展，集中查看'}</h2><p>这里展示任务目标、当前阶段、已完成事项和验收记录。开始任务后自动生成解释，您也可以立即更新。</p><button className="tl-button primary" disabled={state.loading || acting || view?.busy} onClick={refresh}><Icon kind="refresh" spinning={view?.busy}/>{view?.busy ? '正在生成解释…' : '生成阶段解释'}</button></div>}
    {view && <div className="tl-footer"><div className="tl-footer-row"><span>{checkpoint ? `解释模型 · ${checkpoint.model.model}` : '模型 · 跟随会话或在设置中选择'}</span><span>{view.callsThisHour} / {view.preferences.maxCallsPerHour} 次 / 小时</span></div><div>间隔 {view.preferences.intervalSeconds} 秒 · {view.callsTotal} 次调用 · {view.tokensTotal.toLocaleString()} tokens</div><div>摘要依据会话记录生成，验收依据可逐项展开。</div></div>}
  </div>;
}
export function Header({ api, boundSessionId, open }: BoundProps & { open: () => void }) {
  const state = useView(api, boundSessionId); const view = state.view;
  return <button className="tl-launch" title="打开任务透镜，查看阶段进展" aria-label="打开任务透镜" onClick={open}><LensIcon size={15}/>任务透镜{view && view.checkpoints.length > 0 && <span className="tl-launch-count">{view.checkpoints.length}</span>}</button>;
}
