/**
 * VERSUS ON CLOUDFLARE — the GROUP (3-4 player) room on a fake clock. Each block names the chaos-harness scenario
 * (test/versus-chaos-harness, chaosScenarios.ts) it stands for; the transport-only scenarios (realtimeDown, hang,
 * lockHeld, resolverSlow/409) have no counterpart: the room has no Realtime, no row lock and no resolver hop.
 *
 * PARITY: every committed round equals the Edge Function's `resolveVersusGroupRound` digest for the same input.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HEROES, groupRoundDigest, type PreparedCombatSide } from '@game/sim';
import { engineContentRevision, resolveVersusGroupRound, versusGroupPairings, versusStartingVitals, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { DISCONNECT_GRACE_MS, newRoomState, RoomCore, SHOP_GRACE_MS, turnSeconds, type CoreDeps, type CoreEffects, type CoreState } from '../src/core/roomCore';
import type { GSeat } from '../src/core/groupMatch';
import { stateFromEntries, valueOfKey } from '../src/core/storage';

interface Case { name: string; matchSeed: number; round: number; p1: PreparedCombatSide; p2: PreparedCombatSide }
const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/sim/src/versus/fixtures/parity.v1.json', import.meta.url)), 'utf8')) as { cases: Case[] };
const STRONG = FIXTURE.cases.find((c) => c.p1.board.length === 7)!.p1;
const MID = FIXTURE.cases[1]!.p2;
const EMPTY: PreparedCombatSide = { board: [], state: structuredClone(FIXTURE.cases[0]!.p1.state), config: {} };

const U = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'] as const;
const SEAT: GSeat[] = ['p1', 'p2', 'p3', 'p4'];
const ROOM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);
const HERO_IDS = HEROES.slice(0, 12).map((h) => h.id);
const GROUP = { v: 1, mode: 'group', modifiers: [] };

function deps() {
  let s = 777;
  let u = 0;
  return { random31: () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff), uuid: () => `cccccccc-cccc-4ccc-8ccc-${String(++u).padStart(12, '0')}` };
}

class H {
  now = T0;
  core: RoomCore;
  log: CoreEffects[] = [];
  constructor(state?: CoreState, d: CoreDeps = deps()) {
    this.core = new RoomCore(state ?? newRoomState({ id: ROOM, name: 'G', hostUserId: U[0], displayName: 'P1', profile: {}, setId: 'set1', contentRevision: engineContentRevision(), protocol: VERSUS_PROTOCOL, options: GROUP }, this.now), d);
  }
  async op(user: string, op: string, args: Record<string, unknown> = {}): Promise<any> {
    const { data, effects } = await this.core.op(user, op, args, this.now);
    this.log.push(effects);
    return data;
  }
  async advance(ms: number): Promise<void> { this.now += ms; this.log.push(await this.core.tick(this.now)); }
  get g() { return this.core.state.group!.match; }
  get id() { return this.g.id; }
  seat(s: GSeat) { return this.g.seats.find((x) => x.seat === s)!; }
}

const JOIN = (i: number) => ({ as: 'player', display: `P${i + 1}`, profile: {}, content: engineContentRevision(), protocol: VERSUS_PROTOCOL });

/** n players seated, gated, heroes picked, intros done: round 1's shop is running. */
async function inShop(n: 3 | 4, d?: CoreDeps): Promise<H> {
  const h = new H(undefined, d);
  for (let i = 0; i < n; i++) h.core.connect(U[i], h.now);
  for (let i = 1; i < n; i++) await h.op(U[i], 'join', JOIN(i));
  expect(h.core.state.room.members.map((m) => m.role)).toEqual(SEAT.slice(0, n));
  await h.op(U[0], 'start');
  for (let i = 0; i < n; i++) await h.op(U[i], 'gate');
  expect(h.g.phase).toBe('hero_select');
  expect(h.core.state.room.current_match_id).toBe(h.id);
  for (let i = 0; i < n; i++) await h.op(U[i], 'register_offer', { matchId: h.id, offer: HERO_IDS.slice(i * 3, i * 3 + 3) });
  for (let i = 0; i < n; i++) await h.op(U[i], 'pick_hero', { matchId: h.id, index: 0 });
  expect(h.g.phase).toBe('shop');
  for (let i = 0; i < n; i++) await h.op(U[i], 'intro_done', { matchId: h.id });
  expect(h.g.shop_deadline).toBe(h.now + turnSeconds(1, 'group') * 1000);
  return h;
}

