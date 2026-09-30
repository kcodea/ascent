import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardSnapshot } from '../snapshot';
import { MIN_RUN_WAVES, maxPlausibleTier, runTiersPlausible, runWavesCover } from './snapshotSeats';

/**
 * THE WHOLE-RUN POOL SQL, EXECUTED (R-LOBBY-08, 2026-09-29). PGlite runs the real migration
 * (`supabase/migrations/2026-09-29-pool-whole-runs.sql`) on a stub `boards` table and checks:
 *  - `pool_runs` eligibility and the plausible-tier bound agree with the TS rule seat selection uses;
 *  - `pool_runs_sample` returns every run WHOLE (all of its boards, one row per run) or not at all;
 *  - the sample is uniform over eligible runs (both the small-pool shuffle and the rejection sampler), never
 *    returns the excluded account's runs, and its cost does not grow with the pool;
 *  - the triggers keep `pool_runs` current through uploads, re-uploads and deletes, and anon may call only the
 *    sample; the backfill is idempotent.
 */
const root = join(__dirname, '../../../..');
const MIGRATION = readFileSync(join(root, 'supabase/migrations/2026-09-29-pool-whole-runs.sql'), 'utf8');

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

let db: PGlite;
const PATCH = '0.1.0+abc';

interface RunSpec { author: string; hero: string; seed: number; waves: number[]; tier?: (w: number) => number; user?: string; set?: string; patch?: string; empty?: number[] }

const boardJson = (r: RunSpec, wave: number): BoardSnapshot => ({
  v: 1, wave, heroId: r.hero, resolve: 30, tier: (r.tier ?? ((w: number) => Math.min(6, 1 + Math.floor(w / 3))))(wave), triples: 0,
  tribes: [], threat: 'glass', power: wave, seed: r.seed, origin: 'self', author: r.author, setId: r.set ?? 'set2',
  minions: r.empty?.includes(wave) ? [] : [{ cardId: 'pack', attack: wave, health: wave, keywords: [], golden: false }],
} as unknown as BoardSnapshot);

/** Upload a run the way the client does: ONE insert statement with all of its boards. */
async function upload(r: RunSpec, waves = r.waves): Promise<void> {
  const values: string[] = [];
  const params: unknown[] = [];
  for (const w of waves) {
    const b = boardJson(r, w);
    const i = params.length;
    params.push(r.patch ?? PATCH, w, r.hero, w, r.author, r.seed, JSON.stringify(b), r.user ?? null);
    values.push(`($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}, $${i + 6}, $${i + 7}::jsonb, $${i + 8}::uuid)`);
  }
  await db.query(`insert into public.boards (patch, wave, hero_id, power, author, seed, snapshot, user_id) values ${values.join(', ')}`, params);
}

