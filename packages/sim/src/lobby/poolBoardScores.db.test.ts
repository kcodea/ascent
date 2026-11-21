import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STRENGTH_REF_VERSION } from './boardStrength';

/**
 * EVERY BOARD THE POOL SERVES CARRIES ITS STORED v2 SCORE (Relevant Strength, spec
 * docs/superpowers/specs/2026-11-20-strength-while-you-faced-them-design.md; supabase/migrations/2026-11-26-pool-board-scores.sql).
 * `poolScore {ref, raw, wave}` rides on a board whose `strength_raw` is set at the CURRENT reference, `poolCarried`
 * on the final board when `strength_carried` is at the current reference; otherwise the keys are absent. The
 * run rev (`pool_run__rev`) and the rev `pool_runs_boards` returns are the same number, salted so caches refetch.
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

const V2 = STRENGTH_REF_VERSION;
const LAST = 8;
let db: PGlite;
let runId: number;
const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;

interface Board { wave: number; poolScore?: { ref: string; raw: number; wave: number }; poolCarried?: { ref: string; rounds: Record<string, number> } }
const sorted = (bs: Board[]): Board[] => [...bs].sort((a, b) => a.wave - b.wave);

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const sql of CHAIN) await db.exec(sql);
  await db.exec(HUB_STUB);
  for (const f of ['2026-11-22-pool-rolling-window.sql', '2026-11-23-strength-v2.sql', '2026-11-24-strength-peak-cap.sql',
    '2026-11-25-strength-peak-from-round-4.sql', '2026-11-26-pool-board-scores.sql']) await db.exec(read(f));
  for (let w = 1; w <= LAST; w++) {
    const snap = { v: 1, wave: w, heroId: 'h_aria', resolve: 30, tier: 2, triples: 0, tribes: [], threat: 'glass', power: w, seed: 1, origin: 'self',
      author: 'p1', setId: 'set2', minions: [{ cardId: 'pack', attack: w, health: w, keywords: [], golden: false }] };
    await db.query(
      "insert into public.boards (patch, wave, hero_id, power, author, seed, snapshot) values ('0.1.0+abc', $1, 'h_aria', 1, 'p1', 1, $2::jsonb)",
      [w, JSON.stringify(snap)]);
  }
  // Round 3: scored at the current reference. Round 4: scored at an OLD reference (no poolScore). The final board: carried.
  await db.query("update public.boards set strength_raw = 0.6, strength_ref = public.strength_ref_current(), strength_wave = 3 where wave = 3");
  await db.query("update public.boards set strength_raw = 0.5, strength_ref = 'set2-v1', strength_wave = 4 where wave = 4");
  await db.query("update public.boards set strength_carried = $1::jsonb where wave = $2", [JSON.stringify({ ref: V2, rounds: { '9': 0.4 } }), LAST]);
  await db.query("select public.pool_refresh_dirty()");
  runId = Number((await rows<{ id: string }>("select id::text as id from public.pool_runs where live limit 1"))[0]!.id);
}, 240_000);
afterAll(async () => { await db?.close(); });

const boardsOf = async (): Promise<Board[]> =>
  sorted((await rows<{ boards: Board[] }>('select boards from public.pool_runs_boards($1::bigint[])', [[runId]]))[0]!.boards);

describe('pool boards carry their current-version score', () => {
  it('pool_runs_boards: poolScore on the current-version board, poolCarried on the final, nothing on a v1 board', async () => {
    const bs = await boardsOf();
    expect(bs).toHaveLength(LAST);
    expect(bs.find((b) => b.wave === 3)!.poolScore).toEqual({ ref: V2, raw: 0.6, wave: 3 });
    expect(bs.find((b) => b.wave === 4)).not.toHaveProperty('poolScore');
    expect(bs.find((b) => b.wave === LAST)!.poolCarried).toEqual({ ref: V2, rounds: { '9': 0.4 } });
    for (const b of bs.filter((x) => x.wave !== 3)) expect(b).not.toHaveProperty('poolScore');
    for (const b of bs.filter((x) => x.wave !== LAST)) expect(b).not.toHaveProperty('poolCarried');
  });

  it('pool_runs_sample returns the same board objects', async () => {
    const s = await rows<{ boards: Board[] }>("select boards from public.pool_runs_sample(p_limit => 10, p_set => 'set2')");
    expect(s).toHaveLength(1);
    expect(sorted(s[0]!.boards)).toEqual(await boardsOf());
  });

  it('a carried score at another reference is dropped', async () => {
    await db.query("update public.boards set strength_carried = $1::jsonb where wave = $2", [JSON.stringify({ ref: 'set2-v1', rounds: { '9': 0.4 } }), LAST]);
    expect(await boardsOf()).not.toContainEqual(expect.objectContaining({ poolCarried: expect.anything() }));
    await db.query("update public.boards set strength_carried = $1::jsonb where wave = $2", [JSON.stringify({ ref: V2, rounds: { '9': 0.4 } }), LAST]);
  });

  it('the returned rev is pool_run__rev, and it is salted', async () => {
    const r = (await rows<{ rev: string }>('select rev from public.pool_runs_boards($1::bigint[])', [[runId]]))[0]!.rev;
    const via = (await rows<{ rev: string }>("select public.pool_run__rev('p1', 'h_aria', 1) as rev"))[0]!.rev;
    expect(r).toBe(via);
    const unsalted = (await rows<{ rev: string }>(
      "select md5(coalesce(string_agg(x.id::text || ':' || x.xmin::text, ',' order by x.wave, x.created_at, x.id), '')) as rev from public.boards x where x.author = 'p1' and x.seed = 1"))[0]!.rev;
    expect(r).not.toBe(unsalted);
  });
});
