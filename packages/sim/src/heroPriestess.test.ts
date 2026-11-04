/**
 * PRIESTESS (owner 2026-11-04, R-DUOS-PRIESTESS-01): "Priestess - 14 armor, Passaria -> 2g pass a non-golden minion to
 * your teammate." A Duos-only hero whose power is the EFFECT pass (Handout's body) for 2 Gold, once per turn. Each case
 * runs through the real reducer on two teammates' runs.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { reduce } from './reducer';
import { handCap, serialize, type BoardCard, type RunState } from './state';
import { getHero, playableHeroes, powerDiscoverPool, practiceHeroes } from './heroes';
import { createVersusRun, versusHeroRerollCandidates } from './versus/run';
import { versusDisjointHeroOffers, versusHeroShuffle } from './versus/heroOffers';
import { versusModeIsDuos, type VersusRoomOptions } from './versus/options';
import { duosWaitingCount, duosWireOf } from './duosPass';
import { passariaHasTarget, passariaTarget } from './recruit';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };

function card(id: string, uid: string, golden = false): BoardCard {
  const d = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden };
}
const plainId = (): string => Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.tier === 1 && !c.duos && c.effects.length === 0)!.id;
const plain = (uid: string, golden = false): BoardCard => card(plainId(), uid, golden);

function priestess(over: Partial<RunState> = {}, seed = 11): RunState {
  return { ...createVersusRun(seed, 'priestess', 'set2', DUOS), hand: [], board: [], embers: 10, ...over };
}
function mate(over: Partial<RunState> = {}, seed = 12): RunState {
  return { ...createVersusRun(seed, 'warden', 'set2', DUOS), hand: [], board: [], embers: 10, ...over };
}
function ship(from: RunState, to: RunState, since = 0): RunState {
  let out = to;
  for (const e of from.duos!.outbox.slice(since)) out = reduce(out, { type: 'receivePass', from: 'p1', seq: e.seq, card: duosWireOf(e) });
  return out;
}
/** A full hand that cannot triple with what is passed. */
const fullHand = (): BoardCard[] => Object.values(CARD_INDEX)
  .filter((c) => c && !c.spell && !c.token && !c.duos && c.id !== plainId() && c.tier <= 2).slice(0, 10).map((c, i) => card(c.id, `h${i}`));

describe('the hero: Duos only, 14 Armor, a 2 Gold targeted power', () => {
  it('prints what the owner asked for', () => {
    const h = getHero('priestess');
    expect(h.id).toBe('priestess');
    expect(h.armor).toBe(14);
    expect(h.power).toMatchObject({ name: 'Passaria', kind: 'passaria', cost: 2 });
    expect(h.power.passive).toBeUndefined();
    expect(h.power.untargeted).toBeUndefined();
    expect(h.power.text).not.toMatch(/—|--|Oath|climb/);
  });

  it('is never offered outside a team mode: not solo, Practice, Mimic, Void or Power Shifter', () => {
    expect(playableHeroes().some((h) => h.id === 'priestess')).toBe(false);
    expect(practiceHeroes().some((h) => h.id === 'priestess')).toBe(false);
    expect(powerDiscoverPool('mimic')).not.toContain('priestess');
    expect(powerDiscoverPool('void')).not.toContain('priestess');
    expect(versusHeroShuffle(5, 6, 'set2')).not.toContain('priestess');
    expect(versusHeroRerollCandidates(6, 'set2', [])).not.toContain('priestess');
  });

  it('joins the deal, and the re-roll list, of a team mode only', () => {
    expect(['duos', 'ranked_duos'].every(versusModeIsDuos)).toBe(true);
    expect(['duel', 'group', undefined].some(versusModeIsDuos)).toBe(false);
    expect(playableHeroes(undefined, { duos: true }).map((h) => h.id)).toEqual([...playableHeroes().map((h) => h.id), 'priestess']);
    expect(versusHeroShuffle(5, 6, 'set2', { duos: true })).toContain('priestess');
    expect(versusHeroRerollCandidates(6, 'set2', [], { duos: true })).toContain('priestess');
    const seats = (n: number): { heroSeed: number; runSeed: number }[] => Array.from({ length: 4 }, (_, i) => ({ heroSeed: n + i, runSeed: 100 + i }));
    const offered = (duos: boolean): boolean => Array.from({ length: 60 }, (_, n) => versusDisjointHeroOffers(seats(n * 7), 'set2', undefined, { duos }).flat()).flat().includes('priestess');
    expect(offered(true)).toBe(true);
    expect(offered(false)).toBe(false);
  });

  it('a solo deal is the deal of before: the Duos flag off changes nothing', () => {
    expect(versusHeroShuffle(5, 6, 'set2', { duos: false })).toEqual(versusHeroShuffle(5, 6, 'set2'));
  });

  it('her 14 Armor reaches the team pool', () => {
    const lone = createVersusRun(11, 'priestess', 'set2', { v: 1, mode: 'duel', modifiers: [] });
    expect(lone.armor).toBe(14);
    const a = createVersusRun(11, 'priestess', 'set2', DUOS, 'warden');
    const b = createVersusRun(11, 'indy', 'set2', DUOS, 'warden');
    expect(a.armor - b.armor).toBe(14 - getHero('indy').armor);
  });
});

