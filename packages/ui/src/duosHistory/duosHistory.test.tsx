// @vitest-environment jsdom
/**
 * DUOS MATCH HISTORY (owner 2026-10-29, R-DUOS-HISTORY-01): Recent Games' DUOS tab over a mocked read. Pins: the tab
 * reads only when picked, and only YOUR games (by your user id); each list row is your team's placement ("2nd" banded as
 * a good finish of 4, a loss of 2), your team name (or the mode), your hero with your teammate, the rank it was played at
 * and the points it moved; the detail card shows your board AND your teammate's, the lobby grouped by team with every
 * team's place and fate, and picking a player shows their board alone until "Back to yours". Plus the pure record parser,
 * builder, fit and view helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { ALL_CARDS } from '@game/content';
import { HEROES, buildDuosHistory, duosBoardOfSide, duosBoardOfSnapshot, fitDuosHistory, parseDuosHistory, type DuosHistoryRecord } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const fetchMyDuosGames = vi.fn<(id: string | null | undefined) => Promise<unknown>>();
vi.mock('./duosHistoryData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./duosHistoryData')>()),
  fetchMyDuosGames: (id: string | null | undefined) => fetchMyDuosGames(id),
}));
vi.mock('../remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../remoteBoards')>()),
  remoteEnabled: () => true,
  fetchRecentGames: async () => [],
  fetchPracticeGames: async () => [],
}));

import { RecentGames } from '../RecentGames';
import { useGame } from '../store';
import { clearSocialCache } from '../socialCache';
import { asDuosGameRow, duosBand, duosGameView, teamPlaceText, type DuosGameRow } from './duosHistoryData';

const ME = 'me-1';
const MATE = 'mate-2';
const MINIONS = ALL_CARDS.filter((c) => !c.token).slice(0, 7).map((c) => c.id);
const H = HEROES.slice(0, 8).map((h) => h.id);
const board = (n: number, round: number) => ({ round, tier: 3, minions: MINIONS.slice(0, n).map((cardId, i) => ({ cardId, attack: i + 1, health: i + 2 })) });

const ranked: DuosHistoryRecord = buildDuosHistory({
  mode: 'ranked_duos', endRound: 9, startedAt: '2026-10-29T10:00:00Z', endedAt: '2026-10-29T10:21:00Z',
  teams: [
    { team: 'a', kind: 'live', name: 'CITRUS', placement: 2, outRound: 9, members: [
      { seat: 'p1', userId: ME, name: 'Kev', heroId: H[0]!, board: board(5, 9) },
      { seat: 'p2', userId: MATE, name: 'Lemon', heroId: H[1]!, board: board(3, 9) },
    ] },
    { team: 'b', kind: 'duo', name: 'Goats', placement: 1, members: [{ seat: 'b0', name: 'Ann', heroId: H[2]!, board: board(7, 9) }, { seat: 'b1', name: 'Bob', heroId: H[3]!, board: board(6, 9) }] },
    { team: 'c', kind: 'pair', placement: 3, outRound: 7, members: [{ seat: 'c0', name: 'Cy', heroId: H[4]!, board: board(2, 7) }, { seat: 'c1', name: 'Di', heroId: H[5]!, board: null }] },
    { team: 'd', kind: 'generated', placement: 4, outRound: 5, members: [{ seat: 'd0', name: 'Ed', heroId: H[6]!, board: board(1, 5) }, { seat: 'd1', name: 'Flo', heroId: H[7]!, board: board(0, 5) }] },
  ],
});
const versus: DuosHistoryRecord = buildDuosHistory({
  mode: 'versus_duos', endRound: 6, startedAt: '2026-10-28T09:00:00Z', endedAt: '2026-10-28T09:12:00Z',
  teams: [
    { team: 'b', kind: 'live', placement: 1, members: [{ seat: 'p3', userId: 'x3', name: 'Gus', heroId: H[2]!, board: board(4, 6) }, { seat: 'p4', userId: 'x4', name: 'Hal', heroId: H[3]!, board: board(4, 6) }] },
    { team: 'a', kind: 'live', placement: 2, outRound: 6, members: [{ seat: 'p1', userId: ME, name: 'Kev', heroId: H[0]!, board: board(2, 6) }, { seat: 'p2', userId: 'x2', name: 'Ivy', heroId: H[1]!, board: board(1, 6) }] },
  ],
});
const ROWS: DuosGameRow[] = [
  asDuosGameRow({ match_id: 'm-ranked', mode: 'ranked_duos', started_at: '2026-10-29T10:00:00Z', completed_at: '2026-10-29T10:21:00Z', end_round: 9,
    rank: { divisionBefore: 4, pointsBefore: 50, divisionAfter: 4, pointsAfter: 61, delta: 11, promoted: false, demoted: false }, record: ranked })!,
  asDuosGameRow({ match_id: 'm-versus', mode: 'versus_duos', started_at: '2026-10-28T09:00:00Z', completed_at: '2026-10-28T09:12:00Z', end_round: 6, rank: null, record: versus })!,
];

let ui: Mounted;
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const text = (sel: string): string[] => [...ui.container.querySelectorAll(sel)].map((n) => (n.textContent ?? '').trim());
const click = (el: Element | null): void => { act(() => { (el as HTMLElement).click(); }); };

beforeEach(() => {
  clearSocialCache();
  fetchMyDuosGames.mockReset().mockResolvedValue(ROWS);
  (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = () => {};
  useGame.setState({ showRecentGames: false, account: { userId: ME, email: null, anonymous: true, discriminator: '4821' } });
});
afterEach(() => { ui?.unmount(); useGame.setState({ showRecentGames: false }); });

describe('the stored record (pure)', () => {
  it('parses back what it builds, and drops what it cannot read', () => {
    expect(parseDuosHistory(JSON.parse(JSON.stringify(ranked)))).toEqual(ranked);
    expect(parseDuosHistory({ v: 2, teams: [] })).toBeNull();
    expect(parseDuosHistory({ v: 1, teams: [{ nope: 1 }] })).toBeNull();
    // Table order: by team placement.
    expect(ranked.teams.map((t) => t.team)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('compacts a side and a snapshot to the card-render fields', () => {
    const side = { board: [{ cardId: 'abc', attack: 3, health: 4, uid: 'u1', buffs: [{ a: 1 }], golden: true, keywords: ['taunt'] }], state: { tier: 4 }, config: {} };
    expect(duosBoardOfSide(side, 6, ['r1'])).toEqual({ round: 6, tier: 4, minions: [{ cardId: 'abc', attack: 3, health: 4, golden: true, keywords: ['taunt'] }], runes: ['r1'] });
    expect(duosBoardOfSnapshot({ minions: [{ cardId: 'x', attack: 1, health: 1, text: 'long' }], tier: 2, runes: ['q'] }, 3)).toEqual({ round: 3, tier: 2, minions: [{ cardId: 'x', attack: 1, health: 1 }], runes: ['q'] });
    expect(duosBoardOfSide(null, 1)).toBeNull();
  });

  it('fits an oversized record by emptying recorded boards first, never the live players\'', () => {
    const fit = fitDuosHistory(ranked, JSON.stringify(ranked).length - 50);
    expect(fit.teams.find((t) => t.team === 'a')!.members.every((m) => (m.board?.minions.length ?? 0) > 0)).toBe(true);
    expect(fit.teams.some((t) => t.kind !== 'live' && t.members.some((m) => m.board && m.board.minions.length === 0))).toBe(true);
  });

  it('finds you and your teammate; bands a team placement by the table size', () => {
    const v = duosGameView(ranked, ME);
    expect([v.me?.name, v.mate?.name, v.place, v.teamCount]).toEqual(['Kev', 'Lemon', 2, 4]);
    expect(teamPlaceText(2, 4)).toBe('2nd of 4 teams');
    expect([duosBand(1, 4), duosBand(2, 4), duosBand(3, 4), duosBand(2, 2), duosBand(null, 2)]).toEqual(['won', 'top4', 'lost', 'lost', 'none']);
  });
});

describe('Recent Games — the DUOS tab', () => {
  beforeEach(async () => {
    useGame.setState({ showRecentGames: true });
    ui = mount(<RecentGames />);
    await flush();
  });
  const tabs = (): HTMLButtonElement[] => [...ui.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

  it('reads only when picked, and only your own games', async () => {
    expect(fetchMyDuosGames).not.toHaveBeenCalled();
    click(tabs()[2]!);
    await flush();
    expect(fetchMyDuosGames).toHaveBeenCalledWith(ME);
    expect(ui.container.querySelector('.lbsub')?.textContent).toBe('Your last 50 Duos games');
    expect(text('.gs-item .gs-place')).toEqual(['2nd', '2nd']);
    // 2nd of 4 is a good finish (green), 2nd of 2 the loss (red).
    expect([...ui.container.querySelectorAll('.gs-item')].map((n) => n.className.match(/gc-(\w+)/)![1])).toEqual(['top4', 'lost']);
    expect(text('.gs-item .gs-title')).toEqual(['CITRUS', 'Versus Duos']);
    expect(text('.gs-item .gs-sub')[0]).toContain('with Lemon');
    expect(text('.gs-item .gs-delta')).toEqual(['+11']);
    expect(ui.container.querySelectorAll('.gs-item .gamerank')).toHaveLength(1);
    expect(ui.container.querySelector('.hf-row, .hero-filter')).toBeNull(); // no hero chips on this tab
  });

  it('the detail card: both boards, the lobby by team, and a picked player\'s board alone', async () => {
    click(tabs()[2]!);
    await flush();
    const card = (): Element => ui.container.querySelector('.gs-detail .dh-card')!;
    expect(card().querySelector('.lb-row-record')?.textContent).toBe('2nd of 4 teams');
    expect(text('.gs-detail .dh-board-who')).toEqual(['You', 'Lemon']);
    expect(card().querySelectorAll('.dh-board')[0]!.querySelectorAll('.cv2-tile:not(.empty)')).toHaveLength(5);
    expect(card().querySelectorAll('.dh-board')[1]!.querySelectorAll('.cv2-tile:not(.empty)')).toHaveLength(3);
    expect(text('.gs-detail .dh-team-head .lp-chip-place')).toEqual(['1st', '2nd', '3rd', '4th']);
    expect(text('.gs-detail .dh-team-head .lp-tile-out')).toEqual(['Winner', 'Out R9', 'Out R7', 'Out R5']);
    expect(text('.gs-detail .dh-team-name')).toEqual(['Goats', 'CITRUS (your team)', 'Team', 'Team']);
    expect(text('.gs-detail .lb-fact-v')).toEqual(['Ranked Duos', '21 min', '9', '+11']);
    // Pick Ann (team Goats): her board alone, then Back to yours.
    const ann = [...card().querySelectorAll('.dh-tile')].find((b) => b.textContent?.includes('Ann'))!;
    click(ann);
    expect(text('.gs-detail .dh-board-who')).toEqual(['Ann']);
    expect(card().querySelector('.lp-showing-v')?.textContent).toContain("Ann's board, Goats");
    click(card().querySelector('.lp-back'));
    expect(text('.gs-detail .dh-board-who')).toEqual(['You', 'Lemon']);
    // The Versus Duos game: 2 teams, no rank, no points.
    click(ui.container.querySelectorAll('.gs-item')[1]!);
    expect(card().querySelector('.lb-row-record')?.textContent).toBe('2nd of 2 teams');
    expect(text('.gs-detail .lb-fact-v')).toEqual(['Versus Duos', '12 min', '6']);
    expect(text('.gs-detail .dh-board-who')).toEqual(['You', 'Ivy']);
  });

  it('no games yet: a designed empty state', async () => {
    fetchMyDuosGames.mockResolvedValue([]);
    click(tabs()[2]!);
    await flush();
    expect(ui.container.querySelector('.lbempty')?.textContent).toContain('No Duos games yet');
  });
});
