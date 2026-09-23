// @vitest-environment jsdom
/**
 * THE LADDER PAGES (owner polish 2026-09-20) — jsdom renders of the ranked Leaderboard (Rankings), the Hall
 * of Champions (Leaderboard) and Recent Games over three-row fixtures from a mocked `remoteBoards`, plus the
 * pure label helpers (`leaderboardData`) and the widened `asRecentGameRow` mapper. Pins: the podium
 * medallions; YOUR row highlighted + scrolled to; the ranked table's columns (# · Player · Rating · Games —
 * NO board tiles since the 2026-09-20 re-lay) with a CAREER PAGE button per row that opens that player's
 * Career; real card tiles (7 slots) for a stored board and a labelled empty plate without one on the banner
 * pages; the VICTORY / ordinal outcome block with date, length and record; the rune emblems + names; the
 * "Partial recording" caption; ONE Watch button per row, live only with a replay; and the designed loading /
 * empty / offline states.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';
import type { BoardSnapshot } from '@game/sim';
import type { HallHistoryFacts, PlayerRow, RecentGameRow, RunFightRecord } from './remoteBoards';

const fetchTopPlayers = vi.fn<() => Promise<PlayerRow[]>>();
const fetchLatestReplayForUser = vi.fn<(id: string) => Promise<unknown>>();
const fetchHallRecords = vi.fn<() => Promise<RunFightRecord[]>>();
const fetchHallHistory = vi.fn<(seeds: number[]) => Promise<Map<string, HallHistoryFacts>>>();
const fetchRunFinalBoards = vi.fn<(runs: unknown[]) => Promise<Map<string, BoardSnapshot>>>();
const fetchRecentGames = vi.fn<() => Promise<RecentGameRow[]>>();
const fetchReplayPayload = vi.fn<(id: number) => Promise<unknown>>();
const fetchPlayerById = vi.fn<(id: string) => Promise<PlayerRow | null>>();
const startReplay = vi.fn();
let remote = true;

vi.mock('./remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./remoteBoards')>()),
  remoteEnabled: () => remote,
  fetchTopPlayers: () => fetchTopPlayers(),
  fetchLatestReplayForUser: (id: string) => fetchLatestReplayForUser(id),
  fetchHallRecords: () => fetchHallRecords(),
  fetchHallHistory: (seeds: number[]) => fetchHallHistory(seeds),
  fetchRunFinalBoards: (runs: unknown[]) => fetchRunFinalBoards(runs),
  fetchRecentGames: () => fetchRecentGames(),
  fetchReplayPayload: (id: number) => fetchReplayPayload(id),
  fetchPlayerById: (id: string) => fetchPlayerById(id),
}));
vi.mock('./replay/replayPlayer', () => ({ startReplay: (...a: unknown[]) => startReplay(...a) }));

import { Rankings } from './Rankings';
import { Leaderboard } from './Leaderboard';
import { RecentGames } from './RecentGames';
import { useGame } from './store';
import { asRecentGameRow, RECENT_GAMES_SELECTS } from './remoteBoards';
import { medalOf, ordinalOf, outcomeOf, partialText, recordOfHistory, recordText, runLengthText } from './leaderboardData';

/* ─────────────────────────────────────────── fixtures ─────────────────────────────────────────── */

const board = (n: number, heroId = 'brackus'): BoardSnapshot => ({
  v: 1, wave: 12, heroId, resolve: 20, tier: 5, triples: 1, tribes: ['beast'], threat: 'none' as never, power: 40, seed: 7,
  minions: Array.from({ length: n }, (_, i) => ({ cardId: i % 2 ? 'stray' : 'alleycat', name: i % 2 ? 'Stray' : 'Alleycat', attack: 3 + i, health: 4 + i })) as never,
  runes: ['rune_spellslinging'],
} as BoardSnapshot);

