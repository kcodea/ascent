import { describe, it, expect } from 'vitest';
import { rallySpreadText } from './cardText';

/**
 * A rally carrier grants its printed base PLUS everything it has accumulated, so the printed "+3" understates it
 * as soon as the buff has spread. The live text has to show what the next attack will actually hand out.
 */
describe('rallySpreadText — Sunmane’s live rally grant', () => {
  it('falls back to the printed text with nothing accumulated (shop / opening swing)', () => {
    expect(rallySpreadText('b2_sunmane', false, undefined)).toBeNull();
    expect(rallySpreadText('b2_sunmane', false, 0)).toBeNull();
  });

  it('prints base + accumulated, marked as changed', () => {
    // Sunmane holding 21 accumulated grants 3 + 21 = 24 on its next rally.
    const t = rallySpreadText('b2_sunmane', false, 21);
    expect(t).toContain('{{+24 Attack}}');
    expect(t).not.toContain('+3 Attack');
  });

  it('a GOLDEN carrier adds to its DOUBLED base', () => {
    // Golden base is +6, so 6 + 12 = 18.
    expect(rallySpreadText('b2_sunmane', true, 12)).toContain('{{+18 Attack}}');
  });

  it('returns null for any other card', () => {
    expect(rallySpreadText('stray', false, 24)).toBeNull();
  });
});
