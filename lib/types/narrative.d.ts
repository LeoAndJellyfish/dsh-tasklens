import type { Fact, Roadmap, WorkBriefing } from './schema.js';
import type { Preferences } from './shared.js';
export declare const styleProblems: (text: string) => string[];
export declare function fallbackBriefing(graph: Roadmap, candidates: Fact[], preferences: Preferences): WorkBriefing;
export declare function validateBriefing(raw: unknown, graph: Roadmap, candidates: Fact[], loadedFacts: Set<string>, preferences: Preferences, changed: boolean): WorkBriefing;
/** Candidate references are converted to stable fact ids before persistence. */
export declare function stableBriefing(briefing: WorkBriefing, graph: Roadmap, candidates: Fact[]): WorkBriefing;
