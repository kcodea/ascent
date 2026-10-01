import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from '@game/core';
import { pctFromCounts, percentileOf, runPercentileOf, runWeightedAverageOf, weightedAvgFromGroups, type StrengthHistogramEntry } from './boardStrength';
import LIVE from './strengthLiveScores.fixture.json';

/**
 * THE BOARD-STRENGTH SQL, EXECUTED (R-LOBBY-09, 2026-09-30). PGlite runs the 2026-09-29 whole-run pool migration
 * and then `supabase/migrations/2026-09-30-board-strength.sql` on a stub `boards` table, and checks:
 *  - `board_strength_pct` equals the TS `pctFromCounts` on every count triple, and `board_strength_weighted_avg` the
 *    TS `weightedAvgFromGroups` on every group shape; a run's `strength_avg` equals the round-weighted
 *    `runWeightedAverageOf(percentileOf(...))` (2026-09-30-weighted-strength.sql) and its `strength` equals
 *    `runPercentileOf` (the average ranked among the runs), both computed in TS from the same boards, on synthetic
 *    runs and on the REAL live pool's scores (`strengthLiveScores.fixture.json`);
 *  - uploads with a score refresh their run through the trigger (insert and the backfill's update);
 *  - `pool_runs_sample` honours a band, counts an unscored run as inside every band, keeps whole runs and the
 *    own-run exclusion, is uniform inside the band, and still answers the old four-argument call;
 *  - `board_strength_histogram` counts what the client needs; anon may call it and the sample, nothing else;
 *  - the migration is idempotent.
 */
const root = join(__dirname, '../../../..');
const POOL = readFileSync(join(root, 'supabase/migrations/2026-09-29-pool-whole-runs.sql'), 'utf8');
const MIGRATION = readFileSync(join(root, 'supabase/migrations/2026-09-30-board-strength.sql'), 'utf8');
const WEIGHTED = readFileSync(join(root, 'supabase/migrations/2026-09-30-weighted-strength.sql'), 'utf8');

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
const REF = 'set2-v1';
const uuid = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

interface RunSpec {
  author: string; hero: string; seed: number; raws: (number | null)[]; user?: string;
  /** The wave of each board (default i + 1); a repeated wave is a duplicate board for that round. */
  waves?: number[];
  /** The reference wave of each board (default its wave). */
  refWaves?: number[];
}

/** Upload a run as the client does: ONE insert with all of its boards (wave i+1 = raws[i], null = unscored). */
async function upload(r: RunSpec): Promise<void> {
  const values: string[] = [];
  const params: unknown[] = [];
  r.raws.forEach((raw, i) => {
    const wave = r.waves?.[i] ?? i + 1;
    const refWave = r.refWaves?.[i] ?? wave;
    const snap = { v: 1, wave, heroId: r.hero, resolve: 30, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: 0, tribes: [], threat: 'glass', power: wave, seed: r.seed, origin: 'self', author: r.author, setId: 'set2', minions: [{ cardId: 'pack', attack: wave, health: wave, keywords: [], golden: false }] };
    const k = params.length;
    params.push('0.1.0+abc', wave, r.hero, r.author, r.seed, JSON.stringify(snap), r.user ?? null, raw, raw === null ? null : REF, raw === null ? null : refWave);
    values.push(`($${k + 1}, $${k + 2}, $${k + 3}, 1, $${k + 4}, $${k + 5}, $${k + 6}::jsonb, $${k + 7}::uuid, $${k + 8}::numeric, $${k + 9}, $${k + 10}::smallint)`);
  });
  await db.query(`insert into public.boards (patch, wave, hero_id, power, author, seed, snapshot, user_id, strength_raw, strength_ref, strength_wave) values ${values.join(', ')}`, params);
}

const q = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const strengthOf = async (key: string): Promise<number | null> => {
  const [author, hero, seed] = key.split('|');
  const rows = await q<{ s: string | null }>('select strength::text as s from public.pool_runs where author = $1 and hero_id = $2 and seed = $3', [author, hero, Number(seed)]);
  return rows[0]?.s == null ? null : Number(rows[0].s);
};

interface SampleRow { run_key: string; strength: string | null; wave_count: number; boards: unknown[] }
const sample = (limit: number, seed: string | null, band: { min?: number | null; max?: number | null } = {}, exclude: string | null = null): Promise<SampleRow[]> =>
  q<SampleRow>('select * from public.pool_runs_sample(p_limit => $1, p_set => $2, p_patch_prefix => $3, p_exclude_user => $4::uuid, p_seed => $5, p_strength_min => $6, p_strength_max => $7)',
    [limit, 'set2', '0.1.0+', exclude, seed, band.min ?? null, band.max ?? null]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(POOL);
  await db.exec(MIGRATION);
  await db.exec(WEIGHTED);
}, 60_000);

