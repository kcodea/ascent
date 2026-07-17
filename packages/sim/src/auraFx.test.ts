import { describe, it, expect } from 'vitest';
import { createRun, type BoardCard, type RunState, type ShopCard } from './state';
import { projectEndOfTurnSteps } from './recruit';
import { reduce } from './reducer';

const card = (uid: string, cardId: string, tribe: BoardCard['tribe'], attack = 1, health = 1): BoardCard =>
  ({ uid, cardId, tribe, attack, health, keywords: [], golden: false });
const spellInHand = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
const offer = (uid: string, cardId: string): ShopCard => ({ uid, cardId });

describe('auraFx stamp (the Aura Wash FX signal)', () => {
  it('Lantern of Souls raises the Undead aura → stamps tribe undead with the visible Undead as targets', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [card('u1', 'spore', 'undead'), card('b1', 'stray', 'beast')],
      shop: [offer('s1', 'spore'), offer('s2', 'stray')],
      hand: [spellInHand('l1', 'lanternofsouls')],
    };
    const next = reduce(s, { type: 'play', uid: 'l1' });
    expect(next.undeadAttackBonus).toBeGreaterThan(s.undeadAttackBonus); // the aura actually rose
    expect(next.auraFxSeq).toBe(1);
    const fx = next.auraFx ?? [];
    expect(fx.some((e) => e.tribe === 'undead')).toBe(true);
    const undead = fx.find((e) => e.tribe === 'undead')!;
    expect(undead.targets).toContain('u1'); // the board Undead
    expect(undead.targets).toContain('s1'); // the tavern Undead offer
    expect(undead.targets).not.toContain('b1'); // the Beast is untouched
    expect(undead.targets).not.toContain('s2');
  });

  it('a non-aura action clears auraFx and leaves auraFxSeq unchanged', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [card('u1', 'spore', 'undead')],
      hand: [spellInHand('l1', 'lanternofsouls')],
    };
    const buffed = reduce(s, { type: 'play', uid: 'l1' });
    expect(buffed.auraFxSeq).toBe(1);
    const rolled = reduce(buffed, { type: 'roll' });
    expect(rolled.auraFx).toBeUndefined();
    expect(rolled.auraFxSeq).toBe(1); // seq monotonic, unchanged by a non-aura action
  });
});

describe('projectEndOfTurnSteps per-beat FX capture', () => {
  it('Abyssal Feeder: the projection surfaces the neighbor consumes as `eaten` on its beat', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [card('l', 'stray', 'beast'), card('f', 'abyssalfeeder', 'demon', 4, 4), card('r', 'stray', 'beast')],
    };
    const { steps, fx } = projectEndOfTurnSteps(s);
    expect(steps.length).toBe(1); // one EoT beat (the Feeder)
    expect(fx.length).toBe(1); // fx aligned 1:1 with steps
    const eaters = fx[0]!.eaten.map((e) => e.eaterUid).sort();
    expect(eaters).toEqual(['l', 'r']); // both neighbors consumed a created Fodder
    expect(fx[0]!.eaten.every((e) => e.fodderId === 'fred')).toBe(true);
  });

  it('Hunter reacting to an EoT Attack gain is captured as a Hunter-sourced buff on that beat', () => {
    // Vineweaver's End of Turn casts Growth (board-wide +atk/+hp) → Hunter's Attack rises → Hunter's
    // onGainAttack gives the board +Health, captured sourced from the Hunter (a tendril at beat time).
    const s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [card('v', 'vineweaver', 'dragon', 3, 5), card('hu', 'hunter', 'dragon', 5, 7), card('st', 'stray', 'beast')],
    };
    const { fx } = projectEndOfTurnSteps(s);
    const all = fx.flatMap((f) => f.buffFx);
    expect(all.some((e) => e.sourceCardId === 'hunter' && e.sourceUid === 'hu' && e.targetUid === 'st')).toBe(true);
  });
});
