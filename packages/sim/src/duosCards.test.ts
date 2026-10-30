/**
 * DUOS-ONLY CARDS (owner design 2026-10-30, R-DUOS-CARDS-01): the foundation. Pool membership by tribe, the team effect
 * channel (sender's half now, teammate's half through the pass channel, resolved by the RECEIVING run), the pass
 * triggers, Brian's Pal's free pass, Handout's spell pass, the 50/50 most-common-type tie rule, and the five proof cards
 * (Hitchhiker, Brian's Pal, Handout, Share the Wealth, Richmond), each through the real reducer on two teammates' runs.
 */
import { describe, expect, it } from 'vitest';
import { makeRng, type TeamEffect } from '@game/core';
import { CARD_INDEX, DUOS_CARDS, SETS, duosPoolFor, poolFor, type SetId } from '@game/content';
import { reduce } from './reducer';
import { poolOf } from './cardPool';
import { createRun, type BoardCard, type RunState } from './state';
import { createVersusRun } from './versus/run';
import type { VersusRoomOptions } from './versus/options';
import { duosPassCost, duosWireOf, isDuosTeamWire } from './duosPass';
import { mostCommonTribe } from './recruit';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };

function card(id: string, uid: string, golden = false): BoardCard {
  const d = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden };
}

/** A Duos seat's run in its first Shop with a chosen hand and board. */
function seat(over: Partial<RunState> = {}, seed = 11): RunState {
  const run = createVersusRun(seed, 'warden', 'set2', DUOS);
  return { ...run, hand: [], board: [], embers: 10, ...over };
}

/** Ship every entry `from` queued since `since` to `to` the way the transport does (the wire form, `receivePass`). */
function ship(from: RunState, fromSeat: string, to: RunState, since = 0): RunState {
  let out = to;
  for (const e of from.duos!.outbox.slice(since)) out = reduce(out, { type: 'receivePass', from: fromSeat, seq: e.seq, card: duosWireOf(e) });
  return out;
}

const filler = (n: number, prefix = 'f'): BoardCard[] => {
  const id = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.tier === 1 && !c.duos && c.effects.length === 0)!.id;
  return Array.from({ length: n }, (_, i) => card(id, `${prefix}${i}`));
};

describe('pool membership: Duos runs only, joined by tribe (owner 2026-10-30)', () => {
  it('every Duos card is marked `duos`, resolves globally, and sits in NO set manifest', () => {
    expect(DUOS_CARDS.length).toBeGreaterThanOrEqual(5);
    for (const c of DUOS_CARDS) {
      expect(c.duos).toBe(true);
      expect(CARD_INDEX[c.id]).toBe(c);
      for (const id of Object.keys(SETS) as SetId[]) expect(poolFor(id).all.some((x) => x.id === c.id)).toBe(false);
    }
  });

  it('a Duos pool is the set pool with the fitting Duos cards APPENDED (no set position moves)', () => {
    for (const id of Object.keys(SETS) as SetId[]) {
      const base = poolFor(id).all;
      const duos = duosPoolFor(id).all;
      expect(duos.slice(0, base.length)).toEqual(base);
      const tribes = new Set<string>(SETS[id].tribes);
      const want = DUOS_CARDS.filter((c) => c.tribe === 'neutral' || tribes.has(c.tribe)).map((c) => c.id);
      expect(duos.slice(base.length).map((c) => c.id)).toEqual(want);
    }
    // Richmond is a Dragon: Set 2 and Set 3 field Dragons, Set 4 does not. Neutrals and spells join every set.
    const has = (id: SetId, card: string): boolean => duosPoolFor(id).all.some((c) => c.id === card);
    expect([has('set2', 'duo_richmond'), has('set3', 'duo_richmond'), has('set4', 'duo_richmond')]).toEqual([true, true, false]);
    for (const id of ['set2', 'set3', 'set4'] as const) expect(has(id, 'duo_hitchhiker') && has(id, 'duo_handout')).toBe(true);
  });

  it('poolOf: a Duos run draws the Duos pool; every other run (Versus 1v1 / Group, lobby) is untouched', () => {
    const duos = createVersusRun(11, 'warden', 'set2', DUOS);
    expect(poolOf(duos).all.some((c) => c.id === 'duo_hitchhiker')).toBe(true);
    expect(duos.pool['duo_hitchhiker']).toBeGreaterThan(0); // stocked at creation, so the opening Shop can offer it
    for (const r of [createVersusRun(11, 'warden', 'set2'), createVersusRun(11, 'warden', 'set2', { v: 1, mode: 'group', modifiers: [] }), createRun(11, 'warden', 'lobby', undefined, 'set2')]) {
      expect(r.duos).toBeUndefined();
      expect(poolOf(r).all.some((c) => c.duos)).toBe(false);
      expect(Object.keys(r.pool).some((id) => CARD_INDEX[id]?.duos)).toBe(false);
    }
    // Ranked Duos stamps the same pool.
    expect(poolOf(createVersusRun(11, 'warden', 'set2', { v: 1, mode: 'ranked_duos', modifiers: [] })).all.some((c) => c.duos)).toBe(true);
  });

  it('a Duos run is deterministic: the same seed builds the same run', () => {
    expect(createVersusRun(77, 'warden', 'set2', DUOS)).toEqual(createVersusRun(77, 'warden', 'set2', DUOS));
  });
});

