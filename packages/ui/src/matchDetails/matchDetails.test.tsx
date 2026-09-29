// @vitest-environment jsdom
/**
 * MATCH DETAILS (owner ask 2026-09-28; the Discord request "i placed 6th but wanted to see what everyone else looked
 * like at the time of my loss"). Pins the words the scoreboard prints, the seat it opens on, the skin rule (your own
 * recorded skins as-is, everyone else's through "Show opponent skins"), the end screen dialog (Esc closes it), and
 * the Career match card's expand / collapse, including an older match with no details.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { cosmeticOf } from '@game/progression';
import type { MatchDetails, MatchSeat } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import type { CareerRun } from '../careerData';
import { asPracticeGameRow, type PracticeGameRow } from '../remoteBoards';
import { careerRunOf } from '../careerData';

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const fetchMyRuns = vi.fn<() => Promise<CareerRun[] | null>>();
const fetchMyPracticeGames = vi.fn<() => Promise<PracticeGameRow[] | null>>();
const fetchHallRecords = vi.fn<() => Promise<Array<{ runKey: string }>>>(async () => []);
let backend = true;
vi.mock('../remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../remoteBoards')>()),
  remoteEnabled: () => backend,
  fetchHallRecords: () => fetchHallRecords(),
  fetchMyRuns: () => fetchMyRuns(),
  fetchMyPracticeGames: () => fetchMyPracticeGames(),
  fetchPlayerById: async () => null,
  fetchPlayerRating: async () => undefined,
}));
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'me-1' }));

import { Career } from '../Career';
import { useGame } from '../store';
import { heroArt } from '../art';
import { skinArtOf } from '../skins/skins';
import { MatchDetailsDialog, MatchScoreboard } from './MatchScoreboard';
import { resetHallKeysForTests } from './hallKeys';
import { NO_DETAILS_TEXT, boardCaption, defaultSeatId, placeLabel, statusText, summaryText, youWon } from './matchDetailsText';

const seat = (over: Partial<MatchSeat> & { id: string }): MatchSeat => ({
  name: over.id, heroId: 'warden', health: 0, armor: 0, board: { round: 11, tier: 4, minions: [{ cardId: 'pack', attack: 3, health: 3 }] }, ...over,
});

/** You were knocked out 6th in round 11 by s4; s1 fell in round 5, s7 went out alongside you. */
const LOSS: MatchDetails = {
  v: 1, endRound: 11, placement: 6, eliminated: true, knockedOutBy: 's4',
  seats: [
    seat({ id: 's3', name: 'Skye', heroId: 'albus', health: 22, armor: 5, runKey: 'Skye|albus|4242', cosmetics: { heroSkinByHeroId: { albus: 'skin_albus_1' } } }),
    seat({ id: 's4', name: 'Rook', health: 18, board: { round: 11, tier: 5, minions: [{ cardId: 'pack', attack: 3, health: 3 }], runes: ['rune_broodpit', 'rune_epic_forge', 'rune_not_in_this_build'] } }),
    seat({ id: 's5', name: 'Pim', health: 12 }),
    seat({ id: 's6', name: 'Juno', health: 9 }),
    seat({ id: 's2', name: 'Vex', health: 3 }),
    seat({ id: 's0', name: 'Kev', self: true, placement: 6, eliminatedRound: 11, titleId: 'alpha_tester' }),
    seat({ id: 's7', name: 'Tam', placement: 6, eliminatedRound: 11 }),
    seat({ id: 's1', name: 'Olde', placement: 8, eliminatedRound: 5, board: { round: 5, tier: 2, minions: [{ cardId: 'pack', attack: 1, health: 1 }] } }),
  ],
};
/** You won in round 14; everyone else is placed. */
const WIN: MatchDetails = {
  v: 1, endRound: 14, placement: 1, eliminated: false,
  seats: [
    seat({ id: 's0', name: 'Kev', self: true, placement: 1, health: 20, armor: 0, board: { round: 14, tier: 6, minions: [] } }),
    seat({ id: 's2', name: 'Vex', placement: 2, eliminatedRound: 14 }),
    seat({ id: 's1', name: 'Olde', placement: 3, eliminatedRound: 9, board: { round: 9, tier: 3, minions: [] } }),
  ],
};
const byId = (d: MatchDetails, id: string): MatchSeat => d.seats.find((s) => s.id === id)!;

