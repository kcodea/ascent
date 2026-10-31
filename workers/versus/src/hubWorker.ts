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
 *   GET /session/config      THE GAME SESSION (R-SESSION-CF-01): `{ enabled, protocol }`, the cutover switch (no auth)
 *   GET /session/<game>/ws   a session-hosted game's live socket (the live game protocol; `live_host = 'session'`)
 *   * /session/<game>/<op>  the game's session: save, park, table, write, rate, clear, seats, state (`session.ts`)
 *   POST /pool/keys          THE POOL MIRROR (R-POOL-MIRROR-01): the `pool_runs_sample_keys` draw, from the mirror
 *   POST /pool/boards        `pool_runs_boards`, from the mirror (503 while the mirror is cold: the client asks Supabase)
 *
 * The cron (`scheduled`, every 5 minutes) keeps the pool mirror in step with Supabase.
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
import { GameSession, SESSION_OP_HEADER, type SessionEnv } from './session';
import { PoolMirror } from './poolMirror';
import { SESSION_GAME_ID, SESSION_PROTOCOL, SESSION_ROUTES } from './sessionProtocol';
import { LIVE_GAME_HEADER, LIVE_USER_HEADER } from './liveHost';
import { GUEST_HEADER } from './lobbyChat';

export { FriendHub, LiveDirectory, GameSession, PoolMirror };

export interface HubWorkerEnv extends HubEnv, LiveDirEnv, AuthEnv, SessionEnv {
  HUB: DurableObjectNamespace<FriendHub>;
  /** One object per lobby / Practice game (R-SESSION-CF-01). */
  SESSION: DurableObjectNamespace<GameSession>;
  /** The pool mirror (`global`, R-POOL-MIRROR-01). */
  POOL: DurableObjectNamespace<PoolMirror>;
  /** THE SESSION SWITCH: "on" = new games use the session (clients read it at `/session/config`). Anything else = off. */
  SESSION_MODE?: string;
  ALLOWED_ORIGINS?: string;
  /** The hub's source hash, set by `scripts/deploy-hub.ts` (a redeploy is skipped when it is unchanged). */
  HUB_CODE?: string;
}

const SESSION_PATH = /^\/session\/([^/]{1,240})\/(ws|save|park|table|write|rate|clear|seats|state|metrics)$/;
const poolOf = (env: HubWorkerEnv): PoolMirror => env.POOL.get(env.POOL.idFromName('global')) as unknown as PoolMirror;

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
      return new Response(null, { headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
    }
    if (url.pathname === HUB_HEALTH_PATH) return json(200, { hub: HUB_PROTOCOL, min: HUB_PROTOCOL_MIN, code: env.HUB_CODE ?? 'dev' });

    // ── LIVE GAMES (the directory) ──
    // ── THE GAME SESSION + THE POOL MIRROR (R-SESSION-CF-01, R-POOL-MIRROR-01) ──
    if (url.pathname === SESSION_ROUTES.config) {
      return json(200, { enabled: env.SESSION_MODE === 'on', protocol: SESSION_PROTOCOL }, { 'Cache-Control': 'no-store' });
    }
    if (url.pathname === SESSION_ROUTES.poolMetrics) {
      return env.DEV_AUTH === '1' ? json(200, await poolOf(env).metricsSnapshot()) : json(404, { error: 'not_found' });
    }
    if (url.pathname === SESSION_ROUTES.poolKeys || url.pathname === SESSION_ROUTES.poolBoards) {
      if (req.method !== 'POST') return json(405, { error: 'bad_method' });
      const caller = await verifyCaller(bearerOf(req, VERSUS_CF_BEARER_PREFIX), env);
      if (!caller) return json(401, { error: 'not_signed_in' });
      let body: Record<string, unknown>;
      try { body = (await req.json()) as Record<string, unknown>; } catch { return json(400, { error: 'bad_body' }); }
      const pool = poolOf(env);
      const out = url.pathname === SESSION_ROUTES.poolKeys ? await pool.keys(body) : await pool.boards(body.ids);
      if (out === 'bad') return json(400, { error: 'bad_ids' });
      if (out == null) return json(503, { error: 'mirror_cold' });
      return new Response(out, { status: 200, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    const sm = SESSION_PATH.exec(url.pathname);
    if (sm) {
      let gameId = '';
      try { gameId = decodeURIComponent(sm[1]!); } catch { /* bad escape */ }
      if (!SESSION_GAME_ID.test(gameId)) return json(400, { error: 'bad_game' });
      const op = sm[2]!;
      const stub = env.SESSION.get(env.SESSION.idFromName(`session:${gameId}`));
      if (op === 'metrics' && env.DEV_AUTH !== '1') return json(404, { error: 'not_found' });
      const caller = op === 'metrics' ? null : await verifyCaller(bearerOf(req, VERSUS_CF_BEARER_PREFIX), env);
      if (!caller && op !== 'metrics') return op === 'ws' ? new Response('unauthorized', { status: 401 }) : json(401, { error: 'not_signed_in' });
      const fwd = new Headers(req.headers);
      fwd.set(LIVE_GAME_HEADER, gameId);
      fwd.delete(LIVE_USER_HEADER);
      if (caller) fwd.set(LIVE_USER_HEADER, caller.userId);
      fwd.set(GUEST_HEADER, caller?.anonymous ? '1' : '0'); // always set: a client's own header never survives
      if (op !== 'ws') fwd.set(SESSION_OP_HEADER, op); else fwd.delete(SESSION_OP_HEADER);
      const res = await stub.fetch(new Request(req, { headers: fwd }));
      if (op === 'ws') return res;
      // CORS on the object's answer (it is made inside the object, which never sees the Origin rules).
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
      out.headers.set('Cache-Control', 'no-store');
      return out;
    }

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

  /** The cron (`hub.wrangler.toml` [triggers]): keep the pool mirror in step with Supabase. */
  async scheduled(_event: unknown, env: HubWorkerEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(poolOf(env).sync().then((r) => { if (!r.ok && r.error !== 'no_source') console.warn(JSON.stringify({ ev: 'pool_mirror_cron', ...r })); }));
  },
};
