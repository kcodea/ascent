// @vitest-environment jsdom
/**
 * THE HALL OF CHAMPIONS, HIDDEN (owner 2026-10-16: "can you hide the hall of champions for now?"). With the shipped
 * `HALL_VISIBLE = false` (hallFlag.ts): no Hall plaque on the side menu, and every way of asking for the Hall lands on
 * the player Leaderboard instead. The screen itself is untouched (ladderPages.test still renders it directly).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from './renderedText.mount';

vi.mock('./remoteBoards', async (importOriginal) => ({ ...(await importOriginal<typeof import('./remoteBoards')>()), remoteEnabled: () => false }));

import { HALL_VISIBLE } from './hallFlag';
import { Rankings } from './Rankings';
import { useGame } from './store';

const CLOSED = { showRankings: false, showLeaderboard: false, showRecentGames: false, showCareer: false, careerOf: null } as const;
let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; useGame.setState(CLOSED); });

describe('the Hall of Champions is hidden', () => {
  it('ships hidden', () => { expect(HALL_VISIBLE).toBe(false); });

  it('has no plaque on the side menu', () => {
    useGame.setState({ ...CLOSED, showRankings: true });
    ui = mount(<Rankings />);
    const labels = [...ui.container.querySelectorAll('.msb .sbbtn')].map((b) => (b.textContent ?? '').trim());
    expect(labels).not.toContain('Hall of Champions');
    expect(labels).toContain('Leaderboard');
  });

  it('a request for the Hall (goTo or openLeaderboard) opens the Leaderboard instead', () => {
    useGame.setState(CLOSED);
    useGame.getState().goTo('hall');
    expect(useGame.getState().showLeaderboard).toBe(false);
    expect(useGame.getState().showRankings).toBe(true);
    useGame.setState(CLOSED);
    useGame.getState().openLeaderboard();
    expect(useGame.getState().showLeaderboard).toBe(false);
    expect(useGame.getState().showRankings).toBe(true);
  });
});
