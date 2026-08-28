import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { extraTriggerFires, type TriggerFamily } from './types';

/**
 * The shared trigger-multiplier resolver. These pin the STACKING RULES, which were previously implicit in
 * four separate hardcoded call sites and differed between them (Sylus stacks; Drakko and Chronos don't).
 */
const get = (id: string) => CARD_INDEX[id];
const board = (...specs: [string, boolean?][]) => specs.map(([cardId, golden]) => ({ cardId, golden: !!golden }));

describe('extraTriggerFires — the shared multiplier resolver', () => {
  it('Sylus STACKS across copies (the historical rule)', () => {
    expect(extraTriggerFires('deathrattle', board(['sylus']), get)).toBe(1);
    expect(extraTriggerFires('deathrattle', board(['sylus'], ['sylus']), get)).toBe(2);
    expect(extraTriggerFires('deathrattle', board(['sylus', true]), get)).toBe(2); // golden = x2
    expect(extraTriggerFires('deathrattle', board(['sylus', true], ['sylus']), get)).toBe(3);
  });

  it('Drakko and Chronos do NOT stack — best single copy counts', () => {
    expect(extraTriggerFires('battlecry', board(['drummer']), get)).toBe(1);
    expect(extraTriggerFires('battlecry', board(['drummer'], ['drummer']), get)).toBe(1); // no stacking
    expect(extraTriggerFires('battlecry', board(['drummer'], ['drummer', true]), get)).toBe(2); // best copy
    expect(extraTriggerFires('endOfTurn', board(['chronos'], ['chronos']), get)).toBe(1);
    expect(extraTriggerFires('endOfTurn', board(['chronos', true]), get)).toBe(2);
  });

  it('a multiplier only affects the families it declares', () => {
    expect(extraTriggerFires('deathrattle', board(['drummer']), get)).toBe(0);
    expect(extraTriggerFires('battlecry', board(['sylus']), get)).toBe(0);
    expect(extraTriggerFires('rally', board(['chronos']), get)).toBe(0);
  });

  it('Uron covers the COMBAT families, and DOES stack with itself', () => {
    // Owner vocabulary rule 2026-08-28: Uron's text says "an additional time", so it is additive and every
    // copy counts. It was best-of-copies before, which contradicted its own printed wording.
    const mine: TriggerFamily[] = ['rally', 'endOfTurn', 'startOfCombat'];
    for (const f of mine) {
      expect(extraTriggerFires(f, board(['uron']), get), f).toBe(1);
      expect(extraTriggerFires(f, board(['uron'], ['uron']), get), f).toBe(2); // additive: both copies count
      expect(extraTriggerFires(f, board(['uron', true]), get), f).toBe(2); // golden doubles the extra
    }
    // Shouts and Echoes are Zyff's half of the pair — Uron must NOT touch them.
    for (const f of ['battlecry', 'deathrattle'] as TriggerFamily[]) {
      expect(extraTriggerFires(f, board(['uron']), get), f).toBe(0);
    }
  });

  it('Zyff covers Shouts + Echoes only, and DOES stack with itself', () => {
    // Same rule as Uron: "an additional time" → additive.
    for (const f of ['battlecry', 'deathrattle'] as TriggerFamily[]) {
      expect(extraTriggerFires(f, board(['zyff']), get), f).toBe(1);
      expect(extraTriggerFires(f, board(['zyff'], ['zyff']), get), f).toBe(2);
      expect(extraTriggerFires(f, board(['zyff', true]), get), f).toBe(2);
    }
    for (const f of ['rally', 'endOfTurn', 'startOfCombat'] as TriggerFamily[]) {
      expect(extraTriggerFires(f, board(['zyff']), get), f).toBe(0);
    }
  });

  it('Uron + Zyff together cover five families, neither treading on the other', () => {
    const both = board(['uron'], ['zyff']);
    for (const f of ['battlecry', 'deathrattle', 'rally', 'endOfTurn', 'startOfCombat'] as TriggerFamily[]) {
      expect(extraTriggerFires(f, both, get), f).toBe(1);
    }
    // Slaughter now has NO multiplier at all — the family stays supported, nothing declares it.
    expect(extraTriggerFires('slaughter', both, get)).toBe(0);
  });

  it('additive cards sum, and a MULTIPLIER multiplies the total (owner rule 2026-08-28)', () => {
    // Sylus and Zyff both print "additional", so they sum: 2 extra fires on Deathrattles.
    expect(extraTriggerFires('deathrattle', board(['sylus'], ['zyff']), get)).toBe(2);
    expect(extraTriggerFires('deathrattle', board(['sylus'], ['sylus'], ['zyff', true]), get)).toBe(4);
    // Drakko prints "twice" — a MULTIPLIER — so Zyff's extra fire happens, then Drakko doubles the total:
    // (1 + 1) × 2 = 4 fires, i.e. +3 over the base. This is the owner's worked example.
    expect(extraTriggerFires('battlecry', board(['drummer'], ['zyff']), get)).toBe(3);
    // Golden Drakko is ×3 (one more trigger, not a doubled factor): (1 + 1) × 3 = 6 fires → +5.
    expect(extraTriggerFires('battlecry', board(['drummer', true], ['zyff']), get)).toBe(5);
    // Two Drakkos are still ×2 — a multiplier does not stack with copies of itself.
    expect(extraTriggerFires('battlecry', board(['drummer'], ['drummer']), get)).toBe(1);
  });

  it('an empty board and unknown ids contribute nothing', () => {
    expect(extraTriggerFires('battlecry', [], get)).toBe(0);
    expect(extraTriggerFires('battlecry', board(['nope']), get)).toBe(0);
    expect(extraTriggerFires('battlecry', board(['sandbag']), get)).toBe(0);
  });
});