const lockAll = async (h: H, sides: (PreparedCombatSide | null)[]) => {
  const round = h.g.round;
  for (let i = 0; i < sides.length; i++) {
    const s = h.seat(SEAT[i]!);
    if (s.eliminated_round != null || sides[i] == null) continue;
    await h.op(U[i], 'submit', { matchId: h.id, round, seq: 1, side: structuredClone(sides[i]), final: true, checkpoint: null });
  }
};
const readyAll = async (h: H) => {
  const round = h.g.round;
  for (let i = 0; i < h.g.seats.length; i++) if (h.seat(SEAT[i]!).eliminated_round == null) await h.op(U[i], 'combat_ready', { matchId: h.id, round });
};

describe('Group room (Cloudflare) — baseline / simultaneous', () => {
  it('4 players: one press each starts the match; one lock each resolves the round in-object (2 fights, the round robin)', async () => {
    const h = await inShop(4);
    await lockAll(h, [STRONG, MID, EMPTY, MID]);
    expect(h.g.phase).toBe('combat');
    const r1 = h.core.state.group!.rounds[1]!;
    const want = versusGroupPairings(SEAT, {}, 1);
    expect(r1.fights.map((f) => [f.a_seat, f.b_seat, f.b_copy])).toEqual(want.map((p) => [p.a, p.b, p.copy]));
    // PARITY: the room's round equals the Edge Function's resolver on the same input.
    const vitals = Object.fromEntries(SEAT.map((s) => [s, versusStartingVitals(h.seat(s).hero, h.g.options)]));
    const ref = resolveVersusGroupRound({ matchSeed: h.g.seed, round: 1, seats: SEAT, eliminated: {}, sides: { p1: STRONG, p2: MID, p3: EMPTY, p4: MID }, vitals });
    expect(r1.digest).toBe(groupRoundDigest(ref));
    // Everyone ready: round 2 opens with the next pairing of the cycle.
    await readyAll(h);
    expect(h.g.phase).toBe('shop');
    expect(h.g.round).toBe(2);
  });

  it('3 players: the odd player faces a Copy, and a Copy never takes damage', async () => {
    const h = await inShop(3);
    for (let round = 1; round <= 3; round++) {
      await lockAll(h, [STRONG, EMPTY, STRONG]);
      const r = h.core.state.group!.rounds[round]!;
      const copy = r.fights.find((f) => f.b_copy)!;
      expect(copy).toBeDefined();
      expect(copy.heart_lost_by).not.toBe(copy.b_seat);
      if (h.g.phase === 'complete') break;
      await readyAll(h);
    }
  });
});

describe('Group room (Cloudflare) — timer / emptyAll / emptyOne / mendArmor', () => {
  it('nobody presses End Turn: 0:00 + 250 ms closes the round; candidates promoted, absent boards empty (emptyAll never halts)', async () => {
    const h = await inShop(4);
    await h.op(U[1], 'submit', { matchId: h.id, round: 1, seq: 4, side: structuredClone(MID), final: false, checkpoint: null });
    await h.advance(turnSeconds(1, 'group') * 1000 + SHOP_GRACE_MS);
    expect(h.g.phase).toBe('combat');
    expect(h.core.state.group!.subs.p2!.source).toBe('deadline');
    expect(h.core.state.group!.subs.p1!.source).toBe('empty');
  });

  it('a fresh Mend report raises the stored Armor at once (R-VERSUS-LIVE-ARMOR-01)', async () => {
    const h = await inShop(3);
    await lockAll(h, [EMPTY, EMPTY, EMPTY]);
    await readyAll(h);
    const before = h.seat('p1').armor!;
    const mend = { ...structuredClone(EMPTY), vitals: { resolve: 30, armor: 5 } };
    await h.op(U[0], 'submit', { matchId: h.id, round: 2, seq: 1, side: mend, final: false, checkpoint: null });
    expect(h.seat('p1').armor).toBe(Math.max(before, 5));
  });
});

