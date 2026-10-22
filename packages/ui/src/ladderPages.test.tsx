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
import type { HallHistoryFacts, PlayerRow, PracticeGameRow, RecentGameRow, RunFightRecord } from './remoteBoards';

const fetchTopPlayers = vi.fn<() => Promise<PlayerRow[]>>();
const fetchLatestReplayForUser = vi.fn<(id: string) => Promise<unknown>>();
const fetchHallRecords = vi.fn<() => Promise<RunFightRecord[]>>();
const fetchHallHistory = vi.fn<(seeds: number[]) => Promise<Map<string, HallHistoryFacts>>>();
const fetchRunFinalBoards = vi.fn<(runs: unknown[]) => Promise<Map<string, BoardSnapshot>>>();
const fetchRecentGames = vi.fn<() => Promise<RecentGameRow[]>>();
const fetchReplayPayload = vi.fn<(id: number) => Promise<unknown>>();
const fetchPlayerById = vi.fn<(id: string) => Promise<PlayerRow | null>>();
const fetchPracticeGames = vi.fn<() => Promise<PracticeGameRow[]>>();
const fetchPracticeReplay = vi.fn<(id: number) => Promise<unknown>>();
const fetchRecentMatch = vi.fn<(rowId: number | null | undefined, userId: string | null | undefined) => Promise<unknown>>();
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
  fetchPracticeGames: () => fetchPracticeGames(),
  fetchPracticeReplay: (id: number) => fetchPracticeReplay(id),
  fetchRecentMatch: (rowId: number | null | undefined, userId: string | null | undefined) => fetchRecentMatch(rowId, userId),
}));
// The LOBBY STRENGTH readout is hidden behind one switch (owner 2026-09-30); a getter-backed mock lets a test
// flip it on and prove the readout still renders when the switch comes back.
const lobbyDisplay = vi.hoisted(() => ({ show: false }));
vi.mock('./lobbyStrengthDisplay', () => ({ get SHOW_LOBBY_STRENGTH() { return lobbyDisplay.show; } }));
vi.mock('./replay/replayPlayer', () => ({ startReplay: (...a: unknown[]) => startReplay(...a) }));
// The leaderboard's ONE loadout read (owner 2026-10-12: "the portrait skins should show here").
const fetchPortraitLoadouts = vi.fn<(ids: readonly string[]) => Promise<Map<string, unknown>>>();
vi.mock('./progression/progressionRemote', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./progression/progressionRemote')>()),
  fetchPortraitLoadouts: (ids: readonly string[]) => fetchPortraitLoadouts(ids),
}));

import { Rankings } from './Rankings';
import { Leaderboard } from './Leaderboard';
import { RecentGames } from './RecentGames';
import { useGame } from './store';
import { clearSocialCache } from './socialCache';
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
  game({ lobbyStrength: { value: 74, tier: 'Brutal', inputs: [] }, boardStrength: 72 }),
  // A PARTIAL recording (resumed from round 5), 5th place, one draw in the record.
  game({ userId: 'me-1', author: 'Kev', heroId: 'sable', rowId: 90, placement: 5, record: { wins: 4, losses: 5, draws: 1 }, partial: true, firstRecordedWave: 5, durationMs: 7 * 60_000 + 20_000, runes: [], wave: 11 }),
  // A pre-replay row: no board, no record, no length, no replay (Watch must be dead), no player id (not clickable).
  game({ userId: null, author: 'Robin', heroId: 'brackus', rowId: 12, hasReplay: false, board: null, record: null, durationMs: null, placement: 2, wins: 3, runes: [], wave: null }),
];

// Practice games (owner ask 2026-09-24): Nadja's bots game on unlimited Health (no replay, no Watch), and Kev's
// recorded-opponent game on normal Health.
const PRACTICE: PracticeGameRow[] = [
  { ...game({ rowId: 5, hasReplay: false, placement: 3, wave: 15, lobbyStrength: null }), practice: { opponents: 'bots', botDifficulty: 5, health: 'unlimited' } },
  { ...game({ userId: 'me-1', author: 'Kev', heroId: 'sable', rowId: 4, hasReplay: false, placement: 6, record: { wins: 3, losses: 6, draws: 0 }, wave: 9, runes: [] }), practice: { opponents: 'players', botDifficulty: 3, health: 'normal' } },
];

