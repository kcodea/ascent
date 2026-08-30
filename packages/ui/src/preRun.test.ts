import { describe, expect, it } from 'vitest';
import { isPreRun } from './store';

/**
 * "No active game should be displayed or happening until the player actually enters a lobby"
 * (owner ruling 2026-08-30, reporting that pressing Practice flashed the board).
 *
 * The bug was that `showTitle: false` was read as "a run is on screen" when it only means "the title is
 * closed". Every case below is a state where the title is DOWN and no run has been entered — which is
 * precisely the gap the board used to paint in.
 */
describe('the board is gated on actually being in a run', () => {
  const base = { showTitle: false, heroChoices: null, practiceSetupOpen: false };

  it('is pre-run at the title', () => {
    expect(isPreRun({ ...base, showTitle: true })).toBe(true);
  });

  it('is pre-run on the Practice options screen — the reported flash', () => {
    // startPractice sets exactly this: title down, options up, no run entered.
    expect(isPreRun({ ...base, practiceSetupOpen: true })).toBe(true);
  });

  it('is pre-run in the hero picker, however the player got there', () => {
    // startAscent / startRift / startLobby all drop showTitle and roll hero choices.
    expect(isPreRun({ ...base, heroChoices: ['albus', 'warden'] })).toBe(true);
    expect(isPreRun({ ...base, heroChoices: [] })).toBe(true);   // empty !== absent
  });

  it('is NOT pre-run once a hero is picked and the run is live', () => {
    // pickHero clears heroChoices and leaves showTitle false — the only state that shows the board.
    expect(isPreRun(base)).toBe(false);
  });
});
