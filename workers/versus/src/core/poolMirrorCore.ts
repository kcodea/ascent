/**
 * THE POOL MIRROR — its state and answers, apart from the Durable Object (`poolMirror.ts`), so the tests drive it with a
 * fake source (R-POOL-MIRROR-01). See `poolMirror.ts` for what it is and why.
 */
import { boardsRowJson, keyRowJson, pickRuns, type MirrorRun, type PickArgs } from './poolPick';
import type { HubStoreEnv } from '../dmStore';

export interface Held { rev: string; boards: string }

/** Where the mirror reads Supabase (a fake in the tests). */
export interface PoolSource {
  version(): Promise<string>;
  index(): Promise<MirrorRun[]>;
  boards(ids: number[]): Promise<{ run_id: number; run_key: string; rev: string; boards: string }[]>;
}

export class SupabasePoolSource implements PoolSource {
  constructor(private readonly url: string, private readonly anonKey: string, private readonly secret: string) {}
  private async rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: this.secret, ...body }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${fn} ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  }
  version(): Promise<string> { return this.rpc<string>('pool_mirror_version', {}); }
  async index(): Promise<MirrorRun[]> {
    const rows = await this.rpc<MirrorRun[]>('pool_mirror_index', {});
    return rows.map((r) => ({ ...r, run_id: Number(r.run_id) }));
  }
  async boards(ids: number[]) {
    const rows = await this.rpc<{ run_id: number; run_key: string; rev: string; boards: string }[]>('pool_mirror_boards', { p_ids: ids });
    return rows.map((r) => ({ ...r, run_id: Number(r.run_id) }));
  }
}

export const poolSourceFor = (env: HubStoreEnv): PoolSource | null =>
  env.PERSIST === '1' && env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.HUB_WRITER_SECRET
    ? new SupabasePoolSource(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, env.HUB_WRITER_SECRET)
    : null;

/** Boards fetched per call (the SQL caps a call at 300). */
export const MIRROR_BOARDS_CHUNK = 100;
/** A read finding the mirror older than this triggers a sync in the background. */
export const MIRROR_STALE_MS = 10 * 60_000;

/**
 * The mirror's state and answers, apart from the Durable Object (the tests drive it directly with a fake source and a
 * memory store).
 */
export class PoolMirrorCore {
  runs: MirrorRun[] = [];
  held = new Map<number, Held>();
  version: string | null = null;
  syncedAt = 0;
  metrics = { syncs: 0, unchanged: 0, fetchedRuns: 0, keys: 0, boards: 0, failures: 0, lastError: '' };

  /** Bring the mirror up to date. Returns what changed. Never leaves a partial copy: the new index is adopted only once
   *  every changed run's boards are in hand. */
  async sync(src: PoolSource, store: (changed: Map<number, Held>, dropped: number[], runs: MirrorRun[], version: string) => Promise<void>, now: number): Promise<{ changed: number; dropped: number; unchanged: boolean }> {
    this.metrics.syncs += 1;
    try {
      const version = await src.version();
      if (version === this.version) { this.syncedAt = now; this.metrics.unchanged += 1; return { changed: 0, dropped: 0, unchanged: true }; }
      const index = await src.index();
      const want = index.filter((r) => this.held.get(r.run_id)?.rev !== r.rev).map((r) => r.run_id);
      const changed = new Map<number, Held>();
      for (let i = 0; i < want.length; i += MIRROR_BOARDS_CHUNK) {
        for (const b of await src.boards(want.slice(i, i + MIRROR_BOARDS_CHUNK))) changed.set(b.run_id, { rev: b.rev, boards: b.boards });
      }
      const live = new Set(index.map((r) => r.run_id));
      const dropped = [...this.held.keys()].filter((id) => !live.has(id));
      // A run whose boards moved again between the index and the boards read keeps the boards' own rev (the rev that
      // truly describes the text held); the next sync catches the index up.
      await store(changed, dropped, index, version);
      for (const [id, h] of changed) this.held.set(id, h);
      for (const id of dropped) this.held.delete(id);
      this.runs = index;
      this.version = version;
      this.syncedAt = now;
      this.metrics.fetchedRuns += changed.size;
      return { changed: changed.size, dropped: dropped.length, unchanged: false };
    } catch (e) {
      this.metrics.failures += 1;
      this.metrics.lastError = String(e).slice(0, 200);
      throw e;
    }
  }

  get cold(): boolean { return this.version == null; }

  /** `pool_runs_sample_keys`, as PostgREST's JSON body. Only runs whose boards are held are drawn. */
  keysJson(args: PickArgs, random: () => number): string {
    this.metrics.keys += 1;
    const servable = this.runs.filter((r) => this.held.has(r.run_id));
    const byId = new Map(servable.map((r) => [r.run_id, r]));
    const ids = pickRuns(servable, args, random);
    return `[${ids.map((id) => keyRowJson(byId.get(id)!, this.held.get(id)!.rev)).join(',')}]`;
  }

  /** `pool_runs_boards`, as PostgREST's JSON body (distinct ids, ordered by id, unknown ids left out). */
  boardsJson(ids: unknown): string | null {
    if (!Array.isArray(ids) || ids.length > 300) return null;
    this.metrics.boards += 1;
    const byId = new Map(this.runs.map((r) => [r.run_id, r]));
    const uniq = [...new Set(ids.map((x) => Number(x)).filter((x) => Number.isSafeInteger(x)))].sort((a, b) => a - b);
    const out: string[] = [];
    for (const id of uniq) {
      const r = byId.get(id);
      const h = this.held.get(id);
      if (r && h) out.push(boardsRowJson(id, r.run_key, h.rev, h.boards));
    }
    return `[${out.join(',')}]`;
  }
}

