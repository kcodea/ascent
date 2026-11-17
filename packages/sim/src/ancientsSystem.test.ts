/**
 * ANCIENTS, SYSTEM FIXES (the 2026-11-16 system audit, R-ANCSYS-01..05). Cross-hero behaviour of the Ancient loop itself
 * rather than any one pairing:
 *  - a power gained AFTER the pick (Power Shifter) gets its pairing's shape and starting stamps (R-ANCSYS-01);
 *  - a resolved hero-power pick is not re-opened by a save / restore (R-ANCSYS-02);
 *  - every effect whose text says "Refresh" fills the meter and runs the Refresh pairings (R-ANCSYS-03);
 *  - Drakko × Bonds, Emerald Warden × Death and Gorun × Death count live through a fight (R-ANCSYS-04).
 * Cindy × Fortune's banked refresh (R-ANCSYS-05) is in `ancientsCindy.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_DRAKKO_SHOUT_FLAG, ANCIENT_EW_AVENGE_FLAG, ANCIENT_GORUN_GIFT_FLAG, ANCIENT_IDS, DRAKKO_CARD_ID, activePowers, createRun, deserialize,
  enableAncients, heroPowerText, reduce, serialize, upgradeCostOf,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (heroId: string, over: Partial<RunState> = {}, setId: 'set2' | 'set3' = 'set3'): RunState =>
  ({ ...createRun(7, heroId, 'lobby', undefined, setId), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const clearModals = (s0: RunState): RunState => {
  let s = s0;
  for (let g = 0; g < 12 && (s.discover || s.powerOffer || s.questOffer); g++) {
    s = reduce(s, s.discover ? { type: 'discover', index: 0 } : s.powerOffer ? { type: 'pickPower', index: 0 } : { type: 'buyQuest', index: 0 });
  }
  return s;
};
const picked = (heroId: string, id: AncientId, over: Partial<RunState> = {}, setId: 'set2' | 'set3' = 'set3'): RunState => {
  let s = clearModals(enableAncients(base(heroId, over, setId)));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
/** Indy picks `id`, then Power Shifts into `target`'s power (the real `pickPower` 'shifter' branch). */
const shifted = (target: string, id: AncientId, over: Partial<RunState> = {}): RunState => {
  const s = picked('indy', id, { wave: 6, tier: 4, ...over });
  const n = reduce({ ...s, powerOffer: { heroIds: [target], slot: 'shifter' } }, { type: 'pickPower', index: 0 });
  expect(n.adoptedPowerId).toBe(target);
  return n;
};
const foes = (wave: number, attack: number, health: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health,
  minions: [{ cardId: 'sandbag', attack, health, keywords: [] }], seed: 1, origin: 'self',
});
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const pulses = (s: RunState, flag: string): number =>
  ((s.lastCombat!.events ?? []) as CombatEvent[]).filter((e) => e.type === 'questTrigger' && e.side === 'player' && e.flag === flag).length;

