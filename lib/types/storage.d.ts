import { type Roadmap, type TimelineEntry, type Annotation } from './schema.js';
import type { Checkpoint } from './shared.js';
export interface SavedSession {
    schemaVersion: 2;
    sessionId: string;
    commitVersion: number;
    live: Roadmap;
    rebuild: Roadmap | null;
    rebuildTarget: string | null;
    liveFloor: number | null;
    pendingWork: {
        branch: 'live' | 'rebuild';
        batchIds: string[];
        extraSourceIds: string[];
        extraNodeIds: string[];
        repair: number;
        supplement: number;
        error: string | null;
    } | null;
    history: TimelineEntry[];
    annotations: Annotation[];
    legacy: Checkpoint[];
    paused: boolean;
    backfillPaused: boolean;
    callsTotal: number;
    tokensTotal: number;
}
export declare function atomicJson(path: string, value: unknown): Promise<void>;
/** Checksummed write-ahead deltas; a valid orphan transaction is replayed after a crash. */
export declare class RoadmapStore {
    readonly directory: string;
    state: SavedSession;
    notice: string | null;
    private lastHash;
    private corrupt;
    private writing;
    constructor(root: string, id: string);
    private lease;
    initialize(): Promise<void>;
    private restore;
    commit(next: SavedSession, expected: number, key: string): Promise<SavedSession>;
    historical(commit: number): Promise<SavedSession>;
    cacheSources(sources: import('./schema.js').PublicSource[]): Promise<void>;
    cachedSource(id: string, hash: string): Promise<import('./schema.js').PublicSource | null>;
}
