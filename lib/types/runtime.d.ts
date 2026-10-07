import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import { type ObservedEvent } from './core.js';
import { type SavedSession } from './storage.js';
import { type PublicSource, type Roadmap, type TimelineEntry, type SourceRef } from './schema.js';
import { type Preferences, type SessionView, type ModelRoute } from './shared.js';
export interface RuntimeServices {
    llm: LlmRuntime;
    query: SessionQueryEngine;
    directory: string;
    now?: () => number;
}
/** Preserve preview identities and replay version-specific user corrections at the handoff. */
export declare function finishRebuild(saved: SavedSession): Roadmap;
export declare class TaskLensRuntime {
    private services;
    private preferences;
    private sessions;
    private loads;
    private writes;
    private jobs;
    private usage;
    private active;
    private disposed;
    private preferenceEpoch;
    private readonly now;
    private modelsCache;
    constructor(services: RuntimeServices, defaults?: unknown);
    initialize(): Promise<void>;
    private state;
    private hydrate;
    private refreshEvents;
    onEvent(id: string, event: ObservedEvent, subagent?: boolean): void;
    private schedule;
    private launch;
    tick(): Promise<void>;
    models(force?: boolean): Promise<ModelRoute[]>;
    private pending;
    view(id: string): Promise<SessionView>;
    private viewOf;
    historical(id: string, entryId: string): Promise<{
        roadmap: Roadmap;
        entry: TimelineEntry;
    }>;
    sources(id: string, refs: unknown): Promise<Array<{
        source: PublicSource | null;
        ref: SourceRef;
        validity: 'current' | 'revised' | 'missing';
    }>>;
    configure(value: unknown): Promise<Preferences>;
    pause(id: string, paused: boolean, backfill?: boolean): Promise<SessionView>;
    annotate(id: string, value: unknown): Promise<SessionView>;
    requestRefresh(id: string): Promise<SessionView>;
    private prepare;
    private invoke;
    private run;
    private write;
    dispose(): Promise<void>;
}