interface SampleRow { run_key: string; author: string; user_id: string | null; wave_count: number; boards: BoardSnapshot[] }
async function sample(limit: number, seed: string | null, opts: { set?: string; prefix?: string; exclude?: string } = {}): Promise<SampleRow[]> {
  return (await db.query<SampleRow>('select * from public.pool_runs_sample($1, $2, $3, $4::uuid, $5)',
    [limit, opts.set ?? 'set2', opts.prefix ?? '0.1.0+', opts.exclude ?? null, seed])).rows;
}
const count = async (sql: string): Promise<number> => Number((await db.query<{ n: number }>(sql)).rows[0]!.n);
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const uuid = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MIGRATION);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the SQL rule equals the TS rule', () => {
  it('pool_max_plausible_tier is maxPlausibleTier, wave by wave', async () => {
    for (const w of range(1, 40)) {
      const sql = Number((await db.query<{ t: number }>('select public.pool_max_plausible_tier($1) as t', [w])).rows[0]!.t);
      expect(sql, `wave ${w}`).toBe(maxPlausibleTier(w));
    }
  });

  it('eligibility matches runWavesCover + runTiersPlausible + the 4-wave minimum on every shape', async () => {
    const shapes: RunSpec[] = [
      { author: 'Whole', hero: 'a', seed: 1, waves: range(1, 12) },
      { author: 'FromTwo', hero: 'a', seed: 2, waves: range(2, 9) },
      { author: 'OneGap', hero: 'a', seed: 3, waves: [1, 2, 4, 5, 6] },
      { author: 'Truncated', hero: 'a', seed: 4, waves: range(10, 17) },
      { author: 'Holed', hero: 'a', seed: 5, waves: [1, 2, 3, 9, 10, 11] },
      { author: 'Short', hero: 'a', seed: 6, waves: [1, 2, 3] },
      { author: 'FromThree', hero: 'a', seed: 7, waves: range(3, 10) },
      { author: 'Cheat', hero: 'a', seed: 8, waves: range(1, 8), tier: (w) => (w === 2 ? 6 : 1) },
      { author: 'EmptyMiddle', hero: 'a', seed: 9, waves: range(1, 8), empty: [4, 5] },
    ];
    for (const r of shapes) await upload(r);
    const rows = (await db.query<{ author: string; eligible: boolean }>('select author, eligible from public.pool_runs')).rows;
    const byAuthor = new Map(rows.map((r) => [r.author, r.eligible]));
    for (const r of shapes) {
      const servable = r.waves.filter((w) => !r.empty?.includes(w));
      const snaps = servable.map((w) => boardJson(r, w));
      const ts = servable.length >= MIN_RUN_WAVES && runWavesCover(servable) && runTiersPlausible(snaps);
      expect(byAuthor.get(r.author), r.author).toBe(ts);
    }
    await db.exec('delete from public.boards');
    expect(await count('select count(*) as n from public.pool_runs')).toBe(0); // the delete trigger emptied it
  });
});

describe('the triggers keep pool_runs current', () => {
  it('an upload, a second upload of the rest, and a partial delete', async () => {
    const r: RunSpec = { author: 'Trig', hero: 'b', seed: 50, waves: range(1, 10), user: uuid(50) };
    await db.query('insert into auth.users (id) values ($1)', [uuid(50)]);
    await upload(r, [1, 2]);
    let row = (await db.query<{ wave_count: number; eligible: boolean; user_id: string }>("select * from public.pool_runs where author = 'Trig'")).rows[0]!;
    expect(row.wave_count).toBe(2);
    expect(row.eligible).toBe(false); // 2 waves: not enough material yet
    await upload(r, range(3, 10));
    row = (await db.query<{ wave_count: number; eligible: boolean; user_id: string }>("select * from public.pool_runs where author = 'Trig'")).rows[0]!;
    expect(row.wave_count).toBe(10);
    expect(row.eligible).toBe(true);
    expect(row.user_id).toBe(uuid(50));
    await db.exec("delete from public.boards where author = 'Trig' and wave between 4 and 6");
    row = (await db.query<{ wave_count: number; eligible: boolean; user_id: string }>("select * from public.pool_runs where author = 'Trig'")).rows[0]!;
    expect(row.wave_count).toBe(7);
    expect(row.eligible).toBe(false); // a three-wave hole is no longer a whole run
    await db.exec("delete from public.boards where author = 'Trig'");
    expect(await count("select count(*) as n from public.pool_runs where author = 'Trig'")).toBe(0);
  });

  it('the backfill (pool_runs_rebuild) is idempotent', async () => {
    await upload({ author: 'Re', hero: 'c', seed: 60, waves: range(1, 6) });
    const before = (await db.query('select author, hero_id, seed, wave_count, eligible from public.pool_runs order by author')).rows;
    await db.exec(MIGRATION); // the whole file, re-run
    const after = (await db.query('select author, hero_id, seed, wave_count, eligible from public.pool_runs order by author')).rows;
    expect(after).toEqual(before);
    await db.exec('delete from public.boards');
  });
});

