import { describe, it, expect } from 'vitest';
import { rallySpreadText } from './cardText';

/** Sunmane Herald's printed "+3 Attack" is only its opening rung — the live text must show the current value. */
describe('rallySpreadText — Sunmane\u2019s live rally value', () => {
  it('falls back to the printed text with no accrued value (shop / first swing)', () => {
    expect(rallySpreadText('b2_sunmane', false, undefined)).toBeNull();
    expect(rallySpreadText('b2_sunmane', false, 3)).toBeNull(); // still on the base rung
  });

  it('prints the escalated grant, marked as changed', () => {
    const t = rallySpreadText('b2_sunmane', false, 24);
    expect(t).toContain('{{+24 Attack}}'); // green, and excluded from the golden doubler
    expect(t).not.toContain('+3 Attack');
  });

  it('a GOLDEN Sunmane reads against its doubled base, not the printed one', () => {
    // Golden is already folded into the stored magnitude, so +6 is its opening rung — not an escalation.
    expect(rallySpreadText('b2_sunmane', true, 6)).toBeNull();
    expect(rallySpreadText('b2_sunmane', true, 12)).toContain('{{+12 Attack}}');
  });

  it('returns null for any other card', () => {
    expect(rallySpreadText('stray', false, 24)).toBeNull();
  });
});
