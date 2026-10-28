import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from '@game/core';

/**
 * POOL WORK OFF THE UPLOAD (R-LOBBY-POOL-JOB-01, 2026-10-28; supabase/migrations/2026-11-07-pool-refresh-off-upload.sql).
 * Snapshot serving integrity is an owner bar ("snapshots served on exactly the right turn with exact recorded state"),
 * so this runs TWO databases side by side: OLD = the whole pool chain as production runs it today (in-upload triggers),
 * NEW = the same chain plus the job migration. The same uploads, re-uploads, backfill updates and deletes go into both
 * (NEW runs `pool_refresh_dirty()` after each, as pg_cron would), and after every step the two must agree EXACTLY:
 * every `pool_runs` row (ids included, so a seeded draw picks the same runs), every `pool_runs_sample` answer for many
 * seeds / bands / weights / caps (the boards served), and both histograms. Then: an upload no longer touches
 * `pool_runs`; a batch of uploads drained by one job lands the same runs and the same strengths a full refresh gives;
 * a failing job keeps its keys and logs to `ops.events`; the enqueue does not swallow errors; the sample keeps its
 * 16 MB work_mem; clients can reach the RPCs and nothing else new.
 */
const root = join(__dirname, '../../../..');
const CHAIN = [
  '2026-09-29-pool-whole-runs.sql', '2026-09-30-board-strength.sql', '2026-09-30-weighted-strength.sql',
  '2026-10-03-final-board-strength.sql', '2026-10-06-weighted-strength-again.sql', '2026-10-06-early-late-strength.sql',
  '2026-10-09-strength-overall-caps.sql', '2026-10-17-pool-empty-boards.sql',
].map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8'));
const JOB = readFileSync(join(root, 'supabase/migrations/2026-11-07-pool-refresh-off-upload.sql'), 'utf8');

const STUB = `
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key);
  create table public.boards (
    id uuid primary key default gen_random_uuid(), patch text not null, wave int not null, hero_id text not null,
    power int not null, rating real, origin text, author text, tribes text[], captured_at date, seed bigint,
    snapshot jsonb not null, created_at timestamptz default now(), user_id uuid, unrated boolean not null default false);
  alter table public.boards enable row level security;
  create policy "read boards" on public.boards for select using (true);
  grant usage on schema public to anon, authenticated;
  grant select on public.boards to anon, authenticated;
`;

async function makeDb(withJob: boolean): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STUB);
  for (const sql of CHAIN) await db.exec(sql);
  if (withJob) await db.exec(JOB);
  return db;
}

// ── A deterministic workload: runs of varied shape, scored and unscored boards, re-uploads, a backfill, deletes ──
interface Board { wave: number; empty: boolean; raw: number | null; refWave: number; tier: number }
interface Run { author: string; hero: string; seed: number; user: string; boards: Board[] }
type Op = { kind: 'upload'; run: Run; boards: Board[] } | { kind: 'backfill'; run: Run } | { kind: 'delete'; run: Run; waves?: number[] };

const uuid = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

function workload(seed: number): Op[] {
  const rng = makeRng(seed);
  const heroes = ['h_aria', 'h_bram', 'h_cole', 'h_dina'];
  const runs: Run[] = [];
  for (let i = 0; i < 26; i++) {
    const len = 3 + rng.int(12);
    const gap = rng.int(5) === 0 ? 2 + rng.int(len - 1) : -1; // some runs miss a round (never eligible if early)
    const boards: Board[] = [];
    for (let w = 1; w <= len; w++) {
      if (w === gap) continue;
      boards.push({
        wave: w, empty: w === 1 && rng.int(6) === 0, raw: rng.int(4) === 0 ? null : Math.round(rng.next() * 400) / 4,
        refWave: Math.min(w, 9), tier: rng.int(9) === 0 ? 6 : Math.min(6, 1 + Math.floor(w / 3)),
      });
    }
    runs.push({ author: `p${rng.int(7)}`, hero: rng.pick(heroes), seed: 1000 + i, user: uuid(1 + rng.int(7)), boards });
  }
  const ops: Op[] = [];
  for (const r of runs) {
    // Most runs arrive whole; some arrive in two statements (an earlier partial upload, then the rest).
    if (rng.int(4) === 0 && r.boards.length > 2) {
      const cut = 1 + rng.int(r.boards.length - 1);
      ops.push({ kind: 'upload', run: r, boards: r.boards.slice(0, cut) });
      ops.push({ kind: 'upload', run: r, boards: r.boards.slice(cut) });
    } else ops.push({ kind: 'upload', run: r, boards: r.boards });
  }
  ops.push({ kind: 'backfill', run: runs[3]! }, { kind: 'backfill', run: runs[11]! });
  ops.push({ kind: 'delete', run: runs[5]! }, { kind: 'delete', run: runs[8]!, waves: [1] });
  ops.push({ kind: 'upload', run: runs[5]!, boards: runs[5]!.boards }); // a deleted run uploaded again
  return ops;
}

