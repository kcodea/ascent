/**
 * CONTENT OVERLAYS — a candidate data patch applied in-process, validated, and visible in the identity.
 * Each test overlays a DIFFERENT card (an overlay applies once per process) and never a card another balance test
 * relies on numerically.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { applyContentOverlay } from './overlay';
import { contentDigestFor } from './identity';

describe('content overlays (balance:compare candidates)', () => {
  it('patches stats and per-effect params on the LIVE def, and the content digest moves', () => {
    const before = contentDigestFor('set3');
    const d = CARD_INDEX['ce3_starseed']!;
    const p0 = d.effects[0]!.params as { attack: number; health: number };
    expect([p0.attack, p0.health]).toEqual([4, 4]);
    const diff = applyContentOverlay({ ce3_starseed: { health: 2, params: { '0': { attack: 2, health: 2 } } } });
    expect(diff).toHaveLength(1);
    expect(CARD_INDEX['ce3_starseed']!.health).toBe(2);
    expect((CARD_INDEX['ce3_starseed']!.effects[0]!.params as { attack: number }).attack).toBe(2);
    expect(contentDigestFor('set3')).not.toBe(before);
    expect(diff[0]!.after).toContain('"attack":2');
  });
  it('refuses an unknown card, a bad effect index, an invalid result, and a second application', () => {
    expect(() => applyContentOverlay({ nope_card: { attack: 1 } })).toThrow(/unknown card/);
    expect(() => applyContentOverlay({ ce3_courier: { params: { '9': { attack: 1 } } } })).toThrow(/no effect at index/);
    expect(() => applyContentOverlay({ ce3_vendor: { tier: 99 } })).toThrow(); // the content schema rejects it
    applyContentOverlay({ ce3_seer: { attack: 4 } });
    expect(() => applyContentOverlay({ ce3_seer: { attack: 5 } })).toThrow(/already overlaid/);
  });
  it('an empty overlay is a no-op', () => {
    expect(applyContentOverlay(undefined)).toEqual([]);
  });
});