const runKey = (s: RunSpec): string => `${s.author}|${s.hero}|${s.seed}`;

/** The client's numbers for these runs, computed in TS from the same boards: each board's percentile among its
 *  reference wave (itself in the population), the run's round-weighted average, and that average ranked among runs. */
function tsRunNumbers(specs: readonly RunSpec[]): { avgs: Map<string, number | null>; strengths: Map<string, number | null> } {
  const byWave = new Map<number, number[]>();
  const refOf = (s: RunSpec, i: number): number => s.refWaves?.[i] ?? s.waves?.[i] ?? i + 1;
  for (const s of specs) s.raws.forEach((r, i) => { if (r !== null) byWave.set(refOf(s, i), [...(byWave.get(refOf(s, i)) ?? []), Number(r.toFixed(4))]); });
  const hist = (w: number, skipOne: number): StrengthHistogramEntry[] => {
    const m = new Map<number, number>();
    let skipped = false;
    for (const r of byWave.get(w) ?? []) { if (!skipped && r === skipOne) { skipped = true; continue; } m.set(r, (m.get(r) ?? 0) + 1); }
    return [...m].map(([raw, count]) => ({ raw, count }));
  };
  const avgs = new Map<string, number | null>();
  for (const s of specs) {
    const rounds = s.raws.map((r, i) => ({ round: s.waves?.[i] ?? i + 1, value: r === null ? null : percentileOf(Number(r.toFixed(4)), hist(refOf(s, i), Number(r.toFixed(4))), true) }));
    avgs.set(runKey(s), runWeightedAverageOf(rounds));
  }
  const all = [...avgs.values()].filter((a): a is number => a !== null);
  const strengths = new Map<string, number | null>();
  for (const [k, a] of avgs) {
    if (a === null) { strengths.set(k, null); continue; }
    const others = new Map<number, number>();
    let skipped = false;
    for (const x of all) { if (!skipped && x === a) { skipped = true; continue; } others.set(x, (others.get(x) ?? 0) + 1); }
    strengths.set(k, runPercentileOf(a, [...others].map(([avg, count]) => ({ avg, count })), true));
  }
  return { avgs, strengths };
}

const sqlAverages = async (): Promise<Map<string, number | null>> =>
  new Map((await q<{ k: string; a: string | null }>(`select author || '|' || hero_id || '|' || seed as k, strength_avg::text as a from public.pool_runs`)).map((r) => [r.k, r.a === null ? null : Number(r.a)]));
afterAll(async () => { await db?.close(); });

describe('the SQL percentile equals the TS percentile', () => {
  it('board_strength_pct is pctFromCounts on every count triple', async () => {
    const triples: [number, number, number][] = [];
    for (let n = 1; n <= 40; n++) for (let below = 0; below < n; below++) for (let equal = 1; below + equal <= n; equal += 3) triples.push([below, equal, n]);
    const rows = await q<{ p: number }>(`select public.board_strength_pct(t.b, t.e, t.n) as p from unnest($1::bigint[], $2::bigint[], $3::bigint[]) with ordinality as t(b, e, n, i) order by t.i`,
      [triples.map((t) => t[0]), triples.map((t) => t[1]), triples.map((t) => t[2])]);
    rows.forEach((r, i) => expect(r.p, `below ${triples[i]![0]} equal ${triples[i]![1]} n ${triples[i]![2]}`).toBe(pctFromCounts(...triples[i]!)));
  });

  it('board_strength_weighted_avg is weightedAvgFromGroups on every group shape (present, absent, duplicates)', async () => {
    const rng = makeRng(931);
    const cases: number[][] = [];
    for (let i = 0; i < 400; i++) {
      const n = [0, 1, 2].map(() => (rng.next() < 0.25 ? 0 : 1 + Math.floor(rng.next() * 9)));
      cases.push(n.flatMap((c) => [c === 0 ? 0 : c + Math.floor(rng.next() * 100 * c), c]));
    }
    cases.push([0, 0, 0, 0, 0, 0], [5, 5, 0, 0, 0, 0], [500, 5, 400, 4, 0, 0], [5, 5, 4, 4, 100, 1]);
    const rows = await q<{ p: number | null }>(`select public.board_strength_weighted_avg(t.s1, t.n1, t.s2, t.n2, t.s3, t.n3) as p
      from unnest($1::bigint[], $2::bigint[], $3::bigint[], $4::bigint[], $5::bigint[], $6::bigint[]) with ordinality as t(s1, n1, s2, n2, s3, n3, i) order by t.i`,
    [0, 1, 2, 3, 4, 5].map((j) => cases.map((c) => c[j]!)));
    rows.forEach((r, i) => {
      const c = cases[i]!;
      expect(r.p, c.join(',')).toBe(weightedAvgFromGroups([c[0]!, c[2]!, c[4]!], [c[1]!, c[3]!, c[5]!]));
    });
  });

  it("a run's weighted average and its strength (the average ranked among runs) are the numbers the client computes", async () => {
    const rng = makeRng(930);
    const specs: RunSpec[] = [];
    // Raw scores on a 1/120 grid, as a 60-fight score is, so ties are common. Runs of 4..15 rounds cover every group
    // shape (rounds 1-5 only; 1-9; 1-15), some with an unscored round, one with a duplicate board for round 7.
    for (let i = 0; i < 24; i++) specs.push({ author: `P${i % 5}`, hero: `h${i}`, seed: 1000 + i, raws: Array.from({ length: 4 + (i % 12) }, (_, j) => (j === 2 && i % 4 === 0 ? null : Math.round(rng.next() * 120) / 120)) });
    specs.push({ author: 'Dup', hero: 'd', seed: 1999, raws: [0.5, 0.2, 0.9, 0.9, 0.1, 0.4, 0.3, 0.95], waves: [1, 2, 3, 4, 5, 6, 7, 7] });
    for (const s of specs) await upload(s);
    await db.exec('select public.pool_strength_refresh(null, null, null)');
    const { avgs, strengths: tsStrengths } = tsRunNumbers(specs);
    const sqlAvg = await sqlAverages();
    for (const [k, a] of avgs) expect(sqlAvg.get(k), k).toBe(a);
    for (const [k, v] of tsStrengths) expect(await strengthOf(k), k).toBe(v);
    const strengths = await Promise.all([...avgs.keys()].map((k) => strengthOf(k)));
    expect(Math.min(...(strengths as number[]))).toBeLessThanOrEqual(5); // ranked: spans the scale
    expect(Math.max(...(strengths as number[]))).toBeGreaterThanOrEqual(95);
  });
});

