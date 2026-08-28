import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { extraTriggerFires } from '@game/core';

/**
 * THE TRIGGER-MULTIPLIER VOCABULARY (owner rule 2026-08-28).
 *
 * The card's own printed wording says how it combines:
 *   · "trigger twice"            → a MULTIPLIER. Copies of the SAME card do not stack; different multiplier
 *                                  cards multiply with each other.
 *   · "trigger 1 additional time" → ADDITIVE. Every copy of every additive card counts.
 *
 * `(1 + Σ extra) × Π factor`. These are the owner's worked examples, verbatim, plus the golden rulings.
 */
const at = (cardId: string, golden = false) => ({ cardId, golden });
/** Total fires for a family, which is what a player actually counts. */
const fires = (family: Parameters<typeof extraTriggerFires>[0], board: { cardId: string; golden?: boolean }[]): number =>
  1 + extraTriggerFires(family, board, (id) => CARD_INDEX[id]);

describe('the printed wording decides how a multiplier combines', () => {
  it('two Sylus mean an Echo triggers 3 times ("additional" stacks)', () => {
    expect(fires('deathrattle', [at('sylus')])).toBe(2);
    expect(fires('deathrattle', [at('sylus'), at('sylus')])).toBe(3);
  });

  it('two Drakko still mean a Shout triggers twice ("twice" does not stack)', () => {
    expect(fires('battlecry', [at('drummer')])).toBe(2);
    expect(fires('battlecry', [at('drummer'), at('drummer')])).toBe(2);
  });

  it('Drakko + Zyff mean a Shout triggers 4 times — the additive fires, then the multiplier doubles it', () => {
    expect(fires('battlecry', [at('drummer'), at('zyff')])).toBe(4);
  });

  it('Chronos doubles End of Turn, and two of him still only double it', () => {
    expect(fires('endOfTurn', [at('chronos')])).toBe(2);
    expect(fires('endOfTurn', [at('chronos'), at('chronos')])).toBe(2);
  });

  it('Zyff still stacks with Sylus on Echoes — both additive', () => {
    expect(fires('deathrattle', [at('sylus'), at('zyff')])).toBe(3);
  });

  it('two Urons mean 3 triggers — its text says "an additional time", so it stacks now', () => {
    expect(fires('rally', [at('uron')])).toBe(2);
    expect(fires('rally', [at('uron'), at('uron')])).toBe(3);
  });
});

describe('golden', () => {
  it('a golden MULTIPLIER buys one more trigger, not a doubled factor (owner ruling)', () => {
    expect(fires('battlecry', [at('drummer', true)]), 'golden Drakko is three times, not four').toBe(3);
    expect(fires('endOfTurn', [at('chronos', true)])).toBe(3);
  });

  it('a golden ADDITIVE card doubles its extra', () => {
    expect(fires('deathrattle', [at('sylus', true)])).toBe(3);
  });

  it('and the two compose: golden Drakko + Zyff is (1+1)×3', () => {
    expect(fires('battlecry', [at('drummer', true), at('zyff')])).toBe(6);
  });
});

describe('the printed text matches the behaviour', () => {
  it('every multiplier card says "twice"/"three times" and every additive one says "additional"', () => {
    for (const id of ['drummer', 'chronos']) {
      const def = CARD_INDEX[id]!;
      expect(def.triggerMultiplier?.factor, `${id} must be a multiplier`).toBeGreaterThan(1);
      expect(def.text, `${id} must print the multiplier wording`).toMatch(/twice/);
      expect(def.goldenText ?? '', `${id} golden must print three times`).toMatch(/three times/);
    }
    for (const id of ['sylus', 'zyff', 'uron']) {
      const def = CARD_INDEX[id]!;
      expect(def.triggerMultiplier?.extra, `${id} must be additive`).toBeGreaterThan(0);
      expect(def.triggerMultiplier?.stacks, `${id} must stack — its text says "additional"`).toBe(true);
      expect(def.text, `${id} must print the additive wording`).toMatch(/additional/);
    }
  });
});
