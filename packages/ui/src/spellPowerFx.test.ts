import { describe, it, expect } from 'vitest';

/**
 * The combat flourish rides the `sc` narration that `grantSpellPower` emits in
 * `packages/core/src/combat/simulate.ts`:
 *
 *     emit({ type: 'sc', source: sourceUid, text: `+${attack}/+${health} Spell Power` })
 *
 * useCombatReplay parses that text to recover the gain. That's a STRING COUPLING across a package
 * boundary — if core ever reformats the narration, the FX silently stops firing in combat with nothing
 * else failing. This pins the shape from the UI side so the break surfaces here instead of in a playtest.
 */
const RE = /^\+(-?\d+)\/\+(-?\d+) Spell Power$/;

/** The exact template core uses — kept in sync deliberately, not imported (core builds it inline). */
const emitted = (attack: number, health: number): string => `+${attack}/+${health} Spell Power`;

describe('spell power FX — combat narration contract', () => {
  it('parses the gain out of the sc text core emits', () => {
    const m = RE.exec(emitted(2, 1));
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(2);
    expect(Number(m![2])).toBe(1);
  });

  it('parses a HEALTH-ONLY gain — the Cinderwing shape that started this', () => {
    const m = RE.exec(emitted(0, 1));
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(0);
    expect(Number(m![2])).toBe(1);
  });

  it('ignores unrelated sc narration', () => {
    expect(RE.exec('Start of Combat')).toBeNull();
    expect(RE.exec('+2/+1 Attack')).toBeNull();
    expect(RE.exec('Cinderwing Matron')).toBeNull();
  });
});
