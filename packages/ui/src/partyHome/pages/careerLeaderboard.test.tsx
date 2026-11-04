// @vitest-environment jsdom
/**
 * THE CAREER + LEADERBOARD ON THE APP SHELL (party home prototype, DEV only). Renders PhCareer and PhLeaderboard from
 * fixture props and pins: the shared PhPage head (same heading for every page), the five Career views as tabs (Trends
 * now a tab), every profile number still on the page, the Heroes grid opening a hero's games, the Leaderboard podium in
 * 2nd / 1st / 3rd order with every row opening that player's Career, your row marked, your standing pinned when you are
 * off the board; and that production never loads either view (lazy behind `import.meta.env.DEV`). Plus the UI rules:
 * no native tooltips, no bare cursor, no looping animation, no em dash / Oath / climb in player text.
 */
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mount } from '../../renderedText.mount';
import { PhCareer, type PhCareerProps } from './career/PhCareer';
import { PhLeaderboard, teamLabel, type PhLeaderboardProps } from './leaderboard/PhLeaderboard';
import type { DuosLeaderboardRow } from '../../versus/versusRemote';
import type { RankedRow } from '../../Rankings';
import type { HeroCareer } from '../../careerData';

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
const here = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

const hero = (heroId: string, runs: number): HeroCareer => ({ heroId, runs, winRate: 50, avgPlacement: 4.2, netMmr: 12, ratedGames: 2 } as unknown as HeroCareer);

const VIEW: PhCareerProps['history']['view'] = {
  label: 'Match history', selected: 'r1', onPick: vi.fn(),
  items: [{ key: 'r1', place: 3, band: 'top4', title: 'Orangez', sub: 'Robin', delta: 6, label: '3rd, Robin' }],
  detail: { place: 3, who: 'Orangez', heroName: 'Robin', record: '7-7', recordTone: 'up', rank: null, facts: [], match: null, own: false, skins: null, runes: [], replay: null },
};

function careerProps(over: Partial<PhCareerProps> = {}): PhCareerProps {
  return {
    own: false, name: 'Orangez', title: null, addFriend: null, pageState: null, profileArt: undefined, favoriteHero: 'Robin',
    accountLevel: null, level: 157,
    stats: { games: 141, firsts: 66, top4Pct: 74, losses: 37, avgPlacement: 3, tribe: 'Demon' },
    rank: <div className="rk">rank</div>, duos: null,
    tab: 'history', onTab: vi.fn(), achievementsOn: true, tabSub: 'Last 50 runs',
    history: { filter: null, state: null, view: VIEW },
    heroes: { list: [hero('robin', 13), hero('albus', 3)], sort: 'games', onSort: vi.fn(), onPick: vi.fn(), art: () => undefined, state: null },
    trends: { window: 30, onWindow: vi.fn(), body: <div className="charts">charts</div> },
    practice: { state: null, view: null },
    achievements: null,
    ...over,
  };
}

const row = (i: number, over: Partial<RankedRow> = {}): RankedRow => ({
  userId: `u${i}`, author: `Player${i}`, discriminator: String(1000 + i), rating: 2000 - i * 100, gamesPlayed: 50 - i,
  favoriteHero: 'robin', rank: undefined, ...over,
} as RankedRow);

function boardProps(over: Partial<PhLeaderboardProps> = {}): PhLeaderboardProps {
  return {
    rows: [1, 2, 3, 4, 5].map((i) => row(i)), rowsShown: 10, remote: true, versusOn: true, board: 'solo', onBoard: vi.fn(),
    myId: null, myName: 'Me', myDisc: '0001', myRank: null, myAvatar: null, myLoadout: null, showOpp: false, onOpen: vi.fn(), onRetry: vi.fn(), ...over,
  };
}