describe('R-ANCSYS-01: a power gained after the pick gets its pairing in full', () => {
  // Every pairing (of a hero in the Power Shifter pool) whose pairing reshapes the power or stamps a start value at the
  // pick. Before the fix each of these showed the new pairing's text but kept the old power's shape / no stamp.
  const TABLE: [string, AncientId][] = [
    ['merrin', 'fortune'], ['nadja', 'fortune'], ['nadja', 'time'], ['nadja', 'death'],
    ['myra', 'genesis'], ['myra', 'time'], ['albus', 'time'], ['albus', 'genesis'], ['frank', 'genesis'], ['frank', 'time'],
    ['gildmaster', 'time'], ['baggerben', 'time'], ['baggerben', 'death'], ['baggerben', 'fortune'],
    ['underdweller', 'fortune'], ['underdweller', 'bonds'], ['xerox', 'genesis'], ['midas', 'fortune'],
    ['gorr', 'bonds'], ['soren', 'war'], ['bram', 'death'], ['bram', 'fortune'], ['bram', 'time'], ['cia', 'war'],
    ['cassen', 'time'], ['brackus', 'time'],
  ];
  const SHAPE = ['passive', 'untargeted', 'cost', 'oncePerGame', 'usesPerTurn', 'maxUses'] as const;
  const STAMPS = ['xeroxCharges', 'sorenWarGain', 'gorrBondsGain', 'ayseWarGain', 'underBondsGain', 'brackusTimeWave'] as const;
  it.each(TABLE)('%s × %s: the shifted power has the native pick\'s shape and starting stamps', (target, id) => {
    const n = shifted(target, id);
    const native = picked(target, id, { wave: 6, tier: 4 });
    const got = activePowers(n)[0]!;
    const want = activePowers(native)[0]!;
    for (const k of SHAPE) expect(got[k], `${k}`).toEqual(want[k]);
    for (const k of STAMPS) expect(n.ancients![k], `${k}`).toEqual(native.ancients![k]);
    expect(n.goldPouchValue, 'goldPouchValue').toEqual(native.goldPouchValue);
    expect(n.ancients!.powerOverrideFor).toBe(target);
  });

  it('Merrin × Fortune after a Power Shift: free, and usable twice this turn, as printed', () => {
    const s = shifted('merrin', 'fortune', { embers: 20 });
    expect(heroPowerText(s)).toContain('(**2** left this turn)');
    const u1 = reduce(s, { type: 'heroPower' });
    expect(u1).not.toBe(s);
    expect(u1.embers).toBe(s.embers);
    const u2 = reduce(u1, { type: 'heroPower' });
    expect(u2, 'the second use is accepted').not.toBe(u1);
  });

  it('Nadja × Fortune after a Power Shift: 2 Gold a use, twice each turn', () => {
    const s = shifted('nadja', 'fortune', { embers: 20 });
    const u1 = reduce(s, { type: 'heroPower' });
    expect(s.embers - u1.embers).toBe(2);
    expect(reduce(u1, { type: 'heroPower' })).not.toBe(u1);
  });

  it('starting stamps run once per power: shifting away and back never pays Xerox a second extra charge', () => {
    let s = shifted('xerox', 'genesis');
    expect(s.ancients!.xeroxCharges).toBe(1);
    s = reduce({ ...s, powerOffer: { heroIds: ['merrin'], slot: 'shifter' } }, { type: 'pickPower', index: 0 });
    expect(s.ancients!.powerOverrideFor).toBe('merrin');
    s = reduce({ ...s, powerOffer: { heroIds: ['xerox'], slot: 'shifter' } }, { type: 'pickPower', index: 0 });
    expect(s.ancients!.xeroxCharges).toBe(1);
  });

  it('the native pick is unchanged, and an unpicked run is untouched by the sync', () => {
    const n = picked('merrin', 'fortune');
    expect(n.ancients!.powerOverride).toEqual({ cost: 0, usesPerTurn: 2 });
    expect(n.ancients!.pairedFor).toEqual(['merrin']);
    const plain = reduce({ ...enableAncients(base('indy')), powerOffer: { heroIds: ['merrin'], slot: 'shifter' } }, { type: 'pickPower', index: 0 });
    expect(plain.ancients!.powerOverride).toBeUndefined();
    expect(plain.ancients!.powerOverrideFor).toBeUndefined();
  });
});

describe('R-ANCSYS-02: a resolved hero-power pick stays resolved across a save', () => {
  it('Mimic: after the turn-1 pick, Continue does not re-open the offer, and a second pick is refused', () => {
    let s = createRun(7, 'mimic', 'lobby', undefined, 'set3');
    expect(s.powerOffer).toBeDefined();
    s = reduce(s, { type: 'pickPower', index: 0 });
    expect(s.powerOffer).toBeUndefined();
    const R = deserialize(serialize(s));
    expect(R.powerOffer).toBeUndefined();
    expect(R.pendingPowerOffer).toBeUndefined();
    expect(reduce(R, { type: 'pickPower', index: 1 })).toBe(R);
    expect(R.adoptedPowerId).toBe(s.adoptedPowerId);
  });
  it('an OPEN power offer still survives the save', () => {
    const s = createRun(7, 'mimic', 'lobby', undefined, 'set3');
    expect(deserialize(serialize(s)).powerOffer).toEqual(s.powerOffer);
  });
});

