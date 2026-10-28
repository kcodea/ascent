/**
 * VERSUS ON CLOUDFLARE — the Room object's rules on a fake clock (spike, 2026-10-28). These run in the root vitest
 * (Node, no workerd): the Durable Object is a thin shell around `RoomCore`, so ready / 0:00 close / resolve /
 * disconnect-pause-reconnect / auto-forfeit / end of match are all proven here. The workerd round trip itself is
 * covered by `test/it/room.it.ts` (`npm run versus:cf:test`).
 *
 * PARITY: every fixture fight resolved INSIDE the room equals `simulate()` run locally on the same sides and seed, and
 * its digest equals the one `versus-resolve` would store for the same round.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { makeRng, simulate, type CombatResult } from '@game/core';
import { HEROES, type PreparedCombatSide } from '@game/sim';
import {
  engineContentRevision,
  resolveVersusFight,
  versusCombatSeed,
  versusStartingVitals,
  VERSUS_PROTOCOL,
} from '@game/sim/versus/server';
import { versusFightDigest } from '@game/sim';
import { originAllowed } from '../src/origins';
import { DISCONNECT_GRACE_MS, newRoomState, ROOM_IDLE_MS, RoomCore, SHOP_GRACE_MS, turnSeconds, type CoreEffects, type CoreState } from '../src/core/roomCore';
import { stateFromEntries, valueOfKey } from '../src/core/storage';

interface Case { name: string; matchSeed: number; round: number; p1: PreparedCombatSide; p2: PreparedCombatSide }
const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/sim/src/versus/fixtures/parity.v1.json', import.meta.url)), 'utf8')) as { cases: Case[] };

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const ROOM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);
const HERO_IDS = HEROES.slice(0, 6).map((h) => h.id);

function deps() {
  let s = 12345;
  let u = 0;
  return {
    random31: () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff),
    uuid: () => `bbbbbbbb-bbbb-4bbb-8bbb-${String(++u).padStart(12, '0')}`,
  };
}

/** A room driven like the Durable Object drives it, with a clock the test moves. */
class Harness {
  now = T0;
  core: RoomCore;
  log: CoreEffects[] = [];
  constructor(state?: CoreState) {
    this.core = new RoomCore(state ?? newRoomState({ id: ROOM, name: 'Test', hostUserId: U1, displayName: 'One', profile: {}, setId: 'set1', contentRevision: engineContentRevision(), protocol: VERSUS_PROTOCOL }, this.now), deps());
  }
  async op(user: string, op: string, args: Record<string, unknown> = {}): Promise<any> {
    const { data, effects } = await this.core.op(user, op, args, this.now);
    this.log.push(effects);
    return data;
  }
  async advance(ms: number): Promise<CoreEffects> {
    this.now += ms;
    const fx = await this.core.tick(this.now);
    this.log.push(fx);
    return fx;
  }
  get m() { return this.core.state.match!; }
  get id() { return this.core.state.match!.id; }
}

const JOIN = { as: 'player', display: 'Two', profile: {}, content: engineContentRevision(), protocol: VERSUS_PROTOCOL };

/** Two seated, connected players with a match in round 1's running shop. */
async function inShop(): Promise<Harness> {
  const h = new Harness();
  h.core.connect(U1, h.now);
  h.core.connect(U2, h.now);
  await h.op(U2, 'join', JOIN);
  await h.op(U1, 'start');
  await h.op(U1, 'gate');
  await h.op(U2, 'gate');
  expect(h.m.phase).toBe('hero_select');
  await h.op(U1, 'register_offer', { matchId: h.id, offer: HERO_IDS.slice(0, 3) });
  await h.op(U2, 'register_offer', { matchId: h.id, offer: HERO_IDS.slice(3, 6) });
  await h.op(U1, 'pick_hero', { matchId: h.id, index: 0 });
  await h.op(U2, 'pick_hero', { matchId: h.id, index: 1 });
  expect(h.m.phase).toBe('shop');
  await h.op(U1, 'intro_done', { matchId: h.id });
  await h.op(U2, 'intro_done', { matchId: h.id });
  expect(h.m.shop_deadline).toBe(h.now + turnSeconds(1) * 1000);
  return h;
}

