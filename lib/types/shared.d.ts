export declare const CHANNEL = "/dsh-tasklens";
export declare const PLUGIN_ID = "dsh-tasklens";
export type Detail = 'brief' | 'standard' | 'detailed';
export type RunStatus = 'idle' | 'running' | 'waiting' | 'review' | 'blocked' | 'stopped';
export type StageState = 'done' | 'active' | 'pending' | 'blocked';
export interface ModelRoute {
    provider: string;
    model: string;
    name: string;
    providerName: string;
}
export interface Preferences {
    enabled: boolean;
    intervalSeconds: number;
    minGapSeconds: number;
    maxCallsPerHour: number;
    detail: Detail;
    model: {
        provider: string;
        model: string;
    } | null;
}
export declare const DEFAULTS: Preferences;
export interface Evidence {
    seq: number;
    type: string;
    time: number;
    text: string;
}
export interface Finding {
    text: string;
    evidence: number[];
    basis: 'tool' | 'reported' | 'inferred';
}
export interface Stage {
    id: string;
    title: string;
    state: StageState;
    reason: string;
    evidence: number[];
}
export interface Acceptance {
    text: string;
    state: 'passed' | 'pending' | 'failed';
    evidence: number[];
}
export interface Briefing {
    goal: string;
    headline: string;
    stage: string;
    summary: string;
    status: RunStatus;
    stages: Stage[];
    completed: Finding[];
    next: string[];
    attention: string[];
    acceptance: Acceptance[];
}
export interface Checkpoint {
    id: string;
    time: number;
    throughSeq: number;
    trigger: string;
    model: {
        provider: string;
        model: string;
    };
    briefing: Briefing;
    evidence: Evidence[];
}
export interface LiveActivity {
    status: RunStatus;
    label: string;
    lastEventAt: number | null;
    toolCount: number;
    pendingTools: string[];
    throughSeq: number;
}
export interface SessionView {
    sessionId: string;
    preferences: Preferences;
    paused: boolean;
    activity: LiveActivity;
    checkpoints: Checkpoint[];
    busy: boolean;
    error: string | null;
    notice: string | null;
    nextAutomaticAt: number | null;
    callsThisHour: number;
    callsTotal: number;
    tokensTotal: number;
}
export declare const STATUS_LABELS: Record<RunStatus, string>;
export declare const EMPTY_ACTIVITY: LiveActivity;
export declare function preferencesOf(value: unknown, base?: Preferences): Preferences;
