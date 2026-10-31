/**
 * THE POOL MIRROR (R-POOL-MIRROR-01; owner 2026-10-31: the ranked game runs on Cloudflare, Supabase is storage). One
 * Durable Object (`global`) on the friends hub holding a copy of the opponent pool exactly as the database serves it:
 *
 *   - every eligible run's index row (`pool_mirror_index`: what the draw filters on, with its content `rev`), and
 *   - every run's boards as the database's own jsonb text (`pool_mirror_boards`, which IS `pool_runs_boards`), with the
 *     rev of exactly those rows.
 *
 * The hub answers `POST /pool/keys` (the `pool_runs_sample_keys` draw, `core/poolPick.ts`, a port of `pool_runs__pick`)
 * and `POST /pool/boards` (`pool_runs_boards`) from it, so a lobby is seated with no Supabase read. The answers are
 * byte-for-byte what PostgREST would send for the same draw (`poolMirror.db.test.ts`), and a run's boards are served
 * only under the rev they were fetched with, so the client's per-run cache (R-EGRESS-05: keyed by run key + rev) and
 * the serving integrity bar (exact turn, exact recorded state) hold unchanged.
 *
 * SYNC (`sync`): the hub's cron calls it (`scheduled`, every 5 minutes), and a cold mirror syncs on its first read. One
 * `pool_mirror_version` call (a hash) when nothing changed; when it moved, the index, then the boards of only the runs
 * whose rev moved (100 a call). A run that left the eligible set is dropped. A sync that fails leaves the mirror as it
 * was: still a whole, consistent copy, just older. Until the first sync completes the mirror is `cold` and the hub
 * answers 503, which the client takes as "ask Supabase" (no seat is ever filled from a half-built mirror).
 */
import { DurableObject } from 'cloudflare:workers';
import type { MirrorRun, PickArgs } from './core/poolPick';
import { MIRROR_STALE_MS, PoolMirrorCore, poolSourceFor, type Held, type PoolSource } from './core/poolMirrorCore';
import type { HubStoreEnv } from './dmStore';

export { PoolMirrorCore, SupabasePoolSource, type PoolSource } from './core/poolMirrorCore';

export interface PoolMirrorEnv extends HubStoreEnv {
  DEV_AUTH?: string;
}

const RUN_PREFIX = 'run:';

export class PoolMirror extends DurableObject<PoolMirrorEnv> {
  private readonly core = new PoolMirrorCore();
  private loaded = false;
  private syncing: Promise<unknown> | null = null;
  private readonly source: PoolSource | null;

  constructor(ctx: DurableObjectState, env: PoolMirrorEnv) {
    super(ctx, env);
    this.source = poolSourceFor(env);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const meta = await this.ctx.storage.get<{ version: string; runs: MirrorRun[]; syncedAt: number }>('index');
    if (meta) {
      const held = await this.ctx.storage.list<Held>({ prefix: RUN_PREFIX });
      for (const [k, h] of held) this.core.held.set(Number(k.slice(RUN_PREFIX.length)), h);
      this.core.runs = meta.runs;
      this.core.version = meta.version;
      this.core.syncedAt = meta.syncedAt;
    }
    this.loaded = true;
  }

  /** Sync now (the cron, a cold read, the tests through `source` injection). One at a time. */
  async sync(): Promise<{ ok: boolean; changed?: number; dropped?: number; unchanged?: boolean; error?: string }> {
    await this.load();
    if (!this.source) return { ok: false, error: 'no_source' };
    if (this.syncing) { await this.syncing.catch(() => undefined); return { ok: true, unchanged: true }; }
    const run = this.core.sync(this.source, async (changed, dropped, runs, version) => {
      for (const [id, h] of changed) await this.ctx.storage.put(RUN_PREFIX + id, h);
      if (dropped.length) await this.ctx.storage.delete(dropped.map((id) => RUN_PREFIX + id));
      await this.ctx.storage.put('index', { version, runs, syncedAt: Date.now() });
    }, Date.now());
    this.syncing = run;
    try {
      return { ok: true, ...(await run) };
    } catch (e) {
      console.warn(JSON.stringify({ ev: 'pool_mirror_sync_failed', error: String(e) }));
      return { ok: false, error: String(e).slice(0, 200) };
    } finally {
      this.syncing = null;
    }
  }

  /** The keys answer, or null while the mirror is cold. */
  async keys(args: PickArgs): Promise<string | null> {
    await this.load();
    if (this.core.cold) { await this.sync(); if (this.core.cold) return null; }
    this.staleCheck();
    return this.core.keysJson(args ?? {}, Math.random);
  }

  /** The boards answer, or null while the mirror is cold (or a bad request: `bad`). */
  async boards(ids: unknown): Promise<string | 'bad' | null> {
    await this.load();
    if (this.core.cold) { await this.sync(); if (this.core.cold) return null; }
    return this.core.boardsJson(ids) ?? 'bad';
  }

  async metricsSnapshot(): Promise<Record<string, unknown>> {
    await this.load();
    return { ...this.core.metrics, runs: this.core.runs.length, held: this.core.held.size, version: this.core.version, syncedAt: this.core.syncedAt };
  }

  private staleCheck(): void {
    if (Date.now() - this.core.syncedAt > MIRROR_STALE_MS && !this.syncing) void this.sync();
  }
}