let ui: Mounted;
const scrollIntoView = vi.fn();
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const text = (sel: string): string[] => [...ui.container.querySelectorAll(sel)].map((n) => (n.textContent ?? '').trim());
const click = (el: Element | null): void => { act(() => { (el as HTMLElement).click(); }); };

beforeEach(() => {
  clearSocialCache(); // the ladder lists are cached across opens (socialCache.ts); every case starts cold
  remote = true;
  fetchTopPlayers.mockReset().mockResolvedValue(PLAYERS);
  fetchPortraitLoadouts.mockReset().mockResolvedValue(new Map());
  fetchLatestReplayForUser.mockReset().mockResolvedValue({ version: 2, seed: 1, frames: [{}] });
  fetchHallRecords.mockReset().mockResolvedValue(RECORDS);
  fetchHallHistory.mockReset().mockResolvedValue(HISTORY);
  fetchRunFinalBoards.mockReset().mockResolvedValue(POOL_BOARDS);
  fetchRecentGames.mockReset().mockResolvedValue(GAMES);
  fetchReplayPayload.mockReset().mockResolvedValue({ version: 2, seed: 1, frames: [{}] });
  fetchPlayerById.mockReset().mockResolvedValue(null);
  fetchPracticeGames.mockReset().mockResolvedValue(PRACTICE);
  fetchRecentMatch.mockReset().mockResolvedValue(null);
  fetchPracticeReplay.mockReset().mockResolvedValue({ version: 2, seed: 9, frames: [{}] });
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
    expect(runLengthText(null, true)).toBe('35+ min');
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
    // R-MATCH-LENGTH-01: the replay's ACTIVE time is the length; an older row's span shows up to 35 min, "35+" past it.
    expect(asRecentGameRow({ ...base, first_t: '0', last_t: String(246 * 60_000), final_wave: '16', active_ms: '1860000' }).durationMs).toBe(1_860_000);
    const longLegacy = asRecentGameRow({ ...base, first_t: '0', last_t: String(246 * 60_000), final_wave: '16' });
    expect(longLegacy.durationMs).toBeNull();
    expect(runLengthText(longLegacy.durationMs, longLegacy.lengthOverCap)).toBe('35+ min');
    expect(asRecentGameRow({ ...base, first_t: '0', last_t: String(31 * 60_000), final_wave: '16' }).durationMs).toBe(31 * 60_000);
    expect(asRecentGameRow({ ...base, first_t: '0', last_t: String(31 * 60_000), final_wave: '16' }).lengthOverCap).toBe(false);
    // The lobby-strength stamp (`replay->v2->result->lobbyStrength`, a JSON object): parsed when present, null otherwise.
    expect(asRecentGameRow({ ...base, lobby_strength: { value: 74, tier: 'Brutal', inputs: [] } }).lobbyStrength).toEqual({ value: 74, tier: 'Brutal', inputs: [] });
    expect(asRecentGameRow({ ...base, lobby_strength: null }).lobbyStrength).toBeNull();
    // The board-strength stamp (`replay->v2->result->>boardStrength`, text): a number when present, else null.
    expect(asRecentGameRow({ ...base, board_strength: '72' }).boardStrength).toBe(72);
    expect(asRecentGameRow({ ...base }).boardStrength).toBeNull();
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
    expect(text('.lb-thead > *')).toEqual(['#', 'Player', 'MMR', 'Games', '']);
    expect(ui.container.querySelectorAll('.lb-tile, .lb-team, .lb-team-none, .lb-latest-place, .lb-c-board')).toHaveLength(0);
    // The rating cell is ONE element (aliased .rk-rating) so a crest can be slotted into it.
    expect(ui.container.querySelectorAll('.lb-trow-btn .lb-c-rating.rk-rating')).toHaveLength(3);
    expect(text('.lb-trow-btn .lb-c-rating')).toEqual(['782MMR', '763MMR', '264MMR']);
  });

  it('a row opens THAT player’s Career, once; rows carry no Career page / Watch buttons (owner 2026-10-16)', () => {
    const rows = [...ui.container.querySelectorAll('.lb-trow-btn')];
    expect(ui.container.querySelectorAll('.lb-trow-btn button')).toHaveLength(0);
    const real = useGame.getState().openCareer;
    const openCareer = vi.fn(real);
    act(() => { useGame.setState({ openCareer }); });
    try {
      click(rows[2]!);
      expect(openCareer).toHaveBeenCalledTimes(1);
      expect(openCareer).toHaveBeenCalledWith({ userId: 'u-three', author: 'Robin', rating: 264, gamesPlayed: 2, favoriteHero: undefined });
      expect(useGame.getState().careerOf?.userId).toBe('u-three');
      expect(startReplay).not.toHaveBeenCalled();
    } finally {
      act(() => { useGame.setState({ openCareer: real }); });
    }
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
      click(ranked);
      expect(openCareer).toHaveBeenCalledTimes(1);
      expect(openCareer).toHaveBeenCalledWith({ userId: 'u-top', author: 'Nadja', rating: 46, gamesPlayed: 46, favoriteHero: 'brackus', rank });
      expect(useGame.getState().careerOf?.rank?.position).toEqual({ divisionIndex: 0, points: 46, demotionReady: false });
      // A rankless row (pre-migration) hands nothing extra over.
      const plain = rows.find((r) => r.querySelector('.lb-handle')?.textContent?.startsWith('Robin'))!;
      click(plain);
      expect(openCareer).toHaveBeenLastCalledWith({ userId: 'u-three', author: 'Robin', rating: 264, gamesPlayed: 2, favoriteHero: undefined });
      expect('rank' in (openCareer.mock.calls[1]![0] as object)).toBe(false);
    } finally {
      act(() => { useGame.setState({ openCareer: real }); });
    }
  });
});

