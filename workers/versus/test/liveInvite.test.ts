/**
 * VERSUS ON CLOUDFLARE — the room's Live Games row and its invite check, on a fake clock.
 *
 *  - R-VERSUS-CF-LIVE-01: a Ranked Duos match is listed (`duos:cf:<room>` once written) from Hero Select to the end, a
 *    friends-only party never is, and 1v1 / Group / Versus Duos never are (parity: on Supabase only Ranked Duos rows
 *    exist). The writer is throttled: one write per listing change (start, round, phase, end) plus a 2-minute
 *    keep-alive, never per spectator, never per request; a failed write retries; the removal can't be overtaken.
 *  - R-VERSUS-CF-INVITE-01: the room's invite check answers the SQL's codes, and the proof is a plain HMAC-SHA256 the
 *    SQL can recompute.
 */
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HEROES, type PreparedCombatSide } from '@game/sim';
import { engineContentRevision, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { newRoomState, RoomCore, type CoreDeps, type CoreState } from '../src/core/roomCore';
import { LIVE_REFRESH_MS, liveKeyOf, liveListingOf, type LiveListing } from '../src/core/liveListing';
import { LIVE_GIVE_UP_AFTER, LiveSlot, type LiveSink } from '../src/live';
import { INVITE_PROOF_TTL_S, invitePayload, signInviteProof } from '../src/invites';
import type { RankedService } from '../src/core/rankedMatch';
import { LocalRankedService } from '../src/rankedService';

interface Case { p1: PreparedCombatSide; p2: PreparedCombatSide }
const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/sim/src/versus/fixtures/parity.v1.json', import.meta.url)), 'utf8')) as { cases: Case[] };
const STRONG = FIXTURE.cases.find((c) => c.p1.board.length === 7)!.p1;

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const U4 = '44444444-4444-4444-8444-444444444444';
const TEAM = '99999999-9999-4999-8999-999999999999';
const ROOM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac';
const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);
const HERO_IDS = HEROES.slice(0, 6).map((h) => h.id);
const JOIN = { as: 'player', display: 'Two', profile: {}, content: engineContentRevision(), protocol: VERSUS_PROTOCOL };

function deps(): CoreDeps {
  let s = 99;
  let u = 0;
  return { random31: () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff), uuid: () => `eeeeeeee-eeee-4eee-8eee-${String(++u).padStart(12, '0')}` };
}

class H {
  now = T0;
  core: RoomCore;
  constructor(mode: string) {
    this.core = new RoomCore(newRoomState({ id: ROOM, name: 'Room', hostUserId: U1, displayName: 'One', profile: {}, setId: 'set1', contentRevision: engineContentRevision(), protocol: VERSUS_PROTOCOL, options: { v: 1, mode, modifiers: [] } }, this.now), deps());
    this.core.connect(U1, this.now);
  }
  async op(user: string, op: string, args: Record<string, unknown> = {}): Promise<any> { return (await this.core.op(user, op, args, this.now)).data; }
  get state(): CoreState { return this.core.state; }
  get g() { return this.core.ranked!.m; }
}

const local = new LocalRankedService();
const svc: RankedService = {
  ensureTeam: async () => ({ teamId: TEAM, name: 'The Pair', division: 2 }),
  soloSample: () => local.soloSample(), duoSample: () => local.duoSample(),
};

/** A Ranked Duos pair through the gates (Hero Select), optionally on to round 1's shop. */
async function ranked(toShop: boolean): Promise<H> {
  const h = new H('ranked_duos');
  h.core.connect(U2, h.now);
  await h.op(U2, 'join', JOIN);
  await h.op(U1, 'start');
  await h.op(U1, 'gate');
  await h.op(U2, 'gate');
  h.core.rankedSetTeam(await svc.ensureTeam(U1, U2), h.now);
  if (!toShop) return h;
  await h.op(U1, 'register_offer', { matchId: h.g.id, offer: HERO_IDS.slice(0, 3) });
  await h.op(U2, 'register_offer', { matchId: h.g.id, offer: HERO_IDS.slice(3, 6) });
  await h.op(U1, 'pick_hero', { matchId: h.g.id, index: 0 });
  await h.op(U2, 'pick_hero', { matchId: h.g.id, index: 0 });
  await h.core.rankedSeat(svc, h.now);
  await h.op(U1, 'intro_done', { matchId: h.g.id });
  await h.op(U2, 'intro_done', { matchId: h.g.id });
  return h;
}
const lock = (h: H, u: string) => h.op(u, 'submit', { matchId: h.g.id, round: h.g.round, seq: 1, side: structuredClone(STRONG), final: true, checkpoint: null });

