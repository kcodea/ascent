// GET /api/moderation/search — see src/server/moderation.ts (the Access JWT guard, then the service-role RPC).
import type { DashEnv } from '../../../src/server/handler';
import { handleModeration } from '../../../src/server/moderation';

export const onRequest = (ctx: { request: Request; env: DashEnv }): Promise<Response> => handleModeration(ctx.request, ctx.env, 'search');
