/**
 * VERSUS DUOS (owner 2026-10-25, R-DUOS-01 / R-DUOS-PASS-01): the 2v2 tag-team round (teams, fight order, team hearts,
 * one seat's own view of the fight) and passing a card to your teammate (1 Gold, once per card per turn, a full hand
 * waits, a pass lands once).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_INDEX } from '@game/content';
import { combatSide } from '@game/core';
import type { BoardMinion } from '@game/core';
import { reduce } from '../reducer';
import { handCap, type BoardCard, type PreparedCombatSide, type RunState } from '../state';
import { DUOS_PASS_GOLD, duosPassBlocked } from '../duosPass';
import { canonicalJson } from './canonical';
import {
  duosMateOf, duosRandomFirst, duosMemberOf, duosMemberView, duosTeamOf, duosTeamSeats, resolveVersusDuosRound, versusDuosCombatSeed,
  VERSUS_DUOS_PASS_GOLD, VERSUS_DUOS_STOMP_HEARTS,
} from './duos';
import { versusCombatSeed } from './combat';
import { versusGroupCombatSeed } from './group';
import { mirrorForEnemySeat } from './mirror';
import { createVersusRun } from './run';
import { normalizeVersusOptions, versusOptionsError, VERSUS_MODE_SEATS } from './options';
import { parityDuosRecord } from './server';

const { cases } = JSON.parse(readFileSync(join(__dirname, 'fixtures/parity.v1.json'), 'utf8')) as { cases: { matchSeed: number; round: number; p1: PreparedCombatSide; p2: PreparedCombatSide }[] };
const side = (board: BoardMinion[]): PreparedCombatSide => ({ board, state: combatSide(), config: {} });
const sandbag = (n: number, attack: number, health: number, tag: string): BoardMinion[] =>
  Array.from({ length: n }, (_, i) => ({ cardId: 'sandbag', attack, health, sourceUid: `${tag}${i}` }));

describe('Versus Duos teams and order (R-DUOS-01)', () => {
  it('teams are seat pairs: p1 + p2 vs p3 + p4', () => {
    expect(['p1', 'p2', 'p3', 'p4'].map((s) => duosTeamOf(s as 'p1'))).toEqual(['a', 'a', 'b', 'b']);
    expect(duosMateOf('p1')).toBe('p2');
    expect(duosMateOf('p4')).toBe('p3');
  });

  // R-DUOS-ORDER-01 (owner 2026-10-25): "I want the 'who fights first' to be a 50/50, not a player decision for duos
  // teams. Every round it should say who fights first but players cannot decide who it is."
  it('who fights first is a seeded pick: the same seed + round + team always gives the same seat', () => {
    for (const seed of [1, 9, 123456, -77, 0x7fffffff]) {
      for (let round = 1; round <= 12; round++) {
        const f = duosRandomFirst(seed, round);
        expect(duosRandomFirst(seed, round)).toEqual(f);
        expect(['p1', 'p2']).toContain(f.a);
        expect(['p3', 'p4']).toContain(f.b);
      }
    }
  });

  it('who fights first is roughly 50/50 per team, independent between the teams, and varies by round', () => {
    const N = 4000;
    let a1 = 0;
    let b3 = 0;
    let both = 0;
    let changed = 0;
    for (let i = 0; i < N; i++) {
      const seed = 1000 + Math.floor(i / 20);
      const round = (i % 20) + 1;
      const f = duosRandomFirst(seed, round);
      if (f.a === 'p1') a1++;
      if (f.b === 'p3') b3++;
      if (f.a === 'p1' && f.b === 'p3') both++;
      if (round > 1 && duosRandomFirst(seed, round - 1).a !== f.a) changed++;
    }
    expect(a1 / N).toBeGreaterThan(0.46);
    expect(a1 / N).toBeLessThan(0.54);
    expect(b3 / N).toBeGreaterThan(0.46);
    expect(b3 / N).toBeLessThan(0.54);
    expect(both / N).toBeGreaterThan(0.21); // independent teams: about a quarter
    expect(both / N).toBeLessThan(0.29);
    expect(changed / (N * 0.95)).toBeGreaterThan(0.44); // no alternation pattern, no stickiness
    expect(changed / (N * 0.95)).toBeLessThan(0.56);
  });

  it('no player input can set the order: the round input has no order field and the resolver fights the seeded pick', () => {
    const f = duosRandomFirst(31, 3);
    const big = side(sandbag(1, 5, 5, 'x'));
    // A smuggled order (the old flip's shape, the opposite of the pick) is ignored.
    const smuggled = { first: { a: duosMateOf(f.a), b: duosMateOf(f.b) } };
    const r = resolveVersusDuosRound({ matchSeed: 31, round: 3, sides: { p1: big, p2: big, p3: big, p4: big }, ...smuggled } as Parameters<typeof resolveVersusDuosRound>[0]);
    expect(r.first).toEqual(f);
    expect(r.aResult.duosFirst).toEqual(f);
  });

  it('the room option: "duos" is a mode of exactly four seats', () => {
    expect(versusOptionsError({ v: 1, mode: 'duos', modifiers: [] })).toBeNull();
    expect(normalizeVersusOptions({ mode: 'duos' }).mode).toBe('duos');
    expect(VERSUS_MODE_SEATS.duos).toEqual({ min: 4, max: 4 });
  });

  it('its own fight seed, apart from the 1v1 and group seeds', () => {
    const s = versusDuosCombatSeed(123, 4);
    expect(s).not.toBe(versusCombatSeed(123, 4));
    expect(s).not.toBe(versusGroupCombatSeed(123, 4, 0));
  });
});

describe('a Duos round: one tag-team fight (R-DUOS-01)', () => {
  const big = side(sandbag(1, 40, 400, 'big'));
  const small = side(sandbag(1, 1, 2, 'small'));

  // Seat the boards by the seeded pick of (9, round 1): `fa` fights first for team A, `ma` is its teammate.
  const pick = duosRandomFirst(9, 1);
  const fa = pick.a;
  const ma = duosMateOf(pick.a);
  const fb = pick.b;
  const mb = duosMateOf(pick.b);

  it('the winner that never needed its second board costs the losers 2 hearts; one that did, 1; a draw 0', () => {
    const stomp = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: { [fa]: big, [ma]: small, [fb]: small, [mb]: small } });
    expect(stomp.outcome).toBe('a');
    expect(stomp.losingTeam).toBe('b');
    expect(stomp.heartsLost).toBe(VERSUS_DUOS_STOMP_HEARTS);
    // Team A's first board is small this time: it falls, its teammate steps in and wins: 1 heart.
    const needed = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: { [fa]: small, [ma]: big, [fb]: small, [mb]: small } });
    expect(needed.outcome).toBe('a');
    expect(needed.heartsLost).toBe(1);
    expect(needed.aResult.events.some((e) => e.type === 'tagIn' && e.side === 'player')).toBe(true);
    const draw = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: {} });
    expect(draw.outcome).toBe('draw');
    expect(draw.heartsLost).toBe(0);
    expect(draw.losingTeam).toBeNull();
  });

  it('an empty first board hands straight over to its teammate', () => {
    const empty = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: { [ma]: big, [fb]: small } });
    expect(empty.first).toEqual({ a: ma, b: fb });
    expect(empty.heartsLost).toBe(VERSUS_DUOS_STOMP_HEARTS);
  });

  it('is deterministic over real recorded sides, and its parity record is stable', () => {
    const [x, y] = [cases[2]!, cases[3]!];
    const input = { matchSeed: x.matchSeed, round: x.round, sides: { p1: x.p1, p2: x.p2, p3: y.p1, p4: y.p2 } };
    const r1 = resolveVersusDuosRound(structuredClone(input));
    const r2 = resolveVersusDuosRound(structuredClone(input));
    expect(canonicalJson(r1)).toBe(canonicalJson(r2));
    expect(parityDuosRecord(r1).digest).toBe(parityDuosRecord(r2).digest);
  });

  it('team B\'s view is the mirror, with the member ledger flipped to its side', () => {
    const r = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: { [fa]: small, [ma]: big, [fb]: small, [mb]: small } });
    expect(r.bResult).toEqual(mirrorForEnemySeat(r.aResult));
    expect(r.bResult.tagTeam?.members.player).toEqual(r.aResult.tagTeam?.members.enemy);
    expect(r.bResult.tagTeam?.tagInAt.enemy).toBe(r.aResult.tagTeam?.tagInAt.player);
  });

  it('each SEAT lands its own board\'s carry-backs; a board that never fought lands none', () => {
    const r = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: { [fa]: small, [ma]: big, [fb]: side(sandbag(2, 1, 2, 'b')), [mb]: small } });
    const first = duosMemberView(r.aResult, duosMemberOf(fa, r.first));
    const mate = duosMemberView(r.aResult, duosMemberOf(ma, r.first));
    expect(first.duosMember).toBe(0);
    expect(mate.duosMember).toBe(1);
    expect(first.playerDeaths).toBe(1); // the first board's one body fell
    expect(mate.playerDeaths).toBe(0);
    expect((first.enemyDeaths ?? 0) + (mate.enemyDeaths ?? 0)).toBeGreaterThan(0);
    expect(first.result).toBe(mate.result); // the outcome is the team's
    // Team B: its first board's two bodies fell before its teammate stepped in.
    const bFirst = duosMemberView(r.bResult, duosMemberOf(fb, r.first));
    expect(bFirst.playerDeaths).toBe(2);
    const stomp = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: { [fa]: big, [ma]: small, [fb]: small, [mb]: small } });
    const idle = duosMemberView(stomp.aResult, duosMemberOf(ma, stomp.first));
    expect(idle.playerDeaths).toBe(0);
    expect(idle.enemyDeaths).toBe(0);
    expect(idle.playerDeathrattles).toBe(0);
  });
});

/** A Duos seat's run in its first Shop, with a known card in hand and on the board. */
function duosRun(): RunState {
  const run = createVersusRun(11, 'warden', 'set2', { v: 1, mode: 'duos', modifiers: [] });
  const id = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.tier === 1)!.id;
  const def = CARD_INDEX[id]!;
  const mk = (uid: string): BoardCard => ({ uid, cardId: id, tribe: def.tribe, attack: def.attack + 5, health: def.health + 5, keywords: [...def.keywords], golden: false });
  return { ...run, hand: [mk('h1')], board: [mk('b1')], embers: 3 };
}

