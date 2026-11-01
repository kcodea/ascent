/**
 * R-HERO-POWER-REPLACED-01 (owner 2026-11-01): "foreman flint played power shifter but dwarves still cost 2 for him.
 * please make sure when a hero replaces their hero power that their existing hero power gets replaced."
 *
 * A replaced power's passive effects END, and the new power's APPLY. Behaviour reads the WIELDED power (slot 0 and
 * slot 1, `activePowers` / `hasPower` / `primaryPower`), never `getHero(heroId).power`. Each test here pins one site
 * that used to read the native power.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG, createRun, heroOfferPrice, reduce, toBotVisibleState, type RunState } from './index';

const DWARF = 'dw_brunni';
const OTHER = 'stray';

/** A mid-shop run with a Dwarf and a non-Dwarf in the Shop and Power Shifter in hand. */
function shop(heroId: string, over: Partial<RunState> = {}): RunState {
  const s = createRun(5, heroId);
  return {
    ...s, phase: 'recruit', embers: 20, maxEmbers: 20, tier: 5, board: [],
    hand: [{ uid: 'ps', cardId: 'powershifter', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    shop: [{ uid: 'd0', cardId: DWARF }, { uid: 'n0', cardId: OTHER }],
    powerOffer: undefined, discover: undefined, questOffer: undefined, pendingPowerOffer: undefined,
    ...over,
  } as RunState;
}

/** Cast Power Shifter and pick `heroId`'s power (the offer is pinned so the test does not depend on the roll). */
function shiftTo(s: RunState, heroId: string): RunState {
  const cast = reduce(s, { type: 'play', uid: 'ps' } as never);
  expect(cast.powerOffer?.slot, 'Power Shifter opened its Discover').toBe('shifter');
  return reduce({ ...cast, powerOffer: { heroIds: [heroId], slot: 'shifter' } } as RunState, { type: 'pickPower', index: 0 });
}

const paid = (s: RunState, uid: string): number => s.embers - reduce(s, { type: 'buy', uid }).embers;

describe('R-HERO-POWER-REPLACED-01: Company Rate follows the wielded power', () => {
  it('native Flint: Dwarves cost 2 (baseline)', () => {
    const s = shop('flint');
    expect(heroOfferPrice(s, { cardId: DWARF })).toBe(2);
    expect(paid(s, 'd0')).toBe(2);
  });

  it('Flint who Power Shifts Company Rate away pays the normal price for Dwarves', () => {
    const s = shiftTo(shop('flint'), 'nadja');
    expect(s.adoptedPowerId).toBe('nadja');
    expect(heroOfferPrice(s, { cardId: DWARF }), 'no hero price once Company Rate is gone').toBeUndefined();
    expect(paid(s, 'd0'), 'the owner bug: still charged 2').toBe(CONFIG.minionCost);
  });

  it('a non-Flint hero who Power Shifts INTO Company Rate gets Dwarves at 2', () => {
    const s = shiftTo(shop('warden'), 'flint');
    expect(heroOfferPrice(s, { cardId: DWARF })).toBe(2);
    expect(paid(s, 'd0')).toBe(2);
    expect(heroOfferPrice(s, { cardId: OTHER }), 'non-Dwarves stay unpriced').toBeUndefined();
  });

  it('a Mimic wearing Company Rate gets Dwarves at 2', () => {
    const s = shop('mimic', { adoptedPowerId: 'flint' });
    expect(heroOfferPrice(s, { cardId: DWARF })).toBe(2);
  });

  it("a Void holding Company Rate in SLOT 1 gets Dwarves at 2", () => {
    const s = shop('voidhero', { voidPowerIds: ['warden', 'flint'] });
    expect(heroOfferPrice(s, { cardId: DWARF })).toBe(2);
  });
});

describe('R-HERO-POWER-REPLACED-01: the bots read the wielded power', () => {
  it('the production-bot view reports the slot-0 power, not the native one', () => {
    const s = shiftTo(shop('flint'), 'nadja');
    expect(toBotVisibleState(s).hero.powerKind).toBe('gainMaxMana');
  });
});

describe('R-HERO-POWER-REPLACED-01: Start of Turn hero beats name the wielded power', () => {
  it("a Mimic wearing Chaos Bond labels the turn-5 grant 'Chaos Bond', not 'Mimicry'", () => {
    const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };
    const s = shop('mimic', { adoptedPowerId: 'chaos', wave: 4, hand: [] });
    const next = reduce({ ...s, phase: 'combat', lastCombat: win } as RunState, { type: 'resolveCombat' });
    expect(next.wave).toBe(5);
    const beat = (next.sotBeatFx ?? []).find((b) => b.source.kind === 'hero');
    expect(beat?.source.label).toBe('Chaos Bond');
  });
});