describe('Career on the app shell', () => {
  it('uses the shared page head and offers every view as a tab, Trends included', () => {
    const m = mount(<PhCareer {...careerProps()} />);
    expect(m.container.querySelector('.phk-pagehead h1')?.textContent).toBe('Orangez');
    expect(m.container.querySelector('.phk-eyebrow')?.textContent).toBe('Career');
    const tabs = [...m.container.querySelectorAll('.phk-pagetabs [role=tab]')].map((t) => t.textContent);
    expect(tabs).toEqual(['Match History', 'Heroes', 'Trends', 'Practice', 'Achievements']);
    m.unmount();
  });
  it('shows the name in its own case (no forced capitals in the markup)', () => {
    const m = mount(<PhCareer {...careerProps({ name: 'VerdantBear35' })} />);
    expect(m.container.querySelector('.phk-pagehead h1')?.textContent).toBe('VerdantBear35');
    m.unmount();
  });
  it('keeps every profile number: level, the six career stats, the rank card', () => {
    const m = mount(<PhCareer {...careerProps()} />);
    const text = m.container.textContent ?? '';
    for (const s of ['157', 'Favorite hero', 'Robin', '141', '66', '74%', '37', 'Demon', 'Seasonal Ranked', 'rank']) expect(text).toContain(s);
    expect(m.container.querySelector('.rgp-item')?.textContent).toContain('+6'); // Recent Games' row, with the rating change
    expect(m.container.querySelector('.rgp-banner')).not.toBeNull();
    m.unmount();
  });
  it('a hero card opens that hero’s games; the sort and the trend window reach their handlers', () => {
    const p = careerProps({ tab: 'heroes' });
    const m = mount(<PhCareer {...p} />);
    const cards = m.container.querySelectorAll<HTMLButtonElement>('.phc-hero');
    expect(cards).toHaveLength(2);
    act(() => { cards[0]!.click(); });
    expect(p.heroes.onPick).toHaveBeenCalledWith('robin');
    act(() => { [...m.container.querySelectorAll<HTMLButtonElement>('.phk-segbtn')].find((b) => b.textContent === 'Net MMR')!.click(); });
    expect(p.heroes.onSort).toHaveBeenCalledWith('mmr');
    m.render(<PhCareer {...p} tab="trends" />);
    expect(m.container.querySelector('.charts')).not.toBeNull();
    act(() => { [...m.container.querySelectorAll<HTMLButtonElement>('.phk-segbtn')].find((b) => b.textContent === '7d')!.click(); });
    expect(p.trends.onWindow).toHaveBeenCalledWith(7);
    m.unmount();
  });
  it('a whole-page state replaces the grid and keeps its one action', () => {
    const onClick = vi.fn();
    const m = mount(<PhCareer {...careerProps({ pageState: { title: 'Sign in to see your career', body: 'x', action: { label: 'Sign in', onClick } } })} />);
    expect(m.container.querySelector('.phc-grid')).toBeNull();
    act(() => { [...m.container.querySelectorAll('button')].find((b) => b.textContent === 'Sign in')!.click(); });
    expect(onClick).toHaveBeenCalled();
    m.unmount();
  });
});

