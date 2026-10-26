// @vitest-environment jsdom
/**
 * VERSUS DUOS — THE TEAMMATE VIEW HOLDS UNTIL THE TURN IS OVER (owner 2026-10-25: "don't force the player back from the
 * teammate view until the turn is 'over.' it currently forces back at the 5s mark i think?"; R-DUOS-VIEW-01).
 *  - no return at a clock mark (the old under-5-seconds return is gone), nor while the round resolves;
 *  - back to my board when the fight starts (or the match ends / pauses);
 *  - 0:00 while watching locks MY set-aside run, never the teammate's run on screen;
 *  - the manual way back still works.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunState } from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const leave = vi.fn();
let ownRun: RunState | null = null;
vi.mock('./spectate', async (orig) => ({
  ...(await orig<typeof import('./spectate')>()),
  leaveTeammate: (...a: unknown[]) => leave(...a),
  ownRunWhileWatching: () => ownRun,
}));

const { useGame } = await import('../store');
const { useSpectate } = await import('./spectate');
const { expireVersusShop, teammateViewReturns } = await import('./versusStore');
const view = await import('./teammateView');

afterEach(() => { ownRun = null; leave.mockReset(); useSpectate.setState({ teammate: false }); vi.unstubAllGlobals(); });

describe('R-DUOS-VIEW-01: the teammate view holds until the turn is over', () => {
  it('no return during the shop, whatever my clock reads (no 5 s return), nor while the round resolves', () => {
    expect(teammateViewReturns({ phase: 'shop', paused_at: null })).toBe(false);
    expect(teammateViewReturns({ phase: 'resolving', paused_at: null })).toBe(false);
  });

  it('back to my board when the fight starts, the match ends, or it pauses', () => {
    expect(teammateViewReturns({ phase: 'combat', paused_at: null })).toBe(true);
    expect(teammateViewReturns({ phase: 'complete', paused_at: null })).toBe(true);
    expect(teammateViewReturns({ phase: 'shop', paused_at: '2026-10-25T12:00:00Z' })).toBe(true);
  });

  it('0:00 while watching never touches the run on screen (the teammate\'s); my own turn is the one that locks', () => {
    const screen = { ...useGame.getState().run, mode: 'versus', phase: 'recruit', runId: 'spectate:m:p2' } as RunState;
    ownRun = { ...screen, runId: 'mine' } as RunState;
    useGame.setState({ run: screen, replaying: true });
    expireVersusShop();
    expect(useGame.getState().run).toBe(screen);
    expect(useGame.getState().run.shopClockExpired).toBeFalsy();
    useGame.setState({ replaying: false });
  });

  it('the manual way back still works (the portrait / Esc path)', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    useSpectate.setState({ teammate: true });
    view.exitTeammateView();
    expect(leave).toHaveBeenCalledTimes(1);
  });
});