describe('the bug case: a whole run always arrives whole', () => {
  it('146 wave-5 boards vs 112 wave-10 boards: an OLD run keeps every wave, where the per-wave pull cut it', async () => {
    // The live shape: many runs end early, so early waves hold more rows. The OLD run is uploaded first.
    const old: RunSpec = { author: 'Orangez', hero: 'soren', seed: 1129878061, waves: range(1, 17) };
    await upload(old);
    const runs: RunSpec[] = [old];
    for (let i = 0; i < 145; i++) {
      const r: RunSpec = { author: `P${i % 12}`, hero: `h${i % 9}`, seed: 10_000 + i, waves: range(1, i < 111 ? 10 + (i % 7) : 5 + (i % 5)) };
      runs.push(r);
      await upload(r);
    }
    const perWave = async (w: number): Promise<number> => count(`select count(*) as n from public.boards where wave = ${w}`);
    expect(await perWave(5)).toBe(146);
    expect(await perWave(10)).toBe(112);
    // The OLD pull: newest 120 per wave. The old run loses its early waves and keeps its late ones.
    const oldPull = (await db.query<{ wave: number }>(`select wave from (
      select wave, author, row_number() over (partition by wave order by created_at desc, id desc) as rk from public.boards) t
      where rk <= 120 and author = 'Orangez' order by wave`)).rows.map((r) => r.wave);
    expect(oldPull.length).toBeLessThan(17);
    expect(oldPull[0]).toBeGreaterThan(2); // exactly the live bug: its reassembled run starts late
    // The NEW path: every sampled run carries every one of its waves, the old run included.
    const got = await sample(300, 'bug');
    expect(got.length).toBe(146);
    for (const row of got) {
      const spec = runs.find((r) => `${r.author}|${r.hero}|${r.seed}` === row.run_key)!;
      expect(row.boards.map((b) => b.wave), row.run_key).toEqual(spec.waves);
      expect(row.wave_count).toBe(spec.waves.length);
    }
    await db.exec('delete from public.boards');
  });
});

