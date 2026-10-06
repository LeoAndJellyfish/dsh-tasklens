import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { taskLensRoute } from '../src/rpc.js';

test('真实 HTTP 路由保留身份校验并传递中文 RPC 数据', async () => {
  const route = taskLensRoute(req => req.headers['x-test-auth'] === 'valid' ? undefined : 401,
    async (method, payload) => ({ ok: true, value: { method, payload } }));
  const server = createServer((req, res) => { void route.handler(req, res); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/dsh-tasklens/view`;
  const data = { type: 'client-request', rpcId: 'test', method: 'view', payload: { sessionId: '测试会话' } };
  const send = (body = JSON.stringify(data), headers: Record<string,string> = { 'content-type': 'application/json', 'x-test-auth': 'valid' }) => fetch(url, { method: 'POST', headers, body });
  try {
    assert.equal((await send(JSON.stringify(data), { 'content-type': 'application/json' })).status, 401);
    const success = await send(); assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { type: 'server-response', rpcId: 'test', result: { ok: true, value: { method: 'view', payload: data.payload } } });
    assert.equal((await send('invalid JSON')).status, 400);
    assert.equal((await send(JSON.stringify({ ...data, method: 'pause' }))).status, 400);
    assert.equal((await send('x'.repeat(65537))).status, 413);
    assert.equal((await send('{}', { 'content-type': 'text/plain', 'x-test-auth': 'valid' })).status, 415);
  } finally { server.close(); server.closeAllConnections(); await once(server, 'close'); }
});
