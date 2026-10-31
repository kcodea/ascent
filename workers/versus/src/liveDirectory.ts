/**
 * THE LIVE DIRECTORY — one Durable Object on the friends hub Worker (`ascent-hub`, named `global`) that lists every live
 * game of every content revision (R-LIVE-DIR-01; wire: `liveDirProtocol.ts`, rules: `core/liveDirCore.ts`).
 *
 * WRITES come only from the Versus Workers, through the hub's `LiveDirectoryWriter` entrypoint (a service binding: the
 * public internet cannot call it). Each room and live lobby game writes when its listing changes plus a 2-minute
 * keep-alive (the same `LiveSlot` that wrote the Supabase row), so the directory sees a few small writes per game per
 * round, never per frame.
 *
 * RANKS are looked up here, once per player or team per `LIVE_DIR_META_TTL_MS`, through the hub's key-gated
 * `live_dir_meta` (the SQL listing used to read `profiles` and `duos_team_ranks` on every write). A lookup that fails
 * keeps the writer's own values (a lobby game's reported rank; a Ranked Duos room's team division).
 *
 * READS are the Live Games page (every 10 s while open), the menu glow (every 45 s while a menu is up) and a friend's
 * Watch: all answered from memory, with no Supabase read. A friends-only row needs the reader's friends: asked of the
 * reader's own FriendHub (which caches them for 2 minutes), and only when such a row is listed.
 *
 * COST: nothing ticks while the directory is empty; with rows up, one purge alarm when the next one runs out.
 */
import { DurableObject } from 'cloudflare:workers';
import { LiveDirCore, cleanPut, type DirEntry, type DirReader } from './core/liveDirCore';
import { LIVE_DIR_META_TTL_MS, type LiveDirPut, type LiveDirRank, type LiveDirRow } from './liveDirProtocol';
import type { HubStoreEnv } from './dmStore';

/** Where ranks and team names come from. */
export interface LiveMetaSource {
  ranks(users: string[], teams: string[]): Promise<{ users: Record<string, LiveDirRank>; teams: Record<string, LiveDirRank> }>;
}

/** The hub's key-gated rank lookup (`live_dir_meta`, supabase/migrations/2026-11-18-live-directory.sql). */
export class SupabaseLiveMeta implements LiveMetaSource {
  constructor(private readonly url: string, private readonly anonKey: string, private readonly secret: string) {}
  async ranks(users: string[], teams: string[]) {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/live_dir_meta`, {
      method: 'POST',
      headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: this.secret, p_users: users, p_teams: teams }),
    });
    if (!res.ok) throw new Error(`live_dir_meta ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { users?: Record<string, LiveDirRank>; teams?: Record<string, LiveDirRank> } | null;
    return { users: j?.users ?? {}, teams: j?.teams ?? {} };
  }
}

/** No Supabase (local dev, tests): the writers' own values stand. */
export class NoLiveMeta implements LiveMetaSource {
  async ranks() { return { users: {}, teams: {} }; }
}

export const liveMetaFor = (env: HubStoreEnv): LiveMetaSource =>
  env.PERSIST === '1' && env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.HUB_WRITER_SECRET
    ? new SupabaseLiveMeta(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, env.HUB_WRITER_SECRET)
    : new NoLiveMeta();

/** The longest a write waits for a rank lookup before it is listed with what it has. */
const META_WAIT_MS = 2_500;
const ROW_PREFIX = 'g:';

export interface LiveDirEnv extends HubStoreEnv {
  LIVE_DIR: DurableObjectNamespace<LiveDirectory>;
  /** The friends hubs (a reader's friends, for a friends-only row). */
  HUB: DurableObjectNamespace<{ friendsFor(userId: string): Promise<string[]> }>;
}

/** Counters for the DEV metrics route and the tests. */
export interface LiveDirMetrics {
  puts: number;
  removes: number;
  reads: number;
  metaLookups: number;
  friendLookups: number;
}

export class LiveDirectory extends DurableObject<LiveDirEnv> {
  private readonly core = new LiveDirCore();
  private loaded = false;
  private meta: LiveMetaSource;
  private readonly ranks = new Map<string, { rank: LiveDirRank; at: number }>();
  readonly metrics: LiveDirMetrics = { puts: 0, removes: 0, reads: 0, metaLookups: 0, friendLookups: 0 };

  constructor(ctx: DurableObjectState, env: LiveDirEnv) {
    super(ctx, env);
    this.meta = liveMetaFor(env);
  }

