import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rateRunsV2, type RawRound } from './strengthV2';
import { STRENGTH_REF_VERSION } from './boardStrength';

/**
 * THE PEAK CAP IN THE DATABASE (owner 2026-11-16: "90 for all"; supabase/migrations/2026-11-24-strength-peak-cap.sql).
 * A run's PEAK is its best REAL board percentile from round 4 on (`runPeakOf`; round 3 on until
 * 2026-11-25-strength-peak-from-round-4.sql, owner 2026-11-17); the database must hold exactly the
 * number `rateRunsV2` gives, and the draw must leave out every run whose peak is above `p_peak_cap` (exactly the cap
 * is inside; a run with no peak is unscored and is out of any capped draw).
 */
const root = join(__dirname, '../../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const CHAIN = [
  '2026-09-29-pool-whole-runs.sql', '2026-09-30-board-strength.sql', '2026-09-30-weighted-strength.sql',
  '2026-10-03-final-board-strength.sql', '2026-10-06-weighted-strength-again.sql', '2026-10-06-early-late-strength.sql',
  '2026-10-09-strength-overall-caps.sql', '2026-10-17-pool-empty-boards.sql', '2026-11-07-pool-refresh-off-upload.sql',
  '2026-11-08-pool-runs-delta.sql',
].map(read);
const PEAK = '2026-11-24-strength-peak-cap.sql';
/** The peak counts from round 4 (owner 2026-11-17: "best board should not include win rates for boards on rounds 1,
 *  2, or 3"): the refresh of PEAK with one number changed. Always applied after PEAK. */
const PEAK4 = '2026-11-25-strength-peak-from-round-4.sql';

const STUB = `
  create role anon; create role authenticated; create role service_role;
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
  create schema extensions;
  create extension pgcrypto with schema extensions;
`;
const HUB_STUB = `
  create function public.session_cf__key_ok(p_key text) returns boolean language sql stable as 'select true';
  create function public.pool_mirror_version(p_key text) returns text language sql stable as 'select null::text';
  create function public.pool_mirror_index(p_key text)
  returns table (run_id bigint, run_key text, author text, user_id uuid, wave_count int, set_id text, patch_prefix text,
                 pool_id text, strength text, strength_early text, strength_late text, rev text)
  language plpgsql stable as 'begin return; end';
  create schema if not exists ops;
  create function ops.pool_digest(p_params jsonb) returns jsonb language sql as 'select null::jsonb';
`;

const LAST_REF = 15;
const V2 = STRENGTH_REF_VERSION;

interface Fixture { seed: number; last: number; empty: number[]; raw: (round: number) => number; carried: (round: number) => number }
const raw4 = (n: number): number => (((n % 97) + 97) % 97) / 100; // 0.00 .. 0.96
/** The 30 runs of strengthV2.db.test.ts, plus one whose ONLY strong boards are on rounds 2 and 3 (rounds 1-3 never count). */
const FIXTURES: Fixture[] = [
  ...Array.from({ length: 30 }, (_, i): Fixture => {
    const seed = i + 1;
    return {
      seed, last: 7 + (i % 10), empty: i % 9 === 4 ? [3 + (i % 3)] : [],
      raw: (round) => raw4(seed * 37 + round * 11 + (seed % 4) * round),
      carried: (round) => raw4(seed * 13 + round * 7),
    };
  }),
  { seed: 301, last: 8, empty: [], raw: (round) => (round === 2 || round === 3 ? 0.99 : 0), carried: () => 0 },
];
const EARLY_ONLY = 301;

let db: PGlite;
const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await rows<T>(sql, params))[0]!;
const drain = async (): Promise<void> => { expect((await one<{ n: number }>('select public.pool_refresh_dirty() as n')).n).toBeGreaterThanOrEqual(0); };

