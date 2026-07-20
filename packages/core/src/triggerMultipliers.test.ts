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

  it('Uron covers all six families, and does not stack with itself', () => {
    const families: TriggerFamily[] = ['battlecry', 'deathrattle', 'rally', 'slaughter', 'endOfTurn', 'startOfCombat'];
    for (const f of families) {
      expect(extraTriggerFires(f, board(['uron']), get), f).toBe(1);
      expect(extraTriggerFires(f, board(['uron'], ['uron']), get), f).toBe(1); // best copy only
      expect(extraTriggerFires(f, board(['uron', true]), get), f).toBe(2); // golden
    }
  });

  it('stacking and non-stacking multipliers combine ADDITIVELY', () => {
    // Sylus (stacking, +1) + Uron (best-copy, +1) on Deathrattles = +2.
    expect(extraTriggerFires('deathrattle', board(['sylus'], ['uron']), get)).toBe(2);
    expect(extraTriggerFires('deathrattle', board(['sylus'], ['sylus'], ['uron', true]), get)).toBe(4);
    // Drakko + Uron both non-stacking on Battlecries → the single best contribution, not the sum.
    expect(extraTriggerFires('battlecry', board(['drummer'], ['uron']), get)).toBe(1);
    expect(extraTriggerFires('battlecry', board(['drummer', true], ['uron']), get)).toBe(2);
  });

  it('an empty board and unknown ids contribute nothing', () => {
    expect(extraTriggerFires('battlecry', [], get)).toBe(0);
    expect(extraTriggerFires('battlecry', board(['nope']), get)).toBe(0);
    expect(extraTriggerFires('battlecry', board(['sandbag']), get)).toBe(0);
  });
});
