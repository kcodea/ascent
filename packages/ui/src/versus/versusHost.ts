/**
 * VERSUS CUTOVER: which backend hosts a room (owner decision 2026-10-28, docs/versus-cf-cutover.md).
 *
 * Live Versus moves from Supabase SQL functions to Cloudflare Durable Objects ONE MODE AT A TIME, with no downtime and an
 * instant rollback. Three rules carry that:
 *
 *   1. A per-mode switch decides where NEW rooms are created. It lives on the server (`versus_host_config()`,
 *      supabase/migrations/2026-11-05-versus-host-config.sql), so the owner flips a mode with one SQL update and no
 *      game build. The client reads it when it first needs it and keeps it for `HOST_CONFIG_TTL_MS`.
 *   2. A room keeps the host it was created on for its whole life. The client remembers the host of every room it
 *      touches (`rememberRoomHost`, kept across a reload), so a reconnect, an invite or a Watch goes to the right place
 *      whatever the switch says now. Rollback = flip the mode back: new rooms go to Supabase at once, Cloudflare rooms
 *      finish where they are.
 *   3. A build can only send a room to Cloudflare when it carries a Worker URL for its OWN content revision
 *      (`VITE_VERSUS_CF_URL`, set by `npm run release:web -- --versus-cf`). A build without one is Supabase-only,
 *      whatever the switch says, so flipping the switch can never strand a client whose Worker was never deployed.
 *
 * Room references that leave the client (friend invites, the Friends "Watch" id, a Live Games row) carry the host as a
 * prefix: `cf:<room id>` for a Cloudflare room, the bare id for a Supabase room (the format every older client and
 * every existing row already uses).
 */
import { VERSUS_MODES, type VersusMode } from '@game/sim';
import { contentRevision } from '@game/content';
import { versusCfLiveUrl } from './versusCfRemote';

export type VersusHost = 'supabase' | 'cf';
export type VersusHostConfig = Record<VersusMode, VersusHost>;

/** Everything on Supabase: the default, the fallback on any read failure, and what a build with no Worker uses. */
export const DEFAULT_HOST_CONFIG: Readonly<VersusHostConfig> = Object.freeze({ duel: 'supabase', group: 'supabase', duos: 'supabase', ranked_duos: 'supabase' });
/** How long a read of the switch is trusted. A flip reaches every client within this (plus its next room creation). */
export const HOST_CONFIG_TTL_MS = 30_000;

const isHost = (v: unknown): v is VersusHost => v === 'supabase' || v === 'cf';

/** The server's answer, cleaned: unknown modes ignored, anything but 'cf' / 'supabase' reads as Supabase. */
export function parseHostConfig(raw: unknown): VersusHostConfig {
  const out: VersusHostConfig = { ...DEFAULT_HOST_CONFIG };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const m of VERSUS_MODES) {
    const v = (raw as Record<string, unknown>)[m];
    if (isHost(v)) out[m] = v;
  }
  return out;
}

/**
 * The dev override (a dev build, or a browser with the Versus test tools on): `?versusRoute=duel:cf,group:supabase`
 * sets single modes (`?versusRoute=off` clears it), and the older `?versusHost=cf` / `cf-live` sends every mode to
 * Cloudflare. Answers the per-mode overrides, or null.
 */
export function parseRouteOverride(raw: string | null): Partial<VersusHostConfig> | null {
  if (!raw) return null;
  const out: Partial<VersusHostConfig> = {};
  for (const part of raw.split(',')) {
    const [mode, host] = part.split(':').map((s) => s.trim());
    if (mode === '*' && isHost(host)) { for (const m of VERSUS_MODES) out[m] = host; continue; }
    if ((VERSUS_MODES as readonly string[]).includes(mode) && isHost(host)) out[mode as VersusMode] = host;
  }
  return Object.keys(out).length ? out : null;
}

const ROUTE_KEY = 'ascent.versusRoute';
/** The dev tab's per-mode override (`?versusRoute=...`, kept for the tab), or null. Dev builds / Versus test tools only. */
export function devRouteOverride(): Partial<VersusHostConfig> | null {
  try {
    if (typeof window === 'undefined') return null;
    if (!(import.meta.env.DEV || localStorage.getItem('ascent.versus') === '1')) return null;
    const q = new URLSearchParams(window.location.search).get('versusRoute');
    if (q === 'off') sessionStorage.removeItem(ROUTE_KEY);
    else if (q && parseRouteOverride(q)) sessionStorage.setItem(ROUTE_KEY, q);
    return parseRouteOverride(sessionStorage.getItem(ROUTE_KEY));
  } catch {
    return null;
  }
}

