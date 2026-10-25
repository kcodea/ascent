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
import { DUOS_PASS_GOLD } from '../duosPass';
import { canonicalJson } from './canonical';
import {
  duosDefaultFirst, duosMateOf, duosMemberOf, duosMemberView, duosTeamOf, duosTeamSeats, resolveVersusDuosRound, versusDuosCombatSeed,
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

  it('the first board alternates by round: p1 / p3 on odd rounds, p2 / p4 on even ones', () => {
    expect(duosDefaultFirst(1)).toEqual({ a: 'p1', b: 'p3' });
    expect(duosDefaultFirst(2)).toEqual({ a: 'p2', b: 'p4' });
    expect(duosDefaultFirst(7)).toEqual({ a: 'p1', b: 'p3' });
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

  it('the winner that never needed its second board costs the losers 2 hearts; one that did, 1; a draw 0', () => {
    const stomp = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: { p1: big, p2: small, p3: small, p4: small } });
    expect(stomp.outcome).toBe('a');
    expect(stomp.losingTeam).toBe('b');
    expect(stomp.heartsLost).toBe(VERSUS_DUOS_STOMP_HEARTS);
    // Team A's first board (p1, round 1) is small this time: it falls, p2 steps in and wins: 1 heart.
    const needed = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: { p1: small, p2: big, p3: small, p4: small } });
    expect(needed.outcome).toBe('a');
    expect(needed.heartsLost).toBe(1);
    expect(needed.aResult.events.some((e) => e.type === 'tagIn' && e.side === 'player')).toBe(true);
    const draw = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: {} });
    expect(draw.outcome).toBe('draw');
    expect(draw.heartsLost).toBe(0);
    expect(draw.losingTeam).toBeNull();
  });

  it('the server\'s order is honoured (a flip), and an empty first board hands straight over', () => {
    const flipped = resolveVersusDuosRound({ matchSeed: 9, round: 1, first: { a: 'p2' }, sides: { p1: big, p2: small, p3: small, p4: small } });
    expect(flipped.first).toEqual({ a: 'p2', b: 'p3' });
    expect(flipped.heartsLost).toBe(1); // p2 fell first, p1 finished it
    // A seat of the other team can never be named as a team's first.
    expect(resolveVersusDuosRound({ matchSeed: 9, round: 1, first: { a: 'p3' }, sides: { p1: big } }).first.a).toBe('p1');
    const empty = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: { p2: big, p3: small } });
    expect(empty.first.a).toBe('p2');
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
    const r = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: { p1: small, p2: big, p3: small, p4: small } });
    expect(r.bResult).toEqual(mirrorForEnemySeat(r.aResult));
    expect(r.bResult.tagTeam?.members.player).toEqual(r.aResult.tagTeam?.members.enemy);
    expect(r.bResult.tagTeam?.tagInAt.enemy).toBe(r.aResult.tagTeam?.tagInAt.player);
  });

  it('each SEAT lands its own board\'s carry-backs; a board that never fought lands none', () => {
    const r = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: { p1: small, p2: big, p3: side(sandbag(2, 1, 2, 'b')), p4: small } });
    const p1 = duosMemberView(r.aResult, duosMemberOf('p1', r.first));
    const p2 = duosMemberView(r.aResult, duosMemberOf('p2', r.first));
    expect(p1.duosMember).toBe(0);
    expect(p2.duosMember).toBe(1);
    expect(p1.playerDeaths).toBe(1); // p1's one body fell
    expect(p2.playerDeaths).toBe(0);
    expect((p1.enemyDeaths ?? 0) + (p2.enemyDeaths ?? 0)).toBeGreaterThan(0);
    expect(p1.result).toBe(p2.result); // the outcome is the team's
    // Team B: p3's two bodies fell before p4 stepped in.
    const p3 = duosMemberView(r.bResult, duosMemberOf('p3', r.first));
    expect(p3.playerDeaths).toBe(2);
    const stomp = resolveVersusDuosRound({ matchSeed: 9, round: 1, sides: { p1: big, p2: small, p3: small, p4: small } });
    const idle = duosMemberView(stomp.aResult, duosMemberOf('p2', stomp.first));
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

  it('a pass costs 1 Gold, takes the card out of the hand or the board and records it as it left', () => {
    const run = duosRun();
    const a = reduce(run, { type: 'passCard', uid: 'h1' });
    expect(a.embers).toBe(2);
    expect(a.hand.map((c) => c.uid)).toEqual([]);
    expect(a.duos!.outbox).toHaveLength(1);
    expect(a.duos!.outbox[0]).toMatchObject({ seq: 0, wave: run.wave, card: { uid: 'h1', attack: run.hand[0]!.attack } });
    const b = reduce(a, { type: 'passCard', uid: 'b1' });
    expect(b.board).toHaveLength(0);
    expect(b.duos!.outbox.map((o) => o.seq)).toEqual([0, 1]);
    expect(b.embers).toBe(1);
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
    expect(arrived).toMatchObject({ cardId: card.cardId, attack: card.attack, health: card.health, golden: true, keywords: ['T'], passedWave: recv.wave });
    // Re-delivered: nothing changes.
    expect(reduce(got, { type: 'receivePass', from: 'p2', seq: 0, card })).toBe(got);
    // ...and it cannot be passed straight back this turn.
    expect(reduce({ ...got, embers: 5 }, { type: 'passCard', uid: arrived.uid }).hand).toHaveLength(1);
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
    // The sender: the board card goes back to its slot, the Gold and the Gold-spent tallies come back, once.
    const sender = duosRun();
    const sent = reduce(sender, { type: 'passCard', uid: 'b1' });
    expect([sent.embers, sent.board.length]).toEqual([sender.embers - 1, 0]);
    const back = reduce(sent, { type: 'passRefunded', seq: 0 });
    expect(back.board.map((c) => c.uid)).toEqual(['b1']);
    expect(back.embers).toBe(sender.embers);
    expect(back.goldSpentThisTurn ?? 0).toBe(sender.goldSpentThisTurn ?? 0);
    expect(back.goldSpent ?? 0).toBe(sender.goldSpent ?? 0);
    expect(back.duos!.outbox[0]!.refunded).toBe(true);
    expect(reduce(back, { type: 'passRefunded', seq: 0 })).toBe(back);
    // A hand card goes back to the hand.
    const h = reduce(reduce(sender, { type: 'passCard', uid: 'h1' }), { type: 'passRefunded', seq: 0 });
    expect(h.hand.map((c) => c.uid)).toEqual(['h1']);
  });

  it('a pass that arrives during the fight lands in the hand at once (when there is room)', () => {
    const recv = { ...duosRun(), phase: 'combat' as const };
    const got = reduce(recv, { type: 'receivePass', from: 'p1', seq: 0, card: duosRun().hand[0]! });
    expect(got.hand).toHaveLength(recv.hand.length + 1);
  });

  it('team ids are letters by seat pair, so N teams extend the same helpers', () => {
    expect(duosTeamSeats('a')).toEqual(['p1', 'p2']);
    expect(duosTeamSeats('b')).toEqual(['p3', 'p4']);
    expect(duosDefaultFirst(3, 4)).toEqual({ a: 'p1', b: 'p3', c: 'p5', d: 'p7' });
    expect(duosDefaultFirst(4, 4)).toEqual({ a: 'p2', b: 'p4', c: 'p6', d: 'p8' });
  });
});