describe('Group room (Cloudflare) — knockouts, placements, the end', () => {
  it('Health 0 is out: to the stands, sharing a placement when out together; the last standing wins; the room reopens', async () => {
    const h = await inShop(4);
    let guard = 0;
    while (h.g.phase !== 'complete' && guard++ < 60) {
      await lockAll(h, [STRONG, EMPTY, EMPTY, EMPTY]);
      if (h.g.phase === 'combat') await readyAll(h);
    }
    expect(h.g.phase).toBe('complete');
    expect(h.g.winner_seat).toBe('p1');
    expect(h.seat('p1').placement).toBe(1);
    for (const s of ['p2', 'p3', 'p4'] as GSeat[]) {
      expect(h.seat(s).eliminated_round).not.toBeNull();
      expect(h.core.state.room.members.find((m) => m.userId === h.seat(s).user_id)!.role).toBe('spectator');
    }
    const places = (['p2', 'p3', 'p4'] as GSeat[]).map((s) => h.seat(s).placement!);
    expect(Math.max(...places)).toBeLessThanOrEqual(4);
    expect(h.core.state.room.status).toBe('open');
    expect(h.log.flatMap((f) => f.persist).some((j) => j.kind === 'group_round')).toBe(true);
  });

  it('a forfeit mid-shop: placed below everyone still in, and it still fights the round as a GHOST that is never charged', async () => {
    const h = await inShop(4);
    await lockAll(h, [MID, MID, MID, MID]);
    await readyAll(h);
    const pools = { ...h.seat('p3') };
    await h.op(U[2], 'forfeit', { matchId: h.id });
    expect(h.seat('p3').eliminated_round).toBe(2);
    expect(h.seat('p3').placement).toBe(4);
    await lockAll(h, [STRONG, STRONG, null, STRONG]);
    const r2 = h.core.state.group!.rounds[2]!;
    expect(r2.fights.some((f) => f.a_seat === 'p3' || f.b_seat === 'p3')).toBe(true); // the pairing never changed under the others
    expect(h.seat('p3').health).toBe(pools.health); // a ghost never takes damage
  });

  it('leaving the room mid-match is out too; two left standing keep playing', async () => {
    const h = await inShop(3);
    await h.op(U[2], 'leave');
    expect(h.seat('p3').out_reason).toBe('left');
    expect(h.g.phase).toBe('shop');
    await h.op(U[1], 'forfeit', { matchId: h.id });
    expect(h.g.phase).toBe('complete');
    expect(h.g.winner_seat).toBe('p1');
  });
});