const PLAYERS: PlayerRow[] = [
  { userId: 'u-top', author: 'Nadja', discriminator: '1001', rating: 782, gamesPlayed: 46, favoriteHero: 'brackus' },
  { userId: 'me-1', author: 'Kev', discriminator: '4821', rating: 763, gamesPlayed: 35, favoriteHero: 'sable' },
  { userId: 'u-three', author: 'Robin', discriminator: '7043', rating: 264, gamesPlayed: 2 },
];

// The `run_fight_records` view, already cut to the top rows by Wilson lower bound with at least 10 fights
// (owner 2026-09-22). Nadja's run is 31-7-1 (a lobby winner); Kev's 12-3 across two lobbies never won its own
// game (3rd); Robin's has no career row and no pool board.
const RECORDS: RunFightRecord[] = [
  { runKey: 'Nadja|brackus|7', fights: 39, wins: 31, losses: 7, draws: 1, lobbies: 4, winRate: 31 / 39, wilsonLb: 0.64, lastFightAt: '2026-09-21T10:00:00Z' },
  { runKey: 'Kev|sable|8', fights: 15, wins: 12, losses: 3, draws: 0, lobbies: 2, winRate: 0.8, wilsonLb: 0.55, lastFightAt: '2026-09-18T14:00:00Z' },
  { runKey: 'Robin|brackus|9', fights: 10, wins: 6, losses: 4, draws: 0, lobbies: 1, winRate: 0.6, wilsonLb: 0.31, lastFightAt: '2026-09-22T09:00:00Z' },
];
// The runs' own career rows, filed by full run key (Nadja's, stamped with its author) or by the legacy seed key
// (Kev's, an older row): the rank held (division index 1 = Bronze II under the ascending numerals), the run's
// OWN record, its placement and its final board (Kev's row has no board → the pool lookup).
const HISTORY = new Map<string, HallHistoryFacts>([
  ['Nadja|brackus|7', { seed: 7, author: 'Nadja', heroId: 'brackus', rank: { divisionIndex: 1, points: 40, demotionReady: false }, record: { wins: 12, losses: 3, draws: 0 }, at: '2026-09-19T14:00:00Z', placement: 1, board: { ...board(7), id: 'b1', quests: [] } as BoardSnapshot }],
  ['seed:8', { seed: 8, author: null, heroId: 'sable', rank: { divisionIndex: 1, points: 40, demotionReady: false }, record: { wins: 9, losses: 5, draws: 0 }, at: '2026-09-18T14:00:00Z', placement: 3, board: null }],
]);
const POOL_BOARDS = new Map<string, BoardSnapshot>([['Kev|sable|8', { ...board(5, 'sable'), id: 'b2' } as BoardSnapshot]]);

const game = (over: Partial<RecentGameRow>): RecentGameRow => ({
  userId: 'u-top', author: 'Nadja', heroId: 'brackus', wins: 9, placement: 1, createdAt: '2026-09-19T14:00:00Z', rowId: 91, hasReplay: true,
  board: board(7), record: { wins: 9, losses: 4, draws: 0 }, durationMs: 18 * 60_000, partial: false, firstRecordedWave: null,
  runes: ['rune_spellslinging', 'rune_happy_birthday'], wave: 15, lobbyStrength: null, ...over,
});
const GAMES: RecentGameRow[] = [
  game({ lobbyStrength: { value: 74, tier: 'Brutal', inputs: [] } }),
  // A PARTIAL recording (resumed from round 5), 5th place, one draw in the record.
  game({ userId: 'me-1', author: 'Kev', heroId: 'sable', rowId: 90, placement: 5, record: { wins: 4, losses: 5, draws: 1 }, partial: true, firstRecordedWave: 5, durationMs: 7 * 60_000 + 20_000, runes: [], wave: 11 }),
  // A pre-replay row: no board, no record, no length, no replay (Watch must be dead), no player id (not clickable).
  game({ userId: null, author: 'Robin', heroId: 'brackus', rowId: 12, hasReplay: false, board: null, record: null, durationMs: null, placement: 2, wins: 3, runes: [], wave: null }),
];

