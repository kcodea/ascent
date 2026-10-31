/**
 * THE GAME SESSION, the client's transport (R-SESSION-CF-01; owner 2026-10-31: "Is it possible to just have ranked solos
 * run on cloudflare too so that we aren't read writing in real time? Can we offload that to cloudflare" → "Do it").
 *
 * A lobby / Practice game started while the hub's switch is on (`GET /session/config`, read once at boot) is a SESSION
 * game for its whole life (the choice is kept per game id, so a reload never moves a game between paths). For a session
 * game, everything that used to go to Supabase during and at the end of the game goes to its Durable Object on the hub
 * instead (`workers/versus/src/session.ts`), which writes Supabase once, when it is due:
 *
 *   - the live socket (spectating, the listing, chat, pings) goes to `/session/<game>/ws` (`livePublisher.ts`);
 *   - the per-round cloud save goes to `save` (`cloudSaveRemote.ts` via `sessionCloudSaveApi`), the end's row removal to
 *     `clear`;
 *   - the table (opponent keys + seat recordings) is pinned once at the start (`gameSession.ts`);
 *   - the run-end outbox items go to `write`, the rank request to `rate` (`remoteBoards.ts`, `rank/rankSubmission.ts`).
 *
 * The opponent pool is read from the hub's mirror (`poolKeys` / `poolBoards`) whenever the switch is on, for every game.
 *
 * NO DATA LOSS: every call here answers `null` when the hub cannot be reached (or refuses for a reason only the old path
 * can fix), and every caller then does exactly what it did before this change (Supabase direct, the durable outbox, the
 * rank queue's own retry). The game itself never waits on the session.
 */
import { SESSION_PROTOCOL, SESSION_ROUTES, sessionPath, sessionSocketPath, type SessionOp } from '@game/versus-cf/session';
import { friendsHubUrl } from '../friends/dm/hubUrl';
import { hubToken } from '../friends/dm/hubToken';

export { SESSION_LIVE_HOST, sessionSocketPath } from '@game/versus-cf/session';

/** The longest a session call may take before the caller falls back to the old path. */
export const SESSION_CALL_TIMEOUT_MS = 8_000;
/** The boot read of the switch: an answer later than this counts as off for the games that start meanwhile. */
export const SESSION_CONFIG_TIMEOUT_MS = 4_000;

const DECISIONS_KEY = 'ascent.session.games';
const OVERRIDE_KEY = 'ascent.session';
const MAX_DECISIONS = 40;

export interface SessionAccess {
  base: () => string | null;
  token: (base: string) => Promise<string>;
  fetch: (url: string, init: { method?: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; keepalive?: boolean }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
}
const defaultAccess: SessionAccess = {
  base: friendsHubUrl,
  token: hubToken,
  fetch: (url, init) => fetch(url, init),
};
let access: SessionAccess = defaultAccess;
/** Tests: where the hub is and how it is reached. */
export function setSessionAccessForTests(a: SessionAccess | null): void { access = a ?? defaultAccess; enabled = null; configP = null; }

// ── The switch ─────────────────────────────────────────────────────────────────────────────────────────────────────

let enabled: boolean | null = null;
let configP: Promise<boolean> | null = null;

/** A tester's override (`?session=on|off`, dev builds or with the Versus test tools on), or null. */
function override(): boolean | null {
  try {
    if (typeof window === 'undefined') return null;
    if (!(import.meta.env.DEV || localStorage.getItem('ascent.versus') === '1')) return null;
    const q = new URLSearchParams(window.location.search).get('session');
    if (q === 'on' || q === 'off') sessionStorage.setItem(OVERRIDE_KEY, q);
    if (q === 'clear') sessionStorage.removeItem(OVERRIDE_KEY);
    const v = sessionStorage.getItem(OVERRIDE_KEY);
    return v === 'on' ? true : v === 'off' ? false : null;
  } catch {
    return null;
  }
}

/** Read the switch (once per page). Resolves false when the hub does not answer in time. */
export function prefetchSessionConfig(): Promise<boolean> {
  if (configP) return configP;
  const forced = override();
  if (forced !== null) { enabled = forced; return (configP = Promise.resolve(forced)); }
  const base = access.base();
  if (!base) { enabled = false; return (configP = Promise.resolve(false)); }
  configP = (async () => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), SESSION_CONFIG_TIMEOUT_MS);
    try {
      const res = await access.fetch(`${base}${SESSION_ROUTES.config}`, { headers: {}, ...(ctl ? { signal: ctl.signal } : {}) });
      if (!res.ok) return (enabled = false);
      const body = JSON.parse(await res.text()) as { enabled?: unknown; protocol?: unknown };
      return (enabled = body.enabled === true && body.protocol === SESSION_PROTOCOL);
    } catch {
      return (enabled = false);
    } finally {
      clearTimeout(timer);
    }
  })();
  return configP;
}

