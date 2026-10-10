import { describe, expect, it } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, runeSynergies } from '@game/content';
import { combatSide, foldTribes, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { createRun, deserialize, serialize, type BoardCard, type RunState } from './state';
import { playerCombatSideState, reduce, runeforgePool } from './reducer';
import { defIsTribe, isTribe, playedThisTurnFor } from './recruit';
import { snapshotBoard } from './snapshot';
import { sideFromSnapshot } from './boardSide';

/**
 * RUNE OF DRAKKO (owner 2026-10-03). Ask: "add this rune to set 2 and 3: All Drakko - 4 cost: Get a Drakko with
 * Dragon/Spirit type." Follow-ups: pool "Epic"; name "Rune of Drakko"; gate "if either tribe is in a set it should be
 * offered. categorize it as a dragon and/or spirit rune". Rework: "it SHOULD triple with regular drakkos ... Drakko is
 * a Dragon/Spirit this game. this makes all drakkos in shop and everywhere a dragon/spirit. it isnt a new minion, it's
 * just a drakko that has new types."
 *
 * The rune hands over a regular `drummer` and installs a RUN-LEVEL override (`RunState.cardTribes.drummer`) that the
 * shared tribe predicates read: every Drakko of the run, wherever it is, counts as a Dragon and a Spirit.
 */
const D = 'drummer';

const card = (uid: string, cardId: string, golden = false): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden };
};

const forgeRun = (setId: 'set1' | 'set2' | 'set3', tribes: string[]): RunState =>
  ({ ...createRun(7, undefined, 'ascent', undefined, setId), tribes, runeforgeEpic: true } as RunState);

/** Buy Rune of Drakko on a fresh run (Set 3 by default), with `extra` merged in first. */
const withRune = (extra: Partial<RunState> = {}, setId: 'set2' | 'set3' = 'set3'): RunState => {
  let s: RunState = { ...createRun(5, undefined, 'ascent', undefined, setId), hand: [], embers: 50, ...extra } as RunState;
  s = { ...s, runeforgeOffer: ['rune_drakko'], runeforgeEpic: true };
  return reduce(s, { type: 'buyRune', index: 0 });
};

describe('Rune of Drakko: the def', () => {
  it('is an Epic 4-cost Set 2 + Set 3 rune, gated on Dragon OR Spirit, that grants a REGULAR Drakko and re-types it', () => {
    const r = RUNE_INDEX['rune_drakko']!;
    expect(r.name).toBe('Rune of Drakko');
    expect([r.cost, r.epic]).toEqual([4, true]);
    expect(EPIC_RUNES.some((x) => x.id === 'rune_drakko')).toBe(true);
    expect(RUNES.some((x) => x.id === 'rune_drakko'), 'Epic pool only').toBe(false);
    expect(r.sets).toEqual(['set2', 'set3']);
    expect(r.tribes).toEqual(['dragon', 'spirit']);
    expect(r.text).toBe('Get a **Drakko**. **Drakko** is a **Dragon** and a **Spirit** this game.');
    expect(r.reward).toEqual({ kind: 'multi', rewards: [
      { kind: 'cardTribes', cardId: D, tribes: ['dragon', 'spirit'] },
      { kind: 'grant', cards: [D] },
    ] });
    expect(CARD_INDEX['n2_drakko_dragonspirit'], 'no separate token: it is just a Drakko').toBeUndefined();
  });

  it('is categorised as BOTH a Dragon and a Spirit rune for the forge synergy pick', () => {
    expect([...runeSynergies(RUNE_INDEX['rune_drakko']!)].sort()).toEqual(['dragon', 'spirit']);
  });

  it('the Epic forge offers it in Set 2 / Set 3 when EITHER tribe rolled; never in Set 1, without both, or at the Basic forge', () => {
    expect(runeforgePool(forgeRun('set2', ['kobold', 'dragon', 'beast', 'demon', 'dwarf']))).toContain('rune_drakko');
    expect(runeforgePool(forgeRun('set3', ['kobold', 'dwarf', 'undead', 'spirit', 'celestial']))).toContain('rune_drakko');
    expect(runeforgePool(forgeRun('set3', ['kobold', 'dwarf', 'undead', 'celestial']))).not.toContain('rune_drakko');
    expect(runeforgePool(forgeRun('set2', ['kobold', 'beast', 'demon', 'dwarf']))).not.toContain('rune_drakko');
    expect(runeforgePool(forgeRun('set1', ['beast', 'dragon', 'mech', 'undead', 'demon']))).not.toContain('rune_drakko');
    const basic = { ...forgeRun('set2', ['kobold', 'dragon', 'beast', 'demon', 'dwarf']), runeforgeEpic: undefined } as RunState;
    expect(runeforgePool(basic)).not.toContain('rune_drakko');
  });
});