/** A sink that records (and can be told to fail). */
class FakeSink implements LiveSink {
  readonly live = true;
  writes: (LiveListing | null)[] = [];
  failing = false;
  async write(_room: string, row: LiveListing | null): Promise<void> {
    if (this.failing) throw new Error('503');
    this.writes.push(row);
  }
}
function slot(sink: FakeSink, published: string | null = null) {
  const stored: (string | null)[] = [];
  const s = new LiveSlot(sink, () => ROOM, async (k) => { stored.push(k); }, published, T0);
  return { s, stored, sync: async (row: LiveListing | null, now: number) => { s.want(row); await s.flush(now); } };
}

describe('Live Games listing of a Cloudflare room (R-VERSUS-CF-LIVE-01)', () => {
  it('Ranked Duos: listed from Hero Select (first seat, the pair, the team id), then the shop, then gone at the end', async () => {
    const open = new H('ranked_duos');
    expect(liveListingOf(open.state)).toBeNull(); // a party waiting is not a game
    const h = await ranked(false);
    expect(liveListingOf(h.state)).toMatchObject({ room: ROOM, p1: U1, team: TEAM, names: 'One & Two', phase: 'hero', round: 1 });
    const s = await ranked(true);
    expect(liveListingOf(s.state)).toMatchObject({ phase: 'shop', round: 1, hero: HERO_IDS[0] });
    await lock(s, U1);
    await lock(s, U2);
    expect(liveListingOf(s.state)).toMatchObject({ phase: 'combat', round: 1 });
    await s.op(U1, 'leave');
    await s.op(U2, 'leave');
    expect(s.g.phase).toBe('complete');
    expect(liveListingOf(s.state)).toBeNull();
  });

  it('a friends-only party is never listed', async () => {
    const h = await ranked(true);
    await h.op(U1, 'friends_only', { on: true });
    expect(liveListingOf(h.state)).toBeNull();
  });

  it('1v1, Group and Versus Duos are never on Live Games (as on Supabase: Friends Watch covers them)', async () => {
    for (const mode of ['duel', 'group', 'duos']) {
      const h = new H(mode);
      const others = mode === 'duel' ? [U2] : [U2, U3, U4];
      for (const u of others) { h.core.connect(u, h.now); await h.op(u, 'join', JOIN); }
      await h.op(U1, 'start');
      for (const u of [U1, ...others]) await h.op(u, 'gate');
      expect(h.state.room.status, mode).toBe('in_game');
      expect(liveListingOf(h.state), mode).toBeNull();
    }
  });

  it('the write key ignores spectators (a spectator joining costs no write)', async () => {
    const h = await ranked(true);
    const before = liveKeyOf(liveListingOf(h.state));
    h.core.connect(U3, h.now);
    await h.op(U3, 'join', { ...JOIN, as: 'spectator' });
    expect(liveListingOf(h.state)!.spectators).toBe(1);
    expect(liveKeyOf(liveListingOf(h.state))).toBe(before);
  });
});

