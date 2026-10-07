import { type ObservedEvent } from './core.js';
import type { PublicSource, SourceRef } from './schema.js';
export declare const hashOf: (text: string) => string;
export declare function publicSources(events: readonly ObservedEvent[]): PublicSource[];
export declare function sourceRevision(sources: readonly PublicSource[]): string;
export declare function checkedRefs(value: unknown, sources: ReadonlyMap<string, PublicSource>, quotedOnly?: ReadonlyMap<string, string[]>): SourceRef[];
export declare function refsCurrent(refs: SourceRef[], sources: ReadonlyMap<string, PublicSource>): boolean;
export declare function pendingUserSourceIds(sources: readonly PublicSource[]): Set<string>;