let ui: Mounted;
const scrollIntoView = vi.fn();
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const text = (sel: string): string[] => [...ui.container.querySelectorAll(sel)].map((n) => (n.textContent ?? '').trim());
const click = (el: Element | null): void => { act(() => { (el as HTMLElement).click(); }); };

beforeEach(() => {
  remote = true;
  fetchTopPlayers.mockReset().mockResolvedValue(PLAYERS);
  fetchLatestReplayForUser.mockReset().mockResolvedValue({ version: 2, seed: 1, frames: [{}] });
  fetchHallRecords.mockReset().mockResolvedValue(RECORDS);
  fetchHallHistory.mockReset().mockResolvedValue(HISTORY);
  fetchRunFinalBoards.mockReset().mockResolvedValue(POOL_BOARDS);
  fetchRecentGames.mockReset().mockResolvedValue(GAMES);
  fetchReplayPayload.mockReset().mockResolvedValue({ version: 2, seed: 1, frames: [{}] });
  fetchPlayerById.mockReset().mockResolvedValue(null);
  startReplay.mockReset();
  // jsdom has no scrollIntoView — the own-row scroll must call it exactly once when the list lands.
  scrollIntoView.mockReset();
  (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView;
  useGame.setState({
    showRankings: false, showLeaderboard: false, showRecentGames: false, showCareer: false, careerOf: null,
    account: { userId: 'me-1', email: null, anonymous: true, discriminator: '4821' },
  });
});
afterEach(() => { ui?.unmount(); useGame.setState({ showRankings: false, showLeaderboard: false, showRecentGames: false, showCareer: false, careerOf: null }); });

/* ─────────────────────────────────────────── pure helpers ─────────────────────────────────────────── */

describe('leaderboardData — the labels the pages print', () => {
  it('outcomeOf: 1st is VICTORY (green), 2–4 an ordinal in cream, 5–8 an ordinal in red, none is a dash', () => {
    expect(outcomeOf(1)).toEqual({ label: 'VICTORY', cls: 'won' });
    expect(outcomeOf(3)).toEqual({ label: '3RD', cls: 'top4' });
    expect(outcomeOf(7)).toEqual({ label: '7TH', cls: 'lost' });
    expect(outcomeOf(null)).toEqual({ label: '—', cls: 'none' });
    expect(outcomeOf(0)).toEqual({ label: '—', cls: 'none' });
  });
  it('ordinals, run length, record and history folding', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinalOf)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
    expect(runLengthText(null)).toBe('—');
    expect(runLengthText(20_000)).toBe('<1 min');
    expect(runLengthText(18 * 60_000 + 10_000)).toBe('18 min');
    expect(recordText({ wins: 9, losses: 4, draws: 0 })).toBe('9–4');
    expect(recordText({ wins: 4, losses: 5, draws: 1 })).toBe('4–5–1');
    expect(recordText(null)).toBe('—');
    expect(recordOfHistory('LLWLWWD')).toEqual({ wins: 3, losses: 3, draws: 1 });
    expect(recordOfHistory(undefined)).toBeNull();
  });
  it('medal tiers + the partial caption', () => {
    expect([1, 2, 3, 4].map(medalOf)).toEqual(['gold', 'silver', 'bronze', 'plain']);
    expect(partialText(5)).toBe('Partial recording · from round 5');
    expect(partialText(null)).toBe('Partial recording');
  });
});

