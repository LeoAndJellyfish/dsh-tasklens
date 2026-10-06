import { type Evidence, type LiveActivity } from './shared.js';
/** Deliberately excludes request headers, system prompts, reasoning blocks and adapter secrets. */
export interface ObservedEvent {
    type: string;
    seq: number;
    time: number;
    data: unknown;
    surfaceOp?: unknown;
}
export declare function redact(text: string): string;
export declare function clipped(text: string, size: number): string;
export declare function eventEvidence(event: ObservedEvent): Evidence | null;
export declare function projectActivity(events: readonly ObservedEvent[]): LiveActivity;
export declare function contextFor(events: readonly ObservedEvent[], throughSeq?: number, limit?: number): {
    evidence: Evidence[];
    goal: string;
    latestRequest: string;
    changed: boolean;
};
export declare const PRIORITY_EVENTS: Set<string>;
/** Event-driven checks still obey the shared spacing, budget and single-flight gate. */
export declare function canCall(now: number, lastStart: number, minGapSeconds: number, calls: readonly number[], cap: number): boolean;