/** The switch as known right now (false until the boot read answered). */
export const sessionSwitchOn = (): boolean => enabled === true;

// ── Which games are session games ──────────────────────────────────────────────────────────────────────────────────

function readDecisions(): Record<string, 0 | 1> {
  try { return JSON.parse(localStorage.getItem(DECISIONS_KEY) ?? '{}') as Record<string, 0 | 1>; } catch { return {}; }
}
function writeDecisions(d: Record<string, 0 | 1>): void {
  try {
    const keys = Object.keys(d);
    const kept = keys.length > MAX_DECISIONS ? Object.fromEntries(keys.slice(-MAX_DECISIONS).map((k) => [k, d[k]!])) : d;
    localStorage.setItem(DECISIONS_KEY, JSON.stringify(kept));
  } catch { /* storage refused: the decision lives for this page only */ }
}
const memory = new Map<string, boolean>();

/**
 * Is this game a session game? Decided the FIRST time it is asked (from the switch as known then) and kept for the game's
 * life, across reloads: a game never moves between the session and the old path.
 */
export function sessionGame(gameId: string): boolean {
  const hit = memory.get(gameId);
  if (hit !== undefined) return hit;
  const stored = readDecisions()[gameId];
  const yes = stored !== undefined ? stored === 1 : sessionSwitchOn() && !!access.base();
  memory.set(gameId, yes);
  if (stored === undefined) writeDecisions({ ...readDecisions(), [gameId]: yes ? 1 : 0 });
  return yes;
}
/** Is the game already known to be a session game (never decides)? */
export const knownSessionGame = (gameId: string): boolean => memory.get(gameId) ?? readDecisions()[gameId] === 1;

/** The session game of the most recent game (set by `gameSession.ts`): the run-end writes belong to it until the next
 *  game starts. */
let lastGame: string | null = null;
export function noteSessionGame(gameId: string | null): void { lastGame = gameId; }
export const lastSessionGame = (): string | null => lastGame;

/** The game the save slot's run belongs to (registered by `gameSession.ts`), so the cloud save finds its session. */
const byRunKey = new Map<string, string>();
export function linkRunKey(runKey: string, gameId: string): void { byRunKey.set(runKey, gameId); }
export function sessionGameForRunKey(runKey: string): string | null {
  const g = byRunKey.get(runKey);
  return g && knownSessionGame(g) ? g : null;
}

/** The hub's base URL for a session game's live socket, and its path. */
export function sessionLiveTarget(gameId: string): { url: string; path: string } | null {
  const base = access.base();
  return base ? { url: base, path: sessionSocketPath(gameId) } : null;
}

// ── Calls ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SessionAnswer<T = unknown> { status: number; body: T }

async function call<T>(path: string, method: 'GET' | 'POST', body: unknown, opts: { timeoutMs?: number; keepalive?: boolean } = {}): Promise<SessionAnswer<T> | null> {
  const base = access.base();
  if (!base) return null;
  let token: string;
  try { token = await access.token(base); } catch { return null; }
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), opts.timeoutMs ?? SESSION_CALL_TIMEOUT_MS);
  try {
    const res = await access.fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(ctl ? { signal: ctl.signal } : {}),
      ...(opts.keepalive ? { keepalive: true } : {}),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    return { status: res.status, body: parsed as T };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One session op. `null`: the hub could not be reached (the caller takes the old path). */
export function sessionCall<T = unknown>(gameId: string, op: SessionOp, body?: Record<string, unknown>, opts?: { timeoutMs?: number; keepalive?: boolean }): Promise<SessionAnswer<T> | null> {
  return call<T>(sessionPath(gameId, op), body === undefined ? 'GET' : 'POST', body === undefined ? undefined : { protocol: SESSION_PROTOCOL, ...body }, opts);
}

/** The pool mirror's answers, shaped like the Supabase RPC results the pool code already handles. A miss (cold mirror,
 *  unreachable hub) is an ERROR with code `mirror_unavailable`, which the caller answers by asking Supabase. */
export async function mirrorRpc<T>(which: 'keys' | 'boards', args: Record<string, unknown>): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  const path = which === 'keys' ? SESSION_ROUTES.poolKeys : SESSION_ROUTES.poolBoards;
  const a = await call<T>(path, 'POST', args, { timeoutMs: which === 'keys' ? 6_000 : 20_000 });
  if (!a || a.status !== 200 || !Array.isArray(a.body)) return { data: null, error: { code: 'mirror_unavailable', message: `pool mirror ${a?.status ?? 'unreachable'}` } };
  return { data: a.body, error: null };
}