describe('asRecentGameRow — the widened light-list mapper', () => {
  const base = { id: 7, user_id: 'u1', author: 'kev', hero_id: 'brackus', wins: 5, placement: 1, created_at: '2026-08-19T00:00:00Z', replay_v2_version: 2 };
  it('reads the banner facts off the JSON-path columns (text scalars included) and keeps the board only when it has minions', () => {
    const row = asRecentGameRow({ ...base, final_board: board(3), record: { wins: 9, losses: 4, draws: 0 }, first_t: '1000', last_t: '61000', partial: 'true', first_wave: '5', picked_runes: ['rune_warding'], final_wave: '15' });
    expect(row.board?.minions).toHaveLength(3);
    expect(row.record).toEqual({ wins: 9, losses: 4, draws: 0 });
    expect(row.durationMs).toBe(60_000);
    expect(row.partial).toBe(true);
    expect(row.firstRecordedWave).toBe(5);
    expect(row.runes).toEqual(['rune_warding']);
    expect(row.wave).toBe(15);
    expect(asRecentGameRow({ ...base, final_board: { ...board(0) } }).board).toBeNull();
    // The lobby-strength stamp (`replay->v2->result->lobbyStrength`, a JSON object): parsed when present, null otherwise.
    expect(asRecentGameRow({ ...base, lobby_strength: { value: 74, tier: 'Brutal', inputs: [] } }).lobbyStrength).toEqual({ value: 74, tier: 'Brutal', inputs: [] });
    expect(asRecentGameRow({ ...base, lobby_strength: null }).lobbyStrength).toBeNull();
    expect(row.lobbyStrength).toBeNull();
    expect(RECENT_GAMES_SELECTS[0]).toContain('lobby_strength:replay->v2->result->lobbyStrength');
  });
  it('falls back to the board’s own runes when picked_runes is absent, and to nulls on a sparse row', () => {
    expect(asRecentGameRow({ ...base, final_board: board(2) }).runes).toEqual(['rune_spellslinging']);
    const sparse = asRecentGameRow({ hero_id: 'yazzus' });
    expect(sparse).toMatchObject({ board: null, record: null, durationMs: null, partial: false, firstRecordedWave: null, runes: [], wave: null, hasReplay: false });
  });
  it('the select ladder is richest-first and ends at the plain column list', () => {
    expect(RECENT_GAMES_SELECTS[0]).toContain('frames->-1->>tMs');
    expect(RECENT_GAMES_SELECTS[RECENT_GAMES_SELECTS.length - 1]).toBe('id, user_id, author, hero_id, wins, placement, created_at');
    expect(RECENT_GAMES_SELECTS.every((s) => s.startsWith('id, user_id, author, hero_id, wins, placement, created_at'))).toBe(true);
  });
});

/* ─────────────────────────────────────────── Rankings (the Leaderboard) ─────────────────────────────────────────── */

