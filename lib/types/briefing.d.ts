import type { Briefing, Detail, Evidence, LiveActivity } from './shared.js';
export declare function promptFor(detail: Detail): string;
export declare function parseBriefing(raw: string, evidence: Evidence[], activity: LiveActivity): Briefing;
