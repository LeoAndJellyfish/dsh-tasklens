export const CHANNEL = '/dsh-tasklens';
export const PLUGIN_ID = 'dsh-tasklens';
export type Detail = 'brief' | 'standard' | 'detailed';
export type RunStatus = 'idle' | 'running' | 'waiting' | 'review' | 'blocked' | 'stopped';
export type StageState = 'done' | 'active' | 'pending' | 'blocked';
export interface ModelRoute { provider: string; model: string; name: string; providerName: string }
export interface Preferences {
  enabled: boolean;
  intervalSeconds: number;
  minGapSeconds: number;
  maxCallsPerHour: number;
  detail: Detail;
  model: { provider: string; model: string } | null;
  audience: 'overview' | 'technical';
  inputBudget: number;
  maxTokensPerHour: number;
}
export const DEFAULTS: Preferences = {
  enabled: true, intervalSeconds: 90, minGapSeconds: 30,
  maxCallsPerHour: 40, detail: 'standard', model: null,
  audience: 'overview', inputBudget: 8000, maxTokensPerHour: 400000,
};
export interface Evidence { seq: number; type: string; time: number; text: string }
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
  model: { provider: string; model: string };
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
  roadmapUnchanged?: boolean;
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
  roadmap: import('./schema.js').Roadmap | null;
  timeline: import('./schema.js').TimelineEntry[];
  coverage: import('./schema.js').Coverage;
  budget: import('./schema.js').BudgetInfo;
  commitVersion: number;
}
export const STATUS_LABELS: Record<RunStatus, string> = {
  idle: '等待任务', running: '正在推进', waiting: '等待您的操作',
  review: '本轮回复已结束', blocked: '本轮执行遇到问题', stopped: '会话执行已中断',
};
export const EMPTY_ACTIVITY: LiveActivity = {
  status: 'idle', label: '等待会话产生新的任务记录', lastEventAt: null,
  toolCount: 0, pendingTools: [], throughSeq: -1,
};
export function preferencesOf(value: unknown, base = DEFAULTS): Preferences {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const number = (key: keyof Preferences, min: number, max: number) => {
    const n = v[key];
    return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : base[key] as number;
  };
  const route = v.model;
  let model = base.model;
  if (route === null) model = null;
  else if (route && typeof route === 'object') {
    const pair = route as Record<string, unknown>;
    if (typeof pair.provider === 'string' && typeof pair.model === 'string' && pair.provider.length > 0 && pair.model.length > 0
        && pair.provider.length <= 200 && pair.model.length <= 200) model = { provider: pair.provider, model: pair.model };
  }
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : base.enabled,
    intervalSeconds: number('intervalSeconds', 45, 600), minGapSeconds: number('minGapSeconds', 15, 120),
    maxCallsPerHour: number('maxCallsPerHour', 6, 120),
    detail: v.detail === 'brief' || v.detail === 'standard' || v.detail === 'detailed' ? v.detail : base.detail,
    model,
    audience: v.audience === 'technical' || v.audience === 'overview' ? v.audience : base.audience,
    inputBudget: number('inputBudget', 8000, 32000), maxTokensPerHour: number('maxTokensPerHour', 10000, 2000000),
  };
}