const side = (c: Case, seat: 'p1' | 'p2') => structuredClone(c[seat]);
const EMPTY: PreparedCombatSide = { board: [], state: structuredClone(FIXTURE.cases[0]!.p1.state), config: {} };

describe('Versus Room (Cloudflare) — rooms and the gate', () => {
  it('create, join, start, both gates → a match in Hero Select with hidden offers', async () => {
    const h = new Harness();
    h.core.connect(U1, h.now);
    h.core.connect(U2, h.now);
    const room = await h.op(U2, 'join', JOIN);
    expect(room.members.map((m: { role: string }) => m.role)).toEqual(['p1', 'p2']);
    await expect(h.op(U2, 'start')).rejects.toThrow('not_host');
    await h.op(U1, 'start');
    expect(h.core.state.room.status).toBe('sealed');
    await h.op(U1, 'gate');
    expect(h.core.state.match).toBeNull();
    await h.op(U2, 'gate');
    expect(h.core.state.room.status).toBe('in_game');
    expect(h.m.phase).toBe('hero_select');
    // The offer is private: it never rides the match row.
    await h.op(U1, 'register_offer', { matchId: h.id, offer: HERO_IDS.slice(0, 3) });
    expect(JSON.stringify(h.core.matchJson())).not.toContain(HERO_IDS[0]);
    expect(h.log.at(-1)!.priv.has('p1')).toBe(true);
    expect(h.log.at(-1)!.match).toBe(false);
  });

  it('the gate window runs out → the room is Open again', async () => {
    const h = new Harness();
    h.core.connect(U1, h.now);
    h.core.connect(U2, h.now);
    await h.op(U2, 'join', JOIN);
    await h.op(U1, 'start');
    await h.op(U1, 'gate');
    expect(h.core.nextAlarm(h.now)).toBe(h.now + 30_000);
    await h.advance(30_000);
    expect(h.core.state.room.status).toBe('open');
  });

  it('a Versus room never turns into a Ranked Duos party (bad_mode)', async () => {
    const h = new Harness();
    h.core.connect(U1, h.now);
    await expect(h.op(U1, 'set_options', { options: { v: 1, mode: 'ranked_duos', modifiers: [] } })).rejects.toThrow('bad_mode');
    await h.op(U1, 'set_options', { options: { v: 1, mode: 'duel', modifiers: ['summit'] } });
    expect(h.core.state.room.options_rev).toBe(1);
  });
});

