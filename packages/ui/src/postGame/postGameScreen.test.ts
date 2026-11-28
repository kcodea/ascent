/**
 * THE POST-GAME SCREEN (owner 2026-11-27, R-POSTGAME-01): the result's word by band, and how each seat's game ended on the scoreboard.
 */
import { describe, expect, it } from 'vitest';
import { BAND_WORD, seatOutcome } from './PostGameScreen';
import { resultBand } from '../locationReveal/locations';

describe('the post-game screen', () => {
  it('names the result in its band: Victory for 1st, Top Four for 2nd to 4th, Eliminated for the rest', () => {
    expect([1, 2, 4, 5, 8].map((p) => BAND_WORD[resultBand(p)])).toEqual(['Victory', 'Top Four', 'Top Four', 'Eliminated', 'Eliminated']);
    for (const w of Object.values(BAND_WORD)) expect(w).not.toMatch(/—/); // no em dash in player text
  });
  it('the scoreboard says how each seat ended: the crown, the round it went out, or its health while still standing', () => {
    const lost = { eliminated: true, endRound: 9, placement: 5 };
    expect(seatOutcome({ self: true, health: 0, armor: 0 }, lost)).toEqual({ kind: 'out', round: 9 });
    expect(seatOutcome({ self: true, eliminatedRound: 8, health: 0, armor: 0 }, lost)).toEqual({ kind: 'out', round: 8 });
    expect(seatOutcome({ self: true, health: 12, armor: 0 }, { eliminated: false, endRound: 14, placement: 1 })).toEqual({ kind: 'won' });
    expect(seatOutcome({ placement: 1, health: 7, armor: 0 }, lost)).toEqual({ kind: 'won' });
    expect(seatOutcome({ placement: 6, eliminatedRound: 6, health: 0, armor: 0 }, lost)).toEqual({ kind: 'out', round: 6 });
    expect(seatOutcome({ health: 22, armor: 4 }, lost)).toEqual({ kind: 'in', health: 22, armor: 4 });
  });
});
