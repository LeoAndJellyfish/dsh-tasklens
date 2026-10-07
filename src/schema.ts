/** Serializable records shared by the host and the native sidebar. */
export type TaskStatus = 'pending' | 'active' | 'waiting' | 'blocked' | 'review' | 'done' | 'paused' | 'abandoned' | 'superseded';
export type SourceRole = 'user' | 'assistant' | 'tool' | 'runtime';
export type FactBasis = 'observed' | 'verified' | 'confirmed' | 'reported' | 'planned' | 'requested' | 'unknown' | 'assessed' | 'decision';
export interface SourceRef { id: string; hash: string; quote: string }
export interface PublicSource {
  id: string; seq: number; part: number; parts: number; round: number; time: number;
  type: string; role: SourceRole; hash: string; text: string;
  callId?: string; callSeq?: number; tool?: string; command?: string; workdir?: string; error?: boolean;
  check?: { parser: 'command-exit-v1'; command: string; workdir?: string; exitCode: number; passed?: number; failed?: number };
}
export interface Goal {
  id: string; title: string; revision: number; active: boolean;
  requirements: string[]; constraints: Array<{ id: string; text: string; sources: SourceRef[] }>;
  sources: SourceRef[];
}
export interface Criterion {
  id: string; title: string; required: boolean;
  check?: { command: string; artifact: string };
  sources: SourceRef[];
}
export interface Verification {
  id: string; criterionId: string; attemptId: string; scopeRevision: number;
  state: 'passed' | 'failed' | 'unknown'; basis: 'machine' | 'user' | 'model';
  scope: string; sources: SourceRef[]; time: number; valid: boolean;
}
export interface Attempt {
  id: string; scopeRevision: number; state: 'running' | 'passed' | 'failed' | 'reported';
  sources: SourceRef[]; time: number;
}
export interface TaskNode {
  id: string; goalId: string; parentId: string | null; kind: 'phase' | 'task';
  title: string; aliases: string[]; order: number; revision: number; scopeRevision: number; scopeStartSeq?: number;
  authority: 'user' | 'adopted' | 'proposed'; status: TaskStatus; reason: string;
  criteria: Criterion[]; attempts: Attempt[]; verifications: Verification[];
  sources: SourceRef[]; changedAt: number; changedSeq: number;
  replaces: string | null; valid: boolean;
  locks: Partial<Record<'title' | 'status' | 'parentId' | 'dependencies' | 'structure', { value: string | null; scopeRevision: number; annotationId: string }>>;
}
export interface Dependency { id: string; from: string; to: string; sources: SourceRef[] }
export interface Fact {
  id: string; nodeId: string | null; goalId: string | null; scopeRevision: number;
  claim: string; basis: FactBasis; actor: 'agent' | 'user' | 'system'; scope: string;
  sources: SourceRef[]; valid: boolean; time: number; action: 'agent' | 'user' | null;
}
export interface Unresolved { id: string; nodeId: string | null; text: string; sources: SourceRef[]; time: number }
export interface Episode { id: string; fromSeq: number; toSeq: number; nodeIds: string[]; factIds: string[]; sources: string[] }
export interface NodeChange { id: string; nodeId: string; time: number; from: TaskStatus | null; to: TaskStatus; scopeRevision: number; reason: string; sources: SourceRef[] }
export interface ProseUnit { text: string; factIds: string[] }
export interface WorkBriefing {
  headline: ProseUnit | null; summary: ProseUnit[]; agentNext: ProseUnit[]; userActions: ProseUnit[];
  details: ProseUnit[]; styleVersion: number; fallback: boolean;
}
export interface Roadmap {
  schemaVersion: 2; sessionId: string; generation: string; version: number;
  goals: Goal[]; nodes: TaskNode[]; edges: Dependency[]; facts: Fact[]; unresolved: Unresolved[];
  episodes: Episode[]; analyzed: Record<string, string>; sourceRevision: string;
  changes: NodeChange[];
  briefing: WorkBriefing | null;
}
export interface TimelineEntry {
  id: string; commit: number; branch: 'live' | 'rebuild'; generation: string;
  throughSeq: number; round: number; time: number; title: string; trigger: string;
  model: { provider: string; model: string } | null; key: boolean; preview: boolean;
}
export interface Annotation {
  id: string; nodeId: string; sourceIds: string[]; goalTitle: string; nodeTitle: string;
  scopeRevision: number; field: 'title' | 'status' | 'parentId' | 'dependencies' | 'merge' | 'split'; value: string | null;
  related?: Array<{ id: string; title: string; scopeRevision: number }>;
  reason: string; time: number;
}
export interface Coverage {
  analyzedParts: number; totalParts: number; completeRounds: number[]; pendingRounds: number[];
  invalidSources: number; rebuilding: boolean; backfillPaused: boolean;
  observedSeq: number; analyzedSeq: number;
}
export interface BudgetInfo { estimatedInput: number; inputLimit: number; protectedOmitted: number; tokensThisHour: number; tokenLimit: number }
export const TASK_LABELS: Record<TaskStatus, string> = {
  pending: '待推进', active: '进行中', waiting: '等待', blocked: '受阻', review: '待验收',
  done: '已完成', paused: '暂缓', abandoned: '已放弃', superseded: '已替换',
};
export function emptyRoadmap(sessionId: string, generation: string): Roadmap {
  return { schemaVersion: 2, sessionId, generation, version: 0, goals: [], nodes: [], edges: [], facts: [],
    unresolved: [], episodes: [], analyzed: {}, sourceRevision: '', changes: [], briefing: null };
}
