import type { Preferences } from './shared.js';
import type { PublicSource, Roadmap } from './schema.js';
import type { GraphContext } from './graph.js';
/** Conservative fallback, including JSON and protocol bytes; the UI labels it as estimated. */
export declare function estimateTokens(text: string): number;
export interface WorkContext extends GraphContext {
    request: string;
    system: string;
    estimate: number;
    limit: number;
    protectedOmitted: number;
    throughSeq: number;
    round: number;
    factsLoaded: Set<string>;
    extraUsed: string[];
}
export declare function buildContext(graph: Roadmap, sources: PublicSource[], preferences: Preferences, options?: {
    preview?: boolean;
    limit?: number;
    extraSourceIds?: string[];
    extraNodeIds?: string[];
    styleVersion?: number;
    protectedComplete?: boolean;
}): WorkContext;
