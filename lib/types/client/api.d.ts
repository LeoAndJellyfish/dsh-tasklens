import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';
import { type ModelRoute, type Preferences, type SessionView } from '../shared.js';
import type { Roadmap, TimelineEntry, SourceRef, PublicSource } from '../schema.js';
export interface ClientState {
    view: SessionView | null;
    error: string | null;
    loading: boolean;
}
export declare class TaskLensClient {
    private rpc;
    private entries;
    private timer;
    private disposed;
    constructor(rpc: ClientConnectionRpc);
    private entry;
    getSnapshot: (id: string) => ClientState;
    subscribe: (id: string, listener: () => void) => (() => void);
    private publish;
    call<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T>;
    pull(id: string): Promise<void>;
    refresh(id: string): Promise<void>;
    pause(id: string, paused: boolean): Promise<void>;
    backfill(id: string, paused: boolean): Promise<void>;
    history(id: string, entryId: string): Promise<{
        roadmap: Roadmap;
        entry: TimelineEntry;
    }>;
    sources(id: string, refs: SourceRef[]): Promise<Array<{
        source: PublicSource | null;
        ref: SourceRef;
        validity: 'current' | 'revised' | 'missing';
    }>>;
    annotate(id: string, annotation: unknown): Promise<void>;
    models(): Promise<ModelRoute[]>;
    preferences(preferences: Preferences): Promise<void>;
    dispose(): void;
}