describe('Richmond: "Shout: Give your team +1 max Gold."', () => {
  it('my max Gold rises now, my teammate\'s when the team effect lands on their run', () => {
    let ann = seat({ hand: [card('duo_richmond', 'r1')] });
    let bob = seat({}, 12);
    const annMax = ann.maxGoldBonus ?? 0, bobMax = bob.maxGoldBonus ?? 0;
    ann = reduce(ann, { type: 'play', uid: 'r1' });
    expect(ann.maxGoldBonus ?? 0).toBe(annMax + 1);
    const out = ann.duos!.outbox;
    expect(out).toHaveLength(1);
    expect(out[0]!.team).toEqual({ kind: 'maxGold', amount: 1 });
    expect(isDuosTeamWire(duosWireOf(out[0]!))).toBe(true);
    bob = ship(ann, 'p1', bob);
    expect(bob.maxGoldBonus ?? 0).toBe(bobMax + 1);
    expect(bob.duos!.received).toEqual(['p1:0']);
    // Delivered again (a retry, a restore): lands once.
    expect(ship(ann, 'p1', bob)).toBe(bob);
  });

  it('Gilded gives the team +2', () => {
    let ann = seat({ hand: [card('duo_richmond', 'r1', true)] });
    const before = ann.maxGoldBonus ?? 0;
    ann = reduce(ann, { type: 'play', uid: 'r1' });
    expect(ann.maxGoldBonus ?? 0).toBe(before + 2);
    expect(ann.duos!.outbox[0]!.team).toEqual({ kind: 'maxGold', amount: 2 });
  });
});

describe('Share the Wealth: "Gain +1 max Gold. Give your teammate a Gold Pouch."', () => {
  it('+1 max Gold for me; a Gold Pouch lands in my teammate\'s hand', () => {
    let ann = seat({ hand: [card('duo_sharewealth', 's1')] });
    let bob = seat({}, 12);
    const max = ann.maxGoldBonus ?? 0;
    ann = reduce(ann, { type: 'play', uid: 's1' });
    expect(ann.maxGoldBonus ?? 0).toBe(max + 1);
    expect(ann.duos!.outbox.map((e) => e.team)).toEqual([{ kind: 'gift', cardId: 'emberpouch', count: 1 }]);
    bob = ship(ann, 'p1', bob);
    expect(bob.hand.map((c) => c.cardId)).toEqual(['emberpouch']);
  });

  it('a full hand refuses the gift; the sender loses nothing more and gets nothing back', () => {
    let ann = seat({ hand: [card('duo_sharewealth', 's1')] });
    let bob = seat({ hand: filler(10, 'h') }, 12);
    ann = reduce(ann, { type: 'play', uid: 's1' });
    bob = ship(ann, 'p1', bob);
    expect(bob.hand).toHaveLength(10);
    expect(bob.duos!.refused).toEqual(['p1:0']);
    const embers = ann.embers, hand = ann.hand.length;
    ann = reduce(ann, { type: 'passRefunded', seq: 0 });
    expect([ann.embers, ann.hand.length, ann.duos!.outbox[0]!.refunded]).toEqual([embers, hand, true]);
  });
});

