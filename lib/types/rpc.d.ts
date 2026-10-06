import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { ConnectionRequestRejection, ConnectionTrustRequest } from '@deepseek-ai/dsh-client-connection';
/** Own the route context on DSH builds whose connection.rpc.handle loses webServer injection. */
export declare function taskLensRoute(rejection: (request: ConnectionTrustRequest) => ConnectionRequestRejection, answer: (method: string, payload: unknown) => Promise<unknown>): WebRoute;
