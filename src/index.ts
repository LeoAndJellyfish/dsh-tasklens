import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {} from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-query';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-host-webserver';
import { TaskLensRuntime } from './runtime.js';
import { taskLensRoute } from './rpc.js';

export const name = 'tasklens';
export const inject = ['llm', 'sessions', 'sessionQuery', 'connection', 'webServer'];
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('允许已主动开启的对话自动解释；新对话默认暂停'),
  intervalSeconds: Schema.number().min(45).max(600).default(90).description('定时解释间隔（秒）'),
  minGapSeconds: Schema.number().min(15).max(120).default(30).description('自动调用最短间隔（秒）'),
  maxCallsPerHour: Schema.number().min(6).max(120).default(40).description('全部会话每小时调用上限，含手动生成与回溯'),
  detail: Schema.union(['brief', 'standard', 'detailed']).default('standard').description('解释详略'),
  audience: Schema.union(['overview', 'technical']).default('overview').description('阅读层级'),
  inputBudget: Schema.number().min(8000).max(32000).default(8000).description('单次估算输入 token 上限'),
  maxTokensPerHour: Schema.number().min(10000).max(2000000).default(400000).description('全部会话每小时 token 预算'),
});
function sessionId(payload: unknown): string {
  const id = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).sessionId : undefined;
  if (typeof id !== 'string' || !id || id.length > 200) throw new Error('会话标识无效。');
  return id;
}
export async function apply(ctx: Context, config: unknown = {}): Promise<void> {
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  const runtime = new TaskLensRuntime({ llm: ctx.llm, query: ctx.sessionQuery, directory: join(dshHome, 'storages', 'dsh-tasklens') }, config);
  await runtime.initialize();
  ctx.on('session/event', (session, event) => runtime.onEvent(String(session.id), event, session.header.origin === 'subagent'));
  const timer = setInterval(() => { void runtime.tick().catch(() => undefined); }, 2000);
  timer.unref();
  ctx.effect(() => () => { clearInterval(timer); return runtime.dispose(); }, 'tasklens: observer lifecycle');
  const connection = ctx.connection;
  const webServer = ctx.webServer;
  ctx.effect(() => webServer.register(taskLensRoute(request => connection.requestRejection(request), async (endpoint, payload) => {
    try {
      let value: unknown;
      const p = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      switch (endpoint) {
        case 'view': {
          const view = await runtime.view(sessionId(payload));
          value = p.knownCommit === view.commitVersion && p.knownObservedSeq === view.coverage.observedSeq
            ? { ...view, roadmap: null, timeline: [], checkpoints: [], roadmapUnchanged: true } : view;
          break;
        }
        case 'models': value = await runtime.models(p.force === true); break;
        case 'refresh': value = await runtime.requestRefresh(sessionId(payload)); break;
        case 'preferences': value = await runtime.configure(p.preferences); break;
        case 'pause': value = await runtime.pause(sessionId(payload), p.paused === true); break;
        case 'backfill': value = await runtime.pause(sessionId(payload), p.paused === true, true); break;
        case 'history': value = await runtime.historical(sessionId(payload), String(p.entryId)); break;
        case 'sources': value = await runtime.sources(sessionId(payload), p.refs); break;
        case 'annotate': value = await runtime.annotate(sessionId(payload), p.annotation); break;
        default: throw new Error('未找到任务透镜接口。');
      }
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: { code: 'TASKLENS_ERROR', message: error instanceof Error ? error.message : '任务透镜操作失败。', details: {} } };
    }
  })), 'tasklens: authenticated rpc channel');
}