describe('keeping pool_runs.strength current', () => {
  it('an upload with scores refreshes its run; an unscored upload stays unscored', async () => {
    await upload({ author: 'Fresh', hero: 'f', seed: 5001, raws: [0.9, 0.95, 0.9, 1] });
    await upload({ author: 'Old', hero: 'o', seed: 5002, raws: [null, null, null, null] });
    expect(await strengthOf('Fresh|f|5001')).toBeGreaterThan(90); // the strongest run of the set
    expect(await strengthOf('Old|o|5002')).toBeNull();
  });

  it("the backfill's UPDATE scores an old run through the update trigger", async () => {
    await db.exec(`update public.boards set strength_raw = 0, strength_ref = '${REF}', strength_wave = wave where author = 'Old' and strength_raw is null`);
    const s = await strengthOf('Old|o|5002');
    expect(s).not.toBeNull();
    expect(s!).toBeLessThan(10); // the weakest run of the set
  });
});

describe('the sample with a band', () => {
  it('draws only runs inside the band, or unscored ones, each whole', async () => {
    await db.exec('delete from public.boards');
    await db.exec('delete from public.pool_runs');
    // 30 runs of known strength: set directly (the sampler never reads boards to choose), plus 5 unscored.
    for (let i = 0; i < 35; i++) await upload({ author: `B${i}`, hero: 'h', seed: 7000 + i, raws: [null, null, null, null, null], user: i === 3 ? uuid(3) : undefined });
    await db.exec(`update public.pool_runs set strength = (seed - 7000) * 3 + 1 where seed < 7030`);
    const rows = await sample(300, 'band', { min: 0, max: 30 });
    const keys = rows.map((r) => r.run_key).sort();
    const want = [...Array.from({ length: 10 }, (_, i) => `B${i}|h|${7000 + i}`), ...Array.from({ length: 5 }, (_, i) => `B${30 + i}|h|${7030 + i}`)].sort();
    expect(keys).toEqual(want); // strengths 1..28 and the five unscored runs
    for (const r of rows) expect(r.boards.length).toBe(r.wave_count);
    expect(rows.find((r) => r.run_key === 'B30|h|7030')!.strength).toBeNull();
    // The own-run exclusion still holds inside a band.
    expect((await sample(300, 'band', { min: 0, max: 30 }, uuid(3))).map((r) => r.run_key)).not.toContain('B3|h|7003');
    // No band = everything, as before.
    expect((await sample(300, 'all')).length).toBe(35);
  });

  it('is uniform inside the band (rejection sampler on a large pool)', async () => {
    await db.exec('delete from public.pool_runs');
    await db.exec(`
      insert into public.pool_runs (author, hero_id, seed, set_id, patch_prefix, boards, wave_count, first_wave, last_wave, max_gap, tiers_ok, eligible, strength)
      select 'U' || g, 'h', g, 'set2', '0.1.0+', 8, 8, 1, 8, 0, true, true, 1 + (g % 100) from generate_series(1, 1000) g;`);
    const freq = new Map<string, number>();
    const LIMIT = 20; const DRAWS = 1200;
    for (let d = 0; d < DRAWS; d++) for (const r of await sample(LIMIT, `u${d}`, { min: 0, max: 30 })) freq.set(r.run_key, (freq.get(r.run_key) ?? 0) + 1);
    const inBand = 300; // strengths 1..30, 10 runs each
    expect(freq.size).toBe(inBand);
    const expected = (LIMIT * DRAWS) / inBand;
    for (const [key, n] of freq) {
      expect(Number(key.split('|')[2]) % 100, 'strength <= 30').toBeLessThan(30);
      expect(n, key).toBeGreaterThan(expected * 0.5);
      expect(n, key).toBeLessThan(expected * 1.5);
    }
    const chi = [...freq.values()].reduce((a, n) => a + (n - expected) ** 2 / expected, 0);
    expect(chi / inBand).toBeLessThan(1.5); // ~1 for a uniform draw
  }, 120_000);

  it('still answers the old four-argument call (clients deployed before this change)', async () => {
    const rows = await q<SampleRow>(`select * from public.pool_runs_sample(p_limit => 5, p_set => 'set2', p_patch_prefix => '0.1.0+', p_exclude_user => null)`);
    expect(rows.length).toBe(5);
  });
});