/** Where a NEW room of this mode is created. No Worker in this build: always Supabase. */
export function hostForNewRoom(mode: VersusMode, config: VersusHostConfig, override: Partial<VersusHostConfig> | null, cfAvailable: boolean): VersusHost {
  if (!cfAvailable) return 'supabase';
  return override?.[mode] ?? config[mode] ?? 'supabase';
}

// ── room references (invites, Watch, Live Games) ─────────────────────────────────────────────────────────────

const CF_PREFIX = 'cf:';
/** A room id as it travels in an invite / presence / listing: `cf:<id>` for a Cloudflare room, the bare id otherwise. */
export const encodeRoomRef = (roomId: string, host: VersusHost): string => (host === 'cf' ? `${CF_PREFIX}${roomId}` : roomId);
/** The other way: a bare id is a Supabase room (every row written before the cutover). */
export function decodeRoomRef(ref: string): { roomId: string; host: VersusHost } {
  return ref.startsWith(CF_PREFIX) ? { roomId: ref.slice(CF_PREFIX.length), host: 'cf' } : { roomId: ref, host: 'supabase' };
}

// ── the Worker this build talks to ───────────────────────────────────────────────────────────────────────────

/**
 * The embedded Worker URL is trusted only when it is EXACTLY the Worker for this build's own engine. A pack built
 * against a different content revision (or a typo) leaves the build Supabase-only instead of sending players to a
 * Worker that would refuse every hello with `version_mismatch`.
 */
export function embeddedCfUrl(raw: string | undefined, rev: string = contentRevision()): string | null {
  const url = (raw ?? '').trim().replace(/\/$/, '');
  return url && url === versusCfLiveUrl(rev) ? url : null;
}

// ── the room → host memory (survives a reload) ───────────────────────────────────────────────────────────────

const HOSTS_KEY = 'ascent.versusRoomHosts';
const HOSTS_CAP = 24;

export interface RoomHostMemory {
  get(roomId: string): VersusHost | undefined;
  set(roomId: string, host: VersusHost): void;
}

/** Remembered room hosts. Only Cloudflare rooms are written to storage (a forgotten room reads as Supabase, which is
 *  what every pre-cutover room is); newest last, capped. */
export function makeRoomHostMemory(storage: Pick<Storage, 'getItem' | 'setItem'> | null): RoomHostMemory {
  const mem = new Map<string, VersusHost>();
  const load = (): string[] => {
    try {
      const v = JSON.parse(storage?.getItem(HOSTS_KEY) ?? '[]') as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };
  for (const id of load()) mem.set(id, 'cf');
  return {
    get: (roomId) => mem.get(roomId),
    set(roomId, host) {
      if (mem.get(roomId) === host) return;
      mem.set(roomId, host);
      try {
        const cf = load().filter((id) => id !== roomId);
        if (host === 'cf') cf.push(roomId);
        storage?.setItem(HOSTS_KEY, JSON.stringify(cf.slice(-HOSTS_CAP)));
      } catch { /* memory only */ }
    },
  };
}

// ── the switch, read and cached ──────────────────────────────────────────────────────────────────────────────

/** A cached reader of the switch. `fetch` failing (no migration yet, offline) reads as all Supabase for one TTL. */
export function makeHostConfigReader(fetch: () => Promise<unknown>, now: () => number = Date.now, ttlMs = HOST_CONFIG_TTL_MS) {
  let cached: { at: number; config: VersusHostConfig } | null = null;
  let flight: Promise<VersusHostConfig> | null = null;
  return {
    /** The last value read (no network): Supabase everywhere before the first read. */
    peek: (): VersusHostConfig => cached?.config ?? { ...DEFAULT_HOST_CONFIG },
    async get(): Promise<VersusHostConfig> {
      if (cached && now() - cached.at < ttlMs) return cached.config;
      flight ??= fetch()
        .then(parseHostConfig, () => ({ ...DEFAULT_HOST_CONFIG }))
        .then((config) => { cached = { at: now(), config }; return config; })
        .finally(() => { flight = null; });
      return flight;
    },
  };
}