describe('R-ANCSYS-03: every effect whose text says "Refresh" is a Refresh', () => {
  it('Grand Larceny ("then Refresh it") fills the meter', () => {
    const s = enableAncients(base('indy', { hand: [card('g', 'gift_larceny')] }));
    expect(reduce(s, { type: 'play', uid: 'g' }).ancients!.points).toBe(s.ancients!.points + s.ancients!.refresh);
  });
  it('Grand Larceny runs Tradesman × Bonds (upgrade discount) and Tradesman × Genesis (the count)', () => {
    const t = picked('hermithank', 'bonds');
    const t1 = reduce({ ...t, hand: [card('g', 'gift_larceny')] }, { type: 'play', uid: 'g' });
    const t2 = reduce(t, { type: 'roll' });
    expect(upgradeCostOf(t1)).toBe(upgradeCostOf(t2));
    expect(upgradeCostOf(t1)).toBeLessThan(upgradeCostOf(t));
    const g = picked('hermithank', 'genesis');
    expect(reduce({ ...g, hand: [card('g', 'gift_larceny')] }, { type: 'play', uid: 'g' }).ancients!.tradesRefreshes).toBe(1);
  });
  it('Sigil of Kinship ("Refresh the Shop with minions of its type") fills the meter', () => {
    const beast = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.tier === 1 && c.tribe === 'beast')!;
    const s = enableAncients(base('indy', { hand: [card('g', 'sigilkinship')], board: [card('b', beast.id)] }, 'set2'));
    let n = reduce(s, { type: 'play', uid: 'g', targetUid: 'b' } as never);
    if (n.pendingTarget) n = reduce(n, { type: 'battlecryTarget', targetUid: 'b' } as never);
    expect(n.hand.some((c) => c.uid === 'g'), 'the Sigil was cast').toBe(false);
    expect(n.ancients!.points).toBe(s.ancients!.refresh);
  });
  it('Spell Cart ("Refresh the tavern") fills the meter', () => {
    const s = enableAncients(base('indy', { hand: [card('c', 'spellcart')] }, 'set2'));
    const n = reduce(s, { type: 'play', uid: 'c' });
    expect(n.hand.some((c) => c.uid === 'c')).toBe(false);
    expect(n.ancients!.points).toBe(s.ancients!.refresh);
  });
  it('a pressed Refresh still fills it once (no double count)', () => {
    const s = enableAncients(base('indy'));
    expect(reduce(s, { type: 'roll' }).ancients!.points).toBe(s.ancients!.refresh);
  });
});

describe('R-ANCSYS-04: Ancient counters tick live through a fight', () => {
  it('Drakko × Bonds: the replay\'s Shout pulses move +X/+X and "more to go" to exactly what settle banks', () => {
    let s = picked('drakko', 'bonds', { board: [card('d', DRAKKO_CARD_ID, { health: 90 }), card('a', 'alley', { health: 90 }), card('r', 'ryme', { attack: 1, health: 1, keywords: ['T'] })] });
    s = fightNow(s, 3, 200);
    const fires = pulses(s, ANCIENT_DRAKKO_SHOUT_FLAG);
    expect(fires).toBe(s.lastCombat!.playerShoutFires ?? 0);
    expect(fires).toBeGreaterThan(0);
    const liveEnd = heroPowerText(s, 0, { shoutFires: fires });
    const settled = heroPowerText(reduce(s, { type: 'resolveCombat' }));
    expect(liveEnd).toBe(settled);
    expect(heroPowerText(s, 0, { shoutFires: 0 })).not.toBe(liveEnd);
  });
  it('Emerald Warden × Death: "Used this turn." shows the moment the fight pays', () => {
    let s = picked('emeraldwarden', 'death', { board: Array.from({ length: 7 }, (_, i) => card(`a${i}`, 'sandbag', { attack: 1, health: 1 })) });
    s = { ...s, ancients: { ...s.ancients!, batchBDeaths: 5 } };
    s = fightNow(s, 100, 1000);
    expect(pulses(s, ANCIENT_EW_AVENGE_FLAG)).toBe(1);
    expect(heroPowerText(s, 0, { ewAvengeFired: 0 })).not.toContain('Used this turn.');
    expect(heroPowerText(s, 0, { ewAvengeFired: 1 })).toContain(' Used this turn.');
  });
  it('Gorun × Death: "left this turn" counts down with each gift in the fight', () => {
    const four = ['a', 'b', 'c', 'd'].map((u) => card(u, 'sandbag', { attack: 10, health: 1 }));
    let s = picked('gorun', 'death', { board: [...four, card('k', 'sandbag', { attack: 1, health: 900 })] });
    s = fightNow(s, 5, 4000);
    const gifts = pulses(s, ANCIENT_GORUN_GIFT_FLAG);
    expect(gifts).toBe(2);
    expect(heroPowerText(s, 0, { attackGifts: 0 })).toContain('(**2** left this turn)');
    expect(heroPowerText(s, 0, { attackGifts: 1 })).toContain('(**1** left this turn)');
    expect(heroPowerText(s, 0, { attackGifts: gifts })).toContain('(**0** left this turn)');
  });
});