describe('the words', () => {
  it('placement badge: the ordinal, or "Top N" for a seat still standing when you fell', () => {
    expect(placeLabel(byId(LOSS, 's3'), LOSS)).toBe('Top 5');
    expect(placeLabel(byId(LOSS, 's0'), LOSS)).toBe('6th');
    expect(placeLabel(byId(LOSS, 's1'), LOSS)).toBe('8th');
    expect(placeLabel(byId(WIN, 's0'), WIN)).toBe('1st');
  });

  it('status: Winner, Out in round N, Still in', () => {
    expect(statusText(byId(LOSS, 's3'), LOSS)).toBe('Still in');
    expect(statusText(byId(LOSS, 's0'), LOSS)).toBe('Out in round 11');
    expect(statusText(byId(LOSS, 's1'), LOSS)).toBe('Out in round 5');
    expect(statusText(byId(WIN, 's0'), WIN)).toBe('Winner');
    expect(youWon(WIN)).toBe(true);
    // Practice's curtain: you are standing, and so is the table. Not a win.
    const curtain: MatchDetails = { ...WIN, seats: [byId(WIN, 's0'), seat({ id: 's3', health: 9 })] };
    expect(youWon(curtain)).toBe(false);
    expect(statusText(byId(curtain, 's0'), curtain)).toBe('Still in');
  });

  it('the caption names the moment the board is from', () => {
    expect(boardCaption(byId(LOSS, 's3'), LOSS)).toBe('Their board when you were knocked out, round 11');
    expect(boardCaption(byId(LOSS, 's1'), LOSS)).toBe('Their board when they were knocked out, round 5');
    expect(boardCaption(byId(LOSS, 's7'), LOSS)).toBe('Their board when you were both knocked out, round 11');
    expect(boardCaption(byId(LOSS, 's0'), LOSS)).toBe('Your board when you were knocked out, round 11');
    expect(boardCaption(byId(WIN, 's0'), WIN)).toBe('Your board when you won, round 14');
    expect(boardCaption(byId(WIN, 's1'), WIN)).toBe('Their board when they were knocked out, round 9');
    expect(summaryText(LOSS)).toBe('You placed 6th. Round 11.');
    expect(summaryText(WIN)).toBe('You won in round 14.');
  });

  it('opens on whoever knocked you out, else the best other seat', () => {
    expect(defaultSeatId(LOSS)).toBe('s4');
    expect(defaultSeatId(WIN)).toBe('s2');
  });

  it('no player text uses an em dash or a double hyphen', () => {
    const all = [LOSS, WIN].flatMap((d) => [summaryText(d), ...d.seats.flatMap((s) => [placeLabel(s, d), statusText(s, d), boardCaption(s, d)])]);
    for (const t of [...all, NO_DETAILS_TEXT]) expect(t, t).not.toMatch(/—|--/);
  });
});

let ui: Mounted | null = null;
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
afterEach(() => { ui?.unmount(); ui = null; useGame.setState({ showCareer: false, showOpponentSkins: true }); });