describe('Hitchhiker: "When your team passes a card, gain +1/+2."', () => {
  it('grows on the sender\'s board at the pass AND on the receiver\'s board when it lands', () => {
    const passed = filler(1, 'p')[0]!;
    let ann = seat({ hand: [passed], board: [card('duo_hitchhiker', 'hh1')] });
    let bob = seat({ board: [card('duo_hitchhiker', 'hh2')] }, 12);
    ann = reduce(ann, { type: 'passCard', uid: passed.uid });
    expect(ann.board[0]).toMatchObject({ attack: 3, health: 5 });
    bob = ship(ann, 'p1', bob);
    expect(bob.board[0]).toMatchObject({ attack: 3, health: 5 });
  });

  it('a team effect is not a pass (no growth); Gilded gains +2/+4', () => {
    let ann = seat({ hand: [card('duo_richmond', 'r1')] });
    let bob = seat({ board: [card('duo_hitchhiker', 'hh2', true)] }, 12);
    ann = reduce(ann, { type: 'play', uid: 'r1' });
    bob = ship(ann, 'p1', bob);
    expect(bob.board[0]).toMatchObject({ attack: 2, health: 3 });
    const c = filler(1, 'p')[0]!;
    let cat = seat({ hand: [c] }, 13);
    cat = reduce(cat, { type: 'passCard', uid: c.uid });
    bob = ship(cat, 'p3', bob);
    expect(bob.board[0]).toMatchObject({ attack: 4, health: 7 });
  });
});

describe('Brian\'s Pal: "Your first pass each turn is free."', () => {
  it('the first pass costs 0 (no coin), the second its 1 Gold; a refund of the free one gives the free pass back', () => {
    const [a, b] = filler(2, 'p');
    let ann = seat({ hand: [a!, b!], board: [card('duo_brianspal', 'bp')], embers: 3 });
    expect(duosPassCost(ann)).toBe(0);
    ann = reduce(ann, { type: 'passCard', uid: a!.uid });
    expect([ann.embers, ann.duos!.outbox[0]!.paid, duosPassCost(ann)]).toEqual([3, 0, 1]);
    ann = reduce(ann, { type: 'passCard', uid: b!.uid });
    expect([ann.embers, ann.duos!.outbox[1]!.paid]).toEqual([2, 1]);
    ann = reduce(ann, { type: 'passRefunded', seq: 0 });
    expect([ann.embers, duosPassCost(ann)]).toEqual([2, 0]);
    ann = reduce(ann, { type: 'passRefunded', seq: 1 });
    expect(ann.embers).toBe(3);
  });

  it('a pass with no Gold is still free while the free pass is unspent; Gilded frees two', () => {
    const [a, b, c] = filler(3, 'p');
    let ann = seat({ hand: [a!, b!, c!], board: [card('duo_brianspal', 'bp', true)], embers: 0 });
    ann = reduce(ann, { type: 'passCard', uid: a!.uid });
    ann = reduce(ann, { type: 'passCard', uid: b!.uid });
    expect(ann.duos!.outbox).toHaveLength(2);
    expect(reduce(ann, { type: 'passCard', uid: c!.uid })).toBe(ann); // the third needs Gold
  });
});