describe('Versus Room (Cloudflare) — ready, close, resolve', () => {
  it('both End Turn → the fight is resolved in the same call and pushed with the match', async () => {
    const h = await inShop();
    const c = FIXTURE.cases[0]!;
    await h.op(U1, 'submit', { matchId: h.id, round: 1, seq: 1, side: side(c, 'p1'), final: true, checkpoint: { k: 1 } });
    expect(h.m.phase).toBe('shop');
    const answer = await h.op(U2, 'submit', { matchId: h.id, round: 1, seq: 1, side: side(c, 'p2'), final: true, checkpoint: null });
    // The locking call's own answer already reads `combat`: no finalize hop, no poll.
    expect(answer.phase).toBe('combat');
    const fx = h.log.at(-1)!;
    expect(fx.rounds).toEqual([1]);
    expect(fx.match).toBe(true);
    expect(fx.persist.map((j) => j.kind)).toEqual(['round', 'match']);
    const row = h.core.state.rounds[1]!;
    expect(row.p1_health).toBe(h.m.p1_health);
    expect(row.p1_scout).toHaveProperty('tier');
  });

  it('End Turn is a ready signal: take it back, change the board, ready again', async () => {
    const h = await inShop();
    const c = FIXTURE.cases[0]!;
    await h.op(U1, 'submit', { matchId: h.id, round: 1, seq: 1, side: side(c, 'p1'), final: true, checkpoint: null });
    expect(h.m.p1_locked).toBe(true);
    await h.op(U1, 'unready', { matchId: h.id, round: 1, seq: 2 });
    expect(h.m.p1_locked).toBe(false);
    // A late candidate older than the unready is ignored; a re-lock with a newer seq lands.
    await h.op(U1, 'submit', { matchId: h.id, round: 1, seq: 2, side: EMPTY, final: false, checkpoint: null });
    expect(h.core.state.subs.p1!.prepared_side).toEqual(side(c, 'p1'));
    await h.op(U1, 'submit', { matchId: h.id, round: 1, seq: 3, side: EMPTY, final: true, checkpoint: null });
    expect(h.core.state.subs.p1!.prepared_side).toEqual(EMPTY);
    // Re-sent after End Turn with a newer seq: still ready, newer board.
    await h.op(U1, 'submit', { matchId: h.id, round: 1, seq: 4, side: side(c, 'p1'), final: true, checkpoint: null });
    expect(h.m.p1_locked).toBe(true);
    expect(h.core.state.subs.p1!.prepared_side).toEqual(side(c, 'p1'));
  });

  it('0:00 closes the round after the 250 ms grace, promoting the newest candidate', async () => {
    const h = await inShop();
    const c = FIXTURE.cases[0]!;
    await h.op(U1, 'submit', { matchId: h.id, round: 1, seq: 1, side: side(c, 'p1'), final: true, checkpoint: null });
    await h.op(U2, 'submit', { matchId: h.id, round: 1, seq: 5, side: side(c, 'p2'), final: false, checkpoint: null });
    const deadline = h.m.shop_deadline!;
    expect(h.core.nextAlarm(h.now)).toBe(deadline + SHOP_GRACE_MS);
    await h.advance(deadline - h.now + 100);
    // A side sent at 0:00 still lands within the grace.
    await h.op(U2, 'submit', { matchId: h.id, round: 1, seq: 6, side: side(c, 'p2'), final: false, checkpoint: null });
    expect(h.m.phase).toBe('shop');
    await h.advance(SHOP_GRACE_MS);
    expect(h.m.phase).toBe('combat');
    expect(h.core.state.subs.p2!.source).toBe('deadline');
    await expect(h.op(U2, 'submit', { matchId: h.id, round: 1, seq: 7, side: side(c, 'p2'), final: true, checkpoint: null })).rejects.toThrow('stale_round');
  });

  it('nobody submits at all: both fight the empty board (two AFK players never deadlock)', async () => {
    const h = await inShop();
    await h.advance(turnSeconds(1) * 1000 + SHOP_GRACE_MS);
    expect(h.m.phase).toBe('combat');
    expect(h.core.state.rounds[1]!.outcome).toBe('draw');
    expect(h.core.state.subs.p1!.source).toBe('empty');
  });

  it('End Combat: both ready opens the next shop at once; one ready gives the other 5 s', async () => {
    const h = await inShop();
    await h.advance(turnSeconds(1) * 1000 + SHOP_GRACE_MS);
    await h.op(U1, 'combat_ready', { matchId: h.id, round: 1 });
    expect(h.m.combat_deadline).toBe(h.now + 5_000);
    await h.op(U2, 'combat_ready', { matchId: h.id, round: 1 });
    expect(h.m.phase).toBe('shop');
    expect(h.m.round).toBe(2);
    expect(h.m.shop_deadline).toBe(h.now + turnSeconds(2) * 1000);
  });

  it('the combat view cap opens the next shop when nobody presses End Combat', async () => {
    const h = await inShop();
    await h.advance(turnSeconds(1) * 1000 + SHOP_GRACE_MS);
    await h.advance(90_000);
    expect(h.m.round).toBe(2);
  });
});