describe('Group room (Cloudflare) — dropRestore / dropShort / dropInFight / lostCombatReady', () => {
  it('a 20 s drop pauses after the grace; the socket coming back starts the 3-2-1 (no unpause needed); deadlines move', async () => {
    const h = await inShop(4);
    const dl = h.g.shop_deadline!;
    h.core.disconnect(U[3], h.now);
    await h.advance(DISCONNECT_GRACE_MS);
    expect(h.g.paused_seat).toBe('p4');
    await h.advance(17_000);
    h.core.connect(U[3], h.now);
    expect(h.g.resume_at).toBe(h.now + 3_000);
    await h.advance(3_000);
    expect(h.g.paused_at).toBeNull();
    expect(h.g.shop_deadline).toBe(dl + 20_000);
  });

  it('a 2 s blip never pauses', async () => {
    const h = await inShop(3);
    h.core.disconnect(U[1], h.now);
    await h.advance(2_000);
    h.core.connect(U[1], h.now);
    await h.advance(5_000);
    expect(h.g.paused_at).toBeNull();
  });

  it('gone for good: after 30 s another player unpauses, the seat plays on auto, 3 missed rounds and it is out (never the last)', async () => {
    const h = await inShop(3);
    await lockAll(h, [MID, MID, MID]);
    await readyAll(h);
    h.core.disconnect(U[2], h.now);
    await h.advance(DISCONNECT_GRACE_MS);
    await expect(h.op(U[0], 'unpause', { matchId: h.id })).rejects.toThrow('grace_running');
    await h.advance(30_000);
    await h.op(U[0], 'unpause', { matchId: h.id });
    await h.advance(3_000);
    expect(h.seat('p3').auto).toBe(true);
    for (let i = 0; i < 3 && h.seat('p3').eliminated_round == null; i++) {
      await lockAll(h, [MID, MID, null]);
      expect(h.core.state.group!.subs.p3!.source).toBe('auto');
      if (h.g.phase === 'combat') { await h.op(U[0], 'combat_ready', { matchId: h.id, round: h.g.round }); await h.op(U[1], 'combat_ready', { matchId: h.id, round: h.g.round }); }
    }
    expect(['missed', 'hearts']).toContain(h.seat('p3').out_reason);
  });

  it('End Combat: the last player still watching gets 5 s; a lost ack is covered by the 90 s cap', async () => {
    const h = await inShop(4);
    await lockAll(h, [MID, MID, MID, MID]);
    for (let i = 0; i < 3; i++) await h.op(U[i], 'combat_ready', { matchId: h.id, round: 1 });
    expect(h.g.combat_deadline).toBe(h.now + 5_000);
    await h.advance(5_000);
    expect(h.g.round).toBe(2);
    await lockAll(h, [MID, MID, MID, MID]);
    await h.advance(90_000);
    expect(h.g.round).toBe(3);
  });

  it('every player gone for 10 minutes of pause: abandoned', async () => {
    const h = await inShop(3);
    for (const u of U.slice(0, 3)) h.core.disconnect(u, h.now);
    await h.advance(DISCONNECT_GRACE_MS);
    await h.advance(10 * 60_000);
    expect(h.g.end_reason).toBe('abandoned');
  });
});

describe('Group room (Cloudflare) — resolverFail / hibernation / room options', () => {
  it('a round the object cannot resolve ends the match void (no winner)', async () => {
    const h = await inShop(3, { ...deps(), resolveGroup: async () => { throw new Error('boom'); } } as never);
    await lockAll(h, [MID, MID, MID]);
    expect(h.g.end_reason).toBe('void');
    expect(h.g.winner_seat).toBeNull();
    expect(h.core.state.room.status).toBe('open');
  });

  it('a group room rebuilt from its storage keys mid-round finishes the round identically', async () => {
    const h = await inShop(4);
    await lockAll(h, [STRONG, MID, null, null]);
    const store = new Map<string, unknown>();
    for (const fx of h.log) for (const k of fx.dirty) {
      const v = valueOfKey(h.core.state, k);
      if (v === undefined) store.delete(k); else store.set(k, structuredClone(v));
    }
    const revived = new H(stateFromEntries(store)!);
    revived.now = h.now;
    revived.core.restoreSockets([...U], h.now);
    for (const x of [h, revived]) {
      await x.op(U[2], 'submit', { matchId: h.id, round: 1, seq: 1, side: structuredClone(EMPTY), final: true, checkpoint: null });
      await x.op(U[3], 'submit', { matchId: h.id, round: 1, seq: 1, side: structuredClone(MID), final: true, checkpoint: null });
    }
    expect(revived.core.state.group!.rounds[1]!.digest).toBe(h.core.state.group!.rounds[1]!.digest);
  });

  it('switching to 1v1 sends seats 3 and 4 to a free seat or the stands; Group needs 3 to start', async () => {
    const h = new H();
    for (const u of U) h.core.connect(u, h.now);
    for (let i = 1; i < 4; i++) await h.op(U[i], 'join', JOIN(i));
    await h.op(U[1], 'take_seat', { role: 'spectator' });
    await h.op(U[0], 'set_options', { options: { v: 1, mode: 'duel', modifiers: [] } });
    const roles = Object.fromEntries(h.core.state.room.members.map((m) => [m.userId, m.role]));
    expect(roles[U[2]]).toBe('p2'); // p3 took the free seat 2
    expect(roles[U[3]]).toBe('spectator');
    await h.op(U[0], 'set_options', { options: GROUP });
    await h.op(U[3], 'take_seat', { role: 'p4' });
    await h.op(U[2], 'take_seat', { role: 'spectator' });
    await expect(h.op(U[0], 'start')).rejects.toThrow('need_three_players');
  });
});