describe('Handout: "Pass a minion." (a Shop minion or one of yours)', () => {
  it('a Shop minion leaves the Shop for the teammate\'s hand; the spell is the only price', () => {
    let ann = seat({ hand: [card('duo_handout', 'ho')], board: [card('duo_hitchhiker', 'hh')] });
    const offer = ann.shop.find((o) => !CARD_INDEX[o.cardId]?.spell)!;
    const embers = ann.embers;
    ann = reduce(ann, { type: 'play', uid: 'ho', targetUid: offer.uid });
    expect(ann.shop.some((o) => o.uid === offer.uid)).toBe(false);
    expect(ann.embers).toBe(embers); // a hand spell is already paid for; the pass itself is free
    const e = ann.duos!.outbox[0]!;
    expect(e).toMatchObject({ from: 'shop', via: 'spell', paid: 0, card: { cardId: offer.cardId } });
    expect(duosWireOf(e).passFrom).toBe('spell');
    expect(ann.board[0]).toMatchObject({ attack: 3, health: 5 }); // Hitchhiker heard the pass
    let bob = seat({}, 12);
    bob = ship(ann, 'p1', bob);
    expect(bob.hand.map((c) => c.cardId)).toEqual([offer.cardId]);
    // Refused by the teammate's hand: it goes back to the Shop, never into my hand.
    const back = reduce(ann, { type: 'passRefunded', seq: 0 });
    expect(back.shop.some((o) => o.uid === offer.uid)).toBe(true);
    expect(back.hand.some((c) => c.uid === offer.uid)).toBe(false);
  });

  it('one of my board minions passes; a Golden one cannot be targeted', () => {
    const [m] = filler(1, 'm');
    let ann = seat({ hand: [card('duo_handout', 'ho')], board: [m!, { ...filler(1, 'g')[0]!, golden: true }] });
    ann = reduce(ann, { type: 'play', uid: 'ho', targetUid: m!.uid });
    expect(ann.board.map((c) => c.uid)).toEqual(['g0']);
    expect(ann.duos!.outbox[0]).toMatchObject({ from: 'board', via: 'spell' });
    const ann2 = seat({ hand: [card('duo_handout', 'ho')], board: [{ ...filler(1, 'g')[0]!, golden: true }] });
    const after = reduce(ann2, { type: 'play', uid: 'ho', targetUid: 'g0' });
    expect(after.duos?.outbox ?? []).toHaveLength(0);
    expect(after.board).toHaveLength(1);
  });
});

describe("the teammate's most common type: ties are a seeded 50/50 (owner 2026-10-30)", () => {
  it('the most minions wins; a tie picks uniformly among the tied with the run RNG, the same every replay', () => {
    const base = seat();
    const t = base.tribes.filter((x) => x !== 'neutral');
    const minionOf = (tribe: string, uid: string): BoardCard => {
      const d = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.universalTribe && c.tribe === tribe && !c.tribe2)!;
      return card(d.id, uid);
    };
    const clear: RunState = { ...base, board: [minionOf(t[0]!, 'a'), minionOf(t[0]!, 'b'), minionOf(t[1]!, 'c')] };
    expect(mostCommonTribe(clear, makeRng(1))).toBe(t[0]);
    const tied: RunState = { ...base, board: [minionOf(t[0]!, 'a'), minionOf(t[1]!, 'c')] };
    const seen = new Set<string>();
    for (let seed = 1; seed < 60; seed++) {
      const pick = mostCommonTribe(tied, makeRng(seed))!;
      expect([t[0], t[1]]).toContain(pick);
      expect(mostCommonTribe(tied, makeRng(seed))).toBe(pick);
      seen.add(pick);
    }
    expect(seen.size).toBe(2);
  });

  it('a "minion of their most common type" gift lands one of that type from the receiver\'s own pool', () => {
    let bob = seat({}, 12);
    const tribe = bob.tribes.find((x) => x !== 'neutral')!;
    const d = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.universalTribe && c.tribe === tribe && !c.tribe2 && c.tier === 1)!;
    bob = { ...bob, board: [card(d.id, 'x1'), card(d.id, 'x2')] };
    const gift: TeamEffect = { kind: 'gift', mateTribe: true, count: 1 };
    const wire = { uid: 'team0', cardId: '__team', tribe: 'neutral' as const, attack: 0, health: 0, keywords: [], golden: false, passFrom: 'team' as const, team: gift };
    const after = reduce(bob, { type: 'receivePass', from: 'p1', seq: 0, card: wire });
    expect(after.hand).toHaveLength(1);
    const got = CARD_INDEX[after.hand[0]!.cardId]!;
    expect(got.tribe === tribe || got.tribe2 === tribe).toBe(true);
    expect(got.tier).toBeLessThanOrEqual(bob.tier);
  });
});