describe('Versus Room (Cloudflare) — disconnects', () => {
  it('a closed socket pauses the match after the grace; the socket coming back starts the 3-2-1 itself (R-VERSUS-AUTO-RESUME-01) and every deadline moves', async () => {
    const h = await inShop();
    const deadline = h.m.shop_deadline!;
    h.core.disconnect(U2, h.now);
    await h.advance(DISCONNECT_GRACE_MS - 1);
    expect(h.m.paused_at).toBeNull();
    await h.advance(1);
    expect(h.m.paused_seat).toBe('p2');
    const pausedAt = h.m.paused_at!;
    // The paused clock does not run out.
    await h.advance(turnSeconds(1) * 1000 + 10_000);
    expect(h.m.phase).toBe('shop');
    await expect(h.op(U1, 'request_resume', { matchId: h.id })).rejects.toThrow('not_your_pause');
    const fx = h.core.connect(U2, h.now);
    expect(h.m.resume_at).toBe(h.now + 3_000);
    expect(fx.events.map((e) => e.kind)).toContain('resume_request');
    await h.advance(3_000);
    expect(h.m.paused_at).toBeNull();
    expect(h.m.shop_deadline).toBe(deadline + (h.now - pausedAt));
  });

  it('the next alarm is always in the future (a passed grace or deadline never re-arms "now": no alarm spin)', async () => {
    const h = await inShop();
    h.core.disconnect(U2, h.now);
    await h.advance(DISCONNECT_GRACE_MS);
    expect(h.m.paused_at).not.toBeNull();
    for (let i = 0; i < 5; i++) {
      const next = h.core.nextAlarm(h.now);
      if (next == null) break; // nothing pending until someone acts (an unpause, a return)
      expect(next).toBeGreaterThan(h.now);
      await h.advance(next - h.now);
    }
  });

  it('a reload inside the grace never pauses', async () => {
    const h = await inShop();
    h.core.disconnect(U2, h.now);
    await h.advance(1_500);
    h.core.connect(U2, h.now);
    await h.advance(5_000);
    expect(h.m.paused_at).toBeNull();
  });

  it('after 30 s the opponent unpauses; the absent seat auto-plays its last locked board, and 3 such rounds forfeit', async () => {
    const h = await inShop();
    const c = FIXTURE.cases[1]!;
    await h.op(U2, 'submit', { matchId: h.id, round: 1, seq: 1, side: side(c, 'p2'), final: true, checkpoint: null });
    await h.op(U1, 'submit', { matchId: h.id, round: 1, seq: 1, side: EMPTY, final: true, checkpoint: null });
    await h.op(U1, 'combat_ready', { matchId: h.id, round: 1 });
    await h.op(U2, 'combat_ready', { matchId: h.id, round: 1 });
    h.core.disconnect(U2, h.now);
    await h.advance(DISCONNECT_GRACE_MS);
    await expect(h.op(U1, 'unpause', { matchId: h.id })).rejects.toThrow('grace_running');
    await h.advance(30_000);
    await h.op(U1, 'unpause', { matchId: h.id });
    await h.advance(3_000);
    expect(h.m.p2_auto).toBe(true);
    for (let round = 2; round <= 4 && h.m.phase !== 'complete'; round++) {
      expect(h.m.round).toBe(round);
      await h.op(U1, 'submit', { matchId: h.id, round, seq: 1, side: EMPTY, final: true, checkpoint: null });
      expect(h.core.state.subs.p2!.source).toBe('auto');
      expect(h.core.state.subs.p2!.prepared_side).toEqual(side(c, 'p2'));
      if (h.m.phase === 'combat') await h.op(U1, 'combat_ready', { matchId: h.id, round });
    }
    expect(h.m.phase).toBe('complete');
    expect(['missed', 'hearts']).toContain(h.m.end_reason);
    expect(h.core.state.room.status).toBe('open');
  });

  it('a heartbeat from an auto seat that came back clears auto', async () => {
    const h = await inShop();
    h.core.disconnect(U2, h.now);
    await h.advance(DISCONNECT_GRACE_MS);
    await h.advance(30_000);
    await h.op(U1, 'unpause', { matchId: h.id });
    await h.advance(3_000);
    h.core.connect(U2, h.now);
    await h.op(U2, 'heartbeat');
    expect(h.m.p2_auto).toBe(false);
  });

  it('both gone for 10 minutes of pause: abandoned', async () => {
    const h = await inShop();
    h.core.disconnect(U1, h.now);
    h.core.disconnect(U2, h.now);
    await h.advance(DISCONNECT_GRACE_MS);
    expect(h.m.paused_at).not.toBeNull();
    await h.advance(10 * 60_000);
    expect(h.m.end_reason).toBe('abandoned');
  });
});

