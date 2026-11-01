// @vitest-environment jsdom
/**
 * VERSUS DUOS — A RETURNED PASS SAYS WHY (R-DUOS-PASS-RANKED-01, owner 2026-11-01: "duos keeps saying pass returned.
 * why?"). Every refusal code the transport refunds has its own plain line on the teammate's portrait; only an unknown
 * code keeps the generic text. Player text: short sentences, no em dashes, no "--".
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const { DUOS_PASS_REFUSALS } = await import('./duosPasses');
const { passReturnedText, PASS_RETURNED_FALLBACK } = await import('./duosPassUi');

describe('a returned pass names its reason', () => {
  it('every refusal code has its own text, plain and short', () => {
    expect(DUOS_PASS_REFUSALS.size).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const code of DUOS_PASS_REFUSALS) {
      const t = passReturnedText(code);
      expect(t, code).not.toBe(PASS_RETURNED_FALLBACK);
      expect(t, code).not.toMatch(/—|--|Oath|climb/);
      expect(t.length, code).toBeLessThan(70);
      seen.add(t);
    }
    expect(seen.size).toBe(DUOS_PASS_REFUSALS.size); // no two reasons read the same
  });

  it('the owner\'s examples, and the generic text only for an unknown code', () => {
    expect(passReturnedText('deadline_passed')).toBe('Too late, time ran out. You got it back.');
    expect(passReturnedText('not_shop')).toBe('Too late, the shop is closed. You got it back.');
    expect(passReturnedText('no_teammate')).toBe('Your teammate is out. You got it back.');
    expect(passReturnedText('too_many_passes')).toBe('Pass limit reached this round. You got it back.');
    expect(passReturnedText('golden')).toBe("Gilded minions can't be passed by spells. You got it back.");
    expect(passReturnedText('something_new')).toBe(PASS_RETURNED_FALLBACK);
  });
});
