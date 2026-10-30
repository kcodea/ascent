/**
 * VERSUS ON CLOUDFLARE — VERSUS DUOS (2v2 tag-team) on a fake clock. Blocks are named after the chaos-harness scenarios
 * they stand for (baseline, duosFirstEmpty, duosSecondEmpty, mendArmor, dropRestore, resolver failure); passing has its
 * own block (R-DUOS-PASS-01: the server cap, the full-hand refusal, the teammate away, exactly once per seq, team-only).
 *
 * PARITY: every committed round equals the Edge Function's `resolveVersusDuosRound` digest for the same input.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createVersusRun, duosRoundDigest, duosWireOf, HEROES, reduce, versusDuosStartingVitals, type PreparedCombatSide, type RunState } from '@game/sim';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { engineContentRevision, resolveVersusDuosRound, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { DUOS_HISTORY_MAX_BYTES, parseDuosHistory } from '@game/sim/versus/duosHistory';
import { DISCONNECT_GRACE_MS, newRoomState, RoomCore, turnSeconds, type CoreDeps, type CoreEffects, type CoreState } from '../src/core/roomCore';
import { DUOS_TEAM_FX_CAP, duosTeamFxRefusal, type GSeat } from '../src/core/groupMatch';

interface Case { name: string; matchSeed: number; round: number; p1: PreparedCombatSide; p2: PreparedCombatSide }
const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/sim/src/versus/fixtures/parity.v1.json', import.meta.url)), 'utf8')) as { cases: Case[] };
const STRONG = FIXTURE.cases.find((c) => c.p1.board.length === 7)!.p1;
const MID = FIXTURE.cases[1]!.p2;
const EMPTY: PreparedCombatSide = { board: [], state: structuredClone(FIXTURE.cases[0]!.p1.state), config: {} };

const U = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'] as const;
const SEAT: GSeat[] = ['p1', 'p2', 'p3', 'p4'];
const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);
const HERO_IDS = HEROES.slice(0, 12).map((h) => h.id);
const DUOS: { v: 1; mode: 'duos'; modifiers: [] } = { v: 1, mode: 'duos', modifiers: [] };

function deps(): CoreDeps {
  let s = 4242;
  let u = 0;
  return { random31: () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff), uuid: () => `dddddddd-dddd-4ddd-8ddd-${String(++u).padStart(12, '0')}` };
}

class H {
  now = T0;
  core: RoomCore;
  log: CoreEffects[] = [];
  constructor(d: CoreDeps = deps(), state?: CoreState) {
    this.core = new RoomCore(state ?? newRoomState({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', name: 'D', hostUserId: U[0], displayName: 'P1', profile: {}, setId: 'set1', contentRevision: engineContentRevision(), protocol: VERSUS_PROTOCOL, options: DUOS }, this.now), d);
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
  team(t: 'a' | 'b') { return this.g.teams!.find((x) => x.team === t)!; }
}

async function inShop(d?: CoreDeps): Promise<H> {
  const h = new H(d);
  for (const u of U) h.core.connect(u, h.now);
  for (let i = 1; i < 4; i++) await h.op(U[i], 'join', { as: 'player', display: `P${i + 1}`, profile: {}, content: engineContentRevision(), protocol: VERSUS_PROTOCOL });
  await h.op(U[0], 'start');
  for (const u of U) await h.op(u, 'gate');
  expect(h.g.options.mode).toBe('duos');
  expect(h.g.teams!.map((t) => t.team)).toEqual(['a', 'b']);
  for (let i = 0; i < 4; i++) await h.op(U[i], 'register_offer', { matchId: h.id, offer: HERO_IDS.slice(i * 3, i * 3 + 3) });
  for (const u of U) await h.op(u, 'pick_hero', { matchId: h.id, index: 0 });
  for (const u of U) await h.op(u, 'intro_done', { matchId: h.id });
  expect(h.g.shop_deadline).toBe(h.now + turnSeconds(1, 'duos') * 1000);
  return h;
}

const lockAll = async (h: H, sides: (PreparedCombatSide | null)[]) => {
  for (let i = 0; i < 4; i++) {
    if (h.seat(SEAT[i]!).eliminated_round != null || sides[i] == null) continue;
    await h.op(U[i], 'submit', { matchId: h.id, round: h.g.round, seq: 1, side: structuredClone(sides[i]), final: true, checkpoint: null });
  }
};
const readyAll = async (h: H) => {
  const round = h.g.round;
  for (let i = 0; i < 4; i++) if (h.seat(SEAT[i]!).eliminated_round == null) await h.op(U[i], 'combat_ready', { matchId: h.id, round });
};

describe('Duos room (Cloudflare) — baseline, duosFirstEmpty / duosSecondEmpty', () => {
  it('Duos needs all four seats; one tag-team fight a round on the team pools, identical to the Edge Function', async () => {
    const short = new H();
    for (const u of U) short.core.connect(u, short.now);
    for (let i = 1; i < 3; i++) await short.op(U[i], 'join', { as: 'player', display: 'x', profile: {}, content: engineContentRevision(), protocol: VERSUS_PROTOCOL });
    await expect(short.op(U[0], 'start')).rejects.toThrow('need_four_players');

    const h = await inShop();
    await lockAll(h, [STRONG, MID, MID, EMPTY]);
    expect(h.g.phase).toBe('combat');
    const r1 = h.core.state.group!.rounds[1]!;
    expect(r1.fights).toHaveLength(1);
    const vitals = {
      a: versusDuosStartingVitals(h.seat('p1').hero, h.seat('p2').hero, h.g.options),
      b: versusDuosStartingVitals(h.seat('p3').hero, h.seat('p4').hero, h.g.options),
    };
    const ref = resolveVersusDuosRound({ matchSeed: h.g.seed, round: 1, sides: { p1: STRONG, p2: MID, p3: MID, p4: EMPTY }, vitals });
    expect(r1.digest).toBe(duosRoundDigest(ref));
    // Both teammates show their team's one pool.
    expect(h.seat('p1').health).toBe(h.team('a').health);
    expect(h.seat('p3').armor).toBe(h.team('b').armor);
    expect(h.g.duos_first).toBeNull();
  });

  it('an empty first or second board never halts a round (the teammate steps in, or nobody does)', async () => {
    for (const sides of [[EMPTY, MID, MID, EMPTY], [MID, EMPTY, EMPTY, MID], [EMPTY, EMPTY, EMPTY, EMPTY]]) {
      const h = await inShop();
      await lockAll(h, sides);
      expect(h.g.phase).toBe('combat');
      expect(h.core.state.group!.rounds[1]!.fights).toHaveLength(1);
    }
  });
});

describe('Duos room (Cloudflare) — knockouts and the end', () => {
  it('a team at 0 is out together (both to the stands, 2nd); the other team is 1st; the room reopens', async () => {
    const h = await inShop();
    let guard = 0;
    while (h.g.phase !== 'complete' && guard++ < 60) {
      await lockAll(h, [STRONG, STRONG, EMPTY, EMPTY]);
      if (h.g.phase === 'combat') await readyAll(h);
    }
    expect(h.g.phase).toBe('complete');
    expect(h.team('b').placement).toBe(2);
    expect(h.team('a').placement).toBe(1);
    expect([h.seat('p3').placement, h.seat('p4').placement]).toEqual([2, 2]);
    expect([h.seat('p1').placement, h.seat('p2').placement]).toEqual([1, 1]);
    for (const s of ['p3', 'p4'] as GSeat[]) expect(h.core.state.room.members.find((m) => m.userId === h.seat(s).user_id)!.role).toBe('spectator');
    expect(h.core.state.room.status).toBe('open');
  });

  it("the final match row carries the game's history record: both teams placed, every player's last fought board (R-DUOS-HISTORY-01)", async () => {
    const h = await inShop();
    let guard = 0;
    while (h.g.phase !== 'complete' && guard++ < 60) {
      await lockAll(h, [STRONG, MID, EMPTY, MID]);
      if (h.g.phase === 'combat') await readyAll(h);
    }
    const rows = h.log.flatMap((f) => f.persist).filter((j) => j.kind === 'group_match');
    // Only the final row carries it (a mid-game row never does).
    expect(rows.filter((j) => (j.row as { history?: unknown }).history).length).toBe(1);
    const hist = parseDuosHistory((rows.at(-1)!.row as { history: unknown }).history)!;
    expect(hist.mode).toBe('versus_duos');
    expect(hist.endRound).toBe(h.g.round);
    expect(hist.teams.map((t) => [t.team, t.placement, t.kind])).toEqual([['a', 1, 'live'], ['b', 2, 'live']]);
    expect(hist.teams[1]!.outRound).toBe(h.g.round);
    expect(hist.teams.flatMap((t) => t.members.map((m) => m.userId))).toEqual([...U]);
    const p1 = hist.teams[0]!.members[0]!;
    expect(p1.heroId).toBe(h.seat('p1').hero);
    expect(p1.board!.minions.map((m) => m.cardId)).toEqual(STRONG.board.map((m) => m.cardId));
    expect(p1.board!.round).toBe(h.g.round);
    expect(hist.teams[1]!.members[0]!.board!.minions).toEqual([]); // an empty board is recorded as empty, not missing
    expect(JSON.stringify(hist).length).toBeLessThan(DUOS_HISTORY_MAX_BYTES);
  });

  it('a forfeit takes the whole team out (the teammate as forfeit too); the other team wins', async () => {
    const h = await inShop();
    await h.op(U[3], 'forfeit', { matchId: h.id });
    expect(h.seat('p4').out_reason).toBe('forfeit');
    expect(h.seat('p3').eliminated_round).toBe(1);
    expect(h.g.phase).toBe('complete');
    expect(h.g.winner_seat).toBe('p1');
    // A game over before anyone locked a board still records the game, with no boards.
    const fin = h.log.flatMap((f) => f.persist).filter((j) => j.kind === 'group_match').at(-1)!.row as { history: unknown };
    const hist = parseDuosHistory(fin.history)!;
    expect(hist.teams.map((t) => [t.team, t.placement, t.outRound ?? null])).toEqual([['a', 1, null], ['b', 2, 1]]);
    expect(hist.teams.every((t) => t.members.every((m) => m.board === null))).toBe(true);
  });
});

describe('Duos room (Cloudflare) — passing (R-DUOS-PASS-01)', () => {
  const card = (id = 'x') => ({ cardId: HERO_IDS[0] ?? id, passFrom: 'hand' });

  it('a pass reaches the teammate only, exactly once per seq; answered landed', async () => {
    const h = await inShop();
    const row = await h.op(U[0], 'duos_pass', { matchId: h.id, round: 1, seq: 1, card: card() });
    expect(row).toMatchObject({ from_seat: 'p1', to_seat: 'p2', status: 'sent' });
    const fx = h.log.at(-1)!;
    expect(fx.passes).toHaveLength(1);
    expect(h.core.passAudience(fx.passes[0]!).sort()).toEqual([U[0], U[1]].sort());
    // The same seq again is the same row (a retry), not a second pass.
    expect(await h.op(U[0], 'duos_pass', { matchId: h.id, round: 1, seq: 1, card: card() })).toEqual(row);
    const answered = await h.op(U[1], 'duos_answer_pass', { matchId: h.id, fromSeat: 'p1', seq: 1, landed: true });
    expect(answered.status).toBe('landed');
    await expect(h.op(U[2], 'duos_answer_pass', { matchId: h.id, fromSeat: 'p1', seq: 1, landed: true })).rejects.toThrow('not_receiver');
    // Only the team reads its passes.
    expect(await h.op(U[1], 'duos_passes', { matchId: h.id, from: 1 })).toHaveLength(1);
    expect(await h.op(U[2], 'duos_passes', { matchId: h.id, from: 1 })).toHaveLength(0);
  });

  it('refused: a full hand, the server cap of 10 a round, a bad card, a teammate away', async () => {
    const h = await inShop();
    await h.op(U[1], 'duos_hand_room', { matchId: h.id, room: 1 });
    await h.op(U[0], 'duos_pass', { matchId: h.id, round: 1, seq: 1, card: card() });
    await expect(h.op(U[0], 'duos_pass', { matchId: h.id, round: 1, seq: 2, card: card() })).rejects.toThrow('hand_full');
    await h.op(U[1], 'duos_hand_room', { matchId: h.id, room: 30 });
    for (let s = 2; s <= 10; s++) await h.op(U[0], 'duos_pass', { matchId: h.id, round: 1, seq: s, card: card() });
    await expect(h.op(U[0], 'duos_pass', { matchId: h.id, round: 1, seq: 11, card: card() })).rejects.toThrow('too_many_passes');
    await expect(h.op(U[2], 'duos_pass', { matchId: h.id, round: 1, seq: 1, card: { cardId: 'x', passFrom: 'board' } })).rejects.toThrow('bad_card');
    // "Golden minions CANNOT be passed" (owner 2026-10-30, R-DUOS-PASS-NO-GOLDEN-01): the server refuses one a client sends anyway.
    await expect(h.op(U[2], 'duos_pass', { matchId: h.id, round: 1, seq: 1, card: { ...card(), golden: true } })).rejects.toThrow('golden');
    h.core.disconnect(U[3], h.now);
    await h.advance(DISCONNECT_GRACE_MS);
    await expect(h.op(U[2], 'duos_pass', { matchId: h.id, round: 1, seq: 2, card: card() })).rejects.toThrow('teammate_away');
  });
});

describe('Duos room (Cloudflare) — Duos-only cards: team effects ride the pass channel (R-DUOS-CARDS-01)', () => {
  const ann = (hand: string[]): RunState => {
    const run = createVersusRun(11, 'warden', 'set2', DUOS);
    return { ...run, embers: 10, hand: hand.map((id, i) => ({ uid: `a${i}`, cardId: id, tribe: CARD_INDEX[id]!.tribe, attack: 0, health: 1, keywords: [], golden: false })) };
  };

  it('BOTH TEAMMATES end to end: Share the Wealth on one run puts a Gold Pouch in the other run\'s hand, through the Worker', async () => {
    const h = await inShop();
    const a = reduce(ann(['duo_sharewealth']), { type: 'play', uid: 'a0' });
    const e = a.duos!.outbox[0]!;
    expect(e.team).toEqual({ kind: 'gift', cardId: 'emberpouch', count: 1 });
    // The receiver's hand reports no room: a TEAM EFFECT is not refused up front (its run decides).
    await h.op(U[1], 'duos_hand_room', { matchId: h.id, room: 0 });
    await h.op(U[1], 'duos_hand_room', { matchId: h.id, room: 5 });
    const row = await h.op(U[0], 'duos_pass', { matchId: h.id, round: 1, seq: e.seq, card: duosWireOf(e) });
    expect(row).toMatchObject({ from_seat: 'p1', to_seat: 'p2', status: 'sent' });
    expect(h.core.passAudience(h.log.at(-1)!.passes[0]!).sort()).toEqual([U[0], U[1]].sort());
    // The teammate pulls the team's rows and lands each through its own run's `receivePass`.
    let b: RunState = { ...createVersusRun(12, 'warden', 'set2', DUOS), hand: [] };
    for (const r of await h.op(U[1], 'duos_passes', { matchId: h.id, from: 1 })) {
      b = reduce(b, { type: 'receivePass', from: r.from_seat, seq: r.seq, card: r.card });
      await h.op(U[1], 'duos_answer_pass', { matchId: h.id, fromSeat: r.from_seat, seq: r.seq, landed: b.duos!.received.includes(`${r.from_seat}:${r.seq}`) });
    }
    expect(b.hand.map((c) => c.cardId)).toEqual(['emberpouch']);
    expect((await h.op(U[1], 'duos_passes', { matchId: h.id, from: 1 }))[0].status).toBe('landed');
    // The opponents never see it.
    expect(await h.op(U[2], 'duos_passes', { matchId: h.id, from: 1 })).toHaveLength(0);
  });

  it('team effects skip the hand-room check and the 10-pass cap, have their own cap, and a spell pass travels as `spell`', async () => {
    const h = await inShop();
    await h.op(U[1], 'duos_hand_room', { matchId: h.id, room: 30 });
    const team = (seq: number) => ({ uid: `team${seq}`, cardId: '__team', passFrom: 'team', team: { kind: 'maxGold', amount: 1 } });
    for (let s = 1; s <= 10; s++) await h.op(U[0], 'duos_pass', { matchId: h.id, round: 1, seq: s, card: { cardId: HERO_IDS[0], passFrom: 'hand' } });
    await expect(h.op(U[0], 'duos_pass', { matchId: h.id, round: 1, seq: 11, card: { cardId: HERO_IDS[0], passFrom: 'hand' } })).rejects.toThrow('too_many_passes');
    await h.op(U[1], 'duos_hand_room', { matchId: h.id, room: 0 });
    for (let s = 11; s < 11 + DUOS_TEAM_FX_CAP; s++) await h.op(U[0], 'duos_pass', { matchId: h.id, round: 1, seq: s, card: team(s) });
    await expect(h.op(U[0], 'duos_pass', { matchId: h.id, round: 1, seq: 200, card: team(200) })).rejects.toThrow('too_many_passes');
    // A team effect needs its `team` object; a spell's pass is a card pass (hand room applies).
    await expect(h.op(U[2], 'duos_pass', { matchId: h.id, round: 1, seq: 1, card: { cardId: '__team', passFrom: 'team' } })).rejects.toThrow('bad_card');
    await expect(h.op(U[2], 'duos_pass', { matchId: h.id, round: 1, seq: 1, card: { cardId: HERO_IDS[0], passFrom: 'spell' } })).resolves.toMatchObject({ to_seat: 'p4' });
  });

  it('owner 2026-10-30: a DISCONNECTED teammate still gets it (lands on reconnect); a teammate who LEFT or is OUT is skipped', async () => {
    const h = await inShop();
    h.core.disconnect(U[3], h.now);
    await h.advance(DISCONNECT_GRACE_MS);
    const fx = { uid: 'team1', cardId: '__team', passFrom: 'team', team: { kind: 'maxGold', amount: 1 } };
    // A card pass to the away teammate is still refused; the team effect is recorded for them.
    await expect(h.op(U[2], 'duos_pass', { matchId: h.id, round: 1, seq: 1, card: { cardId: HERO_IDS[0], passFrom: 'hand' } })).rejects.toThrow('teammate_away');
    await expect(h.op(U[2], 'duos_pass', { matchId: h.id, round: 1, seq: 2, card: fx })).resolves.toMatchObject({ to_seat: 'p4', status: 'sent' });
    // Back: their client pulls the team's rows and finds it waiting.
    h.core.connect(U[3], h.now);
    expect((await h.op(U[3], 'duos_passes', { matchId: h.id, from: 1 })).map((r: { status: string }) => r.status)).toEqual(['sent']);
    // Left the party for good (Ranked Duos) or out of the match: skipped.
    expect(duosTeamFxRefusal({ eliminated_round: null, left_at: null })).toBeNull();
    expect(duosTeamFxRefusal({ eliminated_round: null, left_at: T0 })).toBe('no_teammate');
    expect(duosTeamFxRefusal({ eliminated_round: 3, left_at: null })).toBe('no_teammate');
  });
});

describe('Duos room (Cloudflare) — Duos cards batch A: BOTH TEAMMATES through the Worker', () => {
  const card = (id: string, uid: string): RunState['hand'][number] => {
    const d = CARD_INDEX[id]!;
    return { uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
  };
  const seat = (seed: number, over: Partial<RunState> = {}): RunState => ({ ...createVersusRun(seed, 'warden', 'set2', DUOS), hand: [], board: [], embers: 10, ...over });
  /** Send every queued team row of `from` (seat p1) through the Worker, then land the teammate's pulled rows on `to`. */
  async function relay(h: H, from: RunState, to: RunState): Promise<RunState> {
    for (const e of from.duos!.outbox) await h.op(U[0], 'duos_pass', { matchId: h.id, round: 1, seq: e.seq, card: duosWireOf(e) });
    let b = to;
    for (const r of await h.op(U[1], 'duos_passes', { matchId: h.id, from: 1 })) {
      b = reduce(b, { type: 'receivePass', from: r.from_seat, seq: r.seq, card: r.card });
      await h.op(U[1], 'duos_answer_pass', { matchId: h.id, fromSeat: r.from_seat, seq: r.seq, landed: b.duos!.received.includes(`${r.from_seat}:${r.seq}`) });
    }
    return b;
  }

  it('Tribe Bundle, Monstrocity, Broshake and Bratworst Buck: each gift reaches the other run and lands there', async () => {
    const h = await inShop();
    await h.op(U[1], 'duos_hand_room', { matchId: h.id, room: 10 });
    const filler = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.duos && c.tier === 1 && c.effects.length === 0)!.id;
    let a = seat(11, { board: [card(filler, 'm0'), card('duo_bratworst', 'bb')], hand: [card('duo_tribebundle', 'tb'), card('duo_broshake', 'bs'), card('wo_champion', 'ale')] });
    const run0 = a;
    a = reduce(a, { type: 'play', uid: 'tb' });
    a = reduce(a, { type: 'play', uid: 'bs' });
    a = reduce(a, { type: 'play', uid: 'ale' });
    a = reduce({ ...a, shop: [{ uid: 'mo', cardId: 'duo_monstrocity' }, ...a.shop], embers: 10 }, { type: 'buy', uid: 'mo' });
    expect(a.duos!.outbox.map((e) => e.team?.kind)).toEqual(['gift', 'buffLeftmost', 'gift', 'gift']);
    expect(run0.duos!.outbox).toHaveLength(0);
    const mateBoard = [card(filler, 'q0')];
    const b = await relay(h, a, seat(12, { board: mateBoard }));
    const got = b.hand.map((c) => c.cardId);
    expect(got).toContain('wo_champion');
    expect(got).toContain('duo_monstrocity');
    expect(got).toHaveLength(3); // + the Tribe Bundle minion
    expect(b.board[0]).toMatchObject({ attack: mateBoard[0]!.attack + 3, health: mateBoard[0]!.health + 5 });
    // The opponents see none of it.
    expect(await h.op(U[2], 'duos_passes', { matchId: h.id, from: 1 })).toHaveLength(0);
  });

  it("combat gifts (Antsy's Echo, Toot Toot's Rally, Spencer's Echo) are sent at settle and land on the teammate", async () => {
    const h = await inShop();
    await h.op(U[1], 'duos_hand_room', { matchId: h.id, room: 10 });
    const run = seat(11, { board: [card('duo_toottoot', 't1'), card('duo_antsy', 'a1'), card('duo_spencer', 's1')] });
    const parked = reduce(run, { type: 'faceOmen', deferFight: true });
    const prep = parked.pendingCombatSide!;
    const foe = [{ cardId: 'sandbag', attack: 20, health: 30, keywords: [] }] as unknown as BoardMinion[];
    const result = simulate(structuredClone(prep.board), foe, makeRng(7), CARD_INDEX, structuredClone(prep.state), combatSide({ tier: 6 }), prep.config);
    const a = reduce(parked, { type: 'resolveCombat', fight: { result, damageTaken: 0 } });
    const kinds = a.duos!.outbox.map((e) => e.team?.kind);
    expect(kinds).toContain('upgradeDiscount');
    const gifts = a.duos!.outbox.filter((e) => e.team?.kind === 'gift');
    expect(gifts.length).toBeGreaterThanOrEqual(2); // Antsy's spell + at least one Toot Toot swing
    const mate = seat(12);
    const b = await relay(h, a, mate);
    expect(b.upgradeCost).toBe(mate.upgradeCost - 1);
    expect(b.hand.length).toBe(Math.min(10, gifts.length));
    expect(b.hand.some((c) => CARD_INDEX[c.cardId]?.spell && CARD_INDEX[c.cardId]?.tier === 1)).toBe(true);
  });
});