describe('every Drakko of the run is a Dragon and a Spirit', () => {
  it('the granted Drakko, a Drakko already held, and later / Shop Drakkos all count; other cards do not', () => {
    const s = withRune({ board: [card('held', D)], hand: [] });
    expect(s.cardTribes).toEqual({ [D]: ['dragon', 'spirit'] });
    const granted = s.hand.find((c) => c.cardId === D)!;
    for (const c of [granted, s.board.find((x) => x.uid === 'held')!]) {
      expect(isTribe(c, 'dragon') && isTribe(c, 'spirit'), `${c.uid} is Dragon / Spirit`).toBe(true);
    }
    // Def level (a Shop offer, a pool, a later buy): the run override answers for the card id.
    expect(defIsTribe(CARD_INDEX[D], 'dragon', s) && defIsTribe(CARD_INDEX[D], 'spirit', s)).toBe(true);
    expect(defIsTribe(CARD_INDEX[D], 'dragon'), 'without the run, Drakko is still neutral').toBe(false);
    expect(defIsTribe(CARD_INDEX['sylus'], 'spirit', s), 'only Drakko is re-typed').toBe(false);
    // A Drakko BOUGHT from the Shop after the rune arrives typed (stamped at the action boundary).
    const shopped = reduce({ ...s, hand: [], embers: 10, shop: [{ uid: 'o1', cardId: D }] }, { type: 'buy', uid: 'o1' });
    const bought = shopped.hand.find((c) => c.cardId === D);
    expect(bought, 'the Shop Drakko was bought').toBeTruthy();
    expect(isTribe(bought!, 'dragon') && isTribe(bought!, 'spirit')).toBe(true);
  });

  it('is idempotent: a second Rune of Drakko adds another Drakko but changes no types', () => {
    let s = withRune();
    s = { ...s, embers: 50, runeforgeOffer: ['rune_drakko'], runeforgeEpic: true };
    s = reduce(s, { type: 'buyRune', index: 0 });
    expect(s.cardTribes).toEqual({ [D]: ['dragon', 'spirit'] });
    for (const c of s.hand.filter((x) => x.cardId === D)) expect(c.addedTribes).toEqual(['dragon', 'spirit']);
  });

  it('triples with regular Drakkos, and the Gilded Drakko keeps both types', () => {
    const s = withRune({ hand: [card('a', D), card('b', D)] });
    const gold = [...s.hand, ...s.board].filter((c) => c.cardId === D && c.golden);
    expect(gold, 'the rune Drakko + two regular Drakkos combined into one Gilded Drakko').toHaveLength(1);
    expect([...s.hand, ...s.board].filter((c) => c.cardId === D && !c.golden)).toHaveLength(0);
    expect(isTribe(gold[0]!, 'dragon') && isTribe(gold[0]!, 'spirit')).toBe(true);
  });
});