describe('Passaria: the normal pass', () => {
  it('a board minion leaves for 2 Gold, as an effect pass, and lands in the teammate\'s hand as it left', () => {
    const m = { ...plain('m0'), attack: 9, health: 8 };
    const ann = reduce(priestess({ board: [m, plain('m1')] }), { type: 'heroPower', uid: 'm0' });
    expect(ann.board.map((c) => c.uid)).toEqual(['m1']);
    expect(ann.embers).toBe(8);
    expect(ann.heroReady).toBe(false);
    expect(ann.duos!.outbox).toHaveLength(1);
    expect(ann.duos!.outbox[0]).toMatchObject({ via: 'spell', from: 'board', index: 0, paid: 2, power: 0, card: { uid: 'm0' } });
    expect(duosWireOf(ann.duos!.outbox[0]!).passFrom).toBe('spell');
    const bob = ship(ann, mate());
    expect(bob.hand.map((c) => [c.cardId, c.attack, c.health])).toEqual([[plainId(), 9, 8]]);
  });

  it('a Shop minion leaves the row for 2 Gold, never bought', () => {
    const base = priestess();
    const offer = base.shop.find((o) => !CARD_INDEX[o.cardId]?.spell && !o.starform)!;
    const ann = reduce(base, { type: 'heroPower', uid: offer.uid });
    expect(ann.shop.some((o) => o.uid === offer.uid)).toBe(false);
    expect(ann.embers).toBe(8);
    expect(ann.duos!.outbox.at(-1)).toMatchObject({ via: 'spell', from: 'shop', paid: 2, card: { cardId: offer.cardId } });
    expect(ship(ann, mate()).hand.map((c) => c.cardId)).toEqual([offer.cardId]);
  });

  it('once per turn: a second press the same turn is refused', () => {
    const ann = reduce(priestess({ board: [plain('m0'), plain('m1')] }), { type: 'heroPower', uid: 'm0' });
    expect(reduce(ann, { type: 'heroPower', uid: 'm1' })).toBe(ann);
  });

  it('counts as a pass for the pass watchers', () => {
    const hh = card('duo_hitchhiker', 'hh');
    const ann = reduce(priestess({ board: [hh, plain('m0')] }), { type: 'heroPower', uid: 'm0' });
    const after = ann.board.find((c) => c.uid === 'hh')!;
    expect(after.attack + after.health).toBeGreaterThan(hh.attack + hh.health);
  });

  it('replays exactly: the same run and press give the same state', () => {
    const go = (): string => serialize(reduce(priestess({ board: [plain('m0')] }), { type: 'heroPower', uid: 'm0' }));
    expect(go()).toBe(go());
  });
});

