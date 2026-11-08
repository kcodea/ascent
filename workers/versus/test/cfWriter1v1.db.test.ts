/**
 * VERSUS ON CLOUDFLARE — the 1v1 result write, END TO END (2026-11-08, fix/versus-reliability-nov).
 *
 * `cfWriter.db.test.ts` proves `versus_cf_persist` accepts a HAND-BUILT 1v1 row. Nothing proved the rows the room
 * actually queues fit it: Supabase had zero `backend = 'cloudflare'` 1v1 matches since the cutover while Group / Duos
 * rows were landing, so this drives a real `RoomCore` 1v1 (create, gate, heroes, shops, fights) and feeds EVERY
 * `PersistJob` it emits, in order, through `wireRow` into the real SQL (PGlite running the migrations), exactly as
 * `SupabaseRpcSink` would. Every way a 1v1 ends is covered: Health 0, a concede, leaving mid-match, three auto rounds
 * (missed), both gone (abandoned), and a round that cannot resolve (void).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEROES, type PreparedCombatSide } from '@game/sim';
import { engineContentRevision, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { DISCONNECT_GRACE_MS, newRoomState, RoomCore, type CoreEffects, type PersistJob } from '../src/core/roomCore';
import { wireRow } from '../src/persist';

const root = join(__dirname, '../../..');
const mig = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql', '2026-10-25-versus-duos-random-order.sql',
  '2026-10-25-versus-duos-pass-back.sql', '2026-10-26-versus-lock-order.sql', '2026-10-27-versus-egress.sql', '2026-10-28-versus-health.sql',
  '2026-10-15-lobby-live.sql', '2026-10-26-lobby-live-hero-select.sql', '2026-10-28-friends.sql',
  '2026-10-29-ranked-duos.sql', '2026-10-30-ranked-duos-client.sql', '2026-10-31-ranked-duos-live-fixes.sql',
  '2026-11-01-ranked-duos-party.sql', '2026-11-01-versus-ready-signal.sql', '2026-11-02-ranked-duos-both-ready.sql', '2026-11-02-ranked-duos-party-split.sql',
  '2026-11-02-versus-server-reliability.sql', '2026-11-03-versus-live-armor.sql',
  '2026-11-04-versus-cf-writer.sql', '2026-11-05-versus-cf-writer-group.sql', '2026-11-06-versus-cf-writer-duos.sql',
  '2026-11-07-versus-cf-ranked.sql', '2026-11-13-duos-match-history.sql',
];
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create table public.profiles (user_id uuid primary key, author text, discriminator text, avatar text, favorite_hero text);
  grant select on public.profiles to anon, authenticated;
  create table public.cosmetic_loadouts (user_id uuid, slot text, target_id text not null default '', cosmetic_id text, primary key (user_id, slot, target_id));
  grant select on public.cosmetic_loadouts to anon, authenticated;
`;
const SECRET = 'test-writer-secret-not-real';

interface Case { p1: PreparedCombatSide; p2: PreparedCombatSide }
const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/sim/src/versus/fixtures/parity.v1.json', import.meta.url)), 'utf8')) as { cases: Case[] };
const STRONG = structuredClone(FIXTURE.cases.find((c) => c.p1.board.length === 7)!.p1);
const EMPTY: PreparedCombatSide = { board: [], state: structuredClone(FIXTURE.cases[0]!.p1.state), config: {} };

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const HERO_IDS = HEROES.slice(0, 6).map((h) => h.id);
const JOIN = { as: 'player', display: 'Claudebot2', profile: {}, content: engineContentRevision(), protocol: VERSUS_PROTOCOL };

let db: PGlite;
let roomN = 0;

/** What SupabaseRpcSink sends, run against the SQL as the anon role. */
async function persist(job: PersistJob): Promise<unknown> {
  await db.exec('set role anon');
  try {
    const r = await db.query<{ v: unknown }>('select public.versus_cf_persist($1, $2, $3::jsonb) as v', [SECRET, job.kind, JSON.stringify(wireRow(job))]);
    return r.rows[0]!.v;
  } finally {
    await db.exec('reset role');
  }
}