let boardSeq = 0;
/** Apply one op exactly as the client / backfill would: ONE statement. Board ids and times are fixed per board so the
 *  two databases hold byte-identical rows. */
async function apply(db: PGlite, op: Op, ids: Map<string, number>): Promise<void> {
  const r = op.run;
  const idOf = (b: Board): number => {
    const k = `${r.author}|${r.hero}|${r.seed}|${b.wave}`;
    if (!ids.has(k)) ids.set(k, ++boardSeq);
    return ids.get(k)!;
  };
  if (op.kind === 'upload') {
    const values: string[] = [];
    const params: unknown[] = [];
    for (const b of op.boards) {
      const snap = { v: 1, wave: b.wave, heroId: r.hero, resolve: 30, tier: b.tier, triples: 0, tribes: [], threat: 'glass', power: b.wave, seed: r.seed, origin: 'self', author: r.author, setId: 'set2',
        minions: b.empty ? [] : [{ cardId: 'pack', attack: b.wave, health: b.wave, keywords: [], golden: false }] };
      const id = idOf(b);
      const k = params.length;
      params.push(uuid(900000 + id), '0.1.0+abc', b.wave, r.hero, r.author, r.seed, JSON.stringify(snap), r.user,
        b.empty ? null : b.raw, b.empty || b.raw === null ? null : 'set2-v1', b.empty || b.raw === null ? null : b.refWave,
        new Date(Date.UTC(2026, 9, 1) + id * 1000).toISOString());
      values.push(`($${k + 1}::uuid, $${k + 2}, $${k + 3}, $${k + 4}, 1, $${k + 5}, $${k + 6}, $${k + 7}::jsonb, $${k + 8}::uuid, $${k + 9}::numeric, $${k + 10}, $${k + 11}::smallint, $${k + 12}::timestamptz)`);
    }
    if (!values.length) return;
    await db.query(`insert into public.boards (id, patch, wave, hero_id, power, author, seed, snapshot, user_id, strength_raw, strength_ref, strength_wave, created_at) values ${values.join(', ')}`, params);
  } else if (op.kind === 'backfill') {
    // The 2026-09-30 backfill shape: score the run's unscored, non-empty boards in one UPDATE.
    await db.query(`update public.boards set strength_raw = 50 + wave, strength_ref = 'set2-v1', strength_wave = least(wave, 9)
                    where author = $1 and hero_id = $2 and seed = $3 and strength_raw is null and jsonb_array_length(snapshot -> 'minions') > 0`, [r.author, r.hero, r.seed]);
  } else {
    await db.query(`delete from public.boards where author = $1 and hero_id = $2 and seed = $3 ${op.waves ? 'and wave = any($4)' : ''}`,
      op.waves ? [r.author, r.hero, r.seed, op.waves] : [r.author, r.hero, r.seed]);
  }
}

const POOL_COLS = `id, author, hero_id, seed, user_id, set_id, patch_prefix, boards, wave_count, first_wave, last_wave, max_gap, tiers_ok, eligible,
  strength::text, strength_avg::text, strength_early::text, strength_late::text, strength_early_avg::text, strength_late_avg::text, pool_id`;
const poolRows = async (db: PGlite, byKey = false): Promise<unknown[]> =>
  (await db.query(`select ${byKey ? POOL_COLS.replace(/^id, /, '') : POOL_COLS} from public.pool_runs order by author, hero_id, seed`)).rows;

/** Every sample shape the client sends (bands, early weights, caps) at several seeds, in full: run keys + boards. */
async function samples(db: PGlite): Promise<string> {
  const out: unknown[] = [];
  const shapes: [number | null, number | null, number | null, number | null][] = [
    [null, null, null, null], [0, 40, null, null], [10, 30, 0.8, null], [10, 50, 0.6, 40], [30, 100, 0.2, null], [null, null, null, 40],
  ];
  for (const seed of ['a', 'b', 'c', 'd']) {
    for (const [min, max, weight, cap] of shapes) {
      for (const limit of [5, 150]) {
        const rows = (await db.query('select run_key, author, user_id, wave_count, strength::text, strength_early::text, strength_late::text, boards from public.pool_runs_sample(p_limit => $1, p_set => $2, p_patch_prefix => $3, p_exclude_user => $4::uuid, p_seed => $5, p_strength_min => $6, p_strength_max => $7, p_early_weight => $8, p_strength_cap => $9)',
          [limit, 'set2', '0.1.0+', seed === 'd' ? uuid(2) : null, seed, min, max, weight, cap])).rows;
        out.push({ seed, min, max, weight, cap, limit, rows });
      }
    }
  }
  return JSON.stringify(out);
}

