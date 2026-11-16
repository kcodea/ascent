import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE ROLLING POOL (R-POOL-ROLLING-01, owner 2026-11-15: "its tough facing strong boards that are now weakened due to
 * balancing changes", "lets do newest 250 runs"; supabase/migrations/2026-11-22-pool-rolling-window.sql).
 * A new lobby is seated only from the newest `pool_live_limit()` eligible runs of its card set, by `pool_runs.id`
 * (upload order). Older runs stay stored and are never drawn. The tests shrink the limit to 10 so fixtures stay small.
 */
const root = join(__dirname, '../../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const CHAIN = [
  '2026-09-29-pool-whole-runs.sql', '2026-09-30-board-strength.sql', '2026-09-30-weighted-strength.sql',
  '2026-10-03-final-board-strength.sql', '2026-10-06-weighted-strength-again.sql', '2026-10-06-early-late-strength.sql',
  '2026-10-09-strength-overall-caps.sql', '2026-10-17-pool-empty-boards.sql', '2026-11-07-pool-refresh-off-upload.sql',
  '2026-11-08-pool-runs-delta.sql',
].map(read);
const WINDOW_FILE = '2026-11-22-pool-rolling-window.sql';

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
  -- The hub key check (2026-11-20-game-session-cf.sql), so the mirror's reads can be called here.
  create function public.session_cf__key_ok(p_key text) returns boolean language sql stable as 'select true';
`;

let db: PGlite;
let WINDOW = '';
beforeEach(async () => {
  WINDOW = read(WINDOW_FILE);
  db = new PGlite();
  await db.exec(STUB);
  for (const sql of CHAIN) await db.exec(sql);
  await db.exec(WINDOW);
}, 120_000);
afterEach(async () => { await db?.close(); });

const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await rows<T>(sql, params))[0]!;
const drain = async (): Promise<void> => { await db.query('select public.pool_refresh_dirty()'); };
const limitTo = async (n: number): Promise<void> => {
  await db.exec(`create or replace function public.pool_live_limit() returns int language sql immutable as 'select ${n}'`);
};

/** One whole run in one statement (as the client uploads it): waves `from`..`to`, each board scored `raw`. */
async function upload(seed: number, opts: { set?: string; from?: number; to?: number; raw?: number | null } = {}): Promise<void> {
  const { set = 'set2', from = 1, to = 6, raw = seed } = opts;
  const values: string[] = [];
  const params: unknown[] = [];
  for (let w = from; w <= to; w++) {
    const snap = { v: 1, wave: w, heroId: 'h_aria', resolve: 30, tier: Math.min(6, 1 + Math.floor(w / 3)), triples: 0, tribes: [], threat: 'glass',
      power: w, seed, origin: 'self', author: `p${seed}`, setId: set, minions: [{ cardId: 'pack', attack: w, health: w, keywords: [], golden: false }] };
    const k = params.length;
    params.push('0.1.0+abc', w, `p${seed}`, seed, JSON.stringify(snap), raw, raw === null ? null : `${set}-v1`, raw === null ? null : w);
    values.push(`($${k + 1}, $${k + 2}, 'h_aria', 1, $${k + 3}, $${k + 4}, $${k + 5}::jsonb, $${k + 6}::numeric, $${k + 7}, $${k + 8}::smallint)`);
  }
  await db.query(`insert into public.boards (patch, wave, hero_id, power, author, seed, snapshot, strength_raw, strength_ref, strength_wave) values ${values.join(', ')}`, params);
}
/** Upload runs with seeds `from`..`to`, one job run after each (a new run's id follows its upload order). */
async function uploadRuns(from: number, to: number, opts: { set?: string } = {}): Promise<void> {
  for (let s = from; s <= to; s++) { await upload(s, opts); await drain(); }
}
const liveSeeds = async (set = 'set2'): Promise<number[]> =>
  (await rows<{ seed: number }>('select seed::int from public.pool_runs where live and set_id = $1 order by id', [set])).map((r) => r.seed);
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const sampleKeys = async (fn: string, seed: string, limit = 300): Promise<string[]> =>
  (await rows<{ run_key: string }>(`select run_key from public.${fn}(p_limit => $1, p_set => 'set2', p_seed => $2)`, [limit, seed])).map((r) => r.run_key);

describe('the rolling pool window', () => {
  it('the limit is 250', async () => {
    expect((await one<{ n: number }>('select public.pool_live_limit() as n')).n).toBe(250);
  });

  it('window: only the newest N eligible runs of a set are live, and only those are ever drawn', async () => {
    await limitTo(10);
    await uploadRuns(1, 12);
    expect(Number((await one<{ n: number }>('select count(*) n from public.pool_runs where eligible')).n)).toBe(12);
    expect(await liveSeeds()).toEqual(range(3, 12));
    for (const seed of ['s', 't', 'u']) {
      expect((await sampleKeys('pool_runs_sample', seed)).sort()).toEqual(range(3, 12).map((s) => `p${s}|h_aria|${s}`).sort());
      expect((await sampleKeys('pool_runs_sample', seed, 2)).every((k) => Number(k.split('|')[2]) >= 3)).toBe(true); // rejection branch
    }
  });

  it('rolls: a new run takes the oldest live run\'s place', async () => {
    await limitTo(10);
    await uploadRuns(1, 12);
    await uploadRuns(13, 13);
    expect(await liveSeeds()).toEqual(range(4, 13));
  });

  it('small set: fewer eligible runs than the limit are all live', async () => {
    await limitTo(10);
    await uploadRuns(1, 4);
    expect(await liveSeeds()).toEqual(range(1, 4));
  });

  it('ineligible newest: a run that cannot be seated takes no slot and pushes nobody out', async () => {
    await limitTo(10);
    await uploadRuns(1, 12);
    await upload(13, { from: 3, to: 6 }); // starts at round 3: never a whole run
    await drain();
    expect((await one<{ eligible: boolean; live: boolean }>('select eligible, live from public.pool_runs where seed = 13'))).toEqual({ eligible: false, live: false });
    expect(await liveSeeds()).toEqual(range(3, 12));
  });

  it('touch old run: re-uploading or re-scoring a run that left the window does not bring it back', async () => {
    await limitTo(10);
    await uploadRuns(1, 12);
    await db.query('update public.boards set power = power + 1, strength_raw = 99 where seed = 1');
    await drain();
    await db.query('delete from public.boards where seed = 2 and wave = 6');
    await upload(2, { from: 6, to: 6 });
    await drain();
    expect(await liveSeeds()).toEqual(range(3, 12));
  });

  it('per set: each card set keeps its own window', async () => {
    await limitTo(10);
    await uploadRuns(1, 12);
    await uploadRuns(101, 103, { set: 'set1' });
    await uploadRuns(13, 13);
    expect(await liveSeeds('set2')).toEqual(range(4, 13));
    expect(await liveSeeds('set1')).toEqual([101, 102, 103]);
  });

  it('strength among live: live runs are ranked among themselves; a run that left keeps its last number', async () => {
    await limitTo(10);
    // Seeds 1 and 2 are the two STRONGEST runs (raw 200, 199); the rest rise with their seed.
    await upload(1, { raw: 200 }); await drain();
    await upload(2, { raw: 199 }); await drain();
    await uploadRuns(3, 10);
    const strengthOf = async (seed: number): Promise<string | null> =>
      (await one<{ s: string | null }>('select strength::text s from public.pool_runs where seed = $1', [seed])).s;
    // Each run's last number is the one it held in the last window it was part of.
    const last1 = await strengthOf(1);
    await uploadRuns(11, 11); // seed 1 leaves
    const last2 = await strengthOf(2);
    await uploadRuns(12, 12); // seed 2 leaves
    expect(last1).not.toBeNull();
    expect(last2).not.toBeNull();
    expect([await strengthOf(1), await strengthOf(2)]).toEqual([last1, last2]);

    const RANK = (where: string): string => `select r.seed::int, public.board_strength_pct((rank() over (order by r.strength_avg) - 1)::bigint,
      count(*) over (partition by r.strength_avg), count(*) over ())::numeric::text s
      from public.pool_runs r where r.strength_avg is not null and ${where} order by r.seed`;
    const got = await rows<{ seed: number; s: string }>('select seed::int, strength::text s from public.pool_runs where live order by seed');
    const amongLive = await rows<{ seed: number; s: string }>(RANK('r.live'));
    const amongAll = (await rows<{ seed: number; s: string }>(RANK('r.eligible'))).filter((r) => r.seed >= 3);
    expect(got).toEqual(amongLive);
    expect(got).not.toEqual(amongAll); // the two strong runs that left no longer push the live ones down
    // The histogram the client ranks its own game against holds the live runs only.
    const hist = await one<{ n: number }>("select coalesce(sum(n), 0)::int n from public.run_strength_histogram('set2')");
    expect(hist.n).toBe(10);
  });

  it('a manual full strength refresh leaves a run outside the window alone', async () => {
    await limitTo(10);
    await uploadRuns(1, 12);
    const before = await rows('select seed::int, strength::text s from public.pool_runs where not live order by seed');
    await db.query('select public.pool_strength_refresh(null, null, null)');
    expect(await rows('select seed::int, strength::text s from public.pool_runs where not live order by seed')).toEqual(before);
  });

  it('changing the limit takes effect on the next refresh, both ways', async () => {
    await uploadRuns(1, 12);
    expect((await liveSeeds()).length).toBe(12);
    await limitTo(5);
    expect(Number((await one<{ n: number }>('select public.pool_live_refresh() as n')).n)).toBe(7);
    expect(await liveSeeds()).toEqual(range(8, 12));
    await limitTo(250);
    await db.query('select public.pool_live_refresh()');
    expect((await liveSeeds()).length).toBe(12);
    expect(Number((await one<{ n: number }>('select public.pool_live_refresh() as n')).n)).toBe(0); // nothing to change
  });

  it('parity: the keys draw still equals the sample, and the two picking blocks are identical', async () => {
    const norm = (s: string): string => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
    const pickBlock = (fn: string): string => {
      const at = WINDOW.indexOf(`create or replace function public.${fn}(`);
      expect(at).toBeGreaterThan(-1);
      const body = WINDOW.slice(WINDOW.indexOf('#variable_conflict use_column', at));
      const end = fn === 'pool_runs__pick' ? body.indexOf('return picked;') : body.indexOf('return query');
      return norm(body.slice(body.indexOf('declare'), end));
    };
    expect(pickBlock('pool_runs__pick')).toBe(pickBlock('pool_runs_sample').replace('then return; end if;', "then return '{}'; end if;"));
    expect(pickBlock('pool_runs__pick').match(/r\.eligible and r\.live/g)?.length).toBe(3);
    expect(pickBlock('pool_runs__pick').replace(/r\.eligible and r\.live/g, '')).not.toContain('r.eligible');

    await limitTo(10);
    await uploadRuns(1, 14);
    for (const seed of ['a', 'b', 'c']) {
      for (const limit of [300, 2]) {
        const s = await sampleKeys('pool_runs_sample', seed, limit);
        expect(s.length).toBe(limit === 2 ? 2 : 10);
        expect(await sampleKeys('pool_runs_sample_keys', seed, limit)).toEqual(s);
      }
    }
  });

  it('the hub mirror and its health check read the live runs only', async () => {
    await limitTo(10);
    await uploadRuns(1, 12);
    const idx = await rows<{ run_key: string }>("select run_key from public.pool_mirror_index('k') order by run_id");
    expect(idx.map((r) => r.run_key)).toEqual(range(3, 12).map((s) => `p${s}|h_aria|${s}`));
    const v1 = (await one<{ v: string }>("select public.pool_mirror_version('k') as v")).v;
    await uploadRuns(13, 13);
    expect((await one<{ v: string }>("select public.pool_mirror_version('k') as v")).v).not.toBe(v1);
    const src = (await one<{ s: string }>("select prosrc s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'ops' and p.proname = 'pool_digest'")).s;
    expect(src).toContain('where r.eligible and r.live');
  });

  it('pool_runs_sample keeps work_mem 16MB, and the job stays closed to clients', async () => {
    expect((await one<{ c: string[] }>("select proconfig c from pg_proc where proname = 'pool_runs_sample'")).c).toContain('work_mem=16MB');
    const priv = await one<Record<string, boolean>>(`select
      has_function_privilege('anon', 'public.pool_live_refresh()', 'execute') as refresh_anon,
      has_function_privilege('authenticated', 'public.pool_live_refresh()', 'execute') as refresh_auth,
      has_function_privilege('authenticated', 'public.pool_refresh_dirty()', 'execute') as job_auth,
      has_function_privilege('authenticated', 'public.pool_strength_refresh(text[], text[], bigint[])', 'execute') as strength_auth`);
    expect(priv).toEqual({ refresh_anon: false, refresh_auth: false, job_auth: false, strength_auth: false });
  });

  it('re-run: applying the migration again changes nothing', async () => {
    await uploadRuns(1, 5);
    const before = await rows('select id, live, strength::text from public.pool_runs order by id');
    await db.exec(WINDOW);
    await db.exec(WINDOW);
    expect(await rows('select id, live, strength::text from public.pool_runs order by id')).toEqual(before);
  });
});
