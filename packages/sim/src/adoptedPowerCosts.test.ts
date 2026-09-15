/**
 * ADOPTED HERO POWERS START THEIR PRICE CLOCK ON ADOPTION (owner report 2026-09-15: a Void wielding Rounded
 * Spellbook showed no cost pill — the power was already free the moment it was picked).
 *
 * The shrinking-cost powers (Hunch's Rounded Spellbook, Harlan's Buyout), Rascal's climbing All In and Tiff's
 * discount bank key their state off run fields a NATIVE hero implicitly starts at run creation (`?? 1`, `?? 0`).
 * A Void / Mimic / Power Shifter adopting the power mid-run never set them, so the countdown had been running
 * since wave 1 for a wielder who did not exist yet. `seedAdoptedPower` is the one funnel all three adopters go
 * through; these prove it re-bases every price clock, that the reducer CHARGES the same number the shared
 * `heroPowerCostOf` prints, and that the same class of bug is closed for Jenkins's escalating dig and Indy's
 * Gild recharge.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { activePowers, createRun, heroPowerCostOf, INDY_GILD_RECHARGE_GOLD, reduce, type RunState } from './index';

const spell = CARD_INDEX['spiritfire']!;

/** A Void run at wave `wave`, mid-shop, with the turn-4 ceremony's first pick rigged to `first` and the second
 *  to `second` — `pickPower` on the rigged offer is the real adoption path (no state is hand-set). */
function voidAdopting(first: string, second: string, wave = 4, over: Partial<RunState> = {}): RunState {
  let s: RunState = {
    ...createRun(11, 'voidhero'), phase: 'recruit', wave, embers: 20, maxEmbers: 20, board: [], hand: [],
    powerOffer: { heroIds: [first, 'warden'], slot: 'void1' }, discover: undefined, ...over,
  } as RunState;
  s = reduce(s, { type: 'pickPower', index: 0 });
  s = { ...s, powerOffer: { heroIds: [second, 'warden'], slot: 'void2' } } as RunState;
  s = reduce(s, { type: 'pickPower', index: 0 });
  return s;
}

