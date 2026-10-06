import type { IncomingMessage } from 'node:http';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { ConnectionRequestRejection, ConnectionTrustRequest } from '@deepseek-ai/dsh-client-connection';
import { CHANNEL } from './shared.js';

const MAX_BYTES = 64 * 1024;
class RequestError extends Error { constructor(public status: number, message: string) { super(message); } }
function readBody(request: IncomingMessage): Promise<unknown> {
  if (Number(request.headers['content-length']) > MAX_BYTES) {
    request.resume();
    return Promise.reject(new RequestError(413, 'request too large'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0; let settled = false;
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BYTES) { settled = true; chunks.length = 0; reject(new RequestError(413, 'request too large')); }
      else chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new RequestError(400, 'body is not JSON')); }
    });
    request.on('error', () => { if (!settled) reject(new RequestError(400, 'request failed')); });
  });
}
/** Own the route context on DSH builds whose connection.rpc.handle loses webServer injection. */
export function taskLensRoute(
  rejection: (request: ConnectionTrustRequest) => ConnectionRequestRejection,
  answer: (method: string, payload: unknown) => Promise<unknown>,
): WebRoute {
  return { kind: 'prefix', path: CHANNEL, async handler(request, response) {
    const deny = rejection(request);
    if (deny !== undefined) { response.writeHead(deny); response.end(deny === 401 ? 'unauthorized' : 'forbidden'); return; }
    const path = (request.url ?? '').split('?')[0]!;
    const method = path.startsWith(CHANNEL + '/') ? path.slice(CHANNEL.length + 1) : '';
    if (request.method !== 'POST' || !/^[a-z]+$/.test(method)) { response.writeHead(404); response.end('not found'); return; }
    if (String(request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      response.writeHead(415); response.end('content type must be application/json'); return;
    }
    try {
      const body = await readBody(request) as Record<string, unknown> | null;
      if (!body || body.type !== 'client-request' || typeof body.rpcId !== 'string' || !body.rpcId || body.rpcId.length > 200 || body.method !== method) {
        throw new RequestError(400, 'invalid client-request message');
      }
      const result = await answer(method, body.payload);
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result }));
    } catch (error) {
      response.writeHead(error instanceof RequestError ? error.status : 500);
      response.end(error instanceof RequestError ? error.message : 'tasklens request failed');
    }
  } };
}
