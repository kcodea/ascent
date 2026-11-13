/**
 * ANCIENTS × THE DUOS HEROES through the room (R-ANCDUOS-01; owner 2026-11-10: "just build them so they work. we arent
 * turning ancients on just yet, but build it out").
 *
 * Two real runs (`createVersusRun` with its dev seam, the only way a Duos run carries Ancients) on either side of the
 * room core on a fake clock: what one run sends is what `duos_pass` records, and what the other run lands is what
 * `duos_passes` hands back. Everything that crosses players does so ON a pass row, so the room's own guarantees are
 * the pairing's: once per seq, to the teammate only, refused when they are away, answered once.
 *
 *  - Priestess × Bonds: the teammate's +4/+4 arrives with the card, exactly once, across a retry, a second pull and a
 *    reconnect; an away teammate gets nothing and the card comes back.
 *  - Magician × Genesis: the Gilded copy and the three-spell copy are accepted and land.
 *  - Magician × War: a committed tag-team round carries the exchange, and equals the resolver's digest.
 *
 * The Worker's own code is unchanged by this work: these are the rules it already had, holding for the new payloads.
 */
import { describe, expect, it } from 'vitest';
import { ANCIENT_IDS, buildVersusCandidate, createVersusRun, duosRoundDigest, duosWireOf, reduce, versusDuosStartingVitals, type AncientId, type BoardCard, type PreparedCombatSide, type RunState } from '@game/sim';
import { CARD_INDEX } from '@game/content';
import { makeRng, type CombatEvent } from '@game/core';
import { engineContentRevision, resolveVersusDuosRound, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { DISCONNECT_GRACE_MS, newRoomState, RoomCore, type CoreDeps, type CoreEffects } from '../src/core/roomCore';
import type { GSeat } from '../src/core/groupMatch';

const U = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'] as const;
const SEAT: GSeat[] = ['p1', 'p2', 'p3', 'p4'];
const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);
const DUOS: { v: 1; mode: 'duos'; modifiers: [] } = { v: 1, mode: 'duos', modifiers: [] };
const HERO_IDS = ['indy', 'warden', 'gorr', 'robin', 'xerox', 'soren', 'nadja', 'merrin', 'vale', 'risen', 'albus', 'hunch'];