describe('the teammate hears a sale (Hippie Hulk\'s trigger)', () => {
  it('every sale in a Duos run queues a `sold` team effect with the stats it sold at; none outside Duos', () => {
    const m = { ...filler(1, 's')[0]!, attack: 6, health: 9 };
    const ann = reduce(seat({ board: [m] }), { type: 'sell', uid: m.uid });
    expect(ann.duos!.outbox.map((e) => e.team)).toEqual([{ kind: 'sold', cardId: m.cardId, attack: 6, health: 9 }]);
    const bob = ship(ann, 'p1', seat({}, 12));
    expect(bob.duos!.received).toEqual(['p1:0']);
  });
});

describe('the rune-ready primitives (Duos runes batch): Gold, a Triple Reward, a random minion, the effect pass', () => {
  const wire = (team: TeamEffect, seq = 0) => ({ uid: `team${seq}`, cardId: '__team', tribe: 'neutral' as const, attack: 0, health: 0, keywords: [], golden: false, passFrom: 'team' as const, team });
  it('Gold lands on the teammate now; a Triple Reward runs their own Gild reward; a random minion is legal for them', () => {
    const bob = seat({ embers: 2 }, 12);
    expect(reduce(bob, { type: 'receivePass', from: 'p1', seq: 0, card: wire({ kind: 'gold', amount: 3 }) }).embers).toBe(5);
    const tr = reduce(bob, { type: 'receivePass', from: 'p1', seq: 1, card: wire({ kind: 'tripleReward', count: 1 }, 1) });
    expect(tr).not.toBe(bob);
    expect(tr.duos!.received).toEqual(['p1:1']);
    expect(tr.hand.length + (tr.discover ? 1 : 0)).toBeGreaterThan(0);
    const rm = reduce(bob, { type: 'receivePass', from: 'p1', seq: 2, card: wire({ kind: 'gift', randomMinion: true, count: 2 }, 2) });
    expect(rm.hand).toHaveLength(2);
    for (const c of rm.hand) expect(CARD_INDEX[c.cardId]!.tier).toBeLessThanOrEqual(bob.tier);
  });

  it('the effect pass is free, counts as a pass, and never takes a Golden card', async () => {
    const { effectPassCard } = await import('./recruit');
    const s = seat({ board: [card('duo_hitchhiker', 'hh')], embers: 0 });
    const m = filler(1, 'q')[0]!;
    expect(effectPassCard(s, m, 'board', 0)).toBe(true);
    expect(s.duos!.outbox[0]).toMatchObject({ paid: 0, via: 'spell', card: { uid: m.uid } });
    expect(s.board[0]).toMatchObject({ attack: 3, health: 5 });
    expect(effectPassCard(s, { ...m, uid: 'gg', golden: true }, 'board', 0)).toBe(false);
    expect(s.duos!.outbox).toHaveLength(1);
  });
});