describe('Versus Room (Cloudflare) — a round that cannot resolve', () => {
  it('ends the match void (no winner, nobody charged) instead of sitting in resolving (R-VERSUS-RESOLVE-TIMEOUT-01)', async () => {
    const h = new Harness();
    h.core = new RoomCore(h.core.state, { ...deps(), resolve: async () => { throw new Error('engine broke'); } });
    h.core.connect(U1, h.now);
    h.core.connect(U2, h.now);
    await h.op(U2, 'join', JOIN);
    await h.op(U1, 'start');
    await h.op(U1, 'gate');
    await h.op(U2, 'gate');
    await h.advance(20_000);
    await h.advance(45_000);
    await h.op(U1, 'submit', { matchId: h.id, round: 1, seq: 1, side: EMPTY, final: true, checkpoint: null });
    await h.op(U2, 'submit', { matchId: h.id, round: 1, seq: 1, side: EMPTY, final: true, checkpoint: null });
    expect(h.m.phase).toBe('complete');
    expect(h.m.end_reason).toBe('void');
    expect(h.m.winner_seat).toBeNull();
    expect(h.core.state.room.status).toBe('open');
    expect(h.log.flatMap((f) => f.events.map((e) => e.kind))).toEqual(expect.arrayContaining(['close', 'resolve_err', 'void']));
  });
});

describe('Versus Room (Cloudflare) — the end', () => {
  it('a concede ends the match and opens the room; leaving mid-match concedes too', async () => {
    const h = await inShop();
    await h.op(U2, 'forfeit', { matchId: h.id });
    expect(h.m.winner_seat).toBe('p1');
    expect(h.core.state.room.status).toBe('open');
    const g = await inShop();
    await g.op(U1, 'leave');
    expect(g.m.winner_seat).toBe('p2');
    expect(g.core.state.room.host_user_id).toBe(U2);
  });

  it('Health 0 ends the match (the lobby damage, Armor first), and the pools are the server\'s', async () => {
    const h = await inShop();
    const strong = FIXTURE.cases.find((c) => c.p1.board.length === 7)!;
    const start = versusStartingVitals(h.m.p2_hero, h.m.options);
    let round = 1;
    while (h.m.phase !== 'complete' && round < 40) {
      await h.op(U1, 'submit', { matchId: h.id, round, seq: 1, side: side(strong, 'p1'), final: true, checkpoint: null });
      await h.op(U2, 'submit', { matchId: h.id, round, seq: 1, side: EMPTY, final: true, checkpoint: null });
      if (h.m.phase === 'combat') {
        await h.op(U1, 'combat_ready', { matchId: h.id, round });
        await h.op(U2, 'combat_ready', { matchId: h.id, round });
      }
      round++;
    }
    expect(h.m.end_reason).toBe('hearts');
    expect(h.m.winner_seat).toBe('p1');
    expect(h.m.p2_health).toBe(0);
    const dealt = Object.values(h.core.state.rounds).reduce((n, r) => n + r.p2_damage, 0);
    expect(dealt).toBeGreaterThanOrEqual(start.health + start.armor);
    expect(h.log.flatMap((f) => f.persist).filter((j) => j.kind === 'round')).toHaveLength(round - 1);
  });

  it('spectators join the stands and never hold a seat', async () => {
    const h = await inShop();
    h.core.connect(U3, h.now);
    await h.op(U3, 'join', { ...JOIN, as: 'spectator' });
    await expect(h.op(U3, 'submit', { matchId: h.id, round: 1, seq: 1, side: EMPTY, final: true, checkpoint: null })).rejects.toThrow('not_a_player');
    expect(await h.op(U3, 'my_private', { matchId: h.id })).toBeNull();
  });
});

describe('Versus Room (Cloudflare) — hibernation', () => {
  it('a room rebuilt from its storage keys mid-match carries on identically', async () => {
    const h = await inShop();
    const c = FIXTURE.cases[2]!;
    await h.op(U1, 'submit', { matchId: h.id, round: 1, seq: 1, side: side(c, 'p1'), final: true, checkpoint: { restore: 1 } });
    const store = new Map<string, unknown>();
    for (const fx of h.log) for (const k of fx.dirty) {
      const v = valueOfKey(h.core.state, k);
      if (v === undefined) store.delete(k); else store.set(k, structuredClone(v));
    }
    const revived = new Harness(stateFromEntries(store)!);
    revived.now = h.now;
    revived.core.restoreSockets([U1, U2], h.now);
    await revived.op(U2, 'submit', { matchId: h.id, round: 1, seq: 1, side: side(c, 'p2'), final: true, checkpoint: null });
    await h.op(U2, 'submit', { matchId: h.id, round: 1, seq: 1, side: side(c, 'p2'), final: true, checkpoint: null });
    expect(revived.core.state.rounds[1]!.digest).toBe(h.core.state.rounds[1]!.digest);
    expect(await revived.op(U1, 'my_checkpoint', { matchId: h.id })).toMatchObject({ round: 1, checkpoint: { restore: 1 } });
  });
});