describe('the scoreboard', () => {
  it('lists every seat in the recorded order and shows the selected seat\'s board', () => {
    ui = mount(<MatchScoreboard details={LOSS} own />);
    const rows = [...ui.container.querySelectorAll('.mds-row')];
    expect(rows.map((r) => r.getAttribute('data-seat'))).toEqual(LOSS.seats.map((s) => s.id));
    // opens on the seat that knocked you out
    expect(ui.container.querySelector('.mds-row.on')?.getAttribute('data-seat')).toBe('s4');
    expect(ui.container.querySelector('.mds-row[data-seat="s4"] .mds-killer')).not.toBeNull();
    // your row: your title, the You tag, no health (you are out)
    const me = ui.container.querySelector('.mds-row[data-seat="s0"]')!;
    expect(me.querySelector('.mds-tag.you')).not.toBeNull();
    expect(me.querySelector('.mds-title')?.textContent).toBe('Alpha Tester');
    expect(me.querySelector('.mds-hp')).toBeNull();
    // a click swaps the board and its caption
    click(ui.container.querySelector('.mds-row[data-seat="s1"]'));
    expect(ui.container.querySelector('.mds-row.on')?.getAttribute('data-seat')).toBe('s1');
    expect(ui.container.querySelector('.mds-board-caption')?.textContent).toBe('Their board when they were knocked out, round 5');
    expect(ui.container.querySelectorAll('.mds-team .cv2-tile:not(.empty)')).toHaveLength(1);
    // no native tooltips anywhere
    expect(ui.container.querySelector('[title]')).toBeNull();
  });

  it('STEADY (owner report 2026-09-28, the jitter): board cards stay compact tiles whatever the card-text setting, the strip keeps one height, and the panel reserves its scrollbar gutter', () => {
    useGame.setState({ compactCards: false }); // the full-text setting: its drawer hung below the tile and made the panel scroll
    ui = mount(<MatchScoreboard details={LOSS} own />);
    expect(ui.container.querySelectorAll('.mds-team .card').length).toBeGreaterThan(0);
    expect(ui.container.querySelectorAll('.mds-team .card.showtext')).toHaveLength(0);
    // Picking seats re-renders the board, never the rows' order or count (no re-sort, no loop).
    const order = (): string[] => [...ui!.container.querySelectorAll('.mds-row')].map((r) => r.getAttribute('data-seat')!);
    const first = order();
    for (const id of first) click(ui.container.querySelector(`.mds-row[data-seat="${id}"]`));
    expect(order()).toEqual(first);
    useGame.setState({ compactCards: true });
    const css = readFileSync(join(__dirname, 'matchDetails.css'), 'utf8');
    expect(css).toMatch(/\.mdd-panel[^}]*scrollbar-gutter:\s*stable/);
    expect(css).toMatch(/\.mdd-panel[^}]*overflow-anchor:\s*none/);
    expect(css).toMatch(/\.mds-team \{[^}]*min-height:\s*192px/);
    expect(css).toMatch(/body:has\(\.mdd-scrim\) \.cardref \{ z-index: 580; \}/);
  });

  it('RUNES (owner 2026-09-28): the rune choices of the selected player sit under their board; none reads "No runes"', () => {
    ui = mount(<MatchScoreboard details={LOSS} own />);
    // opens on Rook (knocked you out), who owned two known runes (+ one this build does not ship: skipped)
    expect([...ui.container.querySelectorAll('.mds-runes .cv2-rune-name')].map((n) => n.textContent)).toHaveLength(2);
    click(ui.container.querySelector('.mds-row[data-seat="s3"]'));
    expect(ui.container.querySelector('.mds-runes .cv2-rune')).toBeNull();
    expect(ui.container.querySelector('.mds-norunes')?.textContent).toBe('No runes');
  });

  it('an empty or missing board says so plainly', () => {
    ui = mount(<MatchScoreboard details={{ ...WIN, seats: [...WIN.seats, seat({ id: 's9', placement: 4, eliminatedRound: 3, board: null })] }} own />);
    click(ui.container.querySelector('.mds-row[data-seat="s1"]'));
    expect(ui.container.querySelector('.mds-empty')?.textContent).toBe('This board was empty.');
    click(ui.container.querySelector('.mds-row[data-seat="s9"]'));
    expect(ui.container.querySelector('.mds-empty')?.textContent).toBe('No board was recorded for this player.');
  });

  it('opponent skins follow the "Show opponent skins" toggle; your own recorded skins never do', () => {
    const skinned = skinArtOf(cosmeticOf('skin_albus_1'));
    expect(skinned).toBeTruthy();
    const portrait = (id: string): string | null => ui!.container.querySelector(`.mds-row[data-seat="${id}"] img.heroimg`)?.getAttribute('src') ?? null;
    const own: MatchDetails = { ...LOSS, seats: LOSS.seats.map((s) => (s.id === 's0' ? { ...s, heroId: 'albus', cosmetics: { heroSkinByHeroId: { albus: 'skin_albus_1' } } } : s)) };
    useGame.setState({ showOpponentSkins: true });
    ui = mount(<MatchScoreboard details={own} own />);
    expect(portrait('s3')).toBe(skinned);
    expect(portrait('s0')).toBe(skinned);
    act(() => { useGame.setState({ showOpponentSkins: false }); });
    expect(portrait('s3')).toBe(heroArt('albus')); // an opponent: default art with the toggle off
    expect(portrait('s0')).toBe(skinned); // yours: as recorded
    // Someone else's record (their Career): their own seat is an opponent to you too.
    ui.render(<MatchScoreboard details={own} own={false} />);
    expect(portrait('s0')).toBe(heroArt('albus'));
  });

  it('the end screen dialog closes on Esc and on its close button', () => {
    const onClose = vi.fn();
    ui = mount(<MatchDetailsDialog details={LOSS} onClose={onClose} />);
    const panel = document.querySelector('.mdd-panel');
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(document.activeElement?.classList.contains('mdd-close')).toBe(true);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    click(document.querySelector('.mdd-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('the Hall of Champions crown (owner ask 2026-09-28)', () => {
  const crowned = (): string[] => [...ui!.container.querySelectorAll('.mds-row')].filter((r) => r.querySelector('.mds-hall')).map((r) => r.getAttribute('data-seat')!);
  beforeEach(() => { resetHallKeysForTests(); fetchHallRecords.mockReset().mockResolvedValue([]); backend = true; });

  it('crowns exactly the seats whose run is on the Hall now; ONE read however often the panel re-renders, cached for the session', async () => {
    fetchHallRecords.mockResolvedValue([{ runKey: 'Skye|albus|4242' }, { runKey: 'Someone|warden|1' }]);
    ui = mount(<MatchScoreboard details={LOSS} own />);
    await flush();
    expect(crowned()).toEqual(['s3']);
    const crown = ui.container.querySelector('.mds-row[data-seat="s3"] .mds-hall')!;
    expect(crown.getAttribute('aria-label')).toBe('On the Hall of Champions');
    expect(crown.getAttribute('data-tip')).toBe('On the Hall of Champions');
    expect(crown.hasAttribute('title')).toBe(false);
    click(ui.container.querySelector('.mds-row[data-seat="s3"]'));
    expect(ui.container.querySelector('.mds-board-name .mds-hall')).not.toBeNull(); // and on the board header
    for (const id of ['s1', 's4', 's0']) click(ui.container.querySelector(`.mds-row[data-seat="${id}"]`));
    ui.render(<MatchScoreboard details={LOSS} own />);
    await flush();
    ui.unmount(); ui = mount(<MatchScoreboard details={LOSS} own />); // a second panel open
    await flush();
    expect(crowned()).toEqual(['s3']);
    expect(fetchHallRecords).toHaveBeenCalledTimes(1);
  });

  it('a failed or empty read shows no crown and no error', async () => {
    fetchHallRecords.mockResolvedValue([]); // fetchHallRecords answers [] on any failure
    ui = mount(<MatchScoreboard details={LOSS} own />);
    await flush();
    expect(crowned()).toEqual([]);
    expect(ui.container.querySelectorAll('.mds-row')).toHaveLength(8); // the panel renders regardless
  });

  it('offline (no backend): no read at all, no crown', async () => {
    backend = false;
    ui = mount(<MatchScoreboard details={LOSS} own />);
    await flush();
    expect(fetchHallRecords).not.toHaveBeenCalled();
    expect(crowned()).toEqual([]);
  });

  it('a table with no real runs (all bots) never asks', async () => {
    ui = mount(<MatchScoreboard details={WIN} own />);
    await flush();
    expect(fetchHallRecords).not.toHaveBeenCalled();
  });
});

describe('the Career match card', () => {
  const NOW = Date.now();
  const run = (over: Partial<CareerRun>): CareerRun => ({
    id: 1, heroId: 'warden', at: new Date(NOW).toISOString(), atMs: NOW, wave: 11, wins: 5, losses: 5, draws: 0, placement: 6,
    goldSpent: 80, apt: 20, ratingDelta: null, ratingAfter: null, seed: 1, dominantTribe: null, mode: 'lobby', board: null, detailed: true, runes: [],
    replayRowId: null, durationMs: null, lobbyStrength: null, ...over,
  });

  beforeEach(async () => {
    try { localStorage.removeItem('ascent.career.tab'); } catch { /* jsdom */ }
    fetchMyRuns.mockReset().mockResolvedValue([run({ id: 2, match: LOSS }), run({ id: 1, seed: 2, match: null })]);
    fetchMyPracticeGames.mockReset().mockResolvedValue([]);
    useGame.setState({ showCareer: true, careerOf: null, careerCache: null, playerName: 'Kev', account: { userId: 'me-1', email: null, anonymous: true, discriminator: null } });
    ui = mount(<Career />);
    await flush();
  });

  it('a chevron grows the card to show the lobby, and collapses it again', () => {
    const toggles = [...ui!.container.querySelectorAll('.cv2-lobbybtn')];
    expect(toggles).toHaveLength(2);
    expect(toggles[0]!.getAttribute('aria-expanded')).toBe('false');
    expect(ui!.container.querySelector('.cv2-lobby')).toBeNull(); // nothing mounted while collapsed
    click(toggles[0]);
    expect(toggles[0]!.getAttribute('aria-expanded')).toBe('true');
    const panel = ui!.container.querySelector('.cv2-row .cv2-lobby')!;
    expect(panel.id).toBe(toggles[0]!.getAttribute('aria-controls'));
    expect(panel.querySelectorAll('.mds-row')).toHaveLength(8);
    click(panel.querySelector('.mds-row[data-seat="s3"]'));
    expect(panel.querySelector('.mds-board-caption')?.textContent).toBe('Their board when you were knocked out, round 11');
    click(toggles[0]);
    expect(ui!.container.querySelector('.cv2-lobby')).toBeNull();
  });

  it('an older match with no recorded details says so', () => {
    const toggles = [...ui!.container.querySelectorAll('.cv2-lobbybtn')];
    click(toggles[1]);
    expect(ui!.container.querySelector('.cv2-lobby-none')?.textContent).toBe(NO_DETAILS_TEXT);
  });
});

describe('stored records (old records stay readable)', () => {
  const stored = JSON.parse(JSON.stringify(LOSS));
  it('a ranked career entry carries its match (`entry.match`); an entry from before it reads null', () => {
    expect(careerRunOf({ id: 3, entry: { heroId: 'warden', wave: 11, wins: 5, match: stored } }).match).toEqual(LOSS);
    expect(careerRunOf({ id: 2, entry: { heroId: 'warden', wave: 11, wins: 5 } }).match).toBeNull();
    expect(careerRunOf({ id: 1, hero_id: 'warden', wave: 11, wins: 5 }).match).toBeNull(); // a light row
  });
  it('a practice row reads `replay->match`; an older row (or the pre-replay select) reads null', () => {
    expect(asPracticeGameRow({ id: 9, hero_id: 'warden', match: stored }).match).toEqual(LOSS);
    expect(asPracticeGameRow({ id: 8, hero_id: 'warden' }).match).toBeNull();
    expect(asPracticeGameRow({ id: 7, hero_id: 'warden', match: { v: 99 } }).match).toBeNull();
  });
});
