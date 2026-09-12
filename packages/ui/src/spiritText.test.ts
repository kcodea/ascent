import { describe, it, expect } from 'vitest';
import { spiritText, stepProgress } from './cardText';

/**
 * SET 3 SPIRITS — the live line (the hard rule: a scaling card prints its CURRENT number on every surface).
 * One helper serves both chains; these pin the numbers it prints against the engine's rules.
 */
describe('spiritText — the Spirits print what they do now', () => {
  it('the Revelers print the shared value (golden 2X); at the base the printed text stands', () => {
    expect(spiritText('sp3_flamereveler', false, { revelerX: 1 })).toBeNull();
    expect(spiritText('sp3_flamereveler', false, { revelerX: 4 })).toContain('{{+4 Attack}}');
    expect(spiritText('sp3_tidereveler', false, { revelerX: 4 })).toContain('{{+4 Health}}');
    expect(spiritText('sp3_grovereveler', false, { revelerX: 4 })).toContain('{{+4/+4}}');
    expect(spiritText('sp3_flamereveler', true, { revelerX: 4 })).toContain('{{+8 Attack}}');
    expect(spiritText('sp3_flamereveler', true, { revelerX: 1 }), 'golden base is 2, the printed golden text').toBeNull();
  });

  it('Festival Luminary prints +(1 + X) on both stats', () => {
    expect(spiritText('sp3_luminary', false, { revelerX: 1 })).toContain('{{+2/+2}}');
    expect(spiritText('sp3_luminary', false, { revelerX: 3 })).toContain('{{+4/+4}}');
    expect(spiritText('sp3_luminary', true, { revelerX: 3 })).toContain('{{+8/+8}}');
  });

  it('Festival Keeper never prints a fraction (its tracker is the step counter); Aspect prints its live grant only; Forest Colossus its count', () => {
    // Owner ruling 2026-09-11: trackers like Festival Keeper's use the Avenge-style step counter, never the text.
    expect(spiritText('sp3_festivalkeeper', false, { spiritTally: 0 })).toBeNull();
    expect(spiritText('sp3_festivalkeeper', false, { spiritTally: 2 })).toBeNull();
    expect(spiritText('sp3_festivalkeeper', false, { spiritTally: 3 })).toBeNull();
    expect(stepProgress('sp3_festivalkeeper', { spiritTally: 0 })).toEqual({ current: 0, total: 3 });
    expect(stepProgress('sp3_festivalkeeper', { spiritTally: 2 })).toEqual({ current: 2, total: 3 });
    expect(stepProgress('sp3_festivalkeeper', { spiritTally: 3 })).toEqual({ current: 3, total: 3 });
    expect(stepProgress('sp3_festivalkeeper', { spiritTally: 4 }), 'wraps after a payout, Avenge-style').toEqual({ current: 1, total: 3 });
    expect(spiritText('sp3_aspect', false, { spiritTally: 0 }), 'base grant, base text').toBeNull();
    expect(spiritText('sp3_aspect', false, { spiritTally: 2 }), 'no countdown in the text any more').toBeNull();
    expect(spiritText('sp3_aspect', false, { spiritTally: 3 })).toContain('{{+2/+2}}');
    expect(spiritText('sp3_aspect', false, { spiritTally: 3 })).not.toContain('more');
    expect(stepProgress('sp3_aspect', { spiritTally: 2 })).toEqual({ current: 2, total: 3 });
    expect(spiritText('sp3_forestcolossus', false, { spiritTally: 2, onBoard: true })).toContain('{{+2/+2}}');
    expect(spiritText('sp3_forestcolossus', false, { spiritTally: 2, onBoard: false }), 'in the shop it has counted nothing yet').toBeNull();
  });

  it('Nurturer and Kindled Sprite read the Spirits played this turn', () => {
    expect(spiritText('sp3_nurturer', false, { spiritsPlayed: 0 })).toBeNull();
    expect(spiritText('sp3_nurturer', false, { spiritsPlayed: 2 })).toContain('{{(×3)}}');
    expect(spiritText('sp3_kindled', false, { spiritsPlayed: 3 })).toContain('{{+3 Attack}}');
    expect(spiritText('sp3_kindled', true, { spiritsPlayed: 3 })).toContain('{{+6 Attack}}');
  });
});
