import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE POOL DELTA, server side (Supabase cleanup P1.5, owner ruling 2026-10-28: "yes, cache them"; owner bar: snapshots
 * served on exactly the right turn with exact recorded state). PGlite runs the whole pool migration chain, then
 * `supabase/migrations/2026-11-08-pool-runs-delta.sql`, and proves:
 *
 *  - `pool_runs__pick` is the picking block of `pool_runs_sample` VERBATIM (text compare);
 *  - for a seeded draw, `pool_runs_sample_keys` returns the SAME runs in the SAME order with the same wave counts and
 *    strengths as `pool_runs_sample`, across bands, caps, early weights, limits and both picking branches;
 *  - `pool_runs_boards` returns each run's boards byte-identical to `pool_runs_sample`'s, with the keys answer's `rev`;
 *  - `rev` moves when any board of the run is added, updated or deleted, and only for that run;
 *  - the file re-runs cleanly.
 */
const root = join(__dirname, '../../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const CHAIN = [
  '2026-09-29-pool-whole-runs.sql', '2026-09-30-board-strength.sql', '2026-09-30-weighted-strength.sql',
  '2026-10-03-final-board-strength.sql', '2026-10-06-weighted-strength-again.sql', '2026-10-06-early-late-strength.sql',
  '2026-10-09-strength-overall-caps.sql', '2026-10-17-pool-empty-boards.sql',
].map(read);
const SAMPLE_SRC = read('2026-10-17-pool-empty-boards.sql');
const DELTA = read('2026-11-08-pool-runs-delta.sql');

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
const HEROES = ['warden', 'soren', 'albus', 'myra', 'indy'];
async function upload(author: string, hero: string, seed: number, waves: number, opts: { empty?: number[]; synthetic?: boolean } = {}): Promise<void> {
  const values: string[] = [];
  const params: unknown[] = [];
  for (let w = 1; w <= waves; w++) {
    const empty = opts.empty?.includes(w) ?? false;
    const snap = {
      v: 1, wave: w, heroId: hero, resolve: 30, tier: Math.min(6, 1 + Math.floor(w / 3)), triples: 0, tribes: [], threat: 'glass',
      power: w, seed, origin: opts.synthetic ? 'synthetic' : 'self', author, setId: 'set2',
      minions: empty ? [] : [{ cardId: 'k_geode', attack: w + seed % 7, health: 3 + w, keywords: [], golden: false, text: `Live ${seed}:${w}` }],
    };
    const i = params.length;
    params.push('0.1.0+abc', w, hero, w, author, seed, JSON.stringify(snap), opts.synthetic ? 'synthetic' : null);
    values.push(`($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}, $${i + 6}, $${i + 7}::jsonb, $${i + 8})`);
  }
  await db.query(`insert into public.boards (patch, wave, hero_id, power, author, seed, snapshot, origin) values ${values.join(', ')}`, params);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const sql of CHAIN) await db.exec(sql);
  for (let i = 0; i < 40; i++) await upload(`P${i}`, HEROES[i % HEROES.length]!, 1000 + i, 6 + (i % 9), i % 6 === 0 ? { empty: [1] } : {});
  await upload('Bot', 'warden', 77, 10, { synthetic: true });
  // Spread strengths so bands, caps and early weights filter differently (a few stay unscored).
  await db.exec(`update public.pool_runs set strength = case when id % 7 = 0 then null else (id * 37) % 100 end,
                   strength_early = (id * 53) % 100, strength_late = (id * 29) % 100`);
  await db.exec(DELTA);
}, 120_000);
afterAll(async () => { await db?.close(); });

const norm = (s: string): string => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
function pickBlock(src: string, fn: string): string {
  const at = src.indexOf(`create or replace function public.${fn}(`);
  const body = src.slice(src.indexOf('#variable_conflict use_column', at));
  const start = body.indexOf('declare');
  const end = fn === 'pool_runs__pick' ? body.indexOf('return picked;') : body.indexOf('return query');
  return norm(body.slice(start, end));
}

interface SampleRow { run_key: string; author: string; user_id: string | null; wave_count: number; strength: string | null; strength_early: string | null; strength_late: string | null; boards: unknown }
interface KeyRow { run_id: string; run_key: string; author: string; user_id: string | null; wave_count: number; strength: string | null; strength_early: string | null; strength_late: string | null; rev: string }
const ARGS = '$1::int, $2::text, $3::text, $4::uuid, $5::text, $6::numeric, $7::numeric, $8::text, $9::numeric, $10::numeric';
type Args = [number, string | null, string | null, null, string, number | null, number | null, null, number | null, number | null];
const sample = async (a: Args) => (await db.query<SampleRow>(`select run_key, author, user_id, wave_count, strength::text, strength_early::text, strength_late::text, boards::text as boards from public.pool_runs_sample(${ARGS})`, a)).rows;
const keys = async (a: Args) => (await db.query<KeyRow>(`select run_id::text, run_key, author, user_id, wave_count, strength::text, strength_early::text, strength_late::text, rev from public.pool_runs_sample_keys(${ARGS})`, a)).rows;
const boardsOf = async (ids: string[]) => (await db.query<{ run_id: string; run_key: string; rev: string; boards: string }>(
  'select run_id::text, run_key, rev, boards::text as boards from public.pool_runs_boards($1::bigint[])', [ids])).rows;

