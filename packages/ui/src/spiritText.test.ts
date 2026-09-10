import { describe, it, expect } from 'vitest';
import { spiritText } from './cardText';

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

  it('Festival Keeper shows progress toward the next spell; Aspect its grant and countdown; Forest Colossus its count', () => {
    expect(spiritText('sp3_festivalkeeper', false, { spiritTally: 0 })).toBeNull();
    expect(spiritText('sp3_festivalkeeper', false, { spiritTally: 2 })).toContain('{{2/3}}');
    expect(spiritText('sp3_festivalkeeper', false, { spiritTally: 3 }), 'just paid — back to the base').toBeNull();
    expect(spiritText('sp3_aspect', false, { spiritTally: 0 })).toContain('{{+1/+1}}');
    expect(spiritText('sp3_aspect', false, { spiritTally: 2 })).toContain('{{1}} more');
    expect(spiritText('sp3_aspect', false, { spiritTally: 3 })).toContain('{{+2/+2}}');
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
