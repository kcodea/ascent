// @vitest-environment jsdom
/**
 * R-TIMER-ESC-01: THE ESC / SETTINGS MENU PAUSES THE SHOP TIMER (owner 2026-09-29: "yes, lets have it pause the
 * shop timer for now"), like the Compendium, Career and bug reporter already did.
 *
 * Pins the gate (`turnClockMayTick` holds while the store's `settingsOpen` is true in the Shop and resumes the
 * moment it closes), and the wiring (Recruit feeds `settingsOpen` into the countdown gate and its effect deps,
 * but NOT into `overlayOpen`, which would also pause the combat replay: the ruling covers only the Shop clock).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { turnClockMayTick } from './turnClock';
import { useGame } from './store';

const shopTurn = {
  recruitPhase: true, decisionOpen: false, heroSelecting: false, overlayOpen: false, introPlaying: false,
  transitionPlaying: false, startOfTurnPlaying: false,
};
const gate = (): boolean => turnClockMayTick({ ...shopTurn, settingsOpen: useGame.getState().settingsOpen });

describe('R-TIMER-ESC-01: the Esc menu holds the Shop clock', () => {
  afterEach(() => { useGame.getState().closeSettings(); });

  it('ticks in the Shop with the menu closed, holds while it is open, and resumes when it closes', () => {
    expect(gate(), 'menu closed: the clock runs').toBe(true);
    useGame.getState().openSettings();
    expect(useGame.getState().settingsOpen).toBe(true);
    expect(gate(), 'menu open: the clock is held').toBe(false);
    useGame.getState().closeSettings();
    expect(gate(), 'menu closed again: the clock resumes').toBe(true);
  });

  it('a caller that predates the flag keeps its old answer', () => {
    expect(turnClockMayTick(shopTurn)).toBe(true);
  });

  it('Recruit wires settingsOpen into the countdown gate only, not into overlayOpen', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Recruit.tsx'), 'utf8');
    expect(src).toContain('const settingsOpen = useGame((s) => s.settingsOpen);');
    const call = src.slice(src.indexOf('if (!turnClockMayTick({'), src.indexOf('})) return;', src.indexOf('if (!turnClockMayTick({')));
    expect(call, 'the countdown gate receives the menu flag').toMatch(/\bsettingsOpen,/);
    expect(src, 'the countdown effect re-runs when the menu flips').toMatch(/overlayOpen, settingsOpen, introPlaying, run\.wave/);
    const overlayLine = src.split('\n').find((l) => l.includes('const overlayOpen = useGame('))!;
    expect(overlayLine, 'overlayOpen (which also pauses combat) stays menu-free').not.toContain('settingsOpen');
  });
});