describe('Rankings — the MMR column', () => {
  it('a table with medal ranks adds MMR between Rank and Games: the number per row, and Unranked in a rankless rank cell', async () => {
    const rank = { seasonId: 3, rulesVersion: 1, revision: 2, position: { divisionIndex: 6, points: 10, demotionReady: false }, highest: { divisionIndex: 6, points: 10, demotionReady: false } };
    fetchTopPlayers.mockResolvedValue([{ ...PLAYERS[0]!, rating: 610, rank }, PLAYERS[1]!, PLAYERS[2]!]);
    useGame.setState({ showRankings: true });
    ui = mount(<Rankings />);
    await flush();
    expect(ui.container.querySelector('.lb-table')!.classList.contains('lb-has-mmr')).toBe(true);
    expect(text('.lb-thead > *')).toEqual(['#', 'Player', 'Rank', 'MMR', 'Games', '']);
    expect(text('.lb-trow-btn .lb-c-mmr')).toEqual(['610MMR', '763MMR', '264MMR']);
    expect(text('.lb-trow-btn .lb-c-mmr .lb-mmr')).toEqual(['610', '763', '264']);
    // The ranked row keeps its crest + bar; the rankless rows no longer repeat the number in the rank cell.
    const cells = [...ui.container.querySelectorAll('.lb-trow-btn .lb-c-rating')];
    expect(cells[0]!.querySelector('.rankbar')).not.toBeNull();
    expect(cells.slice(1).map((c) => c.textContent)).toEqual(['Unranked', 'Unranked']);
    expect(ui.container.querySelectorAll('.lb-rating')).toHaveLength(0);
    // Every row has the same six cells as the header, so the grid tracks line up.
    expect([...ui.container.querySelectorAll('.lb-trow')].map((r) => r.children.length)).toEqual([6, 6, 6, 6]);
  });

  it('a legacy table (no ranks at all) keeps five columns: its Rating cell already is the MMR', async () => {
    useGame.setState({ showRankings: true });
    ui = mount(<Rankings />);
    await flush();
    expect(ui.container.querySelector('.lb-table')!.classList.contains('lb-has-mmr')).toBe(false);
    expect(ui.container.querySelectorAll('.lb-c-mmr, .lb-unranked')).toHaveLength(0);
    expect(text('.lb-rating')).toEqual(['782', '763', '264']);
  });
});

