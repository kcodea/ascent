/**
 * Odelle (Exhibition) — the two readouts, and the LIVE printed rule.
 *
 * Her power answers two different questions — "how much is this giving me" and "how close is the next step" —
 * and one pill cannot carry both (owner ask 2026-08-22: the +X/+X moves to the centre of the power art, the
 * x/4 takes the normal pill slot). This pins the numbers behind both, and the live text the tooltip prints.
 */
import { describe, expect, it } from 'vitest';
import { createRun, exhibitionGrantOf, heroPowerText, type RunState } from './index';

const at = (cardsPlayedTotal: number): RunState => ({ ...createRun(1, 'odelle'), cardsPlayedTotal } as RunState);

describe('Exhibition grant', () => {
  it('starts at +1/+1 and improves every 4 cards played', () => {
    expect(exhibitionGrantOf(at(0))).toBe(1);
    expect(exhibitionGrantOf(at(3))).toBe(1);
    expect(exhibitionGrantOf(at(4)), 'the 4th card is the step').toBe(2);
    expect(exhibitionGrantOf(at(11))).toBe(3);
    expect(exhibitionGrantOf(at(12))).toBe(4);
  });

  it('the x/4 counter is progress toward the NEXT step, and wraps', () => {
    // The pill's number, derived the same way StatusBar derives it.
    const pill = (n: number): string => `${n % 4}/4`;
    expect(pill(0)).toBe('0/4');
    expect(pill(3)).toBe('3/4');
    expect(pill(4), 'wraps as the grant improves').toBe('0/4');
    expect(pill(7)).toBe('3/4');
  });

  it('the printed rule shows the CURRENT grant, not the base rate', () => {
    // The bug this closes: it read a static "+1/+1" while she was giving +3/+3.
    const t = heroPowerText(at(11));
    expect(t).toContain('+3/+3');
    expect(t, 'the base rate is gone once it has improved').not.toContain('+1/+1');
  });

  it('the printed rule counts down to the next improve, in cards', () => {
    expect(heroPowerText(at(0)), '4 away at a fresh step').toContain('**4** cards');
    expect(heroPowerText(at(3)), 'one more card').toContain('**1** card played');
    expect(heroPowerText(at(2))).toContain('**2** cards');
  });
});
