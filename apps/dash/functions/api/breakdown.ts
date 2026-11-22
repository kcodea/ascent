// GET /api/breakdown — see src/server/handler.ts (Access JWT check, then the analytics_breakdown RPC with a 60 s cache).
import { handleApi, type DashEnv } from '../../src/server/handler';

export const onRequest = (ctx: { request: Request; env: DashEnv }): Promise<Response> => handleApi(ctx.request, ctx.env, 'breakdown');