describe('the sample is uniform over eligible runs, and its cost is flat', () => {
  /** Pick frequencies of each eligible run over `draws` seeded samples. */
  async function frequencies(limit: number, draws: number, tag: string, exclude?: string): Promise<Map<string, number>> {
    const freq = new Map<string, number>();
    for (let d = 0; d < draws; d++) {
      const rows = await sample(limit, `${tag}${d}`, exclude ? { exclude } : {});
      expect(new Set(rows.map((r) => r.run_key)).size, 'no run twice in one sample').toBe(rows.length);
      expect(rows.length).toBe(limit);
      for (const r of rows) freq.set(r.run_key, (freq.get(r.run_key) ?? 0) + 1);
    }
    return freq;
  }

  it('the rejection sampler (pool much larger than the request) picks every eligible run equally often', async () => {
    // 400 runs as pool_runs rows directly (the sampler never reads boards to choose), one in five ineligible
    // and interleaved, plus runs of another set and another build version that must never appear.
    await db.exec(`
      insert into public.pool_runs (author, hero_id, seed, set_id, patch_prefix, boards, wave_count, first_wave, last_wave, max_gap, tiers_ok, eligible, user_id)
      select 'U' || (g % 37), 'h', g, case when g % 23 = 0 then 'set1' else 'set2' end,
             case when g % 29 = 0 then '0.0.9+' else '0.1.0+' end, 8, 8, 1, 8, 0, true, g % 5 <> 0,
             case when g % 37 = 3 then '${uuid(3)}'::uuid else null end
      from generate_series(1, 400) g;`);
    const eligible = await count(`select count(*) as n from public.pool_runs where eligible and set_id = 'set2' and patch_prefix = '0.1.0+'`);
    const excluded = await count(`select count(*) as n from public.pool_runs where eligible and set_id = 'set2' and patch_prefix = '0.1.0+' and user_id = '${uuid(3)}'`);
    const LIMIT = 50; const DRAWS = 600;
    const freq = await frequencies(LIMIT, DRAWS, 'rej', uuid(3));
    const pool = eligible - excluded;
    const expected = (LIMIT * DRAWS) / pool;
    expect(freq.size, 'every eligible run is reachable').toBe(pool);
    for (const [key, n] of freq) {
      expect(key.startsWith('U3|'), 'the excluded account never appears').toBe(false);
      // Expected ~105 picks each, binomial sd ~9: +-50% is > 5 sd, so a fair sampler passes and a 2x bias fails.
      expect(n, key).toBeGreaterThan(expected * 0.5);
      expect(n, key).toBeLessThan(expected * 1.5);
    }
    // A chi-square check on top of the per-run bound: the spread is what a fair draw gives.
    const chi = [...freq.values()].reduce((a, n) => a + (n - expected) ** 2 / expected, 0);
    expect(chi / pool).toBeLessThan(1.5); // ~1 for a uniform draw
  }, 120_000);

  it('the small-pool shuffle is uniform too', async () => {
    await db.exec('delete from public.pool_runs');
    await db.exec(`
      insert into public.pool_runs (author, hero_id, seed, set_id, patch_prefix, boards, wave_count, first_wave, last_wave, max_gap, tiers_ok, eligible)
      select 'S' || g, 'h', g, 'set2', '0.1.0+', 8, 8, 1, 8, 0, true, true from generate_series(1, 60) g;`);
    const freq = await frequencies(20, 600, 'small');
    const expected = (20 * 600) / 60;
    expect(freq.size).toBe(60);
    for (const [key, n] of freq) { expect(n, key).toBeGreaterThan(expected * 0.7); expect(n, key).toBeLessThan(expected * 1.3); }
  }, 60_000);

  it('drawing from 100x the runs costs about the same (index probes, no scan)', async () => {
    const time = async (): Promise<number> => {
      const ts: number[] = [];
      for (let i = 0; i < 7; i++) { const t0 = performance.now(); await sample(150, null); ts.push(performance.now() - t0); }
      return ts.sort((a, b) => a - b)[3]!;
    };
    const seed = async (n: number): Promise<void> => {
      await db.exec('delete from public.pool_runs');
      await db.exec(`
        insert into public.pool_runs (author, hero_id, seed, set_id, patch_prefix, boards, wave_count, first_wave, last_wave, max_gap, tiers_ok, eligible)
        select 'T' || g, 'h', g, 'set2', '0.1.0+', 8, 8, 1, 8, 0, true, true from generate_series(1, ${n}) g;
        analyze public.pool_runs;`);
    };
    await seed(2_000);
    const small = await time();
    await seed(200_000);
    const big = await time();
    expect((await sample(150, null)).length).toBe(150);
    expect(big, `2k runs: ${small.toFixed(1)} ms, 200k runs: ${big.toFixed(1)} ms`).toBeLessThan(small * 4 + 25);
    await db.exec('delete from public.pool_runs');
  }, 120_000);
});

describe('who may call what', () => {
  it('anon can sample and read pool_runs, and cannot run the maintenance functions', async () => {
    await upload({ author: 'Anon', hero: 'd', seed: 70, waves: range(1, 6) });
    await db.exec('set role anon');
    try {
      expect((await sample(10, 'anon')).map((r) => r.run_key)).toEqual(['Anon|d|70']);
      expect(await count('select count(*) as n from public.pool_runs')).toBe(1);
      await expect(db.query('select public.pool_runs_rebuild()')).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.pool_runs_upsert_from(array['a'], array['b'], array[1::bigint])")).rejects.toThrow(/permission denied/);
      await expect(db.query("insert into public.pool_runs (author, hero_id, seed, set_id, patch_prefix, boards, wave_count, first_wave, last_wave, max_gap, tiers_ok, eligible) values ('x','y',1,'set2','0.1.0+',1,1,1,1,0,true,true)")).rejects.toThrow();
    } finally {
      await db.exec('reset role');
    }
  });
});
