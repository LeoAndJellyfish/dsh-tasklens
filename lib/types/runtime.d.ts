import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import { type ObservedEvent } from './core.js';
import { type Preferences, type SessionView, type ModelRoute } from './shared.js';
export interface RuntimeServices {
    llm: LlmRuntime;
    query: SessionQueryEngine;
    directory: string;
    now?: () => number;
}
export declare class TaskLensRuntime {
    private services;
    private preferences;
    private sessions;
    private loads;
    private writes;
    private callTimes;
    private active;
    private disposed;
    private readonly now;
    private modelsCache;
    constructor(services: RuntimeServices, defaults?: unknown);
    initialize(): Promise<void>;
    private state;
    private path;
    private hydrate;
    private refreshEvents;
    onEvent(id: string, event: ObservedEvent, subagent?: boolean): void;
    private schedule;
    tick(): Promise<void>;
    models(force?: boolean): Promise<ModelRoute[]>;
    view(id: string): Promise<SessionView>;
    private viewOf;
    configure(value: unknown): Promise<Preferences>;
    pause(id: string, paused: boolean): Promise<SessionView>;
    requestRefresh(id: string): Promise<SessionView>;
    private run;
    private persist;
    private write;
    dispose(): Promise<void>;
}