async function upload(f: Fixture, opts: { noCarried?: boolean } = {}): Promise<void> {
  const values: string[] = [];
  const params: unknown[] = [];
  for (let w = 1; w <= f.last; w++) {
    const empty = f.empty.includes(w);
    const snap = { v: 1, wave: w, heroId: 'h_aria', resolve: 30, tier: Math.min(6, 1 + Math.floor(w / 3)), triples: 0, tribes: [], threat: 'glass',
      power: w, seed: f.seed, origin: 'self', author: `p${f.seed}`, setId: 'set2',
      minions: empty ? [] : [{ cardId: 'pack', attack: w, health: w, keywords: [], golden: false }] };
    let carried: unknown = null;
    if (w === f.last && !opts.noCarried) {
      const rounds: Record<string, number> = {};
      for (let r = f.last + 1; r <= LAST_REF; r++) rounds[String(r)] = f.carried(r);
      carried = { ref: V2, rounds };
    }
    const k = params.length;
    params.push(w, `p${f.seed}`, f.seed, JSON.stringify(snap), empty ? null : f.raw(w), empty ? null : V2, empty ? null : Math.min(w, LAST_REF), carried === null ? null : JSON.stringify(carried));
    values.push(`('0.1.0+abc', $${k + 1}, 'h_aria', 1, $${k + 2}, $${k + 3}, $${k + 4}::jsonb, $${k + 5}::numeric, $${k + 6}, $${k + 7}::smallint, $${k + 8}::jsonb)`);
  }
  await db.query(`insert into public.boards (patch, wave, hero_id, power, author, seed, snapshot, strength_raw, strength_ref, strength_wave, strength_carried) values ${values.join(', ')}`, params);
}

/** What `rateRunsV2` says each run's peak is. */
function expectedPeaks(fixtures: readonly Fixture[]): Map<number, number | null> {
  const raws: RawRound[] = [];
  for (const f of fixtures) {
    for (let r = 1; r <= f.last; r++) raws.push({ runKey: String(f.seed), round: r, raw: f.empty.includes(r) ? 0 : f.raw(r), carried: false });
    for (let r = f.last + 1; r <= LAST_REF; r++) raws.push({ runKey: String(f.seed), round: r, raw: f.carried(r), carried: true });
  }
  return new Map(rateRunsV2(raws, new Map(), (round) => Math.min(round, LAST_REF)).map((r) => [Number(r.key), r.peak]));
}
const actualPeaks = async (): Promise<Map<number, number | null>> => {
  const rs = await rows<{ seed: number; p: string | null }>('select seed::int as seed, strength_peak::text as p from public.pool_runs where live order by seed');
  return new Map(rs.map((r) => [r.seed, r.p === null ? null : Number(r.p)]));
};
const seedsOf = (rs: { run_key: string }[]): number[] => rs.map((r) => Number(r.run_key.split('|')[2])).sort((a, b) => a - b);
const keys = async (args: string): Promise<number[]> =>
  seedsOf(await rows<{ run_key: string }>(`select run_key from public.pool_runs_sample_keys(p_limit => 300, p_set => 'set2', p_seed => 'z'${args})`));

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const sql of CHAIN) await db.exec(sql);
  await db.exec(HUB_STUB);
  await db.exec(read('2026-11-22-pool-rolling-window.sql'));
  await db.exec(read('2026-11-23-strength-v2.sql'));
  await db.exec(read(PEAK));
  await db.exec(read(PEAK4));
  for (const f of FIXTURES) await upload(f);
  await drain();
}, 240_000);
afterAll(async () => { await db?.close(); });