describe('Rankings — portrait skins and the rank crest ring (owner 2026-10-12)', () => {
  const rankAt = (divisionIndex: number) => ({ seasonId: 3, rulesVersion: 1, revision: 2, position: { divisionIndex, points: 10, demotionReady: false }, highest: { divisionIndex, points: 10, demotionReady: false } });
  const portraitSrc = (): string[] => [...ui.container.querySelectorAll('.lb-trow-btn .heroimg')].map((n) => n.getAttribute('src') ?? '');
  const frames = (): Array<string | null> => [...ui.container.querySelectorAll('.lb-trow-btn .lb-heroframe')].map((n) => n.querySelector('.pframe-box')?.getAttribute('data-frame') ?? null);

  it('each ranked row’s RANK crest wears its medal ring; the hero portrait keeps its own outline; no Rank #1 ring on #1', async () => {
    fetchTopPlayers.mockResolvedValue([{ ...PLAYERS[0]!, rank: rankAt(9) }, { ...PLAYERS[1]!, rank: rankAt(6) }, { ...PLAYERS[2]!, rank: rankAt(15) }]);
    useGame.setState({ showRankings: true });
    ui = mount(<Rankings />);
    await flush();
    const crests = [...ui.container.querySelectorAll('.lb-trow-btn .rankcrest')].map((n) => n.querySelector('.pframe-box')?.getAttribute('data-frame') ?? null);
    expect(crests).toEqual(['ascendant', 'platinum', 'gold']); // rank-sorted: Ascendant, Platinum, Gold
    expect(frames()).toEqual([null, null, null]);
  });

  it('the portrait is the player’s equipped skin for that hero, read once for the shown players, through the opponent switch', async () => {
    fetchPortraitLoadouts.mockResolvedValue(new Map([['u-top', { heroSkinByHeroId: { brackus: 'skin_brackus_2' } }]]));
    useGame.setState({ showRankings: true, showOpponentSkins: true });
    ui = mount(<Rankings />);
    await flush();
    await flush();
    expect(fetchPortraitLoadouts).toHaveBeenCalledTimes(1);
    expect(fetchPortraitLoadouts.mock.calls[0]![0]).toEqual(['u-top', 'me-1', 'u-three']);
    expect(portraitSrc()[0]).toContain('skin_brackus_2');
    expect(portraitSrc()[1]).not.toContain('skin_');
    ui.unmount();
    // "Show opponent skins" off: someone else's row shows the hero's own art.
    clearSocialCache();
    useGame.setState({ showRankings: true, showOpponentSkins: false });
    ui = mount(<Rankings />);
    await flush();
    await flush();
    expect(portraitSrc()[0]).not.toContain('skin_');
  });
});