const COMBOS: Args[] = [];
for (const seed of ['s1', 'abc', 'zz9']) {
  for (const limit of [150, 12, 3]) { // 150 and 12: the shuffle branch; 3 (40 runs > 4 x 3): rejection sampling
    COMBOS.push([limit, 'set2', '0.1.0+', null, seed, null, null, null, null, null]);
    COMBOS.push([limit, 'set2', '0.1.0+', null, seed, 20, 70, null, null, null]);
    COMBOS.push([limit, 'set2', '0.1.0+', null, seed, 10, 80, null, 0.4, null]);
    COMBOS.push([limit, 'set2', '0.1.0+', null, seed, 0, 90, null, 0.25, 60]);
    COMBOS.push([limit, null, null, null, seed, null, null, null, null, 50]);
  }
}

describe('pool_runs_sample_keys + pool_runs_boards == pool_runs_sample', () => {
  it('the picking block is the sample\'s, verbatim', () => {
    const sampleBlock = pickBlock(SAMPLE_SRC, 'pool_runs_sample').replace("then return; end if;", "then return '{}'; end if;");
    expect(pickBlock(DELTA, 'pool_runs__pick')).toBe(sampleBlock);
  });

  it(`a seeded draw: the same runs, same order, same wave counts and strengths (${COMBOS.length} parameter sets)`, async () => {
    let nonEmpty = 0;
    for (const a of COMBOS) {
      const s = await sample(a);
      const k = await keys(a);
      expect(k.map((r) => r.run_key)).toEqual(s.map((r) => r.run_key));
      expect(k.map(({ run_key, author, user_id, wave_count, strength, strength_early, strength_late }) => ({ run_key, author, user_id, wave_count, strength, strength_early, strength_late })))
        .toEqual(s.map(({ run_key, author, user_id, wave_count, strength, strength_early, strength_late }) => ({ run_key, author, user_id, wave_count, strength, strength_early, strength_late })));
      if (s.length) nonEmpty++;
    }
    expect(nonEmpty).toBeGreaterThan(COMBOS.length / 2);
  });

  it("each run's boards are byte-identical to the sample's, under the keys answer's rev", async () => {
    const a: Args = [150, 'set2', '0.1.0+', null, 'full', null, null, null, null, null];
    const s = await sample(a);
    const k = await keys(a);
    expect(s.length).toBe(40 - 0); // every eligible run (the synthetic one never is)
    const b = await boardsOf(k.map((r) => r.run_id));
    const byKey = new Map(b.map((r) => [r.run_key, r]));
    for (let i = 0; i < s.length; i++) {
      const got = byKey.get(s[i]!.run_key)!;
      expect(got.boards).toBe(s[i]!.boards);
      expect(got.rev).toBe(k[i]!.rev);
    }
  });

  it('rev moves on an insert, an update or a delete of a board of THAT run only', async () => {
    const revs = async () => new Map((await keys([150, 'set2', '0.1.0+', null, 'r', null, null, null, null, null])).map((r) => [r.run_key, r.rev]));
    const before = await revs();
    const target = 'P3|myra|1003';
    const other = 'P4|indy|1004';
    await db.exec(`update public.boards set snapshot = jsonb_set(snapshot, '{power}', '99') where author = 'P3' and wave = 2`);
    const afterUpdate = await revs();
    expect(afterUpdate.get(target)).not.toBe(before.get(target));
    expect(afterUpdate.get(other)).toBe(before.get(other));
    await db.exec(`update public.boards set power = power where author = 'P4' and wave = 1`); // a no-op UPDATE is still a new row version
    const afterNoop = await revs();
    expect(afterNoop.get(other)).not.toBe(afterUpdate.get(other));
    const pre = afterNoop.get(target);
    await upload('P3', 'myra', 1003, 1); // a second wave-1 board of the same run
    const afterInsert = await revs();
    expect(afterInsert.get(target)).not.toBe(pre);
    await db.exec(`delete from public.boards where author = 'P3' and wave = 1 and created_at = (select max(created_at) from public.boards where author = 'P3' and wave = 1)`);
    expect((await revs()).get(target)).not.toBe(afterInsert.get(target));
    // And the boards read agrees with the sample again after all of it.
    const s = (await sample([150, 'set2', '0.1.0+', null, 'full', null, null, null, null, null])).find((r) => r.run_key === target)!;
    const id = (await keys([150, 'set2', '0.1.0+', null, 'full', null, null, null, null, null])).find((r) => r.run_key === target)!.run_id;
    expect((await boardsOf([id]))[0]!.boards).toBe(s.boards);
  });

  it('refuses more than 300 ids; an unknown id is simply absent', async () => {
    await expect(boardsOf(Array.from({ length: 301 }, (_, i) => String(i + 1)))).rejects.toThrow(/too_many_runs/);
    expect(await boardsOf(['999999'])).toEqual([]);
  });

  it('the migration is idempotent', async () => {
    const a: Args = [12, 'set2', '0.1.0+', null, 'idem', null, null, null, null, null];
    const before = await keys(a);
    await db.exec(DELTA);
    expect(await keys(a)).toEqual(before);
  });
});
