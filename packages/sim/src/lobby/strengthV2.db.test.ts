import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rateRunsV2, type RawRound } from './strengthV2';
import { STRENGTH_REF_VERSION } from './boardStrength';

/**
 * STRENGTH V2 IN THE DATABASE (owner design 2026-11-16; supabase/migrations/2026-11-23-strength-v2.sql).
 * The database must rate a pool EXACTLY as `rateRunsV2` does: every live run once per round (its real board, an
 * empty board as 0, or its final board carried), rounds past 15 ranked against round 15 without joining it. Also
 * pinned here: the 7-round floor, "a run is scored only when complete", and unscored runs out of banded draws.
 */
const root = join(__dirname, '../../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const CHAIN = [
  '2026-09-29-pool-whole-runs.sql', '2026-09-30-board-strength.sql', '2026-09-30-weighted-strength.sql',
  '2026-10-03-final-board-strength.sql', '2026-10-06-weighted-strength-again.sql', '2026-10-06-early-late-strength.sql',
  '2026-10-09-strength-overall-caps.sql', '2026-10-17-pool-empty-boards.sql', '2026-11-07-pool-refresh-off-upload.sql',
  '2026-11-08-pool-runs-delta.sql',
].map(read);

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
const raw4 = (n: number): number => (((n % 97) + 97) % 97) / 100; // 0.00 .. 0.96, plenty of ties across 30 runs
/** 30 runs: last rounds 7..16, three with an empty round, raws that tie often. */
const FIXTURES: Fixture[] = Array.from({ length: 30 }, (_, i) => {
  const seed = i + 1;
  return {
    seed, last: 7 + (i % 10), empty: i % 9 === 4 ? [3 + (i % 3)] : [],
    raw: (round) => raw4(seed * 37 + round * 11 + (seed % 4) * round),
    carried: (round) => raw4(seed * 13 + round * 7),
  };
});

let db: PGlite;
const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await rows<T>(sql, params))[0]!;
const drain = async (): Promise<void> => { expect((await one<{ n: number }>('select public.pool_refresh_dirty() as n')).n).toBeGreaterThanOrEqual(0); };

/** One whole run in one statement, as a v2 client uploads it. `opts` breaks it on purpose. */
async function upload(f: Fixture, opts: { ref?: string; dropCarried?: number; noCarried?: boolean } = {}): Promise<void> {
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
      for (let r = f.last + 1; r <= LAST_REF; r++) if (r !== opts.dropCarried) rounds[String(r)] = f.carried(r);
      carried = { ref: opts.ref ?? V2, rounds };
    }
    const k = params.length;
    params.push(w, `p${f.seed}`, f.seed, JSON.stringify(snap), empty ? null : f.raw(w), empty ? null : opts.ref ?? V2, empty ? null : Math.min(w, LAST_REF), carried === null ? null : JSON.stringify(carried));
    values.push(`('0.1.0+abc', $${k + 1}, 'h_aria', 1, $${k + 2}, $${k + 3}, $${k + 4}::jsonb, $${k + 5}::numeric, $${k + 6}, $${k + 7}::smallint, $${k + 8}::jsonb)`);
  }
  await db.query(`insert into public.boards (patch, wave, hero_id, power, author, seed, snapshot, strength_raw, strength_ref, strength_wave, strength_carried) values ${values.join(', ')}`, params);
}

/** What `rateRunsV2` says about the fixtures. */
function expected(fixtures: readonly Fixture[]): Map<number, { strength: number | null; early: number | null; late: number | null }> {
  const raws: RawRound[] = [];
  for (const f of fixtures) {
    for (let r = 1; r <= f.last; r++) raws.push({ runKey: String(f.seed), round: r, raw: f.empty.includes(r) ? 0 : f.raw(r), carried: false });
    for (let r = f.last + 1; r <= LAST_REF; r++) raws.push({ runKey: String(f.seed), round: r, raw: f.carried(r), carried: true });
  }
  const rated = rateRunsV2(raws, new Map(), (round) => Math.min(round, LAST_REF));
  return new Map(rated.map((r) => [Number(r.key), { strength: r.strength, early: r.early, late: r.late }]));
}
const actual = async (): Promise<Map<number, { strength: number | null; early: number | null; late: number | null }>> => {
  const num = (x: string | null): number | null => (x === null ? null : Number(x));
  const rs = await rows<{ seed: number; s: string | null; e: string | null; l: string | null }>(
    'select seed::int as seed, strength::text as s, strength_early::text as e, strength_late::text as l from public.pool_runs where live order by seed');
  return new Map(rs.map((r) => [r.seed, { strength: num(r.s), early: num(r.e), late: num(r.l) }]));
};

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const sql of CHAIN) await db.exec(sql);
  await db.exec(HUB_STUB);
  await db.exec(read('2026-11-22-pool-rolling-window.sql'));
  await db.exec(read('2026-11-23-strength-v2.sql'));
  for (const f of FIXTURES) await upload(f);
  await drain();
}, 240_000);
afterAll(async () => { await db?.close(); });

