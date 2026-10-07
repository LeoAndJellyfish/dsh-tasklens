import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';
import { CHANNEL, type ModelRoute, type Preferences, type SessionView } from '../shared.js';
import type { Roadmap, TimelineEntry, SourceRef, PublicSource } from '../schema.js';

export interface ClientState { view: SessionView | null; error: string | null; loading: boolean }
interface Entry { state: ClientState; listeners: Set<() => void>; inFlight: boolean; refs: number; controller: AbortController | null }
export class TaskLensClient {
  private entries = new Map<string, Entry>();
  private timer: ReturnType<typeof setInterval>;
  private disposed = false;
  constructor(private rpc: ClientConnectionRpc) {
    this.timer = setInterval(() => {
      for (const [id, e] of this.entries) if (e.refs) void this.pull(id);
    }, 5000);
  }
  private entry(id: string): Entry {
    let entry = this.entries.get(id);
    if (!entry) { entry = { state: { view: null, error: null, loading: true }, listeners: new Set(), inFlight: false, refs: 0, controller: null }; this.entries.set(id, entry); }
    return entry;
  }
  getSnapshot = (id: string): ClientState => this.entry(id).state;
  subscribe = (id: string, listener: () => void): (() => void) => {
    const e = this.entry(id); e.listeners.add(listener); e.refs++;
    void this.pull(id);
    return () => { e.listeners.delete(listener); e.refs--; if (!e.refs) e.controller?.abort(); };
  };
  private publish(e: Entry, state: ClientState): void {
    e.state = state; for (const listener of e.listeners) listener();
  }
  async call<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const result = await this.rpc.call(CHANNEL, method, payload, signal);
    if (!result.ok) throw new Error(result.error.message);
    return result.value as T;
  }
  async pull(id: string): Promise<void> {
    const e = this.entry(id); if (e.inFlight || this.disposed) return;
    e.inFlight = true; const controller = new AbortController(); e.controller = controller;
    try {
      const previous = e.state.view;
      const view = await this.call<SessionView>('view', { sessionId: id, knownCommit: previous?.commitVersion, knownObservedSeq: previous?.coverage.observedSeq }, controller.signal);
      if (e.state.view && view.commitVersion < e.state.view.commitVersion) return;
      const merged = view.roadmapUnchanged && e.state.view ? { ...view, roadmap: e.state.view.roadmap, timeline: e.state.view.timeline, checkpoints: e.state.view.checkpoints } : view;
      if (!controller.signal.aborted && !this.disposed) this.publish(e, { view: merged, error: null, loading: false });
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed) this.publish(e, { ...e.state, loading: false, error: error instanceof Error ? error.message : '会话连接失败。' });
    } finally { e.inFlight = false; if (e.controller === controller) e.controller = null; }
  }
  async refresh(id: string): Promise<void> {
    const e = this.entry(id); const view = await this.call<SessionView>('refresh', { sessionId: id });
    this.publish(e, { view, error: null, loading: false });
  }
  async pause(id: string, paused: boolean): Promise<void> {
    const view = await this.call<SessionView>('pause', { sessionId: id, paused });
    this.publish(this.entry(id), { view, error: null, loading: false });
  }
  async backfill(id: string, paused: boolean): Promise<void> {
    const view = await this.call<SessionView>('backfill', { sessionId: id, paused });
    this.publish(this.entry(id), { view, error: null, loading: false });
  }
  history(id: string, entryId: string): Promise<{ roadmap: Roadmap; entry: TimelineEntry }> { return this.call('history', { sessionId: id, entryId }); }
  sources(id: string, refs: SourceRef[]): Promise<Array<{ source: PublicSource | null; ref: SourceRef; validity: 'current' | 'revised' | 'missing' }>> { return this.call('sources', { sessionId: id, refs }); }
  async annotate(id: string, annotation: unknown): Promise<void> {
    const view = await this.call<SessionView>('annotate', { sessionId: id, annotation }); this.publish(this.entry(id), { view, error: null, loading: false });
  }
  models(): Promise<ModelRoute[]> { return this.call('models', { force: true }); }
  async preferences(preferences: Preferences): Promise<void> {
    await this.call('preferences', { preferences });
    await Promise.all([...this.entries].filter(([,e]) => e.refs).map(([id]) => this.pull(id)));
  }
  dispose(): void { this.disposed = true; clearInterval(this.timer); for (const e of this.entries.values()) e.controller?.abort(); this.entries.clear(); }
}