describe('Rankings — every player wears their equipped portrait frame (owner 2026-10-16, R-PROG-FRAMES-LIST-01)', () => {
  // Owner 2026-10-16: "the player frames they have equipped arent showing here and they should".
  const frames = (): Array<string | null> => [...ui.container.querySelectorAll('.lb-trow-btn .lb-heroframe')].map((n) => n.querySelector('.pframe-box')?.getAttribute('data-frame') ?? null);

  it('the loadout read asks for the hero skin AND the portrait frame, and another player’s row wears their frame', async () => {
    fetchPortraitLoadouts.mockResolvedValue(new Map([
      ['u-top', { portraitFrame: 'frame_fire' }],
      ['u-three', { heroSkinByHeroId: { brackus: 'skin_brackus_2' }, portraitFrame: 'frame_gold' }],
    ]));
    useGame.setState({ showRankings: true, showOpponentSkins: true });
    ui = mount(<Rankings />);
    await flush();
    await flush();
    // Row 2 is YOUR row ('me-1'): your live frame (none equipped in this fixture), never another player's.
    expect(frames()).toEqual(['frame_fire', null, 'frame_gold']);
    expect(ui.container.querySelectorAll('.lb-trow-btn .lb-heroframe.pf-on')).toHaveLength(2);
  });

  it('"Show opponent cosmetics" off puts the default ring back on other players’ rows', async () => {
    fetchPortraitLoadouts.mockResolvedValue(new Map([['u-top', { portraitFrame: 'frame_fire' }]]));
    useGame.setState({ showRankings: true, showOpponentSkins: false });
    ui = mount(<Rankings />);
    await flush();
    await flush();
    expect(frames()).toEqual([null, null, null]);
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
    clearSocialCache(); // a cached Hall would (by design) stay up over an empty answer
    fetchHallRecords.mockResolvedValue([]);
    useGame.setState({ showLeaderboard: true });
    ui = mount(<Leaderboard />);
    await flush();
    expect(ui.container.querySelector('.lb-state')?.textContent).toBe('No records yet. A warband enters the Hall after 10 fights.');
    expect(fetchHallHistory).toHaveBeenCalledWith([]);
  });
});

/* ─────────────────────────────────────────── Recent Games ─────────────────────────────────────────── */