describe('Rankings — the ranked table', () => {
  beforeEach(async () => {
    useGame.setState({ showRankings: true });
    ui = mount(<Rankings />);
    await flush();
  });

  it('renders the three rows with podium medallions, handles, ratings and games', () => {
    const rows = ui.container.querySelectorAll('.lb-trow-btn');
    expect(rows).toHaveLength(3);
    expect(text('.lb-medal').slice(0, 3)).toEqual(['1', '2', '3']);
    expect([...ui.container.querySelectorAll('.lb-medal')].map((m) => m.className)).toEqual(['lb-medal gold', 'lb-medal silver', 'lb-medal bronze']);
    expect(text('.lb-rating')).toEqual(['782', '763', '264']);
    expect(text('.lb-num')).toEqual(['46', '35', '2']);
    expect(text('.lb-handle')[0]).toBe('Nadja#1001');
    expect(text('.lb-herosub')).toEqual(['Brackus', 'Sable', 'No favorite hero yet']);
  });

  it('highlights YOUR row (by user id, not name) with the you chip and scrolls it into view once', () => {
    const me = ui.container.querySelector('.lb-trow-btn.me');
    expect(me).not.toBeNull();
    expect(me!.querySelector('.lb-handle')?.textContent).toBe('Kev#4821you');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('the columns are # · Player · Rating · Games (+ actions) — no board tiles, no latest-game caption', () => {
    expect(text('.lb-thead > *')).toEqual(['#', 'Player', 'Rating', 'Games', '']);
    expect(ui.container.querySelectorAll('.lb-tile, .lb-team, .lb-team-none, .lb-latest-place, .lb-c-board')).toHaveLength(0);
    // The rating cell is ONE element (aliased .rk-rating) so a crest can be slotted into it.
    expect(ui.container.querySelectorAll('.lb-trow-btn .lb-c-rating.rk-rating')).toHaveLength(3);
    expect(text('.lb-trow-btn .lb-c-rating')).toEqual(['782MMR', '763MMR', '264MMR']);
  });

  it('the CAREER PAGE button opens THAT row’s Career (once — the row click underneath does not double-fire)', () => {
    const rows = [...ui.container.querySelectorAll('.lb-trow-btn')];
    const careerBtns = [...ui.container.querySelectorAll('.lb-career')];
    expect(careerBtns).toHaveLength(3);
    expect(careerBtns.map((b) => b.textContent)).toEqual(['Career page', 'Career page', 'Career page']);
    const real = useGame.getState().openCareer;
    const openCareer = vi.fn(real);
    act(() => { useGame.setState({ openCareer }); });
    try {
      click(rows[2]!.querySelector('.lb-career'));
      expect(openCareer).toHaveBeenCalledTimes(1);
      expect(openCareer).toHaveBeenCalledWith({ userId: 'u-three', author: 'Robin', rating: 264, gamesPlayed: 2, favoriteHero: undefined });
      expect(useGame.getState().careerOf?.userId).toBe('u-three');
      expect(startReplay).not.toHaveBeenCalled();
    } finally {
      act(() => { useGame.setState({ openCareer: real }); });
    }
  });

  it('a row opens that player’s Career; its Watch button plays their latest run without opening the Career', async () => {
    const rows = [...ui.container.querySelectorAll('.lb-trow-btn')];
    click(rows[0]!.querySelector('.lb-watch-latest'));
    await flush();
    expect(fetchLatestReplayForUser).toHaveBeenCalledWith('u-top');
    expect(startReplay).toHaveBeenCalledTimes(1);
    expect(useGame.getState().showCareer).toBe(false);
    click(rows[0]);
    expect(useGame.getState().showCareer).toBe(true);
    expect(useGame.getState().careerOf?.userId).toBe('u-top');
  });
});

describe('Rankings — the medal rank rides into the Career page', () => {
  it('a row that carries a rank hands it to openCareer (so the Career card paints the SAME crest + bar, not a bare number)', async () => {
    // Bronze I 46: the "46 MMR" the owner saw on a viewed Career (rating = 100 × division + points).
    const rank = { seasonId: 3, rulesVersion: 1, revision: 2, position: { divisionIndex: 0, points: 46, demotionReady: false }, highest: { divisionIndex: 0, points: 46, demotionReady: false } };
    fetchTopPlayers.mockResolvedValue([{ ...PLAYERS[0]!, rating: 46, rank }, PLAYERS[1]!, PLAYERS[2]!]);
    useGame.setState({ showRankings: true });
    ui = mount(<Rankings />);
    await flush();
    const rows = [...ui.container.querySelectorAll('.lb-trow-btn')];
    const ranked = rows.find((r) => r.querySelector('.rankbar'))!;
    expect(ranked).toBeDefined();
    const real = useGame.getState().openCareer;
    const openCareer = vi.fn(real);
    act(() => { useGame.setState({ openCareer }); });
    try {
      click(ranked.querySelector('.lb-career'));
      expect(openCareer).toHaveBeenCalledTimes(1);
      expect(openCareer).toHaveBeenCalledWith({ userId: 'u-top', author: 'Nadja', rating: 46, gamesPlayed: 46, favoriteHero: 'brackus', rank });
      expect(useGame.getState().careerOf?.rank?.position).toEqual({ divisionIndex: 0, points: 46, demotionReady: false });
      // A rankless row (pre-migration) hands nothing extra over.
      const plain = rows.find((r) => r.querySelector('.lb-handle')?.textContent?.startsWith('Robin'))!;
      click(plain.querySelector('.lb-career'));
      expect(openCareer).toHaveBeenLastCalledWith({ userId: 'u-three', author: 'Robin', rating: 264, gamesPlayed: 2, favoriteHero: undefined });
      expect('rank' in (openCareer.mock.calls[1]![0] as object)).toBe(false);
    } finally {
      act(() => { useGame.setState({ openCareer: real }); });
    }
  });
});

describe('Rankings — designed states', () => {
  it('loading, then empty', async () => {
    let resolve!: (r: PlayerRow[]) => void;
    fetchTopPlayers.mockReturnValue(new Promise<PlayerRow[]>((r) => { resolve = r; }));
    useGame.setState({ showRankings: true });
    ui = mount(<Rankings />);
    expect(ui.container.querySelector('.lb-state.loading .lb-spin')).not.toBeNull();
    await act(async () => { resolve([]); });
    await flush();
    expect(ui.container.querySelector('.lb-state')?.textContent).toContain('No ranked players yet');
  });
  it('offline (no backend) shows the designed offline state', async () => {
    remote = false;
    useGame.setState({ showRankings: true });
    ui = mount(<Rankings />);
    await flush();
    expect(ui.container.querySelector('.lb-state')?.textContent).toContain('No backend configured');
    expect(ui.container.querySelector('.lb-table')).toBeNull();
  });
});

/* ─────────────────────────────────────────── Hall of Champions ─────────────────────────────────────────── */

describe('Leaderboard — the Hall of Champions banners', () => {
  beforeEach(async () => {
    useGame.setState({ showLeaderboard: true });
    ui = mount(<Leaderboard />);
    await flush();
  });

  it('one banner per view row (top 10, at least 10 fights): medallion · hero frame + author + hero · final team + runes · the record block', () => {
    const rows = [...ui.container.querySelectorAll('.lb-row')];
    expect(rows).toHaveLength(3);
    expect(fetchHallRecords).toHaveBeenCalledTimes(1);
    expect(fetchHallHistory).toHaveBeenCalledWith([7, 8, 9]);
    // The pool lookup only for the runs whose career row carried no board (Kev) or had none (Robin).
    expect(fetchRunFinalBoards).toHaveBeenCalledWith([{ key: 'Kev|sable|8', author: 'Kev', heroId: 'sable', seed: 8 }, { key: 'Robin|brackus|9', author: 'Robin', heroId: 'brackus', seed: 9 }]);
    expect([...ui.container.querySelectorAll('.lb-medal')].map((m) => m.className)).toEqual(['lb-medal gold', 'lb-medal silver', 'lb-medal bronze']);
    expect(rows[0]!.querySelector('.lb-heroframe .hero .f img.heroimg') ?? rows[0]!.querySelector('.lb-heroframe .hero .f svg')).not.toBeNull();
    expect(text('.lb-row-name')).toEqual(['Nadja', 'Kev', 'Robin']);
    expect(text('.lb-row-herosub')).toEqual(['Brackus', 'Sable', 'Brackus']);
    // The left is the player and the hero only (owner 2026-09-22): no pips.
    expect(ui.container.querySelectorAll('.lb-row-record, .lbpip, .runtrophy')).toHaveLength(0);
    expect(rows[0]!.querySelectorAll('.lb-tile .card')).toHaveLength(7);   // from the career row
    expect(rows[1]!.querySelectorAll('.lb-tile .card')).toHaveLength(5);   // from the pool
    expect(rows[1]!.querySelectorAll('.lb-tile.empty')).toHaveLength(2);
    expect(rows[2]!.querySelector('.lb-team-none')?.textContent).toBe('No warband stored for this run');
    // The record across EVERYTHING stands where a verdict would: W–L–D, then the win rate and the lobbies.
    expect(text('.lb-verdict')).toEqual(['31–7–1', '12–3', '6–4']);
    expect(text('.lb-hallrate')).toEqual(['79% win rate · 4 lobbies', '80% win rate · 2 lobbies', '60% win rate · 1 lobby']);
    // The runes read exactly as a Recent Games row shows them.
    expect(rows[0]!.querySelectorAll('.lb-runes .lb-rune, .lb-runes > *').length).toBeGreaterThan(0);
    expect(rows[2]!.querySelector('.lb-runes-none')?.textContent).toBe('No runes taken');
  });

  it('the right side: the run\'s own game, the date of its last fight, and the rank the player held', () => {
    const rows = [...ui.container.querySelectorAll('.lb-row')];
    expect(rows[0]!.querySelector('.lb-hallrecord')?.textContent).toBe('31–7–1');
    // Its OWN game ("12–3", from the career row); Robin's run has no career row, so no own-game line.
    expect(text('.lb-hallown')).toEqual(['Own game 12–3', 'Own game 9–5']);
    expect(rows[0]!.querySelector('.lb-when')?.textContent).toBe('Last fight Sep 21, 2026');
    expect(rows[1]!.querySelector('.lb-when')?.textContent).toBe('Last fight Sep 18, 2026');
    // Division index 1 = Bronze II under the ascending numerals (2026-09-22). Robin's row has no career row,
    // hence no rank line — and a run that never won its own lobby (Kev, 3rd) is a candidate all the same.
    expect(rows[0]!.querySelector('.lb-hallrank')?.textContent).toBe('Bronze II');
    expect(rows[1]!.querySelector('.lb-hallrank')?.textContent).toBe('Bronze II');
    expect(rows[2]!.querySelector('.lb-hallrank')).toBeNull();
  });

  it('Win rate (the Wilson order the view returns) is the default sort (owner 2026-09-22); Most recent re-orders by the last fight', () => {
    const btns = ui.container.querySelectorAll('.lb-seg-btn');
    expect(btns[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(btns[1]!.textContent).toBe('Win rate');
    expect(text('.lb-row-name')).toEqual(['Nadja', 'Kev', 'Robin']);
    click(btns[0]!);
    expect(btns[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(text('.lb-row-name')).toEqual(['Robin', 'Nadja', 'Kev']); // Robin fought most recently (the 22nd)
    expect(ui.container.querySelector('.lbsub')?.textContent).toBe('The 10 warbands with the best record against everyone');
  });

  it('an empty view (pre-migration, or nobody at 10 fights yet) shows the designed empty state', async () => {
    ui.unmount();
    fetchHallRecords.mockResolvedValue([]);
    useGame.setState({ showLeaderboard: true });
    ui = mount(<Leaderboard />);
    await flush();
    expect(ui.container.querySelector('.lb-state')?.textContent).toBe('No records yet. A warband enters the Hall after 10 fights.');
    expect(fetchHallHistory).toHaveBeenCalledWith([]);
  });
});

/* ─────────────────────────────────────────── Recent Games ─────────────────────────────────────────── */

describe('RecentGames — the recording banners', () => {
  beforeEach(async () => {
    useGame.setState({ showRecentGames: true });
    ui = mount(<RecentGames />);
    await flush();
  });

  it('three banners: hero frame + player + hero + record · final team tiles · runes as emblems + names · outcome', () => {
    const rows = [...ui.container.querySelectorAll('.lb-row')];
    expect(rows).toHaveLength(3);
    expect(text('.lb-row-name')).toEqual(['Nadja', 'Kev', 'Robin']);
    expect(text('.lb-row-record')).toEqual(['9–4', '4–5–1', '3 wins']); // no record → the scalar wins column
    expect(rows[0]!.querySelectorAll('.lb-tile .card')).toHaveLength(7);
    expect(text('.lb-rune-name').slice(0, 2)).toEqual(['Rune of Spellslinging', 'Happy Birthday']);
    expect(rows[0]!.querySelectorAll('.lb-rune-em img, .lb-rune-em svg')).toHaveLength(2);
    expect(rows[1]!.querySelector('.lb-runes-none')?.textContent).toBe('No runes taken');
    expect(text('.lb-verdict')).toEqual(['VICTORY', '5TH', '2ND']);
    expect([...ui.container.querySelectorAll('.lb-verdict')].map((v) => v.className)).toEqual(['lb-verdict won', 'lb-verdict lost', 'lb-verdict top4']);
    // length · rounds · (lobby strength, only on a row that carries the stamp) per row; row 3 has no rounds
    expect(text('.lb-fact-v')).toEqual(['18 min', '15', 'Brutal 74', '7 min', '11', '—']);
    expect(text('.lb-fact-lobby')).toEqual(['Brutal 74']);
  });

  it('labels the partial recording, and the board-less row gets the empty plate', () => {
    const rows = [...ui.container.querySelectorAll('.lb-row')];
    expect(rows[1]!.classList.contains('partial')).toBe(true);
    expect(rows[1]!.querySelector('.lb-partial')?.textContent).toBe('Partial recording · from round 5');
    expect(rows[0]!.querySelector('.lb-partial')).toBeNull();
    expect(rows[2]!.querySelector('.lb-team-none')?.textContent).toBe('No board recorded for this game');
    expect(rows[2]!.querySelectorAll('.lb-tile')).toHaveLength(0);
  });

  it('ONE Watch Replay button per banner — live only with a replay; a click fetches that row’s payload and starts the viewer', async () => {
    const btns = [...ui.container.querySelectorAll('.lb-watch')] as HTMLButtonElement[];
    expect(btns).toHaveLength(3);
    expect(btns.map((b) => b.disabled)).toEqual([false, false, true]);
    expect(btns.map((b) => b.textContent)).toEqual(['Watch replay', 'Watch replay', 'No replay']);
    click(btns[0]!);
    await flush();
    expect(fetchReplayPayload).toHaveBeenCalledWith(91);
    expect(startReplay).toHaveBeenCalledTimes(1);
    expect(useGame.getState().showCareer).toBe(false); // the click never bubbled to the banner
  });

  it('a banner with a known player is a button that opens their Career; a pre-accounts row is inert', async () => {
    const rows = [...ui.container.querySelectorAll('.lb-row')];
    expect(rows[0]!.getAttribute('role')).toBe('button');
    expect(rows[2]!.getAttribute('role')).toBeNull();
    click(rows[0]!);
    await flush();
    expect(useGame.getState().showCareer).toBe(true);
    expect(useGame.getState().careerOf?.userId).toBe('u-top');
    expect(useGame.getState().careerOf?.rank).toBeUndefined(); // the profile fetch answered without a rank
  });

  it('the profile fetch that opens a Career hands its medal rank over too', async () => {
    const rank = { seasonId: 3, rulesVersion: 1, revision: 2, position: { divisionIndex: 0, points: 46, demotionReady: false }, highest: { divisionIndex: 0, points: 46, demotionReady: false } };
    fetchPlayerById.mockResolvedValue({ userId: 'u-top', author: 'Nadja', rating: 46, gamesPlayed: 46, favoriteHero: 'brackus', rank });
    click(ui.container.querySelector('.lb-row'));
    await flush();
    expect(fetchPlayerById).toHaveBeenCalledWith('u-top');
    const of = useGame.getState().careerOf!;
    expect(of.userId).toBe('u-top');
    expect(of.rating).toBe(46);
    expect(of.rank).toEqual(rank);
  });
});

describe('RecentGames — designed states', () => {
  it('empty: "No recordings yet"', async () => {
    fetchRecentGames.mockResolvedValue([]);
    useGame.setState({ showRecentGames: true });
    ui = mount(<RecentGames />);
    await flush();
    expect(ui.container.querySelector('.lb-state')?.textContent).toContain('No recordings yet');
  });
});