const histograms = async (db: PGlite): Promise<string> => JSON.stringify([
  (await db.query('select wave, raw::text, n from public.board_strength_histogram($1)', ['set2-v1'])).rows,
  (await db.query('select wave, raw::text, n from public.board_strength_histogram($1)', ['nope'])).rows,
  (await db.query('select avg::text, n from public.run_strength_histogram($1)', ['set2'])).rows,
]);
const one = async <T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0]!;

describe('the job leaves the pool exactly as the in-upload triggers did', () => {
  let oldDb: PGlite;
  let newDb: PGlite;
  beforeAll(async () => { [oldDb, newDb] = await Promise.all([makeDb(false), makeDb(true)]); }, 120_000);
  afterAll(async () => { await oldDb?.close(); await newDb?.close(); });

  it('after every upload / re-upload / backfill / delete: same pool_runs rows (ids too), same samples, same histograms', async () => {
    const ops = workload(20261028);
    const ids = new Map<string, number>(); // one board id per board key, shared, so both databases hold the same rows
    let step = 0;
    for (const op of ops) {
      await apply(oldDb, op, ids);
      await apply(newDb, op, ids);
      await newDb.query('select public.pool_refresh_dirty()'); // pg_cron's next tick
      expect(await poolRows(newDb), `step ${step} ${op.kind}`).toEqual(await poolRows(oldDb));
      expect(await histograms(newDb), `step ${step} histograms`).toBe(await histograms(oldDb));
      step++;
    }
    expect(Number((await one<{ n: number }>(oldDb, 'select count(*) n from public.pool_runs where eligible')).n)).toBeGreaterThan(8);
    expect(await samples(newDb)).toBe(await samples(oldDb));
  }, 120_000);
});