describe('strength v2 in the database', () => {
  it('names the current reference in one place', async () => {
    expect(await one('select public.strength_ref_current() as v, public.strength_ref_last_round() as lr')).toEqual({ v: V2, lr: LAST_REF });
  });

  it('parity: every run\'s Game strength, EARLY and LATE equal rateRunsV2', async () => {
    const want = expected(FIXTURES);
    const got = await actual();
    expect(got.size).toBe(30);
    for (const f of FIXTURES) expect(got.get(f.seed), `run ${f.seed} (last round ${f.last})`).toEqual(want.get(f.seed));
    // The fixture really exercises the rules: every run has a LATE, and the numbers spread.
    expect([...got.values()].every((r) => r.late !== null && r.strength !== null)).toBe(true);
    expect(new Set([...got.values()].map((r) => r.strength)).size).toBeGreaterThan(10);
  });

  it('the histogram the client ranks its own board against is the same population: one entry per live run per round', async () => {
    const h = await rows<{ wave: number; n: string }>('select wave, sum(n)::text as n from public.board_strength_histogram($1) group by wave order by wave', [V2]);
    expect(h.map((r) => r.wave)).toEqual(Array.from({ length: LAST_REF }, (_, i) => i + 1));
    for (const r of h) expect(Number(r.n), `round ${r.wave}`).toBe(30);
  });

  it('floor: a run that ends on round 6 is not eligible; round 7 is', async () => {
    await upload({ ...FIXTURES[0]!, seed: 106, last: 6, empty: [] });
    await upload({ ...FIXTURES[0]!, seed: 107, last: 7, empty: [] });
    await drain();
    expect(await rows('select seed::int as seed, eligible, live from public.pool_runs where seed in (106, 107) order by seed'))
      .toEqual([{ seed: 106, eligible: false, live: false }, { seed: 107, eligible: true, live: true }]);
    await db.query('delete from public.boards where seed in (106, 107)');
    await drain();
  });

  it('incomplete: a run missing one carried round, its carried map, or on the old reference version is unscored', async () => {
    await upload({ ...FIXTURES[1]!, seed: 201 }, { dropCarried: 14 });
    await upload({ ...FIXTURES[1]!, seed: 202 }, { noCarried: true });
    await upload({ ...FIXTURES[1]!, seed: 203 }, { ref: 'set2-v1' });
    await drain();
    const got = await rows<{ seed: number; strength: string | null; strength_early: string | null; strength_late: string | null; eligible: boolean }>(
      'select seed::int as seed, strength, strength_early, strength_late, eligible from public.pool_runs where seed in (201, 202, 203) order by seed');
    expect(got).toEqual([201, 202, 203].map((seed) => ({ seed, strength: null, strength_early: null, strength_late: null, eligible: true })));
    expect((await one<{ n: number }>('select public.pool_live_unscored() as n')).n).toBe(3);
    // An unscored run is not in the population either: the other runs keep their numbers.
    const want = expected(FIXTURES);
    const now = await actual();
    for (const f of FIXTURES) expect(now.get(f.seed)).toEqual(want.get(f.seed));
  });

  it('banded draw: an unscored run is left out of any draw with a band or a cap, and stays in an open draw', async () => {
    const keys = async (args: string): Promise<number[]> =>
      (await rows<{ run_key: string }>(`select run_key from public.pool_runs_sample_keys(p_limit => 300, p_set => 'set2', p_seed => 'z'${args})`)).map((r) => Number(r.run_key.split('|')[2])).sort((a, b) => a - b);
    const open = await keys('');
    expect(open).toEqual(expect.arrayContaining([201, 202, 203]));
    expect(open).toHaveLength(33);
    for (const args of [', p_strength_min => 0, p_strength_max => 100', ', p_strength_cap => 100', ', p_strength_min => 0, p_strength_max => 100, p_early_weight => 0.8']) {
      const banded = await keys(args);
      expect(banded, args).toHaveLength(30);
      expect(banded.some((s) => s > 200), args).toBe(false);
    }
    const viaSample = (await rows<{ run_key: string }>("select run_key from public.pool_runs_sample(p_limit => 300, p_set => 'set2', p_seed => 'z', p_strength_min => 0, p_strength_max => 100)")).map((r) => Number(r.run_key.split('|')[2]));
    expect(viaSample.sort((a, b) => a - b)).toEqual(await keys(', p_strength_min => 0, p_strength_max => 100'));
  });

  it('text parity: the two picking blocks are still identical', () => {
    const sql = read('2026-11-23-strength-v2.sql');
    const block = (fn: string): string => {
      const body = sql.slice(sql.indexOf(`create or replace function public.${fn}(`));
      return body.slice(body.indexOf('  select min(r.id), max(r.id) into lo, hi'), body.indexOf('  end if;\n', body.indexOf('while coalesce(array_length')) + 10)
        .replace("then return; end if;", "then return '{}'; end if;");
    };
    expect(block('pool_runs_sample')).toBe(block('pool_runs__pick'));
    expect(block('pool_runs__pick')).toContain('r.strength is not null');
  });

  it('re-run: applying the migration again changes nothing', async () => {
    const before = await rows('select seed, eligible, live, strength, strength_early, strength_late from public.pool_runs order by seed');
    await db.exec(read('2026-11-23-strength-v2.sql'));
    expect(await rows('select seed, eligible, live, strength, strength_early, strength_late from public.pool_runs order by seed')).toEqual(before);
  });
});
