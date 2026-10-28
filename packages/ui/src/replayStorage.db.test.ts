import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayHeadOf } from './replayStorage';

/**
 * REPLAYS TO STORAGE, EXECUTED (R-REPLAY-STORAGE-01, 2026-10-28). PGlite builds `run_telemetry` with the production
 * replay-facts migration (the `tp_*` GENERATED columns), stubs Storage, then applies
 * supabase/migrations/2026-11-07-replays-storage.sql twice and checks:
 *  - every existing row keeps its facts; an old build's inline insert gets the same facts it always did;
 *  - a new build's Storage row (replay null + the client head + its own-folder path) gets the SAME facts as the whole
 *    replay would (so the client head and the SQL head agree), a path outside the owner's folder is refused, and a
 *    client can never write its own facts;
 *  - the bucket: a session uploads only into its own folder and reads any replay; no session reads nothing;
 *  - the lead's clear step nulls `replay` only on a copied row whose text still hashes to the proof, keeps every fact,
 *    needs its phrase, and the report counts it all.
 */
const root = join(__dirname, '../../..');
const FACTS = readFileSync(join(root, 'supabase/migrations/2026-10-09-replay-facts.sql'), 'utf8');
const SQL = readFileSync(join(root, 'supabase/migrations/2026-11-07-replays-storage.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create schema storage; grant usage on schema storage to anon, authenticated;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant execute on function storage.foldername(text) to anon, authenticated;

  create table public.run_telemetry (id bigserial primary key, user_id uuid, created_at timestamptz default now(), replay jsonb);
  create table public.practice_games (id bigserial primary key, user_id uuid, created_at timestamptz default now(), replay jsonb);
  alter table public.run_telemetry enable row level security;
  create policy "insert own run_telemetry" on public.run_telemetry for insert to authenticated with check (auth.uid() = user_id);
  create policy "read run_telemetry" on public.run_telemetry for select to authenticated using (true);
  grant select, insert on public.run_telemetry to authenticated;
  grant usage on sequence public.run_telemetry_id_seq to authenticated;
`;
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const FACT_COLS = ['tp_seed', 'tp_v2_version', 'tp_first_t', 'tp_last_t', 'tp_active_ms', 'tp_final_board', 'tp_record', 'tp_partial', 'tp_first_wave', 'tp_lobby_strength', 'tp_board_strength'];

/** A replay shaped like production's (every key the v2 recording carries, incl. the bulky ones). */
const replay = (seed: number, o: { partial?: boolean; frames?: number } = {}): Record<string, unknown> => ({
  seed, heroId: 'gorun', mode: 'lobby', actions: [{ t: 'buy' }, { t: 'roll' }],
  v2: {
    version: 2, seed, heroId: 'gorun', mode: 'lobby', author: 'P', patch: '0.1.0+x', createdAtMs: 1, activeMs: 900000 + seed,
    ...(o.partial ? { partial: true, firstRecordedWave: 4, partialReason: 'storage_failure' } : {}),
    heroReroll: { from: 'a', to: 'b' },
    frames: Array.from({ length: o.frames ?? 30 }, (_, i) => ({ tMs: 1000 * i + seed, view: { big: 'x'.repeat(50) } })),
    stream: { events: ['a', 'b'] }, cursorTrail: [[1, 2, 3]], inspectTrail: [{ t: 1 }],
    result: { finalBoard: { minions: [{ cardId: 'c', attack: seed }] }, record: { w: 9, l: 3 }, lobbyStrength: { pct: 61 }, boardStrength: 72 },
  },
});

let db: PGlite;
async function as<T>(sub: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? '']);
    await db.exec(`set local role ${sub ? 'authenticated' : 'anon'}`);
    const r = await db.query<T>(sql, params);
    await db.exec('commit');
    return r.rows;
  } catch (e) { await db.exec('rollback'); throw e; }
}
const facts = async (id: number): Promise<Record<string, unknown>> =>
  (await db.query<Record<string, unknown>>(`select ${FACT_COLS.join(', ')} from public.run_telemetry where id = $1`, [id])).rows[0]!;
/** The facts the ORIGINAL generated columns compute for a replay (a scratch table with the 10-09 definitions). */
async function generatedFacts(r: unknown): Promise<Record<string, unknown>> {
  await db.exec('truncate scratch_facts');
  await db.query('insert into scratch_facts (replay) values ($1)', [JSON.stringify(r)]);
  return (await db.query<Record<string, unknown>>(`select ${FACT_COLS.join(', ')} from scratch_facts`)).rows[0]!;
}

let oldRow = 0;
let oldPartialRow = 0;
let oldFacts: Record<string, unknown> = {};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(FACTS);
  // A scratch twin that keeps the generated definitions forever (the reference the trigger must match).
  await db.exec(`create table scratch_facts (replay jsonb, ${FACT_COLS.map((c) => `${c} ${['tp_final_board', 'tp_record', 'tp_lobby_strength'].includes(c) ? 'jsonb' : 'text'}`).join(', ')})`);
  await db.exec(`alter table scratch_facts ${FACT_COLS.map((c) => `drop column ${c}`).join(', ')}`);
  const def = (await db.query<{ sql: string }>(`select string_agg(format('add column %I %s generated always as (%s) stored', a.attname, format_type(a.atttypid, a.atttypmod), pg_get_expr(d.adbin, d.adrelid)), ', ') as sql
    from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.run_telemetry'::regclass and a.attgenerated = 's'`)).rows[0]!.sql;
  await db.exec(`alter table scratch_facts ${def}`);
  // Rows written before the move.
  oldRow = (await as<{ id: number }>(A, 'insert into public.run_telemetry (user_id, replay) values ($1, $2) returning id', [A, JSON.stringify(replay(11))]))[0]!.id;
  oldPartialRow = (await as<{ id: number }>(B, 'insert into public.run_telemetry (user_id, replay) values ($1, $2) returning id', [B, JSON.stringify(replay(12, { partial: true, frames: 1 }))]))[0]!.id;
  oldFacts = await facts(oldRow);
  await db.exec(SQL);
  await db.exec(SQL); // idempotent
});
afterAll(async () => { await db.close(); });