describe('the strength peak and the peak cap in the database', () => {
  it('parity: every run\'s peak equals rateRunsV2', async () => {
    const want = expectedPeaks(FIXTURES);
    const got = await actualPeaks();
    expect(got.size).toBe(FIXTURES.length);
    for (const f of FIXTURES) expect(got.get(f.seed), `run ${f.seed} (last round ${f.last})`).toBe(want.get(f.seed));
    // The fixture exercises the cap: some runs are above 90, most are not.
    const over = [...got.values()].filter((p) => p !== null && p > 90).length;
    expect(over).toBeGreaterThan(0);
    expect(over).toBeLessThan(FIXTURES.length - 5);
  });

  it('rounds 1, 2 and 3 never count: a run whose only boards above 90 are on rounds 2 and 3 has a peak at or under 90', async () => {
    for (const round of [2, 3]) {
      const r = await one<{ p: number }>(
        'select p from public.pool_strength_round_pcts() x join public.pool_runs r on r.id = x.run_id where r.seed = $1 and x.round = $2', [EARLY_ONLY, round]);
      expect(r.p, `round ${round}`).toBeGreaterThan(90);
    }
    expect((await actualPeaks()).get(EARLY_ONLY)).toBeLessThanOrEqual(90);
  });

  it('an unscored run has no peak, and is out of a draw that carries only the peak cap', async () => {
    await upload({ ...FIXTURES[1]!, seed: 202 }, { noCarried: true });
    await drain();
    expect(await one('select strength, strength_peak from public.pool_runs where seed = 202')).toEqual({ strength: null, strength_peak: null });
    expect(await keys('')).toContain(202);
    expect(await keys(', p_peak_cap => 100')).not.toContain(202);
    await db.query('delete from public.boards where seed = 202');
    await drain();
  });

  it('the draw: no run above the cap, exactly the cap is inside, and the peak rides the answer', async () => {
    // Two runs pinned to the edge by hand (the refresh at the end of this test puts the real numbers back).
    await db.query('update public.pool_runs set strength_peak = 90 where seed = 3');
    await db.query('update public.pool_runs set strength_peak = 91 where seed = 4');
    const peaks = await actualPeaks();
    const under = [...peaks].filter(([, p]) => p !== null && p <= 90).map(([seed]) => seed).sort((a, b) => a - b);
    expect(under).toContain(3);
    expect(under).not.toContain(4);
    for (const args of [', p_peak_cap => 90', ', p_strength_min => 0, p_strength_max => 100, p_peak_cap => 90', ', p_strength_cap => 100, p_peak_cap => 90, p_early_weight => 0.6']) {
      expect(await keys(args), args).toEqual(under);
    }
    const viaSample = seedsOf(await rows<{ run_key: string }>("select run_key from public.pool_runs_sample(p_limit => 300, p_set => 'set2', p_seed => 'z', p_peak_cap => 90)"));
    expect(viaSample).toEqual(under);
    const row = await one<{ strength_peak: string }>("select strength_peak::text from public.pool_runs_sample_keys(p_limit => 300, p_set => 'set2', p_seed => 'z') where run_key like '%|3'");
    expect(Number(row.strength_peak)).toBe(90);
    const sampleRow = await one<{ strength_peak: string }>("select strength_peak::text from public.pool_runs_sample(p_limit => 300, p_set => 'set2', p_seed => 'z') where run_key like '%|3'");
    expect(Number(sampleRow.strength_peak)).toBe(90);
    await db.query('select public.pool_strength_refresh(null, null, null)');
    expect(await actualPeaks()).toEqual(expectedPeaks(FIXTURES));
  });

  it('without the cap the draw is the one it was: same runs, same order', async () => {
    const order = async (args: string): Promise<string[]> =>
      (await rows<{ run_key: string }>(`select run_key from public.pool_runs_sample_keys(p_limit => 300, p_set => 'set2', p_seed => 'z'${args})`)).map((r) => r.run_key);
    expect(await order(', p_peak_cap => null')).toEqual(await order(''));
    expect(await order(', p_strength_min => 0, p_strength_max => 50, p_peak_cap => null')).toEqual(await order(', p_strength_min => 0, p_strength_max => 50'));
    // The capped draw keeps the open draw's order for the runs it keeps.
    const open = await order('');
    const capped = await order(', p_peak_cap => 90');
    expect(capped).toEqual(open.filter((k) => capped.includes(k)));
  });

  it('one signature each: a call with the ten older arguments still resolves', async () => {
    const n = await rows<{ proname: string; n: number }>(
      "select proname, count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and proname in ('pool_runs_sample', 'pool_runs_sample_keys', 'pool_runs__pick') group by 1 order by 1");
    expect(n).toEqual([{ proname: 'pool_runs__pick', n: 1 }, { proname: 'pool_runs_sample', n: 1 }, { proname: 'pool_runs_sample_keys', n: 1 }]);
    const old = await rows("select run_key from public.pool_runs_sample_keys(p_limit => 5, p_set => 'set2', p_patch_prefix => null, p_exclude_user => null, p_seed => 'z', p_strength_min => 0, p_strength_max => 100, p_pool => null, p_early_weight => 1, p_strength_cap => 100)");
    expect(old).toHaveLength(5);
  });

  it('grants: a session may call the draw, the bare public key may not', async () => {
    const can = async (role: string, sig: string): Promise<boolean> => (await one<{ ok: boolean }>('select has_function_privilege($1, $2, \'execute\') as ok', [role, sig])).ok;
    const args = 'int, text, text, uuid, text, numeric, numeric, text, numeric, numeric, numeric';
    for (const fn of ['pool_runs_sample', 'pool_runs_sample_keys', 'pool_runs__pick']) {
      expect(await can('authenticated', `public.${fn}(${args})`), fn).toBe(true);
      expect(await can('anon', `public.${fn}(${args})`), fn).toBe(false);
    }
  });

  it('the hub mirror carries the peak, and its version moves when a peak does', async () => {
    const idx = await rows<{ run_key: string; strength_peak: string | null }>("select run_key, strength_peak from public.pool_mirror_index('k') order by run_id");
    const peaks = await actualPeaks();
    expect(idx).toHaveLength(FIXTURES.length);
    for (const r of idx) expect(r.strength_peak === null ? null : Number(r.strength_peak)).toBe(peaks.get(Number(r.run_key.split('|')[2])));
    const v0 = (await one<{ v: string }>("select public.pool_mirror_version('k') as v")).v;
    await db.query('update public.pool_runs set strength_peak = 12 where seed = 5');
    expect((await one<{ v: string }>("select public.pool_mirror_version('k') as v")).v).not.toBe(v0);
    await db.query('select public.pool_strength_refresh(null, null, null)');
    expect((await one<{ v: string }>("select public.pool_mirror_version('k') as v")).v).toBe(v0);
  });

  it('the pool digest draws with the cap it is given', async () => {
    const digest = async (params: Record<string, unknown>): Promise<number[]> =>
      ((await one<{ d: { rows: { run_id: number }[] } }>('select ops.pool_digest($1::jsonb) as d', [JSON.stringify(params)])).d.rows.map((r) => Number(r.run_id))).sort((a, b) => a - b);
    const ids = async (args: string): Promise<number[]> =>
      (await rows<{ run_id: string }>(`select run_id from public.pool_runs_sample_keys(p_limit => 300, p_set => 'set2', p_seed => 'z'${args})`)).map((r) => Number(r.run_id)).sort((a, b) => a - b);
    expect(await digest({ p_limit: 300, p_set: 'set2', p_seed: 'z', p_peak_cap: 90 })).toEqual(await ids(', p_peak_cap => 90'));
    expect(await digest({ p_limit: 300, p_set: 'set2', p_seed: 'z' })).toEqual(await ids(''));
  });

  it('text parity: the two picking blocks are identical and carry the cap', () => {
    const sql = read(PEAK);
    const block = (fn: string): string => {
      const body = sql.slice(sql.indexOf(`create or replace function public.${fn}(`));
      return body.slice(body.indexOf('  select min(r.id), max(r.id) into lo, hi'), body.indexOf('  end if;\n', body.indexOf('while coalesce(array_length')) + 10)
        .replace('then return; end if;', "then return '{}'; end if;");
    };
    expect(block('pool_runs_sample')).toBe(block('pool_runs__pick'));
    expect(block('pool_runs__pick')).toContain('r.strength_peak <= p_peak_cap');
    expect(block('pool_runs__pick')).toContain('r.strength is not null');
  });

  it('an older migration re-applied AFTER this one leaves two draw signatures (ten-argument calls fail); re-applying this file repairs it', async () => {
    const count = async (fn: string): Promise<number> => (await one<{ n: number }>(
      "select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and proname = $1", [fn])).n;
    const tenArgs = "select run_key from public.pool_runs_sample(p_limit => 5, p_set => 'set2', p_seed => 'z', p_strength_cap => 100)";
    await db.exec(read('2026-11-23-strength-v2.sql'));
    expect(await count('pool_runs_sample')).toBe(2);
    await expect(db.query(tenArgs)).rejects.toThrow(/not unique/);
    await db.exec(read(PEAK));
    await db.exec(read(PEAK4));
    expect([await count('pool_runs_sample'), await count('pool_runs__pick'), await count('pool_runs_sample_keys')]).toEqual([1, 1, 1]);
    expect((await rows(tenArgs)).length).toBe(5);
    expect(await actualPeaks()).toEqual(expectedPeaks(FIXTURES));
  });

  it('the migration says so where the owner will read it', () => {
    expect(read(PEAK)).toMatch(/NEVER RE-APPLY/);
  });

  it('re-run: applying both migrations again changes nothing; the peak cap file ALONE puts the peak back on round 3, and the round-4 file says so', async () => {
    const q = 'select seed, eligible, live, strength, strength_early, strength_late, strength_peak from public.pool_runs order by seed';
    const before = await rows(q);
    await db.exec(read(PEAK));
    expect((await actualPeaks()).get(EARLY_ONLY)).toBeGreaterThan(90); // round 3 counts again
    await db.exec(read(PEAK4));
    expect(await rows(q)).toEqual(before);
    expect(read(PEAK4)).toMatch(/RE-APPLY THIS FILE/);
  });
});