describe('the Live Games slot: throttled, latest wins (R-VERSUS-CF-LIVE-01)', () => {
  it('a whole Ranked Duos match writes once per phase change plus the removal, nothing per request', async () => {
    const sink = new FakeSink();
    const { s, sync } = slot(sink);
    const h = await ranked(true);
    let requests = 0;
    await sync(liveListingOf(h.state), h.now);
    let guard = 0;
    while (h.g.phase !== 'complete' && guard++ < 60) {
      for (const u of [U1, U2]) {
        await lock(h, u);
        requests++;
        h.now += 1000;
        await sync(liveListingOf(h.state), h.now); // the shell syncs after EVERY apply
      }
      if (h.g.phase === 'combat') {
        for (const u of [U1, U2]) { await h.op(u, 'combat_ready', { matchId: h.g.id, round: h.g.round }); requests++; h.now += 1000; await sync(liveListingOf(h.state), h.now); }
      }
    }
    expect(h.g.phase).toBe('complete');
    const rounds = h.g.round;
    // Start + (combat + next shop) per round + the removal; well under one write per request.
    expect(sink.writes.length).toBeLessThanOrEqual(1 + 2 * rounds + 1);
    expect(sink.writes.length).toBeLessThan(requests);
    expect(sink.writes.at(-1)).toBeNull();
    expect(s.pending()).toBe(false);
  });

  it('keep-alive every 2 minutes while up; a silent room never writes; a failure retries with backoff', async () => {
    const sink = new FakeSink();
    const { s, sync, stored } = slot(sink);
    await sync(null, T0);
    expect(sink.writes).toHaveLength(0); // nothing was ever published: no removal either
    const row: LiveListing = { room: ROOM, p1: U1, team: TEAM, names: 'One & Two', hero: 'h', round: 2, phase: 'shop', spectators: 0 };
    await sync(row, T0 + 1);
    await sync(row, T0 + 60_000);
    expect(sink.writes).toHaveLength(1);
    expect(s.nextAt(T0 + 60_000)).toBe(T0 + 1 + LIVE_REFRESH_MS);
    await sync(row, T0 + 1 + LIVE_REFRESH_MS);
    expect(sink.writes).toHaveLength(2);
    expect(stored.at(-1)).toBe(liveKeyOf(row));
    sink.failing = true;
    const t = T0 + 200_000;
    await sync({ ...row, phase: 'combat' }, t);
    expect(s.due(t + 500)).toBe(false);
    expect(s.nextAt(t + 500)).toBe(t + 1000);
    sink.failing = false;
    await sync(null, t + 1000); // the newest wish (the end) is what the retry sends
    expect(sink.writes.at(-1)).toBeNull();
    expect(stored.at(-1)).toBeNull();
    expect(s.pending()).toBe(false);
  });

  it('after a wake: an unchanged row is not re-sent, a row that ended while asleep is removed', async () => {
    const row: LiveListing = { room: ROOM, p1: U1, team: null, names: 'A & B', hero: 'h', round: 3, phase: 'combat', spectators: 0 };
    const a = new FakeSink();
    await slot(a, liveKeyOf(row)).sync(row, T0 + 5);
    expect(a.writes).toHaveLength(0);
    const b = new FakeSink();
    await slot(b, liveKeyOf(row)).sync(null, T0 + 5);
    expect(b.writes).toEqual([null]);
  });

  it('a closed room stops waiting for its removal after repeated failures (the SQL hides a silent row within 4 minutes)', async () => {
    const sink = new FakeSink();
    const { s, sync } = slot(sink, 'x');
    sink.failing = true;
    s.want(null);
    let t = T0;
    for (let i = 0; i < LIVE_GIVE_UP_AFTER; i++) { expect(s.pending()).toBe(true); await sync(null, t); t = s.nextAt(t) ?? t; }
    expect(s.pending()).toBe(false);
  });
});

describe('invite check + proof (R-VERSUS-CF-INVITE-01)', () => {
  it('answers the SQL\'s codes: open room, I am in, they are not, the room\'s own kind', async () => {
    const h = new H('duel');
    expect(() => h.core.inviteCheck(U1, U2, 'versus_room')).not.toThrow();
    expect(() => h.core.inviteCheck(U1, U2, 'duos_party')).toThrow('bad_kind');
    expect(() => h.core.inviteCheck(U1, 'nope', 'versus_room')).toThrow('bad_target');
    expect(() => h.core.inviteCheck(U1, U1, 'versus_room')).toThrow('self');
    expect(() => h.core.inviteCheck(U3, U2, 'versus_room')).toThrow('not_in_room');
    h.core.connect(U2, h.now);
    await h.op(U2, 'join', JOIN);
    expect(() => h.core.inviteCheck(U1, U2, 'versus_room')).toThrow('already_in_room');
    await h.op(U1, 'start');
    expect(() => h.core.inviteCheck(U1, U3, 'versus_room')).toThrow('room_not_open');
    const party = new H('ranked_duos');
    expect(() => party.core.inviteCheck(U1, U2, 'duos_party')).not.toThrow();
    expect(() => party.core.inviteCheck(U1, U2, 'versus_room')).toThrow('bad_kind');
  });

  it('the proof is `<exp>.<hmac-sha256 hex>` keyed by sha256(secret), over the bound payload', async () => {
    const secret = 'test-secret';
    const p = { room: ROOM, from: U1, to: U2, kind: 'versus_room' };
    const proof = await signInviteProof(secret, p, T0);
    const [exp, sig] = proof.split('.');
    expect(Number(exp)).toBe(Math.floor(T0 / 1000) + INVITE_PROOF_TTL_S);
    const key = createHash('sha256').update(secret).digest('hex');
    expect(sig).toBe(createHmac('sha256', key).update(invitePayload({ ...p, exp: Number(exp) })).digest('hex'));
    expect(invitePayload({ ...p, exp: 1 })).toBe(`ascent.invite.v1|${ROOM}|${U1}|${U2}|versus_room|1`);
  });
});
