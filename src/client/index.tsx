import type { Context } from '@deepseek-ai/cordis';
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import { PLUGIN_ID } from '../shared.js';
import { TaskLensClient } from './api.js';
import { Header, LensIcon, Panel } from './Panel.js';
import { CSS } from './styles.js';

export const inject = ['connection', 'slots', 'sidebarRight', 'sidebarRightTabs'];
export function apply(ctx: Context): void {
  const browserConnection = ctx.connection as unknown as { rpc: ClientConnectionRpc };
  const api = new TaskLensClient(browserConnection.rpc);
  ctx.effect(() => () => api.dispose(), 'tasklens: client lifecycle');
  ctx.effect(() => {
    const style = document.createElement('style'); style.dataset.plugin = PLUGIN_ID; style.textContent = CSS; document.head.appendChild(style);
    return () => style.remove();
  }, 'tasklens: theme');
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PLUGIN_ID, kind: 'tasklens', keepMounted: false, title: () => '任务透镜',
    guide: [{ id: 'tasklens', order: 25, title: () => '任务透镜', description: () => '查看任务阶段、全局进展与验收依据', icon: LensIcon }],
  }), 'tasklens: native sidebar page');
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: PLUGIN_ID,
    inject: sessionId => ({ api, boundSessionId: String(sessionId) }),
  }, Panel));
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: PLUGIN_ID, order: 25,
    inject: sessionId => ({ api, boundSessionId: String(sessionId), open: () => ctx.sidebarRight.openTabIn(sessionId as SessionId, 'tasklens') }),
  }, Header));
}
