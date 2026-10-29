/**
 * THE FRIENDS HUB WORKER (`ascent-hub`; owner 2026-10-29: one hub for every build). A Worker of its own, deployed from
 * `hub.wrangler.toml`, NEVER named per content revision: its Durable Object namespace (`FriendHub`) is stable, so two
 * friends on different builds meet in the same hub and see each other's presence and messages at once. It carries no
 * game engine (nothing from @game/sim), only the hub; old and new clients coexist through the hub protocol's versioning
 * (`hubProtocol.ts`).
 *
 *   GET /health   `{ hub, min, code }`: the protocol range and the source hash the deploy script compares (no auth)
 *   GET /hub/ws   my hub's WebSocket (Supabase token in the subprotocol; accounts only)
 *
 * Auth is the Versus Worker's (`auth.ts`: the project's ES256 JWKS, dev tokens only with DEV_AUTH=1); the origin allowlist
 * likewise (`origins.ts`). Messages are stored with the hub's OWN writer secret (`HUB_WRITER_SECRET`, `dmStore.ts`).
 */
import { bearerOf, verifyCaller, type AuthEnv } from './auth';
import { FriendHub, HUB_USER_HEADER, hubName, type HubEnv } from './hub';
import { HUB_HEALTH_PATH, HUB_PROTOCOL, HUB_PROTOCOL_MIN, HUB_SOCKET_PATH } from './hubProtocol';
import { originAllowed } from './origins';
import { VERSUS_CF_BEARER_PREFIX } from './protocol';

export { FriendHub };

export interface HubWorkerEnv extends HubEnv, AuthEnv {
  ALLOWED_ORIGINS?: string;
  /** The hub's source hash, set by `scripts/deploy-hub.ts` (a redeploy is skipped when it is unchanged). */
  HUB_CODE?: string;
}

export default {
  async fetch(req: Request, env: HubWorkerEnv): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    if (!originAllowed(origin, env.ALLOWED_ORIGINS)) return new Response('origin not allowed', { status: 403 });
    const headers: Record<string, string> = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    const json = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
    if (url.pathname === HUB_HEALTH_PATH) return json(200, { hub: HUB_PROTOCOL, min: HUB_PROTOCOL_MIN, code: env.HUB_CODE ?? 'dev' });
    if (url.pathname !== HUB_SOCKET_PATH) return json(404, { error: 'not_found' });
    const caller = await verifyCaller(bearerOf(req, VERSUS_CF_BEARER_PREFIX), env);
    if (!caller) return new Response('unauthorized', { status: 401 });
    // A guest has no friends (the friends SQL refuses guests): no hub.
    if (caller.anonymous) return json(403, { error: 'guest' });
    const fwd = new Headers(req.headers);
    fwd.set(HUB_USER_HEADER, caller.userId);
    return env.HUB.get(env.HUB.idFromName(hubName(caller.userId))).fetch(new Request(req, { headers: fwd }));
  },
};