describe('Dragon and Spirit synergies', () => {
  // RE-PIN 2026-10-10: the Dragon watcher is Spirit Worgen ("whenever you play a Beast or Dragon"); Vaultkeeper no longer
  // watches Dragon plays (owner balance batch).
  it('shop: playing a Drakko grows a Dragon watcher (Spirit Worgen) and a Spirit hand-watcher, and the tallies count it', () => {
    let s = withRune({ board: [card('vk', 'spiritworgen')] });
    s = { ...s, hand: [...s.hand, card('sl', 'sp3_slumbering')] };
    const dk = s.hand.find((c) => c.cardId === D)!;
    const vk0 = s.board[0]!.attack, sl0 = s.hand.find((c) => c.uid === 'sl')!.attack;
    s = reduce(s, { type: 'play', uid: dk.uid });
    expect(s.board.some((c) => c.uid === dk.uid), 'the Drakko was played').toBe(true);
    expect(s.board.find((c) => c.uid === 'vk')!.attack, 'Spirit Worgen: "whenever you play a Beast or Dragon"').toBeGreaterThan(vk0);
    expect(s.hand.find((c) => c.uid === 'sl')!.attack, 'Slumbering: "whenever you play a Spirit"').toBe(sl0 + 4);
    expect(playedThisTurnFor(s, 'dragon')).toBe(1);
    expect(playedThisTurnFor(s, 'spirit'), 'the Spirits-played tally counts it').toBe(1);
    expect(playerCombatSideState(s).tribesPlayed).toMatchObject({ dragon: 1, spirit: 1 });
  });

  it('combat: the Drakko body is a Dragon / Spirit and a Dragon payoff (Traveling Skald) buffs it when it attacks', () => {
    const bm = (cardId: string, attack: number, health: number, addedTribes?: ('dragon' | 'spirit')[]): BoardMinion =>
      ({ cardId, attack, health, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...(addedTribes ? { addedTribes } : {}) } as unknown as BoardMinion);
    const r = simulate(
      [bm(D, 3, 50, ['dragon', 'spirit']), bm('d2_skald', 1, 50)],
      [bm('k_candleback', 1, 60)],
      makeRng(1), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }),
    );
    const drakko = r.initial.player[0]!;
    expect([drakko.tribe, drakko.tribe2], 'the combat snapshot carries the folded pair').toEqual(['dragon', 'spirit']);
    const firstAttack = r.events.findIndex((e) => e.type === 'attack' && e.attacker === drakko.uid);
    expect(firstAttack).toBeGreaterThanOrEqual(0);
    const skald = r.initial.player[1]!.uid;
    const buffed = r.events.slice(firstAttack).some((e: CombatEvent) =>
      e.type === 'buff' && e.target === drakko.uid && e.source === skald && e.attack === 3 && e.health === 2);
    expect(buffed, 'Skald: "When another friendly Dragon attacks, give it +3/+2"').toBe(true);
  });

  it('the fold keeps printed tribes and gives a neutral card its added pair', () => {
    expect(foldTribes('neutral', undefined, ['dragon', 'spirit'])).toEqual({ tribe: 'dragon', tribe2: 'spirit' });
    expect(foldTribes('celestial', undefined, ['undead'])).toEqual({ tribe: 'celestial', tribe2: 'undead' });
    expect(foldTribes('dwarf', 'demon', ['dragon'])).toEqual({ tribe: 'dwarf', tribe2: 'demon' });
    expect(foldTribes('neutral', undefined, undefined)).toEqual({ tribe: 'neutral' });
  });
});

describe('persistence and recorded boards', () => {
  it('the override survives save / restore', () => {
    const s = withRune({ board: [card('held', D)] });
    const back = deserialize(serialize(s));
    expect(back.cardTribes).toEqual({ [D]: ['dragon', 'spirit'] });
    expect(back.ownedRunes).toContain('rune_drakko');
    expect(defIsTribe(CARD_INDEX[D], 'spirit', back)).toBe(true);
    expect(isTribe(back.board.find((c) => c.uid === 'held')!, 'dragon')).toBe(true);
  });

  it('a recorded board (snapshot / ghost) keeps the Drakko typed, on the body and for its mid-fight summons', () => {
    const s = withRune({ board: [card('held', D)] });
    const snap = snapshotBoard(s);
    const body = snap.minions.find((m) => m.cardId === D)!;
    expect(body.addedTribes).toEqual(['dragon', 'spirit']);
    expect(snap.cardTribes).toEqual({ [D]: ['dragon', 'spirit'] });
    expect(sideFromSnapshot(snap, 6, []).cardTribes).toEqual({ [D]: ['dragon', 'spirit'] });
  });

  it('is deterministic: the same seed and actions give the same run', () => {
    const a = withRune({ board: [card('held', D)] });
    const b = withRune({ board: [card('held', D)] });
    expect(serialize(a)).toBe(serialize(b));
  });
});
