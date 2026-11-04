/**
 * @vitest-environment jsdom
 *
 * RECENT GAMES + LIVE GAMES under the party home's app shell (DEV switch "Party home (prototype)", owner 2026-11-02):
 * the kit pages render every piece of the classic page's data (the strip, the hero filter, the history, the open game's
 * banner, facts, board, runes and Replay / Career; the live list's rank, game, watchers and Watch), wire the same
 * handlers, and gate on the switch so production never draws them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HEROES } from '@game/sim';
import { mount, type Mounted } from '../../renderedText.mount';
import { RecentGamesPh, placeWords, type KeyedRow, type RecentGamesPhProps } from './RecentGamesPh';
import { LiveGamesPh, liveCountText, liveRowNames, type LiveGamesPhProps } from './LiveGamesPh';
import type { RecentGameRow } from '../../remoteBoards';
import type { LiveGameRow } from '../../live/liveRemote';
import { LIVE_PAGE } from '../../live/liveRemote';

const lobbyRead = vi.hoisted(() => ({ hang: false }));
vi.mock('../../remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../remoteBoards')>()),
  fetchRecentMatch: () => (lobbyRead.hang ? new Promise(() => {}) : Promise.resolve(null)),
}));

const here = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const H = HEROES.slice(0, 3).map((h) => h.id);

const game = (i: number, placement: number, heroId: string): RecentGameRow => ({
  rowId: 100 + i, userId: `u${i}`, author: `Player${i}`, heroId, placement, wins: 9, record: { wins: 9, losses: 3, ties: 1 },
  createdAt: '2026-11-01T10:00:00Z', durationMs: 25 * 60_000, lengthOverCap: false, wave: 13, partial: false, firstRecordedWave: null,
  hasReplay: true, board: null, runes: [], rank: 8, lobbyStrength: null, boardStrength: 88,
} as unknown as RecentGameRow);

const rows: KeyedRow[] = [game(0, 1, H[0]!), game(1, 5, H[1]!), game(2, 3, H[0]!)].map((r, i) => ({ r, key: `k${i}`, mine: false, skins: null }));

const props = (over: Partial<RecentGamesPhProps> = {}): RecentGamesPhProps => ({
  tab: 'ranked', onTab: vi.fn(), state: 'ready', feedRows: 100, duosLimit: 50, rows, duosRows: [], myId: null,
  heroCounts: [{ id: H[0]!, n: 2 }, { id: H[1]!, n: 1 }], heroFilter: null, onHero: vi.fn(), picked: null, onPick: vi.fn(),
  watching: null, noReplay: null, opening: null, onOpen: vi.fn(), onWatch: vi.fn(), onRetry: vi.fn(), ...over,
});

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const q = (sel: string): HTMLElement | null => ui!.container.querySelector<HTMLElement>(sel);
const qa = (sel: string): HTMLElement[] => [...ui!.container.querySelectorAll<HTMLElement>(sel)];

describe('Recent Games on the shell', () => {
  it('shows the strip, the hero filter, the whole history and the newest game open', () => {
    ui = mount(<RecentGamesPh {...props()} />);
    expect(q('.phk-pagetitle h1')?.textContent).toBe('Recent Games');
    // The hero filter sits on the header line (one row); whose games these are rides the Games figure.
    expect(q('.phk-pageactions .rgp-filters')).not.toBeNull();
    expect(q('.rgp-strip .phk-statsub')?.textContent).toBe('every player');
    expect(qa('.rgp-strip .phk-statval').map((n) => n.textContent)).toEqual(['3', '3.0', '67%', '1']);
    expect(q('.rgp-mostname')?.textContent).toBe(HEROES[0]!.name);
    expect(qa('.rgp-filters .phk-segbtn').map((b) => b.textContent)).toEqual(['All heroes', `${HEROES[0]!.name}2`, `${HEROES[1]!.name}1`]);
    expect(qa('.rgp-item').length).toBe(3);
    expect(q('.rgp-item.sel')?.parentElement?.getAttribute('aria-selected')).toBe('true');
    expect(q('.rgp-verdict')?.textContent).toBe('Victory');
    expect(q('.rgp-name')?.textContent).toBe('Player0');
    expect(q('.rgp-record')?.textContent).toMatch(/^9.3/);
    expect(qa('.rgp-facts .phk-statlbl').map((n) => n.textContent)).toEqual(['Played', 'Length', 'Rounds', 'Game strength']);
  });
  it('wires the tabs, the list, Replay and Career to the page handlers', () => {
    const p = props();
    ui = mount(<RecentGamesPh {...p} />);
    qa('.phk-tab')[1]!.click();
    expect(p.onTab).toHaveBeenCalledWith('practice');
    qa('.rgp-item')[1]!.click();
    expect(p.onPick).toHaveBeenCalledWith('k1');
    qa('.rgp-filters .phk-segbtn')[1]!.click();
    expect(p.onHero).toHaveBeenCalledWith(H[0]);
    const [replay, career] = qa('.rgp-bannerbtns .phk-btn');
    replay!.click();
    expect(p.onWatch).toHaveBeenCalledWith(expect.anything(), rows[0]!.r, 'k0');
    career!.click();
    expect(p.onOpen).toHaveBeenCalledWith(rows[0]!.r, 'k0');
  });
  it('moves through the history with Up / Down', () => {
    const p = props({ picked: 'k1' });
    ui = mount(<RecentGamesPh {...p} />);
    q('.phk-selist')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(p.onPick).toHaveBeenCalledWith('k2');
  });
  it('says what is happening when there is nothing to list', () => {
    ui = mount(<RecentGamesPh {...props({ state: 'loading', rows: [] })} />);
    expect(q('.phk-emptytitle')?.textContent).toBe('Gathering the latest games');
    ui.render(<RecentGamesPh {...props({ state: 'offline', rows: [] })} />);
    expect(q('.phk-emptytitle')?.textContent).toBe('Recent games are unavailable');
    ui.render(<RecentGamesPh {...props({ tab: 'duos', state: 'signedout' })} />);
    expect(q('.phk-emptytitle')?.textContent).toBe('Sign in to see your Duos games');
    expect(q('.rgp-scope')?.textContent).toBe('Your last 50 Duos games');
  });
  it('a failed read says so and offers Retry, never a false no games yet; Duos can truly be empty', () => {
    const p = props({ state: 'empty', rows: [] });
    ui = mount(<RecentGamesPh {...p} />);
    expect(q('.phk-emptytitle')?.textContent).toBe('Recent games are not available right now');
    q('.phk-empty .phk-btn')!.click();
    expect(p.onRetry).toHaveBeenCalled();
    ui.render(<RecentGamesPh {...props({ tab: 'duos', state: 'ready', duosRows: [] })} />);
    expect(q('.phk-emptytitle')?.textContent).toBe('No Duos games yet');
  });
  it('the banner does not repeat the big ordinal: only a win says it in words', () => {
    ui = mount(<RecentGamesPh {...props({ picked: 'k1' })} />);
    expect(q('.rgp-ord.big')?.textContent).toBe('5th');
    expect(q('.rgp-verdict')).toBeNull();
    ui.render(<RecentGamesPh {...props({ picked: 'k0' })} />);
    expect(q('.rgp-verdict')?.textContent).toBe('Victory');
  });
  it('the ledger is chunky gems with no line, the latest 30 at most', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ r: game(i, (i % 8) + 1, H[0]!), key: `m${i}`, mine: false, skins: null }));
    ui = mount(<RecentGamesPh {...props({ rows: many })} />);
    expect(qa('.rgp-gem').length).toBe(30);
    expect(q('.rgp-spark polyline')).toBeNull();
  });
  it('holds the lobby\'s place with ghost tiles while it is read, and the board line already says what it will keep', () => {
    lobbyRead.hang = true;
    ui = mount(<RecentGamesPh {...props()} />);
    lobbyRead.hang = false;
    expect(qa('.rgp-lobby .rgp-ghost').length).toBe(8);
    expect(q('.rgp-lobby')?.getAttribute('aria-busy')).toBe('true');
    expect(q('.lp-showing-v')?.textContent).toBe("Player0's board");
    expect(ui.container.textContent).not.toMatch(/Final board/);
  });
  it('names a placement in words', () => {
    // The production list's placement style (owner ruling 2026-11-03): band-coloured ordinal text, a crown on a win, no crest.
    ui = mount(<RecentGamesPh {...props()} />);
    expect(qa('.rgp-item .rgp-ord').map((n) => `${n.className.match(/b-\w+/)?.[0]} ${n.textContent}`)).toEqual(['b-won 1st', 'b-lost 5th', 'b-top4 3rd']);
    expect(qa('.rgp-item .rgp-crown').length).toBe(1);
    expect(q('.rgp-item .phk-place')).toBeNull();
    expect(placeWords(1)).toBe('Victory');
    expect(placeWords(4)).toBe('4th place');
    expect(placeWords(null)).toBe('No placement');
  });
});

const live = (i: number, over: Partial<LiveGameRow> = {}): LiveGameRow => ({
  game_id: `g${i}`, display_name: `Live${i}`, hero_id: H[i % 3]!, cosmetics: null, division_index: 6, rank_points: 20, rating: 1500,
  round: 5, phase: 'shop', placement: null, spectators: 2, started_at: '', mode: null, live_host: 'cf:rev', ...over,
});
const lprops = (over: Partial<LiveGamesPhProps> = {}): LiveGamesPhProps => ({
  offline: false, rows: [live(0), live(1, { spectators: 20 }), live(2, { phase: 'end', placement: 1 })], failed: false, error: null,
  page: 0, joining: null, showOpp: false, onWatch: vi.fn(), onPage: vi.fn(), onRecent: vi.fn(), onPlay: vi.fn(), ...over,
});

describe('Live Games on the shell', () => {
  it('lists every game with its rank, mode and a Watch button (Full at the cap, Ended when over)', () => {
    const p = lprops();
    ui = mount(<LiveGamesPh {...p} />);
    expect(q('.phk-pagetitle h1')?.textContent).toBe('Live Games');
    expect(qa('.lvp-row').length).toBe(3);
    expect(qa('.lvp-name').map((n) => n.textContent)).toEqual(['Live0', 'Live1', 'Live2']);
    expect(qa('.lvp-act .phk-btn').map((b) => b.textContent)).toEqual(['Watch', 'Full', 'Ended']);
    qa('.lvp-act .phk-btn')[0]!.click();
    expect(p.onWatch).toHaveBeenCalledWith(p.rows![0]);
    expect(q('.lvp-count')?.textContent).toBe('3 live now');
  });
  it('is never a dead end: no games points at Recent Games, and a full page pages', () => {
    const p = lprops({ rows: [] });
    ui = mount(<LiveGamesPh {...p} />);
    const [replays, play] = qa('.phk-empty .phk-btn');
    expect(replays!.textContent).toBe('Watch replays');
    replays!.click();
    expect(p.onRecent).toHaveBeenCalled();
    play!.click();
    expect(p.onPlay).toHaveBeenCalled();
    const full = Array.from({ length: LIVE_PAGE }, (_, i) => live(i));
    const p2 = lprops({ rows: full });
    ui.render(<LiveGamesPh {...p2} />);
    const [prev, next] = qa('.lvp-pager .phk-btn');
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    next!.click();
    expect(p2.onPage).toHaveBeenCalledWith(1);
    expect(liveCountText(LIVE_PAGE, 0)).toBe(`${LIVE_PAGE}+ live now`);
  });
  it('a player with no name leads with their hero, never the bare placeholder', () => {
    expect(liveRowNames('Player', 'Soren', false, false)).toEqual({ title: 'Soren', sub: 'Anonymous player' });
    expect(liveRowNames('Player', 'Soren', false, true)).toEqual({ title: 'Anonymous player', sub: null });
    expect(liveRowNames('IonLime', 'Soren', false, false)).toEqual({ title: 'IonLime', sub: 'Soren' });
    expect(liveRowNames('Ann vs Bob', 'Soren', true, false)).toEqual({ title: 'Ann vs Bob', sub: null });
  });
});

describe('the gate and the UI rules', () => {
  it('draws the kit pages only behind the switch, lazily, and never in production', () => {
    expect(here('../../RecentGames.tsx')).toMatch(/import\.meta\.env\.DEV \? lazy\(\(\) => import\('\.\/partyHome\/pages\/RecentGamesPh'\)/);
    expect(here('../../RecentGames.tsx')).toMatch(/if \(shell && RecentGamesPh\)/);
    expect(here('../../live/LiveGames.tsx')).toMatch(/import\.meta\.env\.DEV \? lazy\(\(\) => import\('\.\.\/partyHome\/pages\/LiveGamesPh'\)/);
    expect(here('../../live/LiveGames.tsx')).toMatch(/if \(shell && LiveGamesPh\)/);
  });
  it('keeps to the UI rules: no native tooltips, no cursor, nothing looping, no em dashes, no Oath', () => {
    const tsx = [here('./RecentGamesPh.tsx'), here('./LiveGamesPh.tsx')].join('\n');
    const css = here('./gamesPages.css');
    expect(tsx).not.toMatch(/<[a-z][a-z0-9]*\s[^>]*\stitle=/);
    expect(css).not.toMatch(/cursor:/);
    expect(css).not.toMatch(/infinite/);
    for (const m of tsx.matchAll(/'([^'\n]*)'|>([^<>{}\n]+)</g)) {
      const s = m[1] ?? m[2] ?? '';
      expect(s).not.toMatch(/—|\s--\s/);
      expect(s).not.toMatch(/\b(Oath|climb)\b/i);
    }
  });
});