describe('Passaria: refusals spend nothing', () => {
  it('a Gilded board minion is no target', () => {
    const s = priestess({ board: [plain('g0', true)] });
    expect(passariaTarget(s, 'g0')).toBeNull();
    expect(reduce(s, { type: 'heroPower', uid: 'g0' })).toBe(s);
  });

  it('a Gilded offer, a held Gilded body and a spell offer are no targets', () => {
    const base = priestess();
    const i = base.shop.findIndex((o) => !CARD_INDEX[o.cardId]?.spell);
    const gilded = { ...base, shop: base.shop.map((o, n) => (n === i ? { ...o, golden: true } : o)) };
    expect(reduce(gilded, { type: 'heroPower', uid: gilded.shop[i]!.uid })).toBe(gilded);
    const held = { ...base, shop: base.shop.map((o, n) => (n === i ? { ...o, held: plain('x', true) } : o)) };
    expect(passariaTarget(held, held.shop[i]!.uid)).toBeNull();
    const spellId = Object.values(CARD_INDEX).find((c) => c?.spell && !c.duos)!.id;
    const spelled = { ...base, shop: [{ uid: 'sp', cardId: spellId }, ...base.shop] };
    expect(reduce(spelled, { type: 'heroPower', uid: 'sp' })).toBe(spelled);
  });

  it('no target at all: a press with nothing named changes nothing', () => {
    const s = priestess({ board: [plain('m0')] });
    expect(reduce(s, { type: 'heroPower' })).toBe(s);
    expect(reduce(s, { type: 'heroPower', uid: 'nobody' })).toBe(s);
  });

  it('not enough Gold', () => {
    const s = priestess({ board: [plain('m0')], embers: 1 });
    expect(reduce(s, { type: 'heroPower', uid: 'm0' })).toBe(s);
  });

  it('no teammate: a run with no Duos state refuses, and the button has nothing to light', () => {
    const solo: RunState = { ...createVersusRun(11, 'priestess', 'set2'), board: [plain('m0')], embers: 10 };
    expect(solo.duos).toBeUndefined();
    expect(passariaHasTarget(solo)).toBe(false);
    expect(reduce(solo, { type: 'heroPower', uid: 'm0' })).toBe(solo);
  });

  it('the button goes dark only when nothing can be passed', () => {
    const s = priestess({ board: [plain('m0')], shop: [] });
    expect(passariaHasTarget(s)).toBe(true);
    expect(passariaHasTarget({ ...s, board: [plain('g0', true)] })).toBe(false);
  });
});

describe('Passaria: the teammate cannot take it', () => {
  it('a full hand holds it, in order, until there is room (an effect pass is never refused for a full hand)', () => {
    const ann = reduce(priestess({ board: [plain('m0')] }), { type: 'heroPower', uid: 'm0' });
    let bob = mate({ hand: fullHand() });
    expect(bob.hand.length).toBe(handCap(bob));
    bob = ship(ann, bob);
    expect(duosWaitingCount(bob)).toBe(1);
    expect(bob.duos!.refused).toEqual([]);
    expect(ann.embers).toBe(8); // nothing came back: it arrived, it is waiting
    bob = reduce(bob, { type: 'passCard', uid: 'h0' }); // room: it lands the moment the action makes some
    expect(duosWaitingCount(bob)).toBe(0);
    expect(bob.hand.at(-1)).toMatchObject({ cardId: plainId(), passKey: 'p1:0' });
  });

  it('a refusal from the room gives back the minion, the 2 Gold and this turn\'s charge, exactly once', () => {
    const ann = reduce(priestess({ board: [plain('m0'), plain('m1')] }), { type: 'heroPower', uid: 'm0' });
    const back = reduce(ann, { type: 'passRefunded', seq: 0 });
    expect(back.board.map((c) => c.uid)).toEqual(['m0', 'm1']);
    expect(back.embers).toBe(10);
    expect(back.heroReady).toBe(true);
    expect(back.goldSpentThisTurn ?? 0).toBe((ann.goldSpentThisTurn ?? 0) - 2);
    expect(reduce(back, { type: 'passRefunded', seq: 0 })).toBe(back);
  });

  it('a Shop minion comes back to the Shop', () => {
    const base = priestess();
    const offer = base.shop.find((o) => !CARD_INDEX[o.cardId]?.spell && !o.starform)!;
    const back = reduce(reduce(base, { type: 'heroPower', uid: offer.uid }), { type: 'passRefunded', seq: 0 });
    expect(back.shop.some((o) => o.uid === offer.uid)).toBe(true);
    expect(back.hand).toEqual([]);
    expect(back.embers).toBe(10);
  });

  it('a refusal that lands on a later turn keeps that turn\'s own charge', () => {
    const ann = reduce(priestess({ board: [plain('m0')] }), { type: 'heroPower', uid: 'm0' });
    const later = { ...ann, wave: ann.wave + 1, heroReady: false };
    expect(reduce(later, { type: 'passRefunded', seq: 0 }).heroReady).toBe(false);
  });
});

describe('the Duos retier (owner 2026-11-04)', () => {
  it('Matchmaker is Tier 4, CueBee Tier 5', () => {
    expect(CARD_INDEX['duo_matchmaker']!.tier).toBe(4);
    expect(CARD_INDEX['duo_cuebee']!.tier).toBe(5);
  });
});
