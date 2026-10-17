import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardSnapshot } from '../snapshot';
import { MIN_RUN_WAVES, runWavesCover } from './snapshotSeats';

/**
 * EMPTY BOARDS ARE PART OF A RUN, server side (owner 2026-10-17, R-LOBBY-08: "empty boards are never uploaded is a
 * problem. this has to be fixed"). PGlite runs the whole pool migration chain, then
 * `supabase/migrations/2026-10-17-pool-empty-boards.sql`, and checks that an uploaded EMPTY round counts as a wave of
 * its run (`first_wave` 1 for a Disco Dan), comes back in `pool_runs_sample` with the rest of the run (so the client's
 * wave count matches), and that a run with no minions anywhere is never eligible.
 */
const root = join(__dirname, '../../../..');
const CHAIN = [
  '2026-09-29-pool-whole-runs.sql', '2026-09-30-board-strength.sql', '2026-09-30-weighted-strength.sql',
  '2026-10-03-final-board-strength.sql', '2026-10-06-weighted-strength-again.sql', '2026-10-06-early-late-strength.sql',
  '2026-10-09-strength-overall-caps.sql', '2026-10-17-pool-empty-boards.sql',
].map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8'));

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
beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const sql of CHAIN) await db.exec(sql);
}, 60_000);
afterAll(async () => { await db?.close(); });

interface RunSpec { author: string; hero: string; seed: number; waves: number[]; empty: number[] }
const boardJson = (r: RunSpec, wave: number): BoardSnapshot => ({
  v: 1, wave, heroId: r.hero, resolve: 30, tier: wave === 1 ? 1 : 2, triples: 0, tribes: [], threat: 'glass',
  power: r.empty.includes(wave) ? 0 : wave, seed: r.seed, origin: 'self', author: r.author, setId: 'set2',
  minions: r.empty.includes(wave) ? [] : [{ cardId: 'k_geode', attack: 4, health: 3, keywords: [], golden: false }],
} as unknown as BoardSnapshot);

/** Upload a run as the client does: ONE insert with all of its boards. */
async function upload(r: RunSpec): Promise<void> {
  const values: string[] = [];
  const params: unknown[] = [];
  for (const w of r.waves) {
    const i = params.length;
    params.push('0.1.0+abc', w, r.hero, r.empty.includes(w) ? 0 : w, r.author, r.seed, JSON.stringify(boardJson(r, w)));
    values.push(`($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}, $${i + 6}, $${i + 7}::jsonb)`);
  }
  await db.query(`insert into public.boards (patch, wave, hero_id, power, author, seed, snapshot) values ${values.join(', ')}`, params);
}

const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('the pool keeps empty rounds', () => {
  it("a Disco Dan run with an empty wave 1 starts at wave 1, is eligible, and arrives whole with its empty board", async () => {
    const disco: RunSpec = { author: 'Orangez', hero: 'discodan', seed: 1184009036, waves: range(1, 8), empty: [1] };
    const ghost: RunSpec = { author: 'Ghost', hero: 'warden', seed: 2, waves: range(1, 6), empty: range(1, 6) };
    const holed: RunSpec = { author: 'Holed', hero: 'soren', seed: 3, waves: range(1, 8), empty: [4, 5] };
    for (const r of [disco, ghost, holed]) await upload(r);

    const rows = (await db.query<{ author: string; first_wave: number; wave_count: number; max_gap: number; eligible: boolean }>(
      'select author, first_wave, wave_count, max_gap, eligible from public.pool_runs order by author')).rows;
    const by = new Map(rows.map((r) => [r.author, r]));
    expect(by.get('Orangez')).toMatchObject({ first_wave: 1, wave_count: 8, max_gap: 0, eligible: true });
    expect(by.get('Holed')).toMatchObject({ first_wave: 1, wave_count: 8, max_gap: 0, eligible: true }); // empty rounds are not holes
    expect(by.get('Ghost')).toMatchObject({ eligible: false }); // nothing on board in any round
    // The SQL shape agrees with the TS rule over every uploaded wave.
    expect(MIN_RUN_WAVES <= 8 && runWavesCover(disco.waves)).toBe(true);

    const sample = (await db.query<{ author: string; wave_count: number; boards: BoardSnapshot[] }>(
      "select author, wave_count, boards from public.pool_runs_sample(50, 'set2', '0.1.0+', null, 'seed')")).rows;
    const got = sample.find((r) => r.author === 'Orangez')!;
    expect(got.boards.map((b) => b.wave)).toEqual(range(1, 8));
    expect(new Set(got.boards.map((b) => b.wave)).size).toBe(got.wave_count); // the client's whole-run check passes
    expect(got.boards[0]!).toMatchObject({ wave: 1, tier: 1, minions: [] });
    expect(sample.some((r) => r.author === 'Ghost')).toBe(false);
  });

  it('the migration is idempotent', async () => {
    const before = (await db.query('select author, first_wave, wave_count, eligible from public.pool_runs order by author')).rows;
    await db.exec(CHAIN[CHAIN.length - 1]!);
    const after = (await db.query('select author, first_wave, wave_count, eligible from public.pool_runs order by author')).rows;
    expect(after).toEqual(before);
  });
});
