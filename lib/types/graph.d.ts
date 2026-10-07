import { type Roadmap, type PublicSource, type Fact, type Annotation } from './schema.js';
export declare const object: (v: unknown) => Record<string, unknown>;
export declare function textValue(v: unknown, max: number, required?: boolean): string;
export interface GraphContext {
    sources: ReadonlyMap<string, PublicSource>;
    batch: PublicSource[];
    loadedNodeIds: Set<string>;
    quotedOnly?: ReadonlyMap<string, string[]>;
    protectedComplete: boolean;
    pendingUserIds: Set<string>;
    sourceRevision: string;
}
export interface AnalysisResult {
    graph: Roadmap;
    facts: Fact[];
    changed: boolean;
    rawBriefing: unknown;
    warnings: string[];
}
export declare function applyAnalysis(previous: Roadmap, raw: unknown, context: GraphContext, now: number): AnalysisResult;
export declare function invalidateSources(graph: Roadmap, sources: ReadonlyMap<string, PublicSource>): boolean;
export declare function applyAnnotation(previous: Roadmap, a: Annotation, remap?: boolean): Roadmap;
