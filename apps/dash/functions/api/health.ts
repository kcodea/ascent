// GET /api/health: see src/server/handler.ts (Access JWT check, then the analytics_health RPC with a 60 s cache).
import { handleApi, type DashEnv } from '../../src/server/handler';

export const onRequest = (ctx: { request: Request; env: DashEnv }): Promise<Response> => handleApi(ctx.request, ctx.env, 'health');