describe('the histogram and grants', () => {
  it('counts boards per reference wave and raw score, for anon', async () => {
    await db.exec('delete from public.boards');
    await db.exec('delete from public.pool_runs');
    await upload({ author: 'H1', hero: 'a', seed: 1, raws: [0.5, 0.25, null, null] });
    await upload({ author: 'H2', hero: 'b', seed: 2, raws: [0.5, 0.75, null, null] });
    await db.exec('set role anon');
    try {
      const rows = await q<{ wave: number; raw: string; n: string }>(`select wave, raw::text as raw, n::text as n from public.board_strength_histogram('${REF}')`);
      expect(rows.map((r) => [r.wave, Number(r.raw), Number(r.n)])).toEqual([[1, 0.5, 2], [2, 0.25, 1], [2, 0.75, 1]]);
      // Run averages: H1 = mean(50, 25) = 38 (37.5 half up), H2 = mean(50, 75) = 63 (62.5 half up).
      const runs = await q<{ avg: string; n: string }>(`select avg::text as avg, n::text as n from public.run_strength_histogram('set2')`);
      expect(runs.map((r) => [Number(r.avg), Number(r.n)])).toEqual([[38, 1], [63, 1]]);
      expect((await sample(10, 'anon')).length).toBe(2);
      await expect(db.query('select public.pool_strength_refresh(null, null, null)')).rejects.toThrow(/permission denied/);
      await expect(db.query('update public.pool_runs set strength = 1')).rejects.toThrow();
    } finally {
      await db.exec('reset role');
    }
  });

  it('the migration is idempotent', async () => {
    const before = await q<{ s: string | null }>('select strength::text as s from public.pool_runs order by id');
    await db.exec(POOL);
    await db.exec(MIGRATION);
    await db.exec(WEIGHTED);
    await db.exec(WEIGHTED);
    expect(await q<{ s: string | null }>('select strength::text as s from public.pool_runs order by id')).toEqual(before);
    expect((await sample(10, 'again')).length).toBe(2);
  });
});

describe('parity on the REAL live pool (2026-09-30 scores, round-weighted)', () => {
  it("every live run's weighted average and strength in SQL are the TS numbers", async () => {
    await db.exec('delete from public.boards');
    await db.exec('delete from public.pool_runs');
    const runs = (LIVE as unknown as { runs: [number, number, number][][] }).runs;
    const specs: RunSpec[] = runs.map((boards, i) => ({
      author: `L${i}`, hero: 'h', seed: 20_000 + i,
      raws: boards.map((b) => b[1]), waves: boards.map((b) => b[0]), refWaves: boards.map((b) => b[2]),
    }));
    expect(specs.length).toBeGreaterThan(150);
    for (const s of specs) await upload(s);
    await db.exec(WEIGHTED); // what the owner runs: the migration's own closing refresh recomputes every run
    const { avgs, strengths } = tsRunNumbers(specs);
    const sqlAvg = await sqlAverages();
    let late = 0;
    for (const s of specs) {
      const k = runKey(s);
      expect(sqlAvg.get(k), k).toBe(avgs.get(k));
      expect(await strengthOf(k), k).toBe(strengths.get(k));
      if (s.waves!.some((w) => w >= 10)) late++;
    }
    expect(late).toBeGreaterThan(50); // the 45% group is exercised on real runs
  }, 120_000);
});