/** A plain hero casting Power Shifter with the Discover rigged to `heroId`. */
function shifterAdopting(heroId: string, over: Partial<RunState> = {}): RunState {
  let s: RunState = {
    ...createRun(5, 'warden'), phase: 'recruit', embers: 20, maxEmbers: 20, board: [],
    hand: [{ uid: 'ps', cardId: 'powershifter', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    powerOffer: undefined, discover: undefined, ...over,
  } as RunState;
  s = reduce(s, { type: 'play', uid: 'ps' } as never);
  s = { ...s, powerOffer: { heroIds: [heroId, 'nadja', 'merrin'], slot: 'shifter' } } as RunState;
  return reduce(s, { type: 'pickPower', index: 0 });
}

describe('Rounded Spellbook adopted mid-run (the owner report)', () => {
  it('a Void picking it on wave 4 pays 3 on wave 4 and 2 on wave 5 — as Hunch does on waves 1 and 2', () => {
    let s = voidAdopting('hunch', 'rayse', 4, { lastSpellCastId: spell.id });
    expect(s.voidPowerIds).toEqual(['hunch', 'rayse']);
    expect(s.hunchResetWave, 'the countdown re-based to the pick turn').toBe(4);
    expect(heroPowerCostOf(activePowers(s)[0]!, s, 0), 'the live price on the pick turn').toBe(3);
    const before = s.embers;
    s = reduce(s, { type: 'heroPower', slot: 0 });
    expect(s.hand.some((c) => c.cardId === spell.id), 'a copy of the last spell').toBe(true);
    expect(before - s.embers, 'CHARGED 3 — the number the coin prints').toBe(3);

    // The turn after a use is already back down to 2 (the native ruling), and the next unused turn 1.
    s = { ...s, wave: 5, heroReady: true, embers: 20, hand: [] };
    expect(heroPowerCostOf(activePowers(s)[0]!, s, 0)).toBe(2);
    s = reduce(s, { type: 'heroPower', slot: 0 });
    expect(20 - s.embers, 'charged 2 on wave N+1').toBe(2);
  });

  it('the price shown equals the price paid at every step — one helper for both', () => {
    let s = voidAdopting('rayse', 'hunch', 4, { lastSpellCastId: spell.id });
    expect(activePowers(s)[1]!.kind, 'Hunch in Void slot 1').toBe('roundedSpellbook');
    for (const wave of [4, 6, 7, 8]) {
      s = { ...s, wave, heroReady2: true, embers: 20, hand: [] };
      const shown = heroPowerCostOf(activePowers(s)[1]!, s, s.heroPowerUses2 ?? 0);
      const after = reduce(s, { type: 'heroPower', slot: 1 });
      expect(20 - after.embers, `wave ${wave}: paid what was shown`).toBe(shown);
      s = after;
    }
  });

  it('a Power Shifter adopting it starts at 3 too, whatever the wave', () => {
    const s = shifterAdopting('hunch', { wave: 9, lastSpellCastId: spell.id });
    expect(s.adoptedPowerId).toBe('hunch');
    expect(heroPowerCostOf(activePowers(s)[0]!, s, 0)).toBe(3);
    const after = reduce(s, { type: 'heroPower' });
    expect(20 - after.embers).toBe(3);
  });

  it('a MIMIC adopting it prices from its pick turn, not from wave 1', () => {
    let s: RunState = {
      ...createRun(9, 'mimic'), phase: 'recruit', wave: 6, embers: 20, maxEmbers: 20, board: [], hand: [],
      lastSpellCastId: spell.id, powerOffer: { heroIds: ['hunch', 'warden'], slot: 'mimic' }, discover: undefined,
    } as RunState;
    s = reduce(s, { type: 'pickPower', index: 0 });
    expect(heroPowerCostOf(activePowers(s)[0]!, s, 0)).toBe(3);
    expect(20 - reduce(s, { type: 'heroPower' }).embers).toBe(3);
  });
});

describe('the other price clocks re-base on adoption', () => {
  it("Harlan's Buyout: 11 on the pick turn (was 11 − (wave − 1))", () => {
    const s = voidAdopting('harlan', 'rayse', 6);
    expect(s.harlanResetWave).toBe(6);
    expect(heroPowerCostOf(activePowers(s)[0]!, s, 0)).toBe(11);
    expect(heroPowerCostOf(activePowers(s)[0]!, { ...s, wave: 7 }, 0), '10 the turn after').toBe(10);
  });

  it("Rascal's (baggerben) All In: the payout starts back at 1 (was 1 + 2 × turns since wave 1)", () => {
    let s = voidAdopting('baggerben', 'rayse', 7);
    expect(s.rascalResetWave).toBe(7);
    const before = s.embers;
    s = reduce(s, { type: 'heroPower', slot: 0 });
    expect(s.embers - before, 'paid 1, not 13').toBe(1);
  });

  it("Tiff's Dragon Tamer: the discount bank starts empty, so the coin reads the full 5", () => {
    const s = voidAdopting('tiff', 'rayse', 5, { tiffDiscount: 3 } as Partial<RunState>);
    expect(s.tiffDiscount).toBe(0);
    expect(heroPowerCostOf(activePowers(s)[0]!, s, 0)).toBe(5);
  });

  it("Jenkins's Dynamite Dig: the first dig is FREE for an adopter whose slot had spent uses before", () => {
    // A Power Shifter after two Gildmaster activations: the slot's use count is 2, which used to price the
    // first dig at 2 Gold instead of 0.
    const s = shifterAdopting('jenkins', { heroPowerUses: 2 });
    expect(s.heroPowerUses, 'the slot counter belongs to the arriving power').toBe(0);
    expect(heroPowerCostOf(activePowers(s)[0]!, s, s.heroPowerUses ?? 0)).toBe(0);
    const after = reduce(s, { type: 'heroPower' });
    expect(after.discover, 'the dig opened').toBeTruthy();
    expect(after.embers, 'free').toBe(20);
    expect(heroPowerCostOf(activePowers(after)[0]!, after, after.heroPowerUses ?? 0), 'then 1').toBe(1);
  });

  it('a Void with Dig in slot 1 prices off slot 1 — slot 0 uses never tax it', () => {
    const s = voidAdopting('rayse', 'jenkins', 4, { heroPowerUses: 3 });
    expect(heroPowerCostOf(activePowers(s)[1]!, s, s.heroPowerUses2 ?? 0)).toBe(0);
    const after = reduce(s, { type: 'heroPower', slot: 1 });
    expect(after.embers, 'a free first dig').toBe(20);
    expect(after.heroPowerUses2).toBe(1);
  });
});

describe("Indy's Gild adopted mid-run", () => {
  const body = { uid: 'm', cardId: 'stray', tribe: 'beast' as const, attack: 2, health: 2, keywords: [], golden: false };

  it('arrives un-spent even when the replaced once-per-game power had been used', () => {
    const s = shifterAdopting('indy', { heroPowerSpent: true, indyGildRearmAt: 999, board: [body] });
    expect(s.heroPowerSpent, 'not dead on arrival').toBe(false);
    expect(s.indyGildRearmAt).toBeUndefined();
    expect(reduce(s, { type: 'heroPower', uid: 'm' }).board[0]!.golden, 'the Gild works').toBe(true);
  });

  it('RECHARGES for a Void wielding it in slot 1 (the gate used to be `heroId === "indy"`)', () => {
    let s = voidAdopting('rayse', 'indy', 4, { board: [body], embers: 200, maxEmbers: 200 });
    s = reduce(s, { type: 'heroPower', slot: 1, uid: 'm' });
    expect(s.board[0]!.golden).toBe(true);
    expect(s.heroPowerSpent2, 'slot 1 spent').toBe(true);
    expect(s.indyGildRearmAt).toBe((s.goldSpent ?? 0) + INDY_GILD_RECHARGE_GOLD);
    // Spend past the threshold (refreshes are 1 Gold each) — the charge must come back on the slot that holds it.
    for (let i = 0; i < INDY_GILD_RECHARGE_GOLD && s.heroPowerSpent2; i++) s = reduce(s, { type: 'roll' });
    expect(s.heroPowerSpent2, 'slot 1 rearmed').toBe(false);
    expect(s.heroPowerSpent, 'slot 0 untouched').toBeFalsy();
    expect(s.indyGildRearmAt).toBeUndefined();
  });
});