  /** Tests: a fake rank source. */
  setMetaForTests(m: LiveMetaSource): void { this.meta = m; }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const rows = await this.ctx.storage.list<DirEntry>({ prefix: ROW_PREFIX });
    for (const [k, e] of rows) this.core.entries.set(k.slice(ROW_PREFIX.length), e);
    this.loaded = true;
  }

  // ── writes (from the Versus Workers, through the hub's entrypoint) ──────────────────────────────────────────────

  /** The rank of the row's owner (or team), cached; null when it cannot be read (the writer's values stand). */
  private async rankFor(p: LiveDirPut, now: number): Promise<LiveDirRank | null> {
    const duo = p.mode === 'ranked_duos';
    if (duo && !p.team) return null;
    const key = duo ? `t:${p.team}` : `u:${p.user_id}`;
    const hit = this.ranks.get(key);
    if (hit && now - hit.at < LIVE_DIR_META_TTL_MS) return hit.rank;
    this.metrics.metaLookups++;
    try {
      const got = await Promise.race([
        this.meta.ranks(duo ? [] : [p.user_id], duo ? [p.team!] : []),
        new Promise<null>((r) => setTimeout(() => r(null), META_WAIT_MS)),
      ]);
      const rank = got ? (duo ? got.teams[p.team!] : got.users[p.user_id]) : undefined;
      if (rank) {
        const clean: LiveDirRank = {
          division: Math.max(0, Math.floor(Number(rank.division) || 0)), points: Math.max(0, Math.floor(Number(rank.points) || 0)),
          rating: Math.max(0, Math.floor(Number(rank.rating) || 0)), name: typeof rank.name === 'string' ? rank.name : null,
        };
        this.ranks.set(key, { rank: clean, at: now });
        if (this.ranks.size > 5_000) this.ranks.delete(this.ranks.keys().next().value as string);
        return clean;
      }
    } catch (e) {
      console.warn(JSON.stringify({ ev: 'live_dir_meta_failed', error: String(e) }));
    }
    return hit?.rank ?? null;
  }

  /** Register or refresh one live game. */
  async put(raw: unknown): Promise<{ ok: true }> {
    await this.load();
    const p = cleanPut(raw);
    const now = Date.now();
    const rank = await this.rankFor(p, now);
    const removed = this.core.put(p, rank, now);
    this.metrics.puts++;
    const entry = this.core.entries.get(p.game_id)!;
    await this.ctx.storage.put(ROW_PREFIX + p.game_id, entry);
    if (removed.length) await this.ctx.storage.delete(removed.map((id) => ROW_PREFIX + id));
    await this.arm();
    return { ok: true };
  }

  /** A game ended (or its room closed): its row (and any listed alongside it) goes. */
  async remove(gameIds: string[]): Promise<{ ok: true }> {
    await this.load();
    const gone = gameIds.filter((id) => typeof id === 'string' && this.core.remove(id));
    this.metrics.removes++;
    if (gone.length) await this.ctx.storage.delete(gone.map((id) => ROW_PREFIX + id));
    return { ok: true };
  }

  // ── reads (from players, through the hub Worker's HTTP routes) ───────────────────────────────────────────────────

  private async readerOf(userId: string | null, now: number): Promise<DirReader> {
    if (!userId || !this.core.needsFriends(userId, now)) return { userId };
    this.metrics.friendLookups++;
    try {
      const hub = this.env.HUB.get(this.env.HUB.idFromName(`hub:${userId.toLowerCase()}`));
      return { userId, friends: new Set(await hub.friendsFor(userId)) };
    } catch {
      return { userId, friends: null };
    }
  }

  async list(userId: string | null, page: number): Promise<LiveDirRow[]> {
    await this.load();
    const now = Date.now();
    this.metrics.reads++;
    return this.core.list(await this.readerOf(userId, now), page, now);
  }

  async count(userId: string | null): Promise<number> {
    await this.load();
    const now = Date.now();
    this.metrics.reads++;
    // The glow never asks for friends: a friends-only room counts only for its host (the page itself shows the rest).
    return this.core.count({ userId }, now);
  }

  async game(userId: string | null, gameId: string): Promise<LiveDirRow | null> {
    await this.load();
    const now = Date.now();
    this.metrics.reads++;
    return this.core.game(gameId, await this.readerOf(userId, now), now);
  }

  async metricsSnapshot(): Promise<LiveDirMetrics & { rows: number }> {
    await this.load();
    return { ...this.metrics, rows: this.core.entries.size };
  }

  // ── time ────────────────────────────────────────────────────────────────────────────────────────────────────────

  async alarm(): Promise<void> {
    await this.load();
    const gone = this.core.purge(Date.now());
    if (gone.length) await this.ctx.storage.delete(gone.map((id) => ROW_PREFIX + id));
    await this.arm();
  }

  private async arm(): Promise<void> {
    const next = this.core.nextExpiry();
    if (next == null) return;
    const cur = await this.ctx.storage.getAlarm();
    if (cur == null || cur > next + 1_000 || cur < Date.now()) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, next + 1_000));
  }
}