describe('passing a card (R-DUOS-PASS-01: "passing should cost 1 gold")', () => {
  it('only a Duos seat\'s run can pass; other runs are byte-identical', () => {
    expect(createVersusRun(11, 'warden', 'set2').duos).toBeUndefined();
    expect(createVersusRun(11, 'warden', 'set2', { v: 1, mode: 'group', modifiers: [] }).duos).toBeUndefined();
    const plain = { ...createVersusRun(11, 'warden', 'set2'), embers: 3 };
    expect(reduce(plain, { type: 'passCard', uid: plain.hand[0]?.uid ?? 'x' })).toBe(plain);
    expect(DUOS_PASS_GOLD).toBe(VERSUS_DUOS_PASS_GOLD);
  });

  it('a pass costs 1 Gold, takes the card out of the hand and records it as it left', () => {
    const run = duosRun();
    const a = reduce(run, { type: 'passCard', uid: 'h1' });
    expect(a.embers).toBe(2);
    expect(a.hand.map((c) => c.uid)).toEqual([]);
    expect(a.duos!.outbox).toHaveLength(1);
    expect(a.duos!.outbox[0]).toMatchObject({ seq: 0, wave: run.wave, from: 'hand', card: { uid: 'h1', attack: run.hand[0]!.attack } });
  });

  it('"you aren\'t supposed to be able to pass a card off your board, only from hand": a board minion never passes', () => {
    const run = duosRun();
    expect(duosPassBlocked(run, 'b1')).toBe('board');
    expect(reduce(run, { type: 'passCard', uid: 'b1' })).toBe(run);
    expect(duosPassBlocked(run, 'h1')).toBeNull();
  });

  it('"you should be able to pass cards back to your teammate": ping-pong A->B->A->B, 1 Gold each time', () => {
    // Ann (p1) and Bob (p2), each with 3 Gold. Ann passes h1; Bob receives it and sends it straight back; Ann sends it
    // again; Bob lands it. Every pass is charged, every landing is exactly once, the card is never duplicated.
    let ann: RunState = { ...duosRun(), hand: [duosRun().hand[0]!], board: [] };
    let bob: RunState = { ...duosRun(), hand: [], board: [], uidSeq: 500 };
    const ship = (from: RunState, fromSeat: string, to: RunState): [RunState, RunState] => {
      const e = from.duos!.outbox[from.duos!.outbox.length - 1]!;
      return [from, reduce(to, { type: 'receivePass', from: fromSeat, seq: e.seq, card: e.card })];
    };
    ann = reduce(ann, { type: 'passCard', uid: 'h1' });
    [ann, bob] = ship(ann, 'p1', bob);
    expect(bob.hand).toHaveLength(1);
    expect(bob.hand[0]!.passKey).toBe('p1:0');
    expect(duosPassBlocked(bob, bob.hand[0]!.uid)).toBeNull(); // no "just passed to you"
    bob = reduce(bob, { type: 'passCard', uid: bob.hand[0]!.uid });
    [bob, ann] = ship(bob, 'p2', ann);
    expect([ann.hand.length, bob.hand.length]).toEqual([1, 0]);
    ann = reduce(ann, { type: 'passCard', uid: ann.hand[0]!.uid });
    [ann, bob] = ship(ann, 'p1', bob);
    expect([ann.hand.length, bob.hand.length]).toEqual([0, 1]);
    expect([ann.embers, bob.embers]).toEqual([1, 2]);
    expect(ann.duos!.outbox.map((e) => e.seq)).toEqual([0, 1]);
    expect(bob.duos!.received).toEqual(['p1:0', 'p1:1']);
    expect(ann.duos!.received).toEqual(['p2:0']);
    // The stats rode every hop; re-delivering any hop changes nothing.
    expect(bob.hand[0]).toMatchObject({ cardId: duosRun().hand[0]!.cardId, attack: duosRun().hand[0]!.attack, passKey: 'p1:1' });
    expect(reduce(bob, { type: 'receivePass', from: 'p1', seq: 0, card: ann.duos!.outbox[0]!.card })).toBe(bob);
  });

  it('no Gold, no pass', () => {
    const run = { ...duosRun(), embers: 0 };
    expect(reduce(run, { type: 'passCard', uid: 'h1' })).toBe(run);
  });

  it('a received card lands in the hand with a fresh uid and everything it carried, once', () => {
    const sender = duosRun();
    const card = { ...sender.hand[0]!, golden: true, keywords: ['T' as const] };
    const recv = { ...duosRun(), hand: [] };
    const got = reduce(recv, { type: 'receivePass', from: 'p2', seq: 0, card });
    expect(got.hand).toHaveLength(1);
    const arrived = got.hand[0]!;
    expect(arrived.uid).not.toBe(card.uid);
    expect(arrived).toMatchObject({ cardId: card.cardId, attack: card.attack, health: card.health, golden: true, keywords: ['T'], passKey: 'p2:0' });
    // Re-delivered: nothing changes.
    expect(reduce(got, { type: 'receivePass', from: 'p2', seq: 0, card })).toBe(got);
    // ...and it CAN be passed straight back (owner 2026-10-25), for its 1 Gold.
    const back = reduce({ ...got, embers: 5 }, { type: 'passCard', uid: arrived.uid });
    expect([back.hand.length, back.embers]).toEqual([0, 4]);
    // The transport's hand-only marker never lands in the hand.
    const marked = reduce(recv, { type: 'receivePass', from: 'p2', seq: 1, card: { ...card, passFrom: 'hand' } as BoardCard });
    expect('passFrom' in marked.hand[0]!).toBe(false);
  });

  it('"Pass is refused if hand is full": a full hand refuses it; the sender gets the card and the Gold back', () => {
    const base = duosRun();
    const full: BoardCard[] = Array.from({ length: handCap(base) }, (_, i) => ({ ...base.hand[0]!, uid: `f${i}` }));
    const recv = { ...base, hand: full };
    const got = reduce(recv, { type: 'receivePass', from: 'p1', seq: 3, card: base.board[0]! });
    expect(got.hand).toHaveLength(handCap(base));
    expect(got.duos!.refused).toEqual(['p1:3']);
    expect(got.duos!.received).toEqual([]);
    // Answered once: the same pass again changes nothing, even with room now.
    expect(reduce({ ...got, hand: [] }, { type: 'receivePass', from: 'p1', seq: 3, card: base.board[0]! }).hand).toHaveLength(0);
    // The sender: the card goes back to its hand slot, the Gold and the Gold-spent tallies come back, once.
    const sender = duosRun();
    const sent = reduce(sender, { type: 'passCard', uid: 'h1' });
    expect([sent.embers, sent.hand.length]).toEqual([sender.embers - 1, 0]);
    const back = reduce(sent, { type: 'passRefunded', seq: 0 });
    expect(back.hand.map((c) => c.uid)).toEqual(['h1']);
    expect(back.embers).toBe(sender.embers);
    expect(back.goldSpentThisTurn ?? 0).toBe(sender.goldSpentThisTurn ?? 0);
    expect(back.goldSpent ?? 0).toBe(sender.goldSpent ?? 0);
    expect(back.duos!.outbox[0]!.refunded).toBe(true);
    expect(reduce(back, { type: 'passRefunded', seq: 0 })).toBe(back);
    // An older checkpoint's board pass (before the hand-only ruling) still goes back to its board slot.
    const old: RunState = { ...sender, board: [], duos: { outbox: [{ seq: 0, wave: sender.wave, card: sender.board[0]!, from: 'board', index: 0 }], received: [], refused: [] } };
    expect(reduce(old, { type: 'passRefunded', seq: 0 }).board.map((c) => c.uid)).toEqual(['b1']);
  });

  it('a pass that arrives during the fight lands in the hand at once (when there is room)', () => {
    const recv = { ...duosRun(), phase: 'combat' as const };
    const got = reduce(recv, { type: 'receivePass', from: 'p1', seq: 0, card: duosRun().hand[0]! });
    expect(got.hand).toHaveLength(recv.hand.length + 1);
  });

  it('team ids are letters by seat pair, so N teams extend the same helpers', () => {
    expect(duosTeamSeats('a')).toEqual(['p1', 'p2']);
    expect(duosTeamSeats('b')).toEqual(['p3', 'p4']);
    const four = duosRandomFirst(77, 3, 4);
    expect(Object.keys(four)).toEqual(['a', 'b', 'c', 'd']);
    for (const [t, s] of Object.entries(four)) expect(duosTeamSeats(t)).toContain(s);
    expect({ a: four.a, b: four.b }).toEqual(duosRandomFirst(77, 3)); // adding teams never reshuffles the first two
  });
});
