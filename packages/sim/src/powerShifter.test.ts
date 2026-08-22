/**
 * POWER SHIFTER (T5, 3 Gold) — Discover a new hero power; it replaces the one you wield.
 *
 * The offered pool is MIMIC'S list, deliberately: one `powerDiscoverPool` serves Mimic, Void and this spell,
 * so "which powers are discoverable" can never drift between the three (see the standing note in heroes.ts —
 * a new hero must be asked about once, not three times).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { activePowers, createRun, getHero, hasPower, powerDiscoverPool, reduce, SHIFTER_OPTIONS, type RunState } from './index';

/** A run holding Power Shifter in hand, mid-shop. */
function withShifter(heroId = 'warden', seed = 5, over: Partial<RunState> = {}): RunState {
  const s = createRun(seed, heroId);
  return {
    ...s, phase: 'recruit', embers: 20, board: [],
    hand: [{ uid: 'ps', cardId: 'powershifter', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    powerOffer: undefined, discover: undefined,
    ...over,
  } as RunState;
}
const cast = (s: RunState): RunState => reduce(s, { type: 'play', uid: 'ps' } as never);

describe('Power Shifter — the card', () => {
  it('is a Tier 5 neutral spell costing 3, single-cast, untargeted', () => {
    const c = CARD_INDEX['powershifter']!;
    expect([c.tier, c.cost, c.spell, c.singleCast, c.tribe]).toEqual([5, 3, true, true, 'neutral']);
    expect(c.target, 'the Discover IS the choice — no board target').toBeUndefined();
    expect(c.token, 'drawable, not a reward-only token').toBeFalsy();
  });
});

describe('Power Shifter — casting', () => {
  it('opens a THREE-option power Discover — wider than the heroes two (owner 2026-08-22)', () => {
    const after = cast(withShifter());
    expect(after.powerOffer?.slot).toBe('shifter');
    expect(after.powerOffer?.heroIds).toHaveLength(SHIFTER_OPTIONS);
    expect(SHIFTER_OPTIONS, 'the spell shows more than a hero Discover does').toBeGreaterThan(2);
    expect(new Set(after.powerOffer!.heroIds).size, 'three DISTINCT powers').toBe(SHIFTER_OPTIONS);
  });

  it('never offers the power you are already wielding', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const after = cast(withShifter('warden', seed));
      expect(after.powerOffer!.heroIds).not.toContain('warden');
    }
  });

  it("draws from MIMIC's pool — the same exclusions, not a second list", () => {
    const banned = new Set(['rohan', 'drakko', 'discodan', 'cassen', 'fi', 'runesmith', 'runeguard', 'coran', 'repete', 'vale', 'quillen', 'bram', 'keshi', 'mimic', 'voidhero', 'aster']);
    for (let seed = 1; seed <= 60; seed++) {
      for (const id of cast(withShifter('warden', seed)).powerOffer!.heroIds) {
        expect(banned.has(id), `seed ${seed} offered ${id}`).toBe(false);
        expect(powerDiscoverPool('mimic'), 'every offer comes from the shared pool').toContain(id);
      }
    }
  });

  it('picking REPLACES the wielded power for a plain hero, and arrives charged', () => {
    let s = cast(withShifter('warden', 5, { heroReady: false }));
    const picked = s.powerOffer!.heroIds[0]!;
    s = reduce(s, { type: 'pickPower', index: 0 });
    expect(s.adoptedPowerId).toBe(picked);
    expect(activePowers(s)[0]!.kind, 'the adopted power is what the run wields').toBe(getHero(picked).power.kind);
    expect(hasPower(s, 'grantWard'), "Warden's own power is gone").toBe(false);
    expect(s.heroReady, 'a new power arrives charged').toBe(true);
    expect(s.powerOffer, 'the modal closed').toBeUndefined();
  });

  it('pays an adopted power its creation-time gift (Yirin → Reflector)', () => {
    let s = cast(withShifter('warden', 5));
    s = { ...s, powerOffer: { heroIds: ['rohan', 'nadja'], slot: 'shifter' } } as RunState;
    s = reduce(s, { type: 'pickPower', index: 0 });
    expect(s.hand.some((c) => c.cardId === 'n2_reflector')).toBe(true);
  });

  it('on VOID it replaces slot 0 IN PLACE, leaving the second power alone', () => {
    let s = withShifter('voidhero', 5, { voidPowerIds: ['warden', 'nadja'] });
    s = cast(s);
    s = { ...s, powerOffer: { heroIds: ['midas', 'robin'], slot: 'shifter' } } as RunState;
    s = reduce(s, { type: 'pickPower', index: 0 });
    expect(s.voidPowerIds, 'slot 0 swapped, slot 1 untouched').toEqual(['midas', 'nadja']);
    expect(activePowers(s)).toHaveLength(2);
  });

  it('blocks every other action while the Discover is open (a real modal)', () => {
    const s = cast(withShifter());
    expect(reduce(s, { type: 'roll' } as never), 'the offer owns the screen').toBe(s);
  });
});