describe('Versus Room (Cloudflare) — PARITY with simulate()', () => {
  it('every fixture fight resolved inside the room equals simulate() run locally, and its digest equals versus-resolve\'s', async () => {
    for (const c of FIXTURE.cases) {
      const h = await inShop();
      // Seat the case: its seed and round (the room's own seed is server-drawn; the parity fixture pins one).
      h.m.seed = c.matchSeed;
      h.m.round = c.round;
      const before = { p1: versusStartingVitals(h.m.p1_hero, h.m.options), p2: versusStartingVitals(h.m.p2_hero, h.m.options) };
      await h.op(U1, 'submit', { matchId: h.id, round: c.round, seq: 1, side: side(c, 'p1'), final: true, checkpoint: null });
      await h.op(U2, 'submit', { matchId: h.id, round: c.round, seq: 1, side: side(c, 'p2'), final: true, checkpoint: null });
      const row = h.core.state.rounds[c.round]!;
      expect(row, c.name).toBeDefined();
      // 1. The raw fight: simulate() on the same sides and seed, p1 as `player`, the round's tie-break side.
      const raw = simulate(structuredClone(c.p1.board), structuredClone(c.p2.board), makeRng(versusCombatSeed(c.matchSeed, c.round)), CARD_INDEX,
        structuredClone(c.p1.state), structuredClone(c.p2.state), { firstSide: c.round % 2 === 1 ? 'player' : 'enemy' });
      const p1 = row.p1_result as CombatResult;
      expect(p1.result, c.name).toBe(raw.result);
      expect(JSON.stringify(p1.events), c.name).toBe(JSON.stringify(raw.events));
      // 2. The stored round: byte-identical to the Edge Function's resolver for the same input (digest of both views,
      //    damage and pools).
      const reference = resolveVersusFight({ matchSeed: c.matchSeed, round: c.round, p1: side(c, 'p1'), p2: side(c, 'p2'), vitals: before });
      expect(row.digest, c.name).toBe(versusFightDigest(reference));
      expect(row.outcome, c.name).toBe(reference.outcome);
    }
  });
});

describe('Versus Room (Cloudflare) — guards', () => {
  it('a room with no match running and no request for 30 minutes closes itself (its alarm stops)', async () => {
    const h = new Harness();
    h.core.connect(U1, h.now);
    await h.op(U1, 'set_options', { options: { v: 1, mode: 'duel', modifiers: [] } });
    expect(h.core.nextAlarm(h.now)).toBe(h.now + ROOM_IDLE_MS);
    await h.advance(ROOM_IDLE_MS);
    expect(h.core.state.room.closed).toBe(true);
    expect(h.core.state.room.members).toHaveLength(0);
    expect(h.core.nextAlarm(h.now)).toBeNull();
  });

  it('a running match never idles out', async () => {
    const h = await inShop();
    await h.advance(ROOM_IDLE_MS);
    expect(h.core.state.room.closed).toBe(false);
  });

  it('origins: the Netlify site and local dev only', () => {
    const list = 'https://*.netlify.app,http://localhost:*,http://127.0.0.1:*';
    expect(originAllowed('https://ascent-game.netlify.app', list)).toBe(true);
    expect(originAllowed('http://localhost:5173', list)).toBe(true);
    expect(originAllowed('http://127.0.0.1:5291', list)).toBe(true);
    expect(originAllowed('https://evil.example.com', list)).toBe(false);
    expect(originAllowed('https://netlify.app.evil.com', list)).toBe(false);
    expect(originAllowed('https://a.b.netlify.app', list)).toBe(false);
    expect(originAllowed(null, list)).toBe(true);
  });
});