describe('replays to Storage', () => {
  it('existing rows keep their facts; the facts are no longer generated', async () => {
    expect(await facts(oldRow)).toEqual(oldFacts);
    expect(oldFacts.tp_seed).toBe('11');
    const gen = await db.query<{ n: number }>("select count(*)::int n from pg_attribute where attrelid = 'public.run_telemetry'::regclass and attgenerated = 's'");
    expect(gen.rows[0]!.n).toBe(0);
  });

  it('an old build (inline replay) gets exactly the facts the generated columns gave', async () => {
    for (const r of [replay(21), replay(22, { partial: true, frames: 1 }), { seed: 23, actions: [] }, { seed: 24, v2: { version: 2, frames: [] } }]) {
      const [row] = await as<{ id: number }>(A, 'insert into public.run_telemetry (user_id, replay) values ($1, $2) returning id', [A, JSON.stringify(r)]);
      expect(await facts(row!.id)).toEqual(await generatedFacts(r));
    }
  });

  it('a new build (replay in Storage, the client head on the row) gets the SAME facts as the whole replay', async () => {
    for (const r of [replay(31), replay(32, { partial: true, frames: 1 }), { seed: 33, v2: { version: 2, frames: [] } }]) {
      const [row] = await as<{ id: number }>(A, 'insert into public.run_telemetry (user_id, replay, replay_head, replay_path) values ($1, null, $2, $3) returning id',
        [A, JSON.stringify(replayHeadOf(r)), `${A}/k${(r as { seed: number }).seed}.json.gz`]);
      expect(await facts(row!.id)).toEqual(await generatedFacts(r));
      // and the client head is the SQL head
      const sqlHead = (await db.query<{ h: unknown }>('select maint.replay_head($1::jsonb) h', [JSON.stringify(r)])).rows[0]!.h;
      expect(replayHeadOf(r)).toEqual(sqlHead);
    }
    // the head is small: the bulk is gone
    expect(JSON.stringify(replayHeadOf(replay(1))).length).toBeLessThan(JSON.stringify(replay(1)).length / 4);
  });

  it('a client cannot point its row at another folder, nor write its own facts', async () => {
    await expect(as(A, "insert into public.run_telemetry (user_id, replay_head, replay_path) values ($1, '{}', $2)", [A, `${B}/x.json.gz`])).rejects.toThrow(/owner's folder/);
    const [row] = await as<{ id: number }>(A, "insert into public.run_telemetry (user_id, tp_seed, tp_final_board) values ($1, '999', '{\"minions\":[1]}') returning id", [A]);
    expect(await facts(row!.id)).toEqual(Object.fromEntries(FACT_COLS.map((c) => [c, null])));
  });

  it('the bucket: own-folder uploads only, any session reads, no session reads nothing, nobody overwrites', async () => {
    const bucket = (await db.query<{ public: boolean; allowed_mime_types: string[] }>("select public, allowed_mime_types from storage.buckets where id = 'replays'")).rows[0]!;
    expect(bucket).toEqual({ public: false, allowed_mime_types: ['application/gzip'] });
    await as(A, "insert into storage.objects (bucket_id, name) values ('replays', $1)", [`${A}/a.json.gz`]);
    await expect(as(A, "insert into storage.objects (bucket_id, name) values ('replays', $1)", [`${B}/a.json.gz`])).rejects.toThrow(/row-level security/);
    await expect(as(A, "insert into storage.objects (bucket_id, name) values ('replays', 'a.json.gz')")).rejects.toThrow(/row-level security/);
    expect((await as(B, "select name from storage.objects where bucket_id = 'replays'")).length).toBe(1);
    expect((await as(null, "select name from storage.objects where bucket_id = 'replays'")).length).toBe(0);
    expect((await as(A, "update storage.objects set name = 'x' returning id")).length).toBe(0);
    expect((await as(A, 'delete from storage.objects returning id')).length).toBe(0);
  });

  it('the clear step: only copied rows whose text matches the proof; facts unchanged; phrase required', async () => {
    const proof = async (id: number, tamper = false): Promise<void> => {
      const text = (await db.query<{ t: string }>('select replay::text t from public.run_telemetry where id = $1', [id])).rows[0]!.t;
      const buf = Buffer.from(text, 'utf8');
      const sha = tamper ? 'f'.repeat(64) : createHash('sha256').update(buf).digest('hex');
      await db.query('update public.run_telemetry set replay_path = $2, replay_sha256 = $3, replay_bytes = $4, replay_copied_at = now() where id = $1',
        [id, `x/rt-${id}.json.gz`, sha, buf.length]);
    };
    await proof(oldRow);
    await proof(oldPartialRow, true); // a proof that does not match: never cleared
    const before = await facts(oldRow);
    const report = async (): Promise<Record<string, number>> => Object.fromEntries((await db.query<{ metric: string; n: number }>('select * from maint.run_telemetry_replay_report()')).rows.map((r) => [r.metric, Number(r.n)]));
    expect((await report())['inline AND copied to Storage (ready to clear)']).toBe(2);

    await expect(db.query("select maint.run_telemetry_clear_copied_replays('yes')")).rejects.toThrow(/phrase/);
    const n = (await db.query<{ n: number }>("select maint.run_telemetry_clear_copied_replays('CLEAR COPIED REPLAYS') n")).rows[0]!.n;
    expect(n).toBe(1);
    const row = (await db.query<{ replay: unknown; replay_head: unknown }>('select replay, replay_head from public.run_telemetry where id = $1', [oldRow])).rows[0]!;
    expect(row.replay).toBeNull();
    expect(row.replay_head).toEqual(replayHeadOf(replay(11)));
    expect(await facts(oldRow)).toEqual(before);
    expect((await db.query<{ r: unknown }>('select replay r from public.run_telemetry where id = $1', [oldPartialRow])).rows[0]!.r).not.toBeNull();
    expect((await db.query<{ n: number }>("select maint.run_telemetry_clear_copied_replays('CLEAR COPIED REPLAYS') n")).rows[0]!.n).toBe(0);
    expect((await report())['in Storage only']).toBe(4); // the cleared row + the three new-build rows
    // the restore path (write the replay back) recomputes the same facts
    await db.query('update public.run_telemetry set replay = $2 where id = $1', [oldRow, JSON.stringify(replay(11))]);
    expect(await facts(oldRow)).toEqual(before);
  });

  it('the client roles cannot reach the maint tools', async () => {
    await expect(as(A, "select maint.run_telemetry_clear_copied_replays('CLEAR COPIED REPLAYS')")).rejects.toThrow(/permission denied/);
  });
});