describe('the upload path', () => {
  let db: PGlite;
  beforeAll(async () => { db = await makeDb(true); }, 120_000);
  afterAll(async () => { await db?.close(); });

  const run = (seed: number, author = 'q1'): Run => ({
    author, hero: 'h_aria', seed, user: uuid(9),
    boards: Array.from({ length: 6 }, (_, i) => ({ wave: i + 1, empty: false, raw: 10 * (i + 1) + seed % 7, refWave: i + 1, tier: Math.min(6, 1 + Math.floor((i + 1) / 3)) })),
  });

  it('an upload only queues its run key: pool_runs and the histograms move when the job runs', async () => {
    const ids = new Map<string, number>();
    const before = await poolRows(db);
    const histBefore = await histograms(db);
    await apply(db, { kind: 'upload', run: run(1), boards: run(1).boards }, ids);
    expect(await poolRows(db)).toEqual(before);
    expect(await histograms(db)).toBe(histBefore);
    expect((await db.query('select author, hero_id, seed::int, scored from public.pool_dirty')).rows).toEqual([{ author: 'q1', hero_id: 'h_aria', seed: 1, scored: true }]);
    expect(Number((await one<{ n: number }>(db, 'select public.pool_refresh_dirty() as n')).n)).toBe(1);
    expect(Number((await one<{ n: number }>(db, 'select count(*) n from public.pool_runs')).n)).toBe(before.length + 1);
    expect(await histograms(db)).not.toBe(histBefore);
    expect(Number((await one<{ n: number }>(db, 'select count(*) n from public.pool_dirty')).n)).toBe(0);
    expect(Number((await one<{ n: number }>(db, 'select public.pool_refresh_dirty() as n')).n)).toBe(0); // nothing queued
  });

  it('a batch drained by ONE job lands the same runs as one-by-one, and the same strengths after a full refresh', async () => {
    const [a, b] = await Promise.all([makeDb(true), makeDb(true)]);
    try {
      const ops = workload(77);
      const ids = new Map<string, number>();
      for (const op of ops) { await apply(a, op, ids); await a.query('select public.pool_refresh_dirty()'); }
      for (const op of ops) await apply(b, op, ids);
      await b.query('select public.pool_refresh_dirty()');
      for (const d of [a, b]) await d.query('select public.pool_strength_refresh(null, null, null)');
      // By key (a batch consumes fewer pool_runs ids than one-by-one re-uploads; production draws are unseeded).
      expect(await poolRows(b, true)).toEqual(await poolRows(a, true));
    } finally { await a.close(); await b.close(); }
  }, 120_000);

  it('runs queued together get their pool ids in upload order (first queued, first id)', async () => {
    const ids = new Map<string, number>();
    for (const s of [31, 12, 27]) await apply(db, { kind: 'upload', run: run(s, 'order'), boards: run(s, 'order').boards }, ids);
    await db.query('select public.pool_refresh_dirty()');
    const got = (await db.query<{ seed: number }>("select seed::int from public.pool_runs where author = 'order' order by id")).rows.map((r) => r.seed);
    expect(got).toEqual([31, 12, 27]);
  });

  it('a failing job keeps every key queued, counts the attempt and logs to ops.events; the next run drains it', async () => {
    const ids = new Map<string, number>();
    await apply(db, { kind: 'upload', run: run(2), boards: run(2).boards }, ids);
    await db.exec(`alter function public.pool_runs_upsert_from(text[], text[], bigint[]) rename to pool_runs_upsert_from_saved`);
    try {
      expect(Number((await one<{ n: number }>(db, 'select public.pool_refresh_dirty() as n')).n)).toBe(-1);
    } finally {
      await db.exec(`alter function public.pool_runs_upsert_from_saved(text[], text[], bigint[]) rename to pool_runs_upsert_from`);
    }
    const q = await one<{ n: number; attempts: number; last_error: string }>(db, 'select count(*)::int n, max(attempts) attempts, max(last_error) last_error from public.pool_dirty');
    expect(q.n).toBe(1);
    expect(q.attempts).toBe(1);
    expect(q.last_error).toMatch(/pool_runs_upsert_from/);
    const ev = await one<{ source: string; kind: string; detail: { error: string; queued: number } }>(db, 'select source, kind, detail from ops.events order by id desc limit 1');
    expect(ev.source).toBe('pool_refresh_dirty');
    expect(ev.kind).toBe('error');
    expect(ev.detail.queued).toBe(1);
    expect(Number((await one<{ n: number }>(db, 'select public.pool_refresh_dirty() as n')).n)).toBe(1);
    expect(Number((await one<{ n: number }>(db, 'select count(*) n from public.pool_dirty')).n)).toBe(0);
  });

  it('the enqueue never swallows an error: a failing queue write fails the upload', async () => {
    await db.exec('alter table public.pool_dirty add constraint pool_dirty_test_block check (seed <> 4242)');
    try {
      await expect(apply(db, { kind: 'upload', run: run(4242), boards: run(4242).boards }, new Map())).rejects.toThrow(/pool_dirty_test_block/);
      expect(Number((await one<{ n: number }>(db, 'select count(*) n from public.boards where seed = 4242')).n)).toBe(0);
    } finally {
      await db.exec('alter table public.pool_dirty drop constraint pool_dirty_test_block');
    }
  });

  it('pool_runs_sample runs with work_mem 16MB (no temp spill), its answer unchanged', async () => {
    const cfg = await one<{ c: string[] }>(db, "select proconfig c from pg_proc where proname = 'pool_runs_sample'");
    expect(cfg.c).toContain('work_mem=16MB');
  });

  it('clients reach the two histogram RPCs and the sample, never the queue, the caches, the job or ops', async () => {
    const priv = await one<Record<string, boolean>>(db, `select
      has_function_privilege('anon', 'public.board_strength_histogram(text)', 'execute') as hist_anon,
      has_function_privilege('authenticated', 'public.run_strength_histogram(text)', 'execute') as runhist_auth,
      has_function_privilege('anon', 'public.pool_refresh_dirty()', 'execute') as job_anon,
      has_function_privilege('authenticated', 'public.pool_refresh_dirty()', 'execute') as job_auth,
      has_table_privilege('anon', 'public.pool_dirty', 'select') as dirty_anon,
      has_table_privilege('authenticated', 'public.pool_dirty', 'insert') as dirty_auth,
      has_table_privilege('anon', 'public.board_strength_hist', 'select') as bh_anon,
      has_table_privilege('authenticated', 'public.run_strength_hist', 'select') as rh_auth,
      has_schema_privilege('authenticated', 'ops', 'usage') as ops_auth`);
    expect(priv).toEqual({ hist_anon: true, runhist_auth: true, job_anon: false, job_auth: false, dirty_anon: false, dirty_auth: false, bh_anon: false, rh_auth: false, ops_auth: false });
  });

  it('is idempotent: re-running the migration keeps the queue, the caches and the triggers single', async () => {
    await db.exec(JOB);
    await db.exec(JOB);
    const t = await db.query<{ tgname: string }>("select tgname from pg_trigger where tgrelid = 'public.boards'::regclass and not tgisinternal order by 1");
    expect(t.rows.map((r) => r.tgname)).toEqual(['pool_dirty_boards_delete', 'pool_dirty_boards_insert', 'pool_dirty_boards_update']);
  });
});
