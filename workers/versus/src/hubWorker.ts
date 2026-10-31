/**
 * THE FRIENDS HUB WORKER (`ascent-hub`; owner 2026-10-29: one hub for every build). A Worker of its own, deployed from
 * `hub.wrangler.toml`, NEVER named per content revision: its Durable Object namespaces (`FriendHub`, `LiveDirectory`)
 * are stable, so two friends on different builds meet in the same hub and see each other's presence and messages at
 * once, and Live Games lists every build's games. It carries no game engine (nothing from @game/sim), only the hub and
 * the directory; old and new clients coexist through the hub protocol's versioning (`hubProtocol.ts`).
 *
 *   GET /health              `{ hub, min, code }`: the protocol range and the source hash the deploy script compares (no auth)
 *   GET /hub/ws              my hub's WebSocket (Supabase token in the subprotocol; accounts only)
 *   GET /live/games?page=N   LIVE GAMES (R-LIVE-DIR-01): one page of the directory, best rank first (any signed-in caller,
 *                            guests too: Live Games was readable by guests on Supabase)
 *   GET /live/count          the menu glow's count
 *   GET /live/game/<id>      one game's row (a friend's Watch), or null
 *   GET /live/metrics        DEV only: the directory's counters (the tests)
 *
 * The directory's WRITES are not routes: the Versus Workers call the `LiveDirectoryWriter` entrypoint below through a
 * service binding (`LIVE_DIR` in `wrangler.toml`), which the public internet cannot reach.
 *
 * Auth is the Versus Worker's (`auth.ts`: the project's ES256 JWKS, dev tokens only with DEV_AUTH=1); the origin allowlist
 * likewise (`origins.ts`). Messages are stored with the hub's OWN writer secret (`HUB_WRITER_SECRET`, `dmStore.ts`).
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import { bearerOf, verifyCaller, type AuthEnv } from './auth';
import { FriendHub, HUB_USER_HEADER, hubName, type HubEnv } from './hub';
import { HUB_HEALTH_PATH, HUB_PROTOCOL, HUB_PROTOCOL_MIN, HUB_SOCKET_PATH } from './hubProtocol';
import { LiveDirectory, type LiveDirEnv } from './liveDirectory';
import { LIVE_DIR_ROUTES } from './liveDirProtocol';
import { originAllowed } from './origins';
import { VERSUS_CF_BEARER_PREFIX } from './protocol';

export { FriendHub, LiveDirectory };

export interface HubWorkerEnv extends HubEnv, LiveDirEnv, AuthEnv {
  HUB: DurableObjectNamespace<FriendHub>;
  ALLOWED_ORIGINS?: string;
  /** The hub's source hash, set by `scripts/deploy-hub.ts` (a redeploy is skipped when it is unchanged). */
  HUB_CODE?: string;
}

/** The one directory object. */
const directoryOf = (env: LiveDirEnv): LiveDirectory => env.LIVE_DIR.get(env.LIVE_DIR.idFromName('global')) as unknown as LiveDirectory;

/**
 * THE DIRECTORY'S WRITER (R-LIVE-DIR-01): reachable only through a service binding (`[[services]] ... entrypoint =
 * "LiveDirectoryWriter"` on every Versus Worker), never from the internet. Each content revision's rooms and live games
 * register here, so the list spans every revision.
 */
export class LiveDirectoryWriter extends WorkerEntrypoint<HubWorkerEnv> {
  async put(row: unknown): Promise<{ ok: true }> {
    return directoryOf(this.env).put(row);
  }
  async remove(gameIds: string[]): Promise<{ ok: true }> {
    return directoryOf(this.env).remove(Array.isArray(gameIds) ? gameIds.slice(0, 8) : []);
  }
}

export default {
  async fetch(req: Request, env: HubWorkerEnv): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    if (!originAllowed(origin, env.ALLOWED_ORIGINS)) return new Response('origin not allowed', { status: 403 });
    const headers: Record<string, string> = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
      new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'authorization' } });
    }
    if (url.pathname === HUB_HEALTH_PATH) return json(200, { hub: HUB_PROTOCOL, min: HUB_PROTOCOL_MIN, code: env.HUB_CODE ?? 'dev' });

    // ── LIVE GAMES (the directory) ──
    if (url.pathname === '/live/metrics') {
      return env.DEV_AUTH === '1' ? json(200, await directoryOf(env).metricsSnapshot()) : json(404, { error: 'not_found' });
    }
    const isList = url.pathname === LIVE_DIR_ROUTES.games;
    const isCount = url.pathname === LIVE_DIR_ROUTES.count;
    const isGame = url.pathname.startsWith(LIVE_DIR_ROUTES.game);
    if (isList || isCount || isGame) {
      if (req.method !== 'GET') return json(405, { error: 'bad_method' });
      const caller = await verifyCaller(bearerOf(req, VERSUS_CF_BEARER_PREFIX), env);
      if (!caller) return json(401, { error: 'not_signed_in' });
      // A guest sees the public games (a guest has no friends to see a friends-only room by).
      const reader = caller.anonymous ? null : caller.userId;
      const dir = directoryOf(env);
      const noStore = { 'Cache-Control': 'no-store' };
      if (isCount) return json(200, { count: await dir.count(reader) }, noStore);
      if (isList) return json(200, await dir.list(reader, Number(url.searchParams.get('page') ?? 0)), noStore);
      let id = '';
      try { id = decodeURIComponent(url.pathname.slice(LIVE_DIR_ROUTES.game.length)); } catch { /* bad escape */ }
      if (!/^[!-~]{1,80}$/.test(id)) return json(400, { error: 'bad_game' });
      return json(200, await dir.game(reader, id), noStore);
    }

    // ── THE FRIENDS HUB ──
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
