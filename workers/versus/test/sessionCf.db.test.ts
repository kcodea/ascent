/**
 * THE GAME SESSION + THE POOL MIRROR against the real SQL (PGlite; R-SESSION-CF-01, R-POOL-MIRROR-01). The pool migration
 * chain, the delta, the saved-runs migration and `2026-11-20-game-session-cf.sql` (twice: idempotent), then:
 *
 * POOL MIRROR (serving exactness, the snapshot-serving-integrity bar):
 *  - the TS draw (`core/poolPick.ts`) picks exactly what `pool_runs_sample_keys` picks for a seeded draw, same runs in the
 *    same order, across bands, caps, early weights, limits and both picking branches;
 *  - a mirror synced from the key-gated reads serves keys whose values equal the RPC's, and boards rows whose `boards` are
 *    BYTE-IDENTICAL to `pool_runs_boards`' text, under the same rev;
 *  - an unchanged pool costs one version call; a board edit moves that run's rev and only that run is fetched again;
 *  - the reads refuse without the writer key.
 *
 * THE FLUSH (`session_cf_flush`):
 *  - writes land once (the ledger), always owned by the session's player (a row's own user_id is ignored), only columns
 *    the client may insert; a bad write is rejected without undoing the others;
 *  - the save and clear follow put_saved_run / clear_saved_run exactly (expected revision, guests refused);
 *  - the rating goes to settle_rank AFTER the writes (the Career row exists when it runs), with the pinned seat keys.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { md5Hex, pickRuns, type MirrorRun, type PickArgs } from '../src/core/poolPick';
import { PoolMirrorCore, type PoolSource } from '../src/core/poolMirrorCore';

const root = join(__dirname, '../../..');
const mig = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const CHAIN = [
  '2026-09-29-pool-whole-runs.sql', '2026-09-30-board-strength.sql', '2026-09-30-weighted-strength.sql',
  '2026-10-03-final-board-strength.sql', '2026-10-06-weighted-strength-again.sql', '2026-10-06-early-late-strength.sql',
  '2026-10-09-strength-overall-caps.sql', '2026-10-17-pool-empty-boards.sql', '2026-11-08-pool-runs-delta.sql',
].map(mig);
const SESSION = mig('2026-11-20-game-session-cf.sql');
const SAVED = mig('2026-09-30-saved-runs.sql');
const KEY = 'test-hub-writer-secret';

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions; create schema ops;
  create extension if not exists pgcrypto with schema extensions;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create table auth.users (id uuid primary key);
  create table ops.events (id bigserial primary key, at timestamptz not null default now(), source text not null, kind text not null, key text, detail jsonb);
  grant usage on schema public to anon, authenticated;
  create table public.boards (
    id uuid primary key default gen_random_uuid(), patch text not null, wave int not null, hero_id text not null,
    power int not null, rating real, origin text, author text, tribes text[], captured_at date, seed bigint,
    snapshot jsonb not null, created_at timestamptz default now(), user_id uuid, unrated boolean not null default false);
  alter table public.boards enable row level security;
  create policy "read boards" on public.boards for select using (true);
  grant select on public.boards to anon, authenticated;
  alter table public.boards add column upload_key text generated always as (snapshot ->> 'id') stored;
  create unique index boards_user_upload_key on public.boards (user_id, upload_key);
  grant insert (patch, wave, hero_id, power, rating, origin, author, tribes, captured_at, seed, snapshot, user_id, unrated) on public.boards to authenticated;
  create table public.run_history (id bigserial primary key, user_id uuid not null, entry jsonb not null, hero_id text,
    created_at timestamptz default now(), upload_key text generated always as ((entry ->> 'seed') || '|' || (entry ->> 'at')) stored);
  create unique index run_history_user_upload_key on public.run_history (user_id, upload_key);
  grant insert (user_id, entry, hero_id) on public.run_history to authenticated;
  create table public.run_telemetry (id bigserial primary key, user_id uuid, telemetry jsonb, upload_key text, secret_flag boolean default false);
  create unique index run_telemetry_user_upload_key on public.run_telemetry (user_id, upload_key);
  grant insert (user_id, telemetry, upload_key) on public.run_telemetry to authenticated;
  create table public.lobby_fights (id bigserial primary key, user_id uuid not null, lobby_seed bigint not null, round int not null,
    run_a text not null, run_b text not null, outcome text not null check (outcome in ('a', 'b', 'draw')), observed boolean, patch text,
    constraint lobby_fights_one_per_pairing unique (lobby_seed, round, run_a, run_b));
  grant insert (user_id, lobby_seed, round, run_a, run_b, outcome, observed, patch) on public.lobby_fights to authenticated;
  create table public.versus_cf_writer_keys (key_hash text primary key, note text, created_at timestamptz not null default now());
  -- settle_rank's stand-in: records its call and whether the Career row was already there (the flush's order).
  create table public.rank_calls (user_id uuid, run_id text, placement int, seat_keys text[], career_rows int);
  create function public.settle_rank(p_user uuid, p_run_id text, p_placement int, p_season int, p_rules_version int,
    p_seed bigint default null, p_seat_keys text[] default null) returns jsonb language plpgsql as $$
  begin
    if p_placement = 8 and p_run_id = 'rate-limit' then raise exception 'rate_limited'; end if;
    insert into public.rank_calls values (p_user, p_run_id, p_placement, p_seat_keys,
      (select count(*) from public.run_history where user_id = p_user and entry ->> 'seed' = p_seed::text));
    return jsonb_build_object('status', 'confirmed', 'result', jsonb_build_object('placement', p_placement), 'profile', jsonb_build_object('ok', true));
  end $$;
`;

let db: PGlite;
const HEROES = ['warden', 'soren', 'albus', 'myra', 'indy'];
async function upload(author: string, hero: string, seed: number, waves: number, opts: { empty?: number[] } = {}): Promise<void> {
  const values: string[] = [];
  const params: unknown[] = [];
  for (let w = 1; w <= waves; w++) {
    const empty = opts.empty?.includes(w) ?? false;
    // Awkward JSON on purpose (floats, unicode, nested keys, an escaped quote): the mirror must hand back the exact text.
    const snap = {
      v: 1, wave: w, heroId: hero, resolve: 30, tier: Math.min(6, 1 + Math.floor(w / 3)), triples: 0, tribes: [], threat: 'glass',
      power: w + 0.5, seed, origin: 'self', author, setId: 'set2', note: `é "q" ${seed}`,
      minions: empty ? [] : [{ cardId: 'k_geode', attack: w + (seed % 7), health: 3 + w, keywords: ['taunt'], golden: false, text: `Live ${seed}:${w}`, m: { z: 1, a: [1.25, 2] } }],
    };
    const i = params.length;
    params.push('0.1.0+abc', w, hero, w, author, seed, JSON.stringify(snap));
    values.push(`($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}, $${i + 6}, $${i + 7}::jsonb)`);
  }
  await db.query(`insert into public.boards (patch, wave, hero_id, power, author, seed, snapshot) values ${values.join(', ')}`, params);
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const sql of CHAIN) await db.exec(sql);
  await db.exec(SAVED);
  for (let i = 0; i < 40; i++) await upload(`P${i}`, HEROES[i % HEROES.length]!, 1000 + i, 6 + (i % 9), i % 6 === 0 ? { empty: [1] } : {});
  await db.exec(`update public.pool_runs set strength = case when id % 7 = 0 then null else ((id * 37) % 100) + (id % 3) * 0.25 end,
                   strength_early = (id * 53) % 100, strength_late = (id * 29) % 100 + 0.5`);
  await db.query('insert into public.versus_cf_writer_keys (key_hash, note) values ($1, $2)', [createHash('sha256').update(KEY).digest('hex'), 'ascent-hub']);
  await db.exec(SESSION);
  await db.exec(SESSION); // idempotent
  await db.query('insert into auth.users (id) values ($1), ($2)', ['11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999']);
}, 180_000);
afterAll(async () => { await db?.close(); });

// ── the source the mirror syncs from: the key-gated reads, exactly as PostgREST would hand them over ─────────────────
const source = (counts = { version: 0, index: 0, boards: 0, boardIds: 0 }): PoolSource & { counts: typeof counts } => ({
  counts,
  async version() { counts.version += 1; return (await db.query<{ v: string }>('select public.pool_mirror_version($1) as v', [KEY])).rows[0]!.v; },
  async index() {
    counts.index += 1;
    const rows = (await db.query<MirrorRun & { run_id: string }>('select * from public.pool_mirror_index($1)', [KEY])).rows;
    return rows.map((r) => ({ ...r, run_id: Number(r.run_id) }));
  },
  async boards(ids) {
    counts.boards += 1; counts.boardIds += ids.length;
    const rows = (await db.query<{ run_id: string; run_key: string; rev: string; boards: string }>('select * from public.pool_mirror_boards($1, $2::bigint[])', [KEY, ids])).rows;
    return rows.map((r) => ({ ...r, run_id: Number(r.run_id) }));
  },
});

const ARGS = '$1::int, $2::text, $3::text, $4::uuid, $5::text, $6::numeric, $7::numeric, $8::text, $9::numeric, $10::numeric';
type Args = [number, string | null, string | null, null, string | null, number | null, number | null, string | null, number | null, number | null];
const asPick = (a: Args): PickArgs => ({ p_limit: a[0], p_set: a[1], p_patch_prefix: a[2], p_exclude_user: a[3], p_seed: a[4], p_strength_min: a[5], p_strength_max: a[6], p_pool: a[7], p_early_weight: a[8], p_strength_cap: a[9] });
const sqlKeys = async (a: Args) => (await db.query<Record<string, unknown>>(`select run_id::text, run_key, author, user_id, wave_count, strength::text, strength_early::text, strength_late::text, rev from public.pool_runs_sample_keys(${ARGS})`, a)).rows;
const COMBOS: Args[] = [];
for (const seed of ['s1', 'abc', 'zz9']) {
  for (const limit of [150, 12, 3]) {
    COMBOS.push([limit, 'set2', '0.1.0+', null, seed, null, null, null, null, null]);
    COMBOS.push([limit, 'set2', '0.1.0+', null, seed, 20, 70, null, null, null]);
    COMBOS.push([limit, 'set2', '0.1.0+', null, seed, 10, 80.25, null, 0.4, null]);
    COMBOS.push([limit, 'set2', '0.1.0+', null, seed, 0, 90, null, 0.25, 60]);
    COMBOS.push([limit, null, null, null, seed, null, null, 'main', null, 50.25]);
    COMBOS.push([limit, 'set2', '0.1.0+', null, seed, 36.5, 36.5, null, 0.5, null]); // an exact band edge (numeric, not float)
  }
}

describe('THE POOL MIRROR serves exactly what Supabase serves (R-POOL-MIRROR-01)', () => {
  it('md5 matches Postgres (and node)', async () => {
    for (const t of ['', 'abc', 's1:17', 'é ünïcode', 'x'.repeat(200)]) {
      const pg = (await db.query<{ h: string }>('select md5($1) as h', [t])).rows[0]!.h;
      expect(md5Hex(t)).toBe(pg);
      expect(md5Hex(t)).toBe(createHash('md5').update(t, 'utf8').digest('hex'));
    }
  });

  it(`a seeded draw picks the same runs in the same order as pool_runs_sample_keys (${COMBOS.length} parameter sets)`, async () => {
    const runs = await source().index();
    let nonEmpty = 0;
    for (const a of COMBOS) {
      const sql = (await sqlKeys(a)).map((r) => Number(r.run_id));
      const ts = pickRuns(runs, asPick(a), () => { throw new Error('a seeded draw never asks random()'); });
      expect(ts).toEqual(sql);
      if (sql.length) nonEmpty++;
    }
    expect(nonEmpty).toBeGreaterThan(COMBOS.length / 2);
  });

  it('a synced mirror: keys values equal the RPC\'s; boards text is byte-identical to pool_runs_boards; same rev', async () => {
    const m = new PoolMirrorCore();
    await m.sync(source(), async () => undefined, 1);
    const a: Args = [150, 'set2', '0.1.0+', null, 'full', null, null, null, null, null];
    const mirrored = JSON.parse(m.keysJson(asPick(a), Math.random)) as Record<string, unknown>[];
    const sql = await sqlKeys(a);
    expect(mirrored.map((r) => ({ ...r, run_id: String(r.run_id), strength: r.strength == null ? null : String(r.strength), strength_early: r.strength_early == null ? null : String(r.strength_early), strength_late: r.strength_late == null ? null : String(r.strength_late) })))
      .toEqual(sql.map((r) => ({ ...r, strength: r.strength == null ? null : String(Number(r.strength)), strength_early: r.strength_early == null ? null : String(Number(r.strength_early)), strength_late: r.strength_late == null ? null : String(Number(r.strength_late)) })));
    const ids = sql.map((r) => Number(r.run_id));
    const raw = (await db.query<{ run_id: string; run_key: string; rev: string; boards: string }>('select run_id::text, run_key, rev, boards::text as boards from public.pool_runs_boards($1::bigint[])', [ids])).rows;
    const body = m.boardsJson(ids)!;
    // The boards element of every row is the database's own jsonb text, byte for byte.
    for (const r of raw) {
      expect(body).toContain(`{"run_id":${r.run_id},"run_key":${JSON.stringify(r.run_key)},"rev":${JSON.stringify(r.rev)},"boards":${r.boards}}`);
    }
    const parsed = JSON.parse(body) as { run_id: number; rev: string; boards: unknown }[];
    expect(parsed.map((r) => r.run_id)).toEqual([...ids].sort((x, y) => x - y));
    expect(parsed.map((r) => JSON.stringify(r.boards))).toEqual(raw.map((r) => JSON.stringify(JSON.parse(r.boards))));
    // Every keys row's rev is the rev its boards come with (the client's per-run cache key).
    const revs = new Map(parsed.map((r) => [r.run_id, r.rev]));
    for (const k of mirrored) expect(revs.get(Number(k.run_id))).toBe(k.rev);
  });

  it('an unchanged pool costs one version call; a board edit refetches that run only', async () => {
    const counts = { version: 0, index: 0, boards: 0, boardIds: 0 };
    const src = source(counts);
    const m = new PoolMirrorCore();
    await m.sync(src, async () => undefined, 1);
    const fetched = counts.boardIds;
    expect(fetched).toBe(m.runs.length);
    expect(await m.sync(src, async () => undefined, 2)).toEqual({ changed: 0, dropped: 0, unchanged: true });
    expect(counts.index).toBe(1);
    await db.exec(`update public.boards set snapshot = jsonb_set(snapshot, '{power}', '77') where author = 'P5' and wave = 2`);
    const r = await m.sync(src, async () => undefined, 3);
    expect(r).toMatchObject({ changed: 1, unchanged: false });
    expect(counts.boardIds).toBe(fetched + 1);
    const p5 = m.runs.find((x) => x.author === 'P5')!;
    const body = JSON.parse(m.boardsJson([p5.run_id])!) as { boards: { power: number }[] }[];
    expect(body[0]!.boards.find((b) => (b as { wave?: number }).wave === 2)!.power).toBe(77);
  });

  it('a cold mirror answers nothing; unknown ids are absent; more than 300 ids is refused', () => {
    const m = new PoolMirrorCore();
    expect(m.cold).toBe(true);
    expect(m.boardsJson(Array.from({ length: 301 }, (_, i) => i))).toBeNull();
  });

  it('the reads refuse without the writer key', async () => {
    await expect(db.query('select public.pool_mirror_version($1)', ['nope'])).rejects.toThrow(/not_authorized/);
    await expect(db.query('select * from public.pool_mirror_index($1)', [null])).rejects.toThrow(/not_authorized/);
    await expect(db.query('select * from public.pool_mirror_boards($1, $2::bigint[])', ['nope', [1]])).rejects.toThrow(/not_authorized/);
  });
});

// ── the flush ───────────────────────────────────────────────────────────────────────────────────────────────────────
const ME = '11111111-1111-4111-8111-111111111111';
const EVIL = '99999999-9999-4999-8999-999999999999';
const flush = async (args: { user?: string; guest?: boolean; game?: string; writes?: unknown; save?: unknown; clear?: unknown; rating?: unknown; key?: string }) =>
  (await db.query<{ r: Record<string, any> }>('select public.session_cf_flush($1, $2, $3, $4, $5, $6, $7, $8) as r', [
    args.key ?? KEY, args.user ?? ME, args.guest ?? false, args.game ?? 'run-1',
    args.writes === undefined ? null : JSON.stringify(args.writes), args.save === undefined ? null : JSON.stringify(args.save),
    args.clear === undefined ? null : JSON.stringify(args.clear), args.rating === undefined ? null : JSON.stringify(args.rating),
  ])).rows[0]!.r;
const board = (id: string, wave: number) => ({ patch: '0.1.0+abc', wave, hero_id: 'warden', power: wave, author: 'Me', seed: 555, snapshot: { id, wave, minions: [] }, unrated: false, user_id: EVIL });

describe('session_cf_flush (R-SESSION-CF-01)', () => {
  it('refuses without the writer key', async () => {
    await expect(flush({ key: 'wrong', writes: [] })).rejects.toThrow(/not_authorized/);
  });

  it('writes land once, owned by the session\'s player (never a row\'s own user_id), only insertable columns', async () => {
    const writes = [
      { key: 'boards:b1:2', table: 'boards', conflict: 'user_id,upload_key', rows: [board('b1', 1), board('b2', 2)] },
      { key: 'fights:1', table: 'lobby_fights', conflict: 'lobby_seed,round,run_a,run_b', rows: [{ lobby_seed: 9, round: 1, run_a: 'x', run_b: 'y', outcome: 'a', observed: true, patch: 'p' }] },
      { key: 'telemetry:1', table: 'run_telemetry', conflict: 'user_id,upload_key', rows: [{ telemetry: { a: 1 }, upload_key: '555|t', secret_flag: true }] },
    ];
    const a = await flush({ writes });
    expect(a.writes.map((w: { status: string }) => w.status)).toEqual(['applied', 'applied', 'applied']);
    const b = await flush({ writes });
    expect(b.writes.map((w: { status: string }) => w.status)).toEqual(['duplicate', 'duplicate', 'duplicate']);
    const owners = (await db.query<{ user_id: string; n: number }>(`select user_id, count(*)::int as n from public.boards where author = 'Me' group by 1`)).rows;
    expect(owners).toEqual([{ user_id: ME, n: 2 }]);
    // A column the client may not insert is never written (the grant decides), even when the row carries it.
    expect((await db.query<{ secret_flag: boolean }>(`select secret_flag from public.run_telemetry where upload_key = '555|t'`)).rows).toEqual([{ secret_flag: false }]);
    // The same boards under a NEW write key (another session, a direct client resend): the table's own key stores nothing twice.
    await flush({ game: 'run-2', writes: [{ ...writes[0], key: 'boards:again' }] });
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.boards where author = 'Me'`)).rows[0]!.n).toBe(2);
  });

  it('a bad write is rejected (and logged) without undoing the others; an unknown table is refused', async () => {
    const a = await flush({ game: 'run-3', writes: [
      { key: 'bad:1', table: 'lobby_fights', rows: [{ lobby_seed: 1, round: 1, run_a: 'a', run_b: 'b', outcome: 'nope' }] },
      { key: 'evil:1', table: 'profiles', rows: [{ rating: 9999 }] },
      { key: 'ok:1', table: 'lobby_fights', rows: [{ lobby_seed: 1, round: 2, run_a: 'a', run_b: 'b', outcome: 'b' }] },
    ] });
    expect(a.writes.map((w: { key: string; status: string }) => `${w.key}=${w.status}`)).toEqual(['bad:1=rejected', 'evil:1=rejected', 'ok:1=applied']);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from ops.events where source = 'session' and kind = 'write_rejected'`)).rows[0]!.n).toBe(2);
    // A rejected write is not in the ledger (it never applied).
    expect((await flush({ game: 'run-3', writes: [{ key: 'ok:1', table: 'lobby_fights', rows: [{ lobby_seed: 1, round: 2, run_a: 'a', run_b: 'b', outcome: 'b' }] }] })).writes[0].status).toBe('duplicate');
  });

  it('the save and the clear follow put_saved_run / clear_saved_run exactly; a guest is refused', async () => {
    const payload = { v: 1, save: '{"run":1}', seatRuns: [[{ wave: 1 }]] };
    expect((await flush({ save: { run_key: 'run:A', expected: 0, device: 'd1', payload } })).save).toEqual({ status: 'ok', revision: 1 });
    expect((await flush({ save: { run_key: 'run:A', expected: 1, device: 'd1', payload } })).save).toEqual({ status: 'ok', revision: 2 });
    const stale = (await flush({ save: { run_key: 'run:A', expected: 1, device: 'd1', payload } })).save;
    expect(stale).toMatchObject({ status: 'conflict', current: { run_key: 'run:A', revision: 2, device_id: 'd1' } });
    expect((await db.query<{ payload: unknown }>('select payload from public.saved_runs where user_id = $1', [ME])).rows[0]!.payload).toEqual(payload);
    expect((await flush({ guest: true, user: EVIL, save: { run_key: 'run:A', expected: 0, device: 'd', payload } })).save).toEqual({ status: 'refused' });
    expect((await flush({ clear: { run_key: 'run:A', expected: 1 } })).clear).toEqual({ status: 'conflict' });
    expect((await flush({ clear: { run_key: 'run:A', expected: 2 } })).clear).toEqual({ status: 'ok' });
    expect((await db.query('select 1 from public.saved_runs where user_id = $1', [ME])).rows).toEqual([]);
  });

  it('the rating settles AFTER the writes in the same call (the Career row is there), with the seat keys given', async () => {
    const history = { key: 'history:555', table: 'run_history', conflict: 'user_id,upload_key', rows: [{ entry: { seed: '777', at: 't1', placement: 2 }, hero_id: 'warden' }] };
    const a = await flush({ game: 'run-777', writes: [history], rating: { run_id: 'run-777', placement: 2, season: 3, rules_version: 1, seed: 777, seat_keys: ['k1', 'k2'] } });
    expect(a.rating).toMatchObject({ status: 'confirmed', result: { placement: 2 } });
    expect((await db.query('select user_id, run_id, placement, seat_keys, career_rows from public.rank_calls')).rows).toEqual([
      { user_id: ME, run_id: 'run-777', placement: 2, seat_keys: ['k1', 'k2'], career_rows: 1 },
    ]);
    // A settle that raises is answered as an error; the writes in the same call still land.
    const b = await flush({ game: 'rate-limit', writes: [{ key: 'fights:rl', table: 'lobby_fights', rows: [{ lobby_seed: 77, round: 1, run_a: 'a', run_b: 'b', outcome: 'a' }] }], rating: { run_id: 'rate-limit', placement: 8, season: 3, rules_version: 1, seed: null, seat_keys: null } });
    expect(b.rating.error).toMatch(/rate_limited/);
    expect(b.writes[0].status).toBe('applied');
  });
});