describe('Duos room (Cloudflare) — mendArmor, dropRestore, resolver failure', () => {
  it('a Mend report raises the TEAM pool, and both teammates show it', async () => {
    const h = await inShop();
    await lockAll(h, [EMPTY, EMPTY, EMPTY, EMPTY]);
    await readyAll(h);
    const before = h.team('a').armor!;
    await h.op(U[1], 'submit', { matchId: h.id, round: 2, seq: 1, side: { ...structuredClone(EMPTY), vitals: { resolve: 30, armor: 5 } }, final: false, checkpoint: null });
    expect(h.team('a').armor).toBe(Math.max(before, 5));
    expect(h.seat('p1').armor).toBe(h.team('a').armor);
  });

  it('a drop pauses; the socket coming back starts the 3-2-1', async () => {
    const h = await inShop();
    h.core.disconnect(U[2], h.now);
    await h.advance(DISCONNECT_GRACE_MS);
    expect(h.g.paused_seat).toBe('p3');
    h.core.connect(U[2], h.now);
    await h.advance(3_000);
    expect(h.g.paused_at).toBeNull();
  });

  it('a round the object cannot resolve ends the match void', async () => {
    const h = await inShop({ ...deps(), resolveDuos: async () => { throw new Error('boom'); } });
    await lockAll(h, [MID, MID, MID, MID]);
    expect(h.g.end_reason).toBe('void');
    expect(h.g.winner_seat).toBeNull();
  });
});