class Room {
  now = Date.UTC(2026, 10, 8, 12, 0, 0);
  core: RoomCore;
  jobs: PersistJob[] = [];
  constructor(resolve?: () => Promise<never>) {
    const n = ++roomN;
    let s = 1000 + n;
    let u = 0;
    this.core = new RoomCore(newRoomState({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`, name: 'Test', hostUserId: U1, displayName: 'Claudebot1', profile: {},
      setId: 'set1', contentRevision: engineContentRevision(), protocol: VERSUS_PROTOCOL,
    }, this.now), {
      random31: () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff),
      uuid: () => `bbbbbbbb-bbbb-4bbb-8b${String(n).padStart(2, '0')}-${String(++u).padStart(12, '0')}`,
      ...(resolve ? { resolve } : {}),
    });
  }
  private take(fx: CoreEffects): void { this.jobs.push(...fx.persist); }
  async op(user: string, op: string, args: Record<string, unknown> = {}): Promise<any> {
    const { data, effects } = await this.core.op(user, op, args, this.now);
    this.take(effects);
    return data;
  }
  async advance(ms: number): Promise<void> {
    this.now += ms;
    this.take(await this.core.tick(this.now));
  }
  get m() { return this.core.state.match!; }
  get id() { return this.core.state.match!.id; }
  /** Two connected players in round 1's running shop. */
  async inShop(): Promise<this> {
    this.core.connect(U1, this.now);
    this.core.connect(U2, this.now);
    await this.op(U2, 'join', JOIN);
    await this.op(U1, 'start');
    await this.op(U1, 'gate');
    await this.op(U2, 'gate');
    await this.op(U1, 'register_offer', { matchId: this.id, offer: HERO_IDS.slice(0, 3) });
    await this.op(U2, 'register_offer', { matchId: this.id, offer: HERO_IDS.slice(3, 6) });
    await this.op(U1, 'pick_hero', { matchId: this.id, index: 0 });
    await this.op(U2, 'pick_hero', { matchId: this.id, index: 1 });
    await this.op(U1, 'intro_done', { matchId: this.id });
    await this.op(U2, 'intro_done', { matchId: this.id });
    expect(this.m.phase).toBe('shop');
    return this;
  }
  /** Every queued job through the writer, in order (the alarm's drain). */
  async flush(): Promise<void> {
    for (const job of this.jobs.splice(0)) {
      expect(['match', 'round']).toContain(job.kind);
      await persist(job);
    }
  }
  async row(): Promise<Record<string, any>> {
    return (await db.query<Record<string, any>>('select * from public.versus_matches where id = $1', [this.id])).rows[0]!;
  }
  async rounds(): Promise<Record<string, any>[]> {
    return (await db.query<Record<string, any>>('select * from public.versus_rounds where match_id = $1 order by round', [this.id])).rows;
  }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  await db.exec(FILES.map(mig).join('\n'));
  await db.query('insert into public.versus_cf_writer_keys (key_hash, note) values ($1, $2)', [createHash('sha256').update(SECRET).digest('hex'), 'test']);
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('Cloudflare 1v1: every job the room queues lands through versus_cf_persist', () => {
  it('Health 0: the match row from Hero Select to complete, and one round row per fight, as the readers expect', async () => {
    const r = await new Room().inShop();
    await r.flush();
    // The row is written at create, after every round and at the end (persist.ts): Hero Select until round 1 commits.
    expect(await r.row()).toMatchObject({ backend: 'cloudflare', room_id: null, phase: 'hero_select', p1_hearts: 7, p2_hearts: 7 });
    let round = 1;
    while (r.m.phase !== 'complete' && round < 40) {
      await r.op(U1, 'submit', { matchId: r.id, round, seq: 1, side: structuredClone(STRONG), final: true, checkpoint: null });
      await r.op(U2, 'submit', { matchId: r.id, round, seq: 1, side: EMPTY, final: true, checkpoint: null });
      if (r.m.phase === 'combat') {
        await r.op(U1, 'combat_ready', { matchId: r.id, round });
        await r.op(U2, 'combat_ready', { matchId: r.id, round });
      }
      await r.flush(); // drained between rounds, like the alarm does
      round++;
    }
    const m = await r.row();
    expect(m).toMatchObject({ phase: 'complete', winner_seat: 'p1', end_reason: 'hearts', p2_health: 0, backend: 'cloudflare' });
    expect(m.p1_hero).toBe(r.m.p1_hero);
    expect(m.completed_at).not.toBeNull();
    const rows = await r.rounds();
    expect(rows).toHaveLength(round - 1);
    expect(rows.at(-1)).toMatchObject({ p2_health: 0, outcome: 'p1' });
    expect(rows[0]!.p1_scout).toHaveProperty('tier');
  });

  it('a concede, and leaving mid-match, both land as forfeit', async () => {
    const a = await new Room().inShop();
    await a.op(U2, 'forfeit', { matchId: a.id });
    await a.flush();
    expect(await a.row()).toMatchObject({ phase: 'complete', winner_seat: 'p1', end_reason: 'forfeit' });
    const b = await new Room().inShop();
    await b.op(U1, 'leave');
    await b.flush();
    expect(await b.row()).toMatchObject({ phase: 'complete', winner_seat: 'p2', end_reason: 'forfeit' });
  });

  it('three auto rounds (missed), both gone (abandoned), a round that cannot resolve (void)', async () => {
    const a = await new Room().inShop();
    a.core.disconnect(U2, a.now);
    await a.advance(DISCONNECT_GRACE_MS);
    await a.advance(30_000);
    await a.op(U1, 'unpause', { matchId: a.id });
    await a.advance(3_000);
    for (let round = 1; round <= 5 && a.m.phase !== 'complete'; round++) {
      await a.op(U1, 'submit', { matchId: a.id, round, seq: 1, side: EMPTY, final: true, checkpoint: null });
      if (a.m.phase === 'combat') await a.op(U1, 'combat_ready', { matchId: a.id, round });
    }
    await a.flush();
    expect(await a.row()).toMatchObject({ phase: 'complete', end_reason: 'missed', winner_seat: 'p1', p2_auto: true });

    const b = await new Room().inShop();
    b.core.disconnect(U1, b.now);
    b.core.disconnect(U2, b.now);
    await b.advance(DISCONNECT_GRACE_MS);
    await b.advance(10 * 60_000);
    await b.flush();
    expect(await b.row()).toMatchObject({ phase: 'complete', end_reason: 'abandoned', winner_seat: null });

    const c = await new Room(async () => { throw new Error('engine broke'); }).inShop();
    await c.op(U1, 'submit', { matchId: c.id, round: 1, seq: 1, side: EMPTY, final: true, checkpoint: null });
    await c.op(U2, 'submit', { matchId: c.id, round: 1, seq: 1, side: EMPTY, final: true, checkpoint: null });
    await c.flush();
    expect(await c.row()).toMatchObject({ phase: 'complete', end_reason: 'void', winner_seat: null });
  });

  it('a second match in the same room is its own row (the room reopens; nothing of the first is overwritten)', async () => {
    const r = await new Room().inShop();
    const first = r.id;
    await r.op(U2, 'forfeit', { matchId: first });
    await r.op(U1, 'start');
    await r.op(U1, 'gate');
    await r.op(U2, 'gate');
    expect(r.id).not.toBe(first);
    await r.flush();
    const both = (await db.query<{ id: string; phase: string }>('select id, phase from public.versus_matches where id in ($1, $2) order by created_at, id', [first, r.id])).rows;
    expect(Object.fromEntries(both.map((x) => [x.id, x.phase]))).toEqual({ [first]: 'complete', [r.id]: 'hero_select' });
  });
});