function deps(): CoreDeps {
  let s = 4242;
  let u = 0;
  return { random31: () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff), uuid: () => `dddddddd-dddd-4ddd-8ddd-${String(++u).padStart(12, '0')}` };
}
class H {
  now = T0;
  core = new RoomCore(newRoomState({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', name: 'D', hostUserId: U[0], displayName: 'P1', profile: {}, setId: 'set2', contentRevision: engineContentRevision(), protocol: VERSUS_PROTOCOL, options: DUOS }, this.now), deps());
  log: CoreEffects[] = [];
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
async function inShop(): Promise<H> {
  const h = new H();
  for (const u of U) h.core.connect(u, h.now);
  for (let i = 1; i < 4; i++) await h.op(U[i]!, 'join', { as: 'player', display: `P${i + 1}`, profile: {}, content: engineContentRevision(), protocol: VERSUS_PROTOCOL });
  await h.op(U[0], 'start');
  for (const u of U) await h.op(u, 'gate');
  for (let i = 0; i < 4; i++) await h.op(U[i]!, 'register_offer', { matchId: h.id, offer: HERO_IDS.slice(i * 3, i * 3 + 3) });
  for (const u of U) await h.op(u, 'pick_hero', { matchId: h.id, index: 0 });
  for (const u of U) await h.op(u, 'intro_done', { matchId: h.id });
  expect(h.g.phase).toBe('shop');
  return h;
}

const minions = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby).map((c) => c!);
const PLAIN = minions.filter((c) => c.effects.length === 0 && c.keywords.length === 0 && c.tier <= 2).map((c) => c.id);
const SPELL = Object.values(CARD_INDEX).find((c) => c && c.spell && !c.ruby && !c.token && !c.duos && (c.cost ?? 0) <= 3)!.id;
const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** A Duos run with Ancients on (the dev seam) and `pick` locked in. */
function ancientRun(heroId: string, seed: number, pick: AncientId, over: Partial<RunState> = {}): RunState {
  let s: RunState = { ...createVersusRun(seed, heroId, 'set2', DUOS, 'warden', { ancients: true }), embers: 400, hand: [], board: [], shop: [], spell: null, ...over };
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [pick, ...ANCIENT_IDS.filter((a) => a !== pick).slice(0, 2)] } };
  return reduce(s, { type: 'pickAncient', id: pick });
}
const mateRun = (over: Partial<RunState> = {}): RunState => ({ ...createVersusRun(12, 'warden', 'set2', DUOS, 'priestess'), hand: [], board: [], shop: [], spell: null, ...over });
/** Ship the sender's outbox entries from `since` on to the room, as the Versus store does. */
async function send(h: H, user: string, run: RunState, since = 0): Promise<void> {
  for (const e of run.duos!.outbox.slice(since)) await h.op(user, 'duos_pass', { matchId: h.id, round: h.g.round, seq: e.seq, card: duosWireOf(e) });
}
/** The receiver pulls the team's rows, lands each on its run, and answers the room. */
async function pull(h: H, user: string, seat: GSeat, b: RunState): Promise<RunState> {
  for (const r of await h.op(user, 'duos_passes', { matchId: h.id, from: 1 })) {
    if (r.to_seat !== seat || r.status === 'refused') continue;
    b = reduce(b, { type: 'receivePass', from: r.from_seat, seq: r.seq, card: r.card });
    if (r.status === 'sent') await h.op(user, 'duos_answer_pass', { matchId: h.id, fromSeat: r.from_seat, seq: r.seq, landed: b.duos!.received.includes(`${r.from_seat}:${r.seq}`) });
  }
  return b;
}
const mateBoard = (): BoardCard[] => [card('x', PLAIN[0]!, { attack: 2, health: 2 }), card('y', PLAIN[1]!, { attack: 2, health: 2 })];

describe('Priestess × Bonds through the room: the teammate\'s +4/+4 rides the pass', () => {
  const priestess = (): RunState => ancientRun('priestess', 11, 'bonds', { board: [card('a', PLAIN[0]!, { attack: 1, health: 1 })], hand: [card('h', PLAIN[2]!)] });

  it('BOTH TEAMMATES: one pass, both left-most minions +4/+4; a retry, a second pull and the opponents change nothing', async () => {
    const h = await inShop();
    const a = reduce(priestess(), { type: 'passCard', uid: 'h' });
    expect(a.board[0]).toMatchObject({ attack: 5, health: 5 });
    await send(h, U[0], a);
    await send(h, U[0], a); // the client retries the same seq: the same row, not a second pass
    const rows = await h.op(U[1], 'duos_passes', { matchId: h.id, from: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ from_seat: 'p1', to_seat: 'p2', status: 'sent' });
    expect(rows[0].card.passBonds).toEqual({ attack: 4, health: 4 });
    let b = await pull(h, U[1], 'p2', mateRun({ board: mateBoard() }));
    expect(b.board.map((c) => [c.attack, c.health])).toEqual([[6, 6], [2, 2]]);
    expect(b.hand.map((c) => c.cardId)).toEqual([PLAIN[2]]);
    expect((await h.op(U[1], 'duos_passes', { matchId: h.id, from: 1 }))[0].status).toBe('landed');
    // The pull runs again (the push's backstop, a reload): the pass key is answered, so nothing is given twice.
    const again = await pull(h, U[1], 'p2', b);
    expect(again).toBe(b);
    // Only the team reads it.
    expect(await h.op(U[2], 'duos_passes', { matchId: h.id, from: 1 })).toHaveLength(0);
    expect(h.core.passAudience(h.log.find((fx) => fx.passes.length > 0)!.passes[0]!).sort()).toEqual([U[0], U[1]].sort());
    b = again;
  });

  it('the teammate drops and comes back inside the grace: the pass waits on the room and lands once on their return', async () => {
    const h = await inShop();
    h.core.disconnect(U[1], h.now);
    await h.advance(2_000);
    const a = reduce(priestess(), { type: 'passCard', uid: 'h' });
    await send(h, U[0], a);
    h.core.connect(U[1], h.now);
    // Their run comes back from before the pass (a reload) and reads the room's rows.
    const b = await pull(h, U[1], 'p2', mateRun({ board: mateBoard() }));
    expect(b.board[0]).toMatchObject({ attack: 6, health: 6 });
    expect(b.hand).toHaveLength(1);
    expect(await pull(h, U[1], 'p2', b)).toBe(b);
  });

  it('the teammate is away: the room refuses the pass, the card and the Gold come back, and they get nothing', async () => {
    const h = await inShop();
    h.core.disconnect(U[1], h.now);
    await h.advance(DISCONNECT_GRACE_MS);
    let a = reduce(priestess(), { type: 'passCard', uid: 'h' });
    const gold = a.embers;
    await expect(send(h, U[0], a)).rejects.toThrow('teammate_away');
    a = reduce(a, { type: 'passRefunded', seq: 0 });
    expect(a.hand.map((c) => c.uid)).toEqual(['h']);
    expect(a.embers).toBe(gold + 1);
    // My own minion keeps what it gained when I passed; no row exists for the teammate to land.
    expect(a.board[0]).toMatchObject({ attack: 5, health: 5 });
    h.core.connect(U[1], h.now);
    const b = await pull(h, U[1], 'p2', mateRun({ board: mateBoard() }));
    expect(b.board[0]).toMatchObject({ attack: 2, health: 2 });
  });

  it('sent just before the teammate dropped: it waits on the room through the pause and lands once when they are back', async () => {
    const h = await inShop();
    const a = reduce(priestess(), { type: 'passCard', uid: 'h' });
    await send(h, U[0], a);
    h.core.disconnect(U[1], h.now);
    await h.advance(DISCONNECT_GRACE_MS);
    expect((await h.op(U[0], 'duos_passes', { matchId: h.id, from: 1 }))[0].status).toBe('sent');
    h.core.connect(U[1], h.now);
    const b = await pull(h, U[1], 'p2', mateRun({ board: mateBoard() }));
    expect(b.board[0]).toMatchObject({ attack: 6, health: 6 });
    expect(b.hand).toHaveLength(1);
    expect(await pull(h, U[1], 'p2', b)).toBe(b);
  });

  it('Passaria to a teammate whose hand is full: accepted, the minion waits, and the +4/+4 lands with it', async () => {
    const h = await inShop();
    await h.op(U[1], 'duos_hand_room', { matchId: h.id, room: 0 });
    const a = reduce(ancientRun('priestess', 11, 'bonds', { board: [card('a', PLAIN[0]!), card('b', PLAIN[1]!)], heroReady: true }), { type: 'heroPower', uid: 'b' });
    expect(a.duos!.outbox).toHaveLength(1);
    await send(h, U[0], a);
    const full = minions.filter((c) => c.tier <= 2 && c.effects.length > 0).slice(0, 10).map((c, i) => card(`h${i}`, c.id));
    const b = await pull(h, U[1], 'p2', mateRun({ board: mateBoard(), hand: full }));
    expect(b.duos!.waiting).toHaveLength(1);
    expect(b.board[0]).toMatchObject({ attack: 6, health: 6 });
    expect((await h.op(U[1], 'duos_passes', { matchId: h.id, from: 1 }))[0].status).toBe('landed');
  });
});

describe('Priestess × Death through the room: the minion arrives with Rise', () => {
  it('BOTH TEAMMATES: a passed Echo minion is received with Rise', async () => {
    const echo = minions.find((c) => c.effects.length === 1 && c.effects[0]!.on === 'onDeath' && !c.keywords.includes('R') && c.tier <= 3)!.id;
    const h = await inShop();
    const a = reduce(ancientRun('priestess', 11, 'death', { board: [card('e', echo)], heroReady: true }), { type: 'heroPower', uid: 'e' });
    await send(h, U[0], a);
    const b = await pull(h, U[1], 'p2', mateRun());
    expect(b.hand[0]).toMatchObject({ cardId: echo });
    expect(b.hand[0]!.keywords).toContain('R');
  });
});

describe('Magician × Genesis through the room: a Gilded copy, three spells', () => {
  /** Seven buys of `cardId` (Genesis: the hat needs eight); the eighth buy fires it. Every card in the hat is `cardId`,
   *  so whichever one the hat picks, the copy is that card. */
  const hatFull = (cardId: string): RunState => {
    let s = ancientRun('magician', 11, 'genesis');
    for (let i = 0; i < 7; i++) s = { ...reduce({ ...s, shop: [{ uid: `q${i}`, cardId }] }, { type: 'buy', uid: `q${i}` }), hand: [] };
    expect(s.duos!.outbox).toHaveLength(0);
    return s;
  };

  it('BOTH TEAMMATES: the minion copy is accepted Gilded and lands Gilded; the Magician keeps the plain one', async () => {
    const h = await inShop();
    const a = reduce({ ...hatFull(PLAIN[0]!), shop: [{ uid: 'g', cardId: PLAIN[0]! }] }, { type: 'buy', uid: 'g' });
    expect(a.hand[0]).toMatchObject({ cardId: PLAIN[0], golden: false });
    await send(h, U[0], a);
    const rows = await h.op(U[1], 'duos_passes', { matchId: h.id, from: 1 });
    expect(rows[0].card).toMatchObject({ cardId: PLAIN[0], golden: true, passFrom: 'sale', passHat: true });
    const b = await pull(h, U[1], 'p2', mateRun());
    const d = CARD_INDEX[PLAIN[0]!]!;
    expect(b.hand).toHaveLength(1);
    expect(b.hand[0]).toMatchObject({ cardId: d.id, golden: true, attack: d.attack * 2, health: d.health * 2 });
    expect(await pull(h, U[1], 'p2', b)).toBe(b);
  });

  it('BOTH TEAMMATES: a spell is one pass that lands as three copies, once', async () => {
    const h = await inShop();
    const a = reduce({ ...hatFull(SPELL), spell: { uid: 'sp', cardId: SPELL } }, { type: 'buy', uid: 'sp' });
    expect(a.duos!.outbox).toHaveLength(1);
    await send(h, U[0], a);
    expect((await h.op(U[1], 'duos_passes', { matchId: h.id, from: 1 }))[0].card.passCopies).toBe(3);
    const b = await pull(h, U[1], 'p2', mateRun());
    expect(b.hand.map((c) => c.cardId)).toEqual([SPELL, SPELL, SPELL]);
    expect(await pull(h, U[1], 'p2', b)).toBe(b);
  });
});

describe('Magician × War through the room: a committed tag-team round carries the exchange', () => {
  const SHARED = PLAIN[0]!;
  const side = (heroId: string, seed: number, board: BoardCard[], pick?: AncientId): PreparedCombatSide => {
    const run = pick
      ? ancientRun(heroId, seed, pick, { board })
      : { ...createVersusRun(seed, heroId, 'set2', DUOS, 'warden'), hand: [], shop: [], spell: null, board };
    return buildVersusCandidate(run, makeRng(seed))!;
  };

  it('the room resolves the round to the resolver\'s digest, with both copies sharing stats', async () => {
    const h = await inShop();
    const sides = [
      side('magician', 21, [card('m0', PLAIN[1]!, { attack: 1, health: 40 }), card('m1', SHARED, { attack: 3, health: 50 })], 'war'),
      side('warden', 22, [card('w0', SHARED, { attack: 7, health: 9 }), card('w1', PLAIN[2]!, { attack: 2, health: 2 })]),
      side('indy', 23, [card('f0', PLAIN[2]!, { attack: 60, health: 3000 })]),
      side('gorr', 24, [card('f1', PLAIN[2]!, { attack: 60, health: 3000 })]),
    ];
    expect(sides[0]!.state.questMods?.ancientMateSwap).toEqual({ label: 'Ancient of War' });
    for (let i = 0; i < 4; i++) await h.op(U[i]!, 'submit', { matchId: h.id, round: 1, seq: 1, side: structuredClone(sides[i]), final: true, checkpoint: null });
    expect(h.g.phase).toBe('combat');
    const r1 = h.core.state.group!.rounds[1]!;
    const vitals = {
      a: versusDuosStartingVitals(h.seat('p1').hero, h.seat('p2').hero, h.g.options),
      b: versusDuosStartingVitals(h.seat('p3').hero, h.seat('p4').hero, h.g.options),
    };
    const ref = resolveVersusDuosRound({ matchSeed: h.g.seed, round: 1, sides: { p1: sides[0]!, p2: sides[1]!, p3: sides[2]!, p4: sides[3]! }, vitals });
    expect(ref.refused).toEqual({});
    expect(r1.digest).toBe(duosRoundDigest(ref));
    const events = (r1.fights[0]!.a_result as { events: CombatEvent[] }).events;
    const war = events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'Ancient of War');
    expect(war).toHaveLength(1);
    const tag = events.find((e): e is Extract<CombatEvent, { type: 'tagIn' }> => e.type === 'tagIn' && e.side === 'player')!;
    const shared = tag.minions.find((m) => m.cardId === SHARED)!;
    expect([shared.attack, shared.health]).toEqual([10, 59]);
    void SEAT;
  });
});