describe('RecentGames — layout B: the game list + the selected game in full (owner 2026-10-16)', () => {
  beforeEach(async () => {
    useGame.setState({ showRecentGames: true });
    ui = mount(<RecentGames />);
    await flush();
  });
  const pick = (i: number): void => click(ui.container.querySelectorAll('.gs-item')[i]!);
  const detail = (): Element => ui.container.querySelector('.gs-detail .lb-row')!;

  it('one compact row per game (placement, portrait, player, hero, when), and the newest game open in full: hero + record · 7 board cards · runes · outcome', () => {
    expect(text('.gs-item .gs-title')).toEqual(['Nadja', 'Kev', 'Robin']);
    expect(text('.gs-item .gs-place')).toEqual(['1st', '5th', '2nd']);
    expect([...ui.container.querySelectorAll('.gs-item')].map((n) => n.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    // Only the selected game mounts its card (and its board).
    expect(ui.container.querySelectorAll('.gs-detail .lb-row')).toHaveLength(1);
    expect(text('.gs-detail .lb-row-name')).toEqual(['Nadja']);
    expect(text('.gs-detail .lb-row-record')).toEqual(['9–4']);
    expect(detail().querySelectorAll('.cv2-tile .card')).toHaveLength(7);
    expect(text('.gs-detail .lb-rune-name').slice(0, 2)).toEqual(['Spellslinging', 'Happy Birthday']);
    expect(detail().querySelectorAll('.lb-rune-em img, .lb-rune-em svg')).toHaveLength(2);
    expect(detail().querySelector('.lb-verdict')?.className).toBe('gc-place won lb-verdict won');
    // length · rounds · board strength (only on the scored game). The lobby strength is HIDDEN for now (owner 2026-09-30).
    expect(text('.gs-detail .lb-fact-v')).toEqual(['18 min', '15', '72']);
    expect(text('.gs-detail .lb-fact-lobby')).toEqual([]);
    const fact = ui.container.querySelector('.lb-fact-bstrength')!.parentElement!;
    expect(fact.querySelector('.lb-fact-l')?.textContent).toBe('Game strength');
    expect(fact.getAttribute('data-tip')).toMatch(/Later rounds count more\.$/);
    expect(fact.getAttribute('title')).toBeNull();
    // Another game: its own facts, its own (empty) runes, one card still.
    pick(1);
    expect(ui.container.querySelectorAll('.gs-detail .lb-row')).toHaveLength(1);
    expect(text('.gs-detail .lb-row-record')).toEqual(['4–5–1']);
    expect(detail().querySelector('.lb-runes-none')?.textContent).toBe('No runes taken');
    expect(text('.gs-detail .lb-fact-v')).toEqual(['7 min', '11']);
    expect(text('.gs-detail .lb-verdict')).toEqual(['5th']);
    pick(2);
    expect(text('.gs-detail .lb-row-record')).toEqual(['3 wins']); // no record → the scalar wins column
    expect(text('.gs-detail .lb-fact-v')).toEqual(['—']);
  });

  it('a ranked game loads its lobby on demand (the player\u2019s career row, by seed); none recorded = no lobby section at all', async () => {
    expect(fetchRecentMatch).toHaveBeenCalledWith(91, 'u-top');
    expect(ui.container.querySelector('.lp-tilewrap')).toBeNull(); // nothing came back: no section, no gap
    const seats = Array.from({ length: 8 }, (_, j) => ({ id: `s${j}`, name: j === 0 ? 'Nadja' : `P${j}`, heroId: 'brackus', ...(j === 0 ? { self: true } : {}), placement: j + 1, health: 0, armor: 0, board: { round: 9, tier: 4, minions: board(3).minions } }));
    fetchRecentMatch.mockResolvedValue({ v: 1, endRound: 12, placement: 1, eliminated: false, seats });
    ui.unmount();
    clearSocialCache();
    ui = mount(<RecentGames />);
    await flush();
    await flush();
    expect(ui.container.querySelectorAll('.gs-detail .lp-tile')).toHaveLength(8);
    expect(ui.container.querySelector('.lp-showing-v')?.textContent).toBe('Your board');
  });

  it('Up / Down on the list move the selection', () => {
    const list = ui.container.querySelector('.gs-list')!;
    act(() => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    expect(text('.gs-detail .lb-row-name')).toEqual(['Kev']);
    act(() => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
    expect(text('.gs-detail .lb-row-name')).toEqual(['Nadja']);
  });

  it('with SHOW_LOBBY_STRENGTH on, the Lobby % returns, only on a game that carries the stamp', async () => {
    lobbyDisplay.show = true;
    try {
      ui.unmount();
      ui = mount(<RecentGames />);
      await flush();
      expect(text('.gs-detail .lb-fact-v')).toEqual(['18 min', '15', '74%', '72']);
      expect(text('.lb-fact-lobby')).toEqual(['74%']);
      pick(1);
      expect(text('.lb-fact-lobby')).toEqual([]);
    } finally { lobbyDisplay.show = false; }
  });

  it('labels the partial recording, and the board-less game gets the empty plate', () => {
    expect(detail().querySelector('.lb-partial')).toBeNull();
    pick(1);
    expect(detail().classList.contains('partial')).toBe(true);
    expect(detail().querySelector('.lb-partial')?.textContent).toBe('Partial recording · from round 5');
    pick(2);
    expect(detail().querySelector('.lb-team-none')?.textContent).toBe('No board recorded for this game');
    expect(detail().querySelectorAll('.cv2-tile')).toHaveLength(0);
  });

  it('ONE Replay button on the open game, live only with a replay; a click fetches that game’s payload and starts the viewer', async () => {
    pick(2);
    let btns = [...ui.container.querySelectorAll('.lb-watch')] as HTMLButtonElement[];
    expect(btns).toHaveLength(1);
    expect([btns[0]!.disabled, btns[0]!.textContent]).toEqual([true, 'No replay']);
    pick(0);
    btns = [...ui.container.querySelectorAll('.lb-watch')] as HTMLButtonElement[];
    expect([btns[0]!.disabled, btns[0]!.textContent]).toEqual([false, 'Replay']);
    click(btns[0]!);
    await flush();
    expect(fetchReplayPayload).toHaveBeenCalledWith(91);
    expect(startReplay).toHaveBeenCalledTimes(1);
    expect(useGame.getState().showCareer).toBe(false);
  });

  it('a game with a known player has a Career button that opens their Career; a pre-accounts game has none', async () => {
    pick(2);
    expect(ui.container.querySelector('.lb-career')).toBeNull();
    pick(0);
    click(ui.container.querySelector('.lb-career'));
    await flush();
    expect(useGame.getState().showCareer).toBe(true);
    expect(useGame.getState().careerOf?.userId).toBe('u-top');
    expect(useGame.getState().careerOf?.rank).toBeUndefined(); // the profile fetch answered without a rank
  });

  it('the profile fetch that opens a Career hands its medal rank over too', async () => {
    const rank = { seasonId: 3, rulesVersion: 1, revision: 2, position: { divisionIndex: 0, points: 46, demotionReady: false }, highest: { divisionIndex: 0, points: 46, demotionReady: false } };
    fetchPlayerById.mockResolvedValue({ userId: 'u-top', author: 'Nadja', rating: 46, gamesPlayed: 46, favoriteHero: 'brackus', rank });
    click(ui.container.querySelector('.lb-career'));
    await flush();
    expect(fetchPlayerById).toHaveBeenCalledWith('u-top');
    const of = useGame.getState().careerOf!;
    expect(of.userId).toBe('u-top');
    expect(of.rating).toBe(46);
    expect(of.rank).toEqual(rank);
  });
});

describe('RecentGames — the portrait wears the frame + skin recorded with the game (owner 2026-10-16, R-PROG-FRAMES-LIST-01)', () => {
  const frames = (): Array<string | null> => [...ui.container.querySelectorAll('.gs-item .lb-heroframe')].map((n) => n.querySelector('.pframe-box')?.getAttribute('data-frame') ?? null);
  const portraitSrc = (): string[] => [...ui.container.querySelectorAll('.gs-item .lb-heroframe .heroimg')].map((n) => n.getAttribute('src') ?? '');
  const withCosmetics = (): RecentGameRow[] => [
    game({ board: { ...board(7), cosmetics: { portraitFrame: 'frame_fire', heroSkinByHeroId: { brackus: 'skin_brackus_2' } } } as BoardSnapshot }),
    game({ userId: 'me-1', author: 'Kev', heroId: 'sable', rowId: 90, board: { ...board(5, 'sable'), cosmetics: { portraitFrame: 'frame_gold' } } as BoardSnapshot }),
    GAMES[2]!,
  ];

  it('another player’s game shows their recorded frame and skin; yours shows yours; a board-less game the default ring', async () => {
    fetchRecentGames.mockResolvedValue(withCosmetics());
    useGame.setState({ showRecentGames: true, showOpponentSkins: true });
    ui = mount(<RecentGames />);
    await flush();
    expect(frames()).toEqual(['frame_fire', 'frame_gold', null]);
    expect(portraitSrc()[0]).toContain('skin_brackus_2');
  });

  it('"Show opponent cosmetics" off strips other players’ frame + skin but never your own', async () => {
    fetchRecentGames.mockResolvedValue(withCosmetics());
    useGame.setState({ showRecentGames: true, showOpponentSkins: false });
    ui = mount(<RecentGames />);
    await flush();
    expect(frames()).toEqual([null, 'frame_gold', null]);
    expect(portraitSrc()[0]).not.toContain('skin_');
  });
});

describe('RecentGames — the Practice tab (owner ask 2026-09-24)', () => {
  beforeEach(async () => {
    useGame.setState({ showRecentGames: true });
    ui = mount(<RecentGames />);
    await flush();
  });
  const tabs = (): HTMLButtonElement[] => [...ui.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const selected = (): string => (ui.container.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? '').trim();
  const pick = (i: number): void => click(ui.container.querySelectorAll('.gs-item')[i]!);

  it('opens on Ranked (the feed as before) and does not read practice games until the tab is picked', () => {
    expect(ui.container.querySelector('[role="tablist"]')?.classList.contains('cv2-tabs')).toBe(true); // the Career tab style
    expect(tabs().map((t) => t.textContent?.trim())).toEqual(['Ranked', 'Practice']);
    expect(selected()).toBe('Ranked');
    expect(text('.gs-item .gs-title')).toEqual(['Nadja', 'Kev', 'Robin']);
    expect(fetchPracticeGames).not.toHaveBeenCalled();
  });

  it('Practice lists the latest practice games: the same card, the practice options as facts, and no Watch', async () => {
    click(tabs()[1]!);
    await flush();
    expect(selected()).toBe('Practice');
    expect(fetchPracticeGames).toHaveBeenCalledTimes(1);
    expect(text('.gs-item .gs-title')).toEqual(['Nadja', 'Kev']);
    expect(text('.gs-item .gs-place')).toEqual(['3rd', '6th']);
    expect(text('.gs-detail .lb-row-record')).toEqual(['9–4']);
    expect(text('.gs-detail .lb-fact-l')).toEqual(['Length', 'Rounds', 'Opponents', 'Health']);
    expect(text('.gs-detail .lb-fact-v')).toEqual(['18 min', '15', 'Bots Lv 5', 'Unlimited']);
    pick(1);
    expect(text('.gs-detail .lb-row-record')).toEqual(['3–6']);
    expect(text('.gs-detail .lb-fact-v')).toEqual(['18 min', '9', 'Players', 'Normal']);
    expect(ui.container.querySelectorAll('.lb-watch')).toHaveLength(0);
    expect(ui.container.querySelector('.lbsub')?.textContent).toContain('practice games');
  });

  it('a practice game WITH a replay (owner 2026-09-27) offers Watch, reading the practice table by id; games without one show none', async () => {
    fetchPracticeGames.mockResolvedValue([{ ...PRACTICE[0]!, hasReplay: true }, PRACTICE[1]!]);
    click(tabs()[1]!);
    await flush();
    pick(1);
    expect(ui.container.querySelector('.lb-watch')).toBeNull();
    pick(0);
    const watches = [...ui.container.querySelectorAll('.lb-watch')];
    expect(watches).toHaveLength(1);
    click(watches[0]!);
    await flush();
    expect(fetchPracticeReplay).toHaveBeenCalledWith(5);
    expect(fetchReplayPayload).not.toHaveBeenCalled();
    expect(startReplay).toHaveBeenCalledTimes(1);
    expect(useGame.getState().showCareer).toBeFalsy();
  });

  it('a practice game’s Career button opens the player’s Career without focusing a run (practice is not in their match history)', async () => {
    click(tabs()[1]!);
    await flush();
    click(ui.container.querySelector('.lb-career'));
    await flush();
    expect(useGame.getState().showCareer).toBe(true);
    expect(useGame.getState().careerOf?.userId).toBe('u-top');
    expect(useGame.getState().careerOf?.focus).toBeUndefined();
  });

  it('switching back and forth keeps each list (no refetch, no loading flash)', async () => {
    click(tabs()[1]!);
    await flush();
    click(tabs()[0]!);
    await flush();
    expect(selected()).toBe('Ranked');
    expect(text('.gs-item .gs-title')).toEqual(['Nadja', 'Kev', 'Robin']);
    click(tabs()[1]!);
    await flush();
    expect(text('.gs-item .gs-title')).toEqual(['Nadja', 'Kev']);
    expect(fetchRecentGames).toHaveBeenCalledTimes(1);
    expect(fetchPracticeGames).toHaveBeenCalledTimes(1);
  });
});

describe('RecentGames — designed states', () => {
  it('Practice empty (none played yet, or the table not migrated): its own empty state', async () => {
    fetchPracticeGames.mockResolvedValue([]);
    useGame.setState({ showRecentGames: true });
    ui = mount(<RecentGames />);
    await flush();
    click(ui.container.querySelectorAll('[role="tab"]')[1]!);
    await flush();
    expect(ui.container.querySelector('.lb-state')?.textContent).toContain('No practice games yet');
    expect(ui.container.querySelectorAll('.gs-item')).toHaveLength(0);
  });

  it('empty: "No recordings yet"', async () => {
    fetchRecentGames.mockResolvedValue([]);
    useGame.setState({ showRecentGames: true });
    ui = mount(<RecentGames />);
    await flush();
    expect(ui.container.querySelector('.lb-state')?.textContent).toContain('No recordings yet');
  });
});