describe('Leaderboard on the app shell', () => {
  it('stands the top three as a podium (2nd, 1st, 3rd) and lists the rest; every row opens that career', () => {
    const p = boardProps();
    const m = mount(<PhLeaderboard {...p} />);
    expect(m.container.querySelector('.phk-pagehead h1')?.textContent).toBe('Leaderboard');
    const pods = [...m.container.querySelectorAll('.phl-pod')].map((e) => e.querySelector('.phl-podname')?.textContent);
    expect(pods).toEqual(['Player2#1002', 'Player1#1001', 'Player3#1003']);
    const rows = m.container.querySelectorAll<HTMLButtonElement>('.phl-row .phl-rowbtn');
    expect(rows).toHaveLength(2);
    act(() => { rows[0]!.click(); });
    expect(p.onOpen).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u4' }));
    m.unmount();
  });
  it('marks your row, or pins your standing when you are off the board', () => {
    const m = mount(<PhLeaderboard {...boardProps({ myId: 'u5' })} />);
    // Marked by the highlight plate alone: no "You" chip (owner rule).
    expect(m.container.querySelector('.phl-row.me')).not.toBeNull();
    expect(m.container.querySelector('.phk-chip')).toBeNull();
    expect(m.container.querySelector('.phl-mepin')).toBeNull();
    m.render(<PhLeaderboard {...boardProps({ myId: 'zz', myRank: { divisionIndex: 3, points: 40 } })} />);
    expect(m.container.querySelector('.phl-mepin')?.textContent).toContain('Outside the top 10');
    m.unmount();
  });
  it('names a Duos team without "Player & Player": its name, its players, or an unnamed team', () => {
    const team = (name: string | null, a: string | null, b: string | null): DuosLeaderboardRow => ({
      teamId: 't', name, division: 0, points: 0, demotionReady: false, games: 3,
      players: [a ? { userId: 'a', name: a } : null, b ? { userId: 'b', name: b } : null],
    } as unknown as DuosLeaderboardRow);
    expect(teamLabel(team(null, null, null))).toEqual({ name: 'Unnamed team', sub: '3 games' });
    expect(teamLabel(team('hilton hotels', null, null)).name).toBe('hilton hotels');
    expect(teamLabel(team(null, 'Ann', null)).name).toBe('Ann and a partner');
    expect(teamLabel(team(null, 'Ann', 'Bo')).sub).toBe('Ann and Bo');
  });
  it('says "Top players" when the board holds fewer than its size', () => {
    const m = mount(<PhLeaderboard {...boardProps()} />);
    expect(m.container.querySelector('.phl-count')?.textContent).toBe('Top players by MMR');
    m.unmount();
  });
  it('an empty or failed read shows the framed "not available right now" panel with Retry, never "no players yet"', () => {
    const p = boardProps({ rows: [] });
    const m = mount(<PhLeaderboard {...p} />);
    expect(m.container.textContent).toContain('not available right now');
    expect(m.container.textContent).not.toMatch(/no ranked players/i);
    act(() => { [...m.container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!.click(); });
    expect(p.onRetry).toHaveBeenCalled();
    m.unmount();
  });
  it('switches Solo / Duos through its tabs', () => {
    const p = boardProps();
    const m = mount(<PhLeaderboard {...p} />);
    act(() => { [...m.container.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((b) => b.textContent === 'Duos')!.click(); });
    expect(p.onBoard).toHaveBeenCalledWith('duos');
    m.unmount();
  });
});

describe('shell pages: production and UI rules', () => {
  it('production never loads either view (lazy, DEV only)', () => {
    expect(here('../../Career.tsx')).toMatch(/import\.meta\.env\.DEV \? lazy\(\(\) => import\('\.\/partyHome\/pages\/career\/PhCareer'\)/);
    expect(here('../../Rankings.tsx')).toMatch(/import\.meta\.env\.DEV \? lazy\(\(\) => import\('\.\/partyHome\/pages\/leaderboard\/PhLeaderboard'\)/);
  });
  it('no native tooltips, no own cursor, nothing loops, no em dash / Oath / climb in player text', () => {
    const tsx = [here('./career/PhCareer.tsx'), here('./leaderboard/PhLeaderboard.tsx')].join('\n');
    const css = [here('./career/phCareer.css'), here('./leaderboard/phLeaderboard.css')].join('\n');
    expect(tsx).not.toMatch(/<[a-z][a-z0-9]*\s[^>]*\stitle=/);
    expect(css).not.toMatch(/cursor:/);
    expect(css).not.toMatch(/infinite/);
    const strings = [...tsx.matchAll(/'([^'\n]*)'/g), ...tsx.matchAll(/>([^<>{}\n]+)</g)].map((x) => x[1] ?? '');
    for (const s of strings) { expect(s).not.toMatch(/—|\s--\s/); expect(s).not.toMatch(/\b(Oath|climb)\b/i); }
  });
});
