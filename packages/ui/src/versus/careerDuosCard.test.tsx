// @vitest-environment jsdom
/**
 * The Career's Ranked Duos card (owner 2026-10-29: "make the ranked duos look like the solo rank, and put it above the
 * performance trends. show 1 team at a time with an arrow to scroll duos teams, sorted by highest rank"):
 *  - it is the SAME rank card as Seasonal Ranked (`.cv2-panel.cv2-ranked`, the big crest, "N MMR");
 *  - one team at a time, best rank first (division, then points), with Previous / Next arrows that wrap;
 *  - one team: no arrows; no teams: no card.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../remoteBoards', async (orig) => ({ ...(await orig<typeof import('../remoteBoards')>()), remoteEnabled: () => true }));

const { mount } = await import('../renderedText.mount');
const { clearSocialCache } = await import('../socialCache');
const { versusRemote } = await import('./versusRemote');
const { CareerDuosTeams, sortDuosTeams } = await import('./DuosBoards');
type Row = import('./versusRemote').DuosTeamOfRow;

const card = (userId: string, name: string) => ({ userId, name, discriminator: null, hero: null } as unknown as Row['partner']);
const row = (teamId: string, division: number, points: number, name: string | null, partner: string, games = 3): Row =>
  ({ teamId, name, partner: card(`u-${partner}`, partner), division, points, games });

const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };

afterEach(() => { clearSocialCache(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('Career Ranked Duos card', () => {
  it('sorts teams by division, then points', () => {
    const sorted = sortDuosTeams([row('a', 2, 90, null, 'Ann'), row('b', 5, 10, null, 'Bo'), row('c', 5, 60, null, 'Cy')]);
    expect(sorted.map((t) => t.teamId)).toEqual(['c', 'b', 'a']);
  });

  it('shows the best team in the solo rank card, and the arrows step through the teams and wrap', async () => {
    vi.spyOn(versusRemote, 'duosTeamsOf').mockResolvedValue([
      row('low', 1, 40, 'Low Team', 'Ann', 1),
      row('top', 6, 20, 'Top Team', 'Bo', 12),
      row('mid', 3, 70, null, 'Cy'),
    ]);
    const m = mount(<CareerDuosTeams userId="me" />);
    await flush();
    const panel = m.container.querySelector('.cv2-panel.cv2-ranked.cv2-duocard');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector('.rankcrest-big')).not.toBeNull();
    expect(panel!.textContent).toMatch(/\d+ MMR/);
    const name = () => m.container.querySelector('.cv2-duocard-name')!.textContent;
    expect(name()).toBe('Top Team');
    expect(m.container.querySelector('.cv2-duocard-sub')!.textContent).toBe('With Bo · 12 games');
    expect(m.container.querySelector('.cv2-duocard-count')!.textContent).toBe('1 of 3');
    const next = m.container.querySelector<HTMLButtonElement>('button[aria-label="Next team"]')!;
    const prev = m.container.querySelector<HTMLButtonElement>('button[aria-label="Previous team"]')!;
    expect(next.getAttribute('title')).toBeNull();
    act(() => { next.click(); });
    expect(name()).toBe('With Cy');
    act(() => { next.click(); });
    expect(name()).toBe('Low Team');
    act(() => { next.click(); });
    expect(name()).toBe('Top Team');
    act(() => { prev.click(); });
    expect(name()).toBe('Low Team');
    act(() => { next.click(); next.click(); }); // two quick presses are two steps
    expect(name()).toBe('With Cy');
    m.unmount();
  });

  it('one team: no arrows; no teams: no card', async () => {
    const spy = vi.spyOn(versusRemote, 'duosTeamsOf').mockResolvedValue([row('only', 2, 10, 'Solo Pair', 'Ann')]);
    const m = mount(<CareerDuosTeams userId="me" />);
    await flush();
    expect(m.container.querySelector('.cv2-duocard')).not.toBeNull();
    expect(m.container.querySelector('.cv2-duocard-arrow')).toBeNull();
    m.unmount();
    clearSocialCache();
    spy.mockResolvedValue([]);
    const m2 = mount(<CareerDuosTeams userId="me" />);
    await flush();
    expect(m2.container.querySelector('.cv2-duocard')).toBeNull();
    m2.unmount();
  });
});
