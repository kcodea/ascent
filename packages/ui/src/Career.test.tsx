// @vitest-environment jsdom
/**
 * THE CAREER PAGE (owner rebuild 2026-09-19/20) — a jsdom render over three fixture runs from a mocked
 * `fetchMyRuns`: a 1st-place run with a full 7-minion (one gilded) team, two runes and a replay; a 3rd-place
 * run with no board / no runes / a clock but no watchable replay; and a light 7th-place run with no telemetry
 * at all. Pins the three-column layout's contents: the most-played hero in the in-run frame + the four tiles;
 * the Match History BANNERS (head: hero + the MATCH result ‖ outcome block · team: 7 slots · foot: runes ‖ ONE
 * Watch button, live only with a replay); the MMR as a bare number (no delta); the three trend charts + window
 * toggle; the designed loading / signed-out / offline / empty states; the HEROES tab (a PORTRAIT GRID folded over
 * every run, with a hover / focus panel per hero; the choice persisted); the three columns sharing one header
 * row; the Seasonal Ranked card as the medal rank (crest in the portrait ring + bar + the scalar caption) — for
 * your own profile and for a VIEWED player (rank handed over on `careerOf.rank`, or fetched by user id; the
 * bare number only when neither yields a rank; owner 2026-09-21).
 * A MATCH WIN IS BY PLACEMENT (owner 2026-09-20): top 4 = W, 5th–8th = L — the banner result, the hero
 * panel's record and the Win Rate trend all use it. Also pins what must NOT be there: any board-power stat, a
 * Share button, a rating delta, the old Insight grid, per-hero rows, a native `title` tooltip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';
import type { CareerRun } from './careerData';
import type { PlayerRow } from './remoteBoards';

// The real `Card` mounts a <canvas> sprite fallback; jsdom has no 2D context (and logs "not implemented" per
// card without this). `drawSprite` returns early on a null context.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const fetchMyRuns = vi.fn<(limit?: number, opts?: { userId?: string }) => Promise<CareerRun[] | null>>();
const fetchReplayPayload = vi.fn<(rowId: number) => Promise<unknown>>();
const fetchPlayerById = vi.fn<(userId: string) => Promise<PlayerRow | null>>();
const startReplay = vi.fn();

vi.mock('./remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./remoteBoards')>()),
  remoteEnabled: () => true,
  fetchMyRuns: (...a: [number?, { userId?: string }?]) => fetchMyRuns(...a),
  fetchReplayPayload: (id: number) => fetchReplayPayload(id),
  fetchPlayerById: (id: string) => fetchPlayerById(id),
  fetchPlayerRating: async () => undefined, // syncProfileFromServer: "couldn't ask" → keep the local rating
}));
vi.mock('./replay/replayPlayer', () => ({ startReplay: (...a: unknown[]) => startReplay(...a) }));

import { Career } from './Career';
import { useGame } from './store';

const DAY = 86_400_000;
const NOW = Date.now();
const run = (over: Partial<CareerRun>): CareerRun => ({
  id: 1, heroId: 'brackus', at: new Date(NOW).toISOString(), atMs: NOW, wave: 12, wins: 6, losses: 4, draws: 0, placement: 3,
  goldSpent: 80, apt: 25, ratingDelta: 10, seed: 1, dominantTribe: 'beast', mode: 'lobby', board: null, detailed: true, runes: [],
  replayRowId: null, durationMs: null, ...over,
});
/** A full 7-minion final team, the 4th one gilded (a triple). */
const FULL_TEAM = {
  minions: [
    { cardId: 'alley', name: 'Alleycat', attack: 12, health: 14 },
    { cardId: 'stray', name: 'Stray', attack: 2, health: 2 },
    { cardId: 'pack', name: 'Pack Leader', attack: 8, health: 9 },
    { cardId: 'kennel', name: 'Kennel Master', attack: 20, health: 24, golden: true },
    { cardId: 'gnash', name: 'Gnasher', attack: 6, health: 7 },
    { cardId: 'trailforager', name: 'Trail Forager', attack: 5, health: 5 },
    { cardId: 'grim', name: 'Grim', attack: 30, health: 31 },
  ],
  wave: 15, heroId: 'sable', runes: ['rune_broodpit', 'rune_epic_forge'],
} as never;
const RUNS: CareerRun[] = [
  run({ id: 12, heroId: 'sable', atMs: NOW - 1 * DAY, wins: 9, losses: 4, placement: 1, goldSpent: 120, apt: 26.1, wave: 15, ratingDelta: 41, dominantTribe: 'beast', replayRowId: 97, durationMs: 883_179,
    board: FULL_TEAM, runes: ['rune_broodpit', 'rune_epic_forge'] }),
  run({ id: 11, heroId: 'brackus', atMs: NOW - 2 * DAY, wins: 5, losses: 5, placement: 3, goldSpent: 90, apt: null, durationMs: 690_108, board: null, runes: [], dominantTribe: 'mech' }), // no APT → no APM point, length still known
  run({ id: 10, heroId: 'brackus', atMs: NOW - 40 * DAY, wins: 2, losses: 5, placement: 7, goldSpent: null, apt: null, durationMs: null, board: null, runes: [], dominantTribe: 'beast', detailed: false }),
];

let ui: Mounted;
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const text = (sel: string): string[] => [...ui.container.querySelectorAll(sel)].map((n) => (n.textContent ?? '').trim());
const click = (el: Element | null): void => { act(() => { (el as HTMLElement).click(); }); };

beforeEach(async () => {
  try { localStorage.removeItem('ascent.career.tab'); } catch { /* jsdom */ }
  fetchMyRuns.mockReset().mockResolvedValue(RUNS);
  fetchReplayPayload.mockReset().mockResolvedValue({ version: 2, seed: 1, frames: [{}] });
  fetchPlayerById.mockReset().mockResolvedValue(null);
  startReplay.mockReset();
  useGame.setState({
    showCareer: true, careerOf: null, careerCache: null, playerName: 'Kev',
    account: { userId: 'me-1', email: null, anonymous: true, discriminator: null },
    profile: { ...useGame.getState().profile, rating: 1234, rank: { ...useGame.getState().profile.rank, position: { divisionIndex: 12, points: 34 }, highest: { divisionIndex: 12, points: 34 } } },
  });
  ui = mount(<Career />);
  await flush();
});
afterEach(() => { ui.unmount(); useGame.setState({ showCareer: false, careerOf: null, careerCache: null }); });

describe('the left column', () => {
  it('shows the most-played hero in the in-run frame markup (.hero > .f > img.heroimg) with its name plate', () => {
    const frame = ui.container.querySelector('.cv2-left .cv2-heroframe .hero .f');
    expect(frame).not.toBeNull();
    expect(frame!.querySelector('img.heroimg') ?? frame!.querySelector('svg')).not.toBeNull();
    // brackus: 2 of the 3 runs.
    expect(ui.container.querySelector('.cv2-left .cv2-heroname')?.textContent).toBe('Brackus');
    expect(ui.container.querySelector('.cv2-left .cv2-playername')?.textContent).toBe('Kev');
  });

  it('prints the five tiles from the server runs: 1st Place Wins · Top 4 Finish · Losses · Avg Placement · Favorite Tribe', () => {
    const labels = text('.cv2-left .cv2-stat-l');
    const values = text('.cv2-left .cv2-stat-v');
    expect(labels).toEqual(['1st Place Wins', 'Top 4 Finish', 'Losses', 'Avg Placement', 'Favorite Tribe']);
    // placements 1, 3, 7 → 1 first; top-4 = 2/3 = 67%; losses (5th–8th) = 1 (the 7th); avg = 11/3 = 3.7;
    // tribes beast, mech, beast → Beast
    expect(values).toEqual(['1', '67%', '1', '3.7', 'Beast']);
    // Losses sits directly under Top 4 Finish (owner ask 2026-09-21) and wears its own icon.
    const tiles = [...ui.container.querySelectorAll('.cv2-left .cv2-stat')];
    expect(tiles[2]!.querySelector('.cv2-stat-ico svg')).not.toBeNull();
  });
});

describe('the column header row', () => {
  it('all three columns start with the SAME header row (Career Stats · the Match History | Heroes tabs · Seasonal Ranked), so their panels start level', () => {
    const heads = [...ui.container.querySelectorAll('.cv2-cols > .cv2-col > .cv2-colhead')];
    expect(heads).toHaveLength(3);
    expect(heads.map((h) => h.textContent)).toEqual(['Career Stats', 'Match HistoryHeroesLast 3 runs', 'Seasonal Ranked']);
    // Each column's first panel is the header's next sibling — nothing else sits above a panel in any column.
    for (const h of heads) expect(h.nextElementSibling?.classList.contains('cv2-panel') || h.nextElementSibling?.classList.contains('cv2-list')).toBe(true);
    const tabs = [...ui.container.querySelectorAll<HTMLButtonElement>('.cv2-tabs [role=tab]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Match History', 'Heroes']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
  });
});

describe('Match History', () => {
  it('lists the server runs newest first as banners that read head → team → foot: hero + match result, the outcome block, 7 slots, runes, ONE button', () => {
    const rows = [...ui.container.querySelectorAll('.cv2-row')];
    expect(rows).toHaveLength(3);
    expect(ui.container.querySelector('.cv2-sec-sub')?.textContent).toBe('Last 3 runs');
    expect(text('.cv2-row .cv2-row-heroname')).toEqual(['Sable', 'Brackus', 'Brackus']);
    // The record under the name is the MATCH result by placement: 1st + 3rd = WIN, 7th = LOSS (owner 2026-09-20).
    expect(text('.cv2-row .cv2-row-result')).toEqual(['WIN', 'WIN', 'LOSS']);
    expect(rows.map((r) => r.querySelector('.cv2-row-result')?.classList.contains('win'))).toEqual([true, true, false]);
    expect(rows[2]!.querySelector('.cv2-row-result')?.classList.contains('loss')).toBe(true);
    expect(rows.map((r) => r.querySelector('.cv2-row-result')?.getAttribute('aria-label'))).toEqual(['Match win', 'Match win', 'Match loss']);
    // The fight record survives only as a small bare "N–M" caption (no "Fights" word — owner 2026-09-21; the
    // aria-label carries the meaning) — never the headline W–L any more.
    expect(text('.cv2-row .cv2-row-fights')).toEqual(['9–4', '5–5', '2–5']);
    expect(rows.map((r) => r.querySelector('.cv2-row-fights')?.getAttribute('aria-label'))).toEqual(['Fights: 9 won, 4 lost', 'Fights: 5 won, 5 lost', 'Fights: 2 won, 5 lost']);
    expect(ui.container.querySelector('.cv2-row-record')).toBeNull();
    // Reading order inside a banner: head (hero ‖ outcome) → team → foot (runes ‖ watch).
    for (const r of rows) {
      const kids = [...r.children].map((c) => c.className);
      expect(kids).toEqual(['cv2-row-head', 'cv2-row-team', 'cv2-row-foot']);
      expect(r.querySelector('.cv2-row-head .cv2-row-hero .cv2-heroframe.small .hero .f')).not.toBeNull();
      expect(r.querySelector('.cv2-row-head .cv2-row-outcome .cv2-verdict')).not.toBeNull();
      expect(r.querySelector('.cv2-row-team .cv2-row-label'), 'no "Final Team" label over the tiles (owner 2026-09-20)').toBeNull();
      expect(r.querySelector('.cv2-row-foot .cv2-row-runes .cv2-row-label')?.textContent).toBe('Runes');
      expect(r.querySelectorAll('button')).toHaveLength(1);
      expect(r.querySelector('.cv2-row-foot .cv2-watch')).not.toBeNull();
    }
    // Row 1 has a FULL board: exactly 7 slots, all real cards, the gilded one wearing the golden frame.
    const team = rows[0]!.querySelectorAll('.cv2-team .cv2-tile');
    expect(team).toHaveLength(7);
    expect(rows[0]!.querySelectorAll('.cv2-team .cv2-tile .card')).toHaveLength(7);
    expect(rows[0]!.querySelectorAll('.cv2-team .cv2-tile.empty')).toHaveLength(0);
    expect(rows[0]!.querySelectorAll('.cv2-team .card.golden')).toHaveLength(1);
    // The cards are the REAL Card (stat badges present, 2-digit stats printed).
    expect(rows[0]!.textContent).toContain('30');
    expect(rows[0]!.textContent).toContain('31');
    // Rows 2 + 3 stored no board → the team slot says so rather than showing seven blanks.
    expect(rows[1]!.querySelector('.cv2-team')).toBeNull();
    expect(rows[1]!.querySelector('.cv2-row-team .cv2-row-none')?.textContent).toMatch(/No final team recorded/);
    expect(rows[2]!.querySelector('.cv2-team')).toBeNull();
  });

  it('the run\'s rune selections: real rune art + name per pick, in pick order; "No runes recorded" otherwise', () => {
    const rows = [...ui.container.querySelectorAll('.cv2-row')];
    const runes = [...rows[0]!.querySelectorAll('.cv2-rune')];
    expect(runes.map((r) => r.querySelector('.cv2-rune-name')?.textContent)).toEqual(['Rune of the Broodpit', 'Rune of the Epic Forge']);
    expect(runes[0]!.classList.contains('epic')).toBe(true);   // Broodpit is an Epic rune
    expect(runes[1]!.classList.contains('epic')).toBe(false);
    for (const r of runes) {
      expect(r.querySelector('.cv2-rune-disc img.cv2-rune-art, .cv2-rune-disc .cv2-rune-emblem')).not.toBeNull();
      expect(r.getAttribute('title')).toBeNull(); // no native tooltip — the hover panel is ours
    }
    expect(rows[1]!.querySelector('.cv2-rune')).toBeNull();
    expect(rows[1]!.querySelector('.cv2-norunes')?.textContent).toBe('No runes recorded');
    expect(rows[2]!.querySelector('.cv2-norunes')?.textContent).toBe('No runes recorded');
  });

  it('hovering a rune floats its text in a styled panel (portalled, not clipped by the list) and leaving hides it', () => {
    vi.useFakeTimers();
    try {
      const rune = ui.container.querySelector('.cv2-rune') as HTMLElement;
      // React synthesises onMouseEnter/Leave from the bubbling mouseover/mouseout pair.
      act(() => { rune.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); });
      expect(document.querySelector('.cv2-rune-tip')).toBeNull(); // a short hover delay first
      act(() => { vi.advanceTimersByTime(200); });
      const tip = document.querySelector('.cv2-rune-tip');
      expect(tip).not.toBeNull();
      expect(tip!.parentElement).toBe(document.body);
      expect(tip!.querySelector('.cv2-rune-tip-name')?.textContent).toContain('Rune of the Broodpit');
      expect(tip!.querySelector('.cv2-rune-tip-kind')?.textContent).toBe('Epic Rune');
      expect(tip!.querySelector('.cv2-rune-tip-body')?.textContent).toMatch(/Avenge \(4\):.*summon.*2 Imps with Taunt/);
      act(() => { rune.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
      expect(document.querySelector('.cv2-rune-tip')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the outcome block: VICTORY for 1st (green) else the placement; the date, run length and Gold, each labelled; "—" when unknown', () => {
    const verdicts = [...ui.container.querySelectorAll('.cv2-verdict')];
    expect(verdicts.map((v) => v.textContent)).toEqual(['VICTORY', '3RD', '7TH']);
    expect(verdicts[0]!.classList.contains('won')).toBe(true);
    expect(verdicts[1]!.classList.contains('top4')).toBe(true);
    expect(verdicts[2]!.classList.contains('lost')).toBe(true);
    // The banner's edge carries the same result colour.
    expect([...ui.container.querySelectorAll('.cv2-row')].map((r) => r.classList.contains('won'))).toEqual([true, false, false]);
    expect(text('.cv2-row-outcome .cv2-row-label')).toEqual(['Match Outcome', 'Match Outcome', 'Match Outcome']);
    expect(text('.cv2-row .cv2-meta-l')).toEqual(['Played', 'Length', 'Gold spent', 'Played', 'Length', 'Gold spent', 'Played', 'Length', 'Gold spent']);
    const when = text('.cv2-row-when');
    expect(when[0]).toMatch(/\d{4}$/);          // a real date
    expect(text('.cv2-row-length')).toEqual(['15 min', '12 min', '—']);   // 883 s · 690 s · no telemetry clock
    expect(text('.cv2-row-gold-v')).toEqual(['120', '90', '—']);
  });

  it('ONE button per row — Watch Replay — enabled only where a replay row exists; no Share button, no power stat, no rating delta', () => {
    const buttons = [...ui.container.querySelectorAll<HTMLButtonElement>('.cv2-watch')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Watch Replay', 'Watch Replay', 'Watch Replay']);
    expect(buttons.map((b) => b.disabled)).toEqual([false, true, true]);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Watch this run’s replay', 'No replay stored for this run', 'No replay stored for this run']);
    const all = ui.container.textContent ?? '';
    expect(all).not.toMatch(/share/i);
    expect(all).not.toMatch(/power/i);
    expect(all).not.toMatch(/\+41|−41|-41/);
    expect(ui.container.querySelector('.carinsights')).toBeNull();
    expect(ui.container.querySelector('[title]'), 'no native tooltips anywhere on the page').toBeNull();
  });

  it('Watch Replay fetches THAT run\'s telemetry payload and hands it to the replay viewer', async () => {
    click(ui.container.querySelector('.cv2-watch'));
    await flush();
    expect(fetchReplayPayload).toHaveBeenCalledWith(97);
    expect(startReplay).toHaveBeenCalledTimes(1);
    expect((startReplay.mock.calls[0] as unknown[])[1]).toMatchObject({ authorName: 'Kev' });
  });

  it('an unplayable payload degrades that one button to "No replay"', async () => {
    fetchReplayPayload.mockResolvedValue(null);
    click(ui.container.querySelector('.cv2-watch'));
    await flush();
    expect(startReplay).not.toHaveBeenCalled();
    expect(ui.container.querySelector<HTMLButtonElement>('.cv2-watch')?.textContent).toBe('No replay');
    expect(ui.container.querySelector<HTMLButtonElement>('.cv2-watch')?.disabled).toBe(true);
  });
});

describe('the right column', () => {
  it('Seasonal Ranked prints the MEDAL RANK — crest in the portrait ring, label, bar, points, the scalar as a caption — no delta', () => {
    const card = ui.container.querySelector('.cv2-ranked')!;
    expect(card.querySelector('.rankcrest.portring .hero .f img.heroimg')).not.toBeNull();
    expect(card.querySelector('.rankcrest-plate')?.textContent).toBe('III');
    expect(card.querySelector('.rankbar-label')?.textContent).toBe('Diamond III');
    expect(card.querySelector('.rankbar-points')?.textContent).toBe('34 / 100');
    expect(card.querySelector('.rankbar-caption')?.textContent).toBe('1234 MMR');
    // The card stacks: crest → bar → points → name → caption (owner 2026-09-20).
    expect(card.querySelector('.rankbar')!.className).toContain('rankbar-stack');
    expect(card.querySelector('.rankbar-track')!.compareDocumentPosition(card.querySelector('.rankbar-label')!) & 4).toBe(4);
    expect(card.querySelector('.cv2-mmr-d')).toBeNull();
    expect(card.querySelector('.rankend-delta')).toBeNull();
    expect(ui.container.querySelector('.cv2-right .cv2-colhead')?.textContent).toBe('Seasonal Ranked');
    expect(ui.container.textContent).not.toMatch(/division|tier|bronze|silver|gold rank/i);
  });

  it('Performance Trends: three inline-SVG charts, 30 days by default, the window toggle re-scopes them', () => {
    expect(text('.cv2-trend-title')).toEqual(['Avg Placement', 'Win Rate', 'Avg APM']);
    expect(ui.container.textContent).not.toMatch(/fight win rate/i);
    expect(ui.container.querySelectorAll('.cv2-chart svg')).toHaveLength(3);
    expect(ui.container.querySelectorAll('.cv2-chart canvas')).toHaveLength(0);
    const seg = [...ui.container.querySelectorAll<HTMLButtonElement>('.cv2-seg-btn')];
    expect(seg.map((b) => b.textContent)).toEqual(['7d', '30d', '90d']);
    expect(seg.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    // 30 days: the two recent runs → placements 3, 1 (avg 2); both top 4 → MATCH win rate 100%; APM from run 12
    // only (run 11 has no APT)
    expect(text('.cv2-trend-foot')).toEqual(['2 runs', '2 runs', '1 run']);
    expect(text('.cv2-trend-avg')[0]).toBe('2');
    expect(text('.cv2-trend-avg')[1]).toBe('100%');
    click(seg[2]!);
    // 90 days adds the 7th-place run → 2 of 3 = 67% (the fight records 9–4 / 5–5 / 2–5 would have said otherwise)
    expect(text('.cv2-trend-foot')).toEqual(['3 runs', '3 runs', '1 run']);
    expect(text('.cv2-trend-avg')[1]).toBe('67%');
    click(seg[0]!);
    expect(text('.cv2-trend-foot')).toEqual(['2 runs', '2 runs', '1 run']);
    expect(ui.container.querySelectorAll('.cv2-chart polyline')).toHaveLength(2); // APM has a lone point → a dot, not a line
    expect(ui.container.querySelectorAll('.cv2-chart .cv2-dot')).toHaveLength(1);
  });
});

describe('states', () => {
  it('caches the fetched runs on the store under whose-career + version', () => {
    const c = useGame.getState().careerCache;
    expect(c?.key).toBe(`me-1|${useGame.getState().careerVersion}`);
    expect(c?.runs).toHaveLength(3);
  });

  it('while the first fetch is in flight it shows a designed loading panel (icon + headline), not bare text', async () => {
    ui.unmount();
    let resolve!: (v: CareerRun[]) => void;
    fetchMyRuns.mockReturnValue(new Promise<CareerRun[] | null>((r) => { resolve = r; }));
    useGame.setState({ careerCache: null });
    ui = mount(<Career />);
    const state = ui.container.querySelector('.cv2-state');
    expect(state).not.toBeNull();
    expect(state!.getAttribute('aria-busy')).toBe('true');
    expect(state!.querySelector('.cv2-state-ico svg')).not.toBeNull();
    expect(state!.querySelector('.cv2-state-title')?.textContent).toBe('Loading your career');
    expect(ui.container.querySelector('.cv2-cols')).toBeNull();
    await act(async () => { resolve(RUNS); await Promise.resolve(); await Promise.resolve(); });
    expect(ui.container.querySelector('.cv2-state')).toBeNull();
    expect(ui.container.querySelector('.cv2-cols')).not.toBeNull();
  });

  it('with no account session it asks the player to sign in (the account panel affordance) and fetches nothing', async () => {
    ui.unmount();
    fetchMyRuns.mockClear();
    useGame.setState({ account: { userId: null, email: null, anonymous: true, discriminator: null }, careerCache: null });
    ui = mount(<Career />);
    await flush();
    const state = ui.container.querySelector('.cv2-state.cv2-signin');
    expect(state).not.toBeNull();
    expect(state!.querySelector('.cv2-state-title')?.textContent).toBe('Sign in to see your career');
    expect(state!.querySelector('.cv2-state-ico svg')).not.toBeNull();
    expect(fetchMyRuns).not.toHaveBeenCalled();
    click(state!.querySelector('button'));
    expect(useGame.getState().accountPanelOpen).toBe(true);
    useGame.setState({ accountPanelOpen: false });
  });

  it('a failed fetch reads as "couldn\'t reach the server" with a Retry, not as "no runs"; an empty list is the designed "No runs yet" panel', async () => {
    ui.unmount();
    fetchMyRuns.mockResolvedValue(null);
    useGame.setState({ careerCache: null });
    ui = mount(<Career />);
    await flush();
    const state = ui.container.querySelector('.cv2-state');
    expect(state!.querySelector('.cv2-state-title')?.textContent).toBe('Couldn’t reach the server');
    expect(ui.container.textContent).not.toContain('No runs yet');
    fetchMyRuns.mockResolvedValue([]);
    click(state!.querySelector('button'));
    await flush();
    // The empty state keeps the three columns (the MMR is real) and designs the centre.
    expect(ui.container.querySelector('.cv2-cols')).not.toBeNull();
    const none = ui.container.querySelector('.cv2-none');
    expect(none!.querySelector('.cv2-state-title')?.textContent).toBe('No runs yet');
    expect(none!.querySelector('.cv2-state-ico svg')).not.toBeNull();
    expect(ui.container.querySelector('.cv2-row')).toBeNull();
    expect(ui.container.querySelector('.cv2-ranked .rankbar-caption')?.textContent).toBe('1234 MMR');
    expect(text('.cv2-left .cv2-stat-v')).toEqual(['0', '—', '0', '—', '—']);
  });

  it('another player\'s career reads by their id, titles as theirs and prints THEIR rating', async () => {
    ui.unmount();
    fetchMyRuns.mockClear();
    useGame.setState({ careerOf: { userId: 'them-9', author: 'Mika', rating: 763, gamesPlayed: 4 }, careerCache: null });
    ui = mount(<Career />);
    await flush();
    expect(fetchMyRuns).toHaveBeenCalledWith(1000, { userId: 'them-9' }); // ALL their runs (the Heroes tab folds every one)
    expect(ui.container.querySelector('.lbtitle .esch')?.textContent).toBe('Mika’s Career');
    // No rank handed over → the page asks the server ONCE by user id; a viewed profile without a medal rank
    // (pre-migration backend / no row) keeps the bare number.
    expect(fetchPlayerById).toHaveBeenCalledTimes(1);
    expect(fetchPlayerById).toHaveBeenCalledWith('them-9');
    expect(ui.container.querySelector('.cv2-mmr-v')?.textContent).toBe('763');
    expect(ui.container.querySelector('.cv2-ranked .rankbar')).toBeNull();
    expect(ui.container.querySelector('.cv2-left .cv2-playername')?.textContent).toBe('Mika');
  });

  it('a viewed player whose rank rode in on careerOf (a Rankings row) gets the SAME crest + bar card as the own page: no bare MMR, no fetch', async () => {
    ui.unmount();
    // "46 MMR" on the server is Bronze III 46 (rating = 100 × division + points; owner report 2026-09-21).
    const rank = { ...useGame.getState().profile.rank, position: { divisionIndex: 0, points: 46 }, highest: { divisionIndex: 0, points: 46 } };
    useGame.setState({ careerOf: { userId: 'them-7', author: 'LazerLemon', rating: 46, gamesPlayed: 9, rank }, careerCache: null });
    ui = mount(<Career />);
    await flush();
    const card = ui.container.querySelector('.cv2-ranked')!;
    expect(card.querySelector('.cv2-mmr')).toBeNull();
    expect(card.querySelector('.rankcrest.portring .hero .f img.heroimg')).not.toBeNull();
    expect(card.querySelector('.rankcrest-plate')?.textContent).toBe('III');
    expect(card.querySelector('.rankbar-label')?.textContent).toBe('Bronze III');
    expect(card.querySelector('.rankbar-points')?.textContent).toBe('46 / 100');
    expect(card.querySelector('.rankbar-caption')?.textContent).toBe('46 MMR');
    expect(card.querySelector('.rankbar')!.className).toContain('rankbar-stack');
    expect(card.querySelector('.rankbar-track')!.compareDocumentPosition(card.querySelector('.rankbar-label')!) & 4).toBe(4);
    expect(fetchPlayerById).not.toHaveBeenCalled();
  });

  it('a viewed player opened WITHOUT a rank (the Hall, a stale link) has it fetched by user id and painted the same way; a rankless answer keeps the bare MMR', async () => {
    ui.unmount();
    const rank = { ...useGame.getState().profile.rank, position: { divisionIndex: 0, points: 46 }, highest: { divisionIndex: 0, points: 46 } };
    fetchPlayerById.mockResolvedValue({ userId: 'them-7', author: 'LazerLemon', rating: 46, gamesPlayed: 9, rank });
    useGame.setState({ careerOf: { userId: 'them-7', author: 'LazerLemon', rating: 46, gamesPlayed: 9 }, careerCache: null });
    ui = mount(<Career />);
    await flush();
    expect(fetchPlayerById).toHaveBeenCalledTimes(1);
    expect(fetchPlayerById).toHaveBeenCalledWith('them-7');
    const card = ui.container.querySelector('.cv2-ranked')!;
    expect(card.querySelector('.cv2-mmr')).toBeNull();
    expect(card.querySelector('.rankbar-label')?.textContent).toBe('Bronze III');
    expect(card.querySelector('.rankbar-points')?.textContent).toBe('46 / 100');
    expect(card.querySelector('.rankbar-caption')?.textContent).toBe('46 MMR');
    // Re-rendering the open page never re-asks: the answer is remembered per user id while the page is open.
    act(() => { useGame.setState({ playerName: 'Kev2' }); });
    await flush();
    expect(fetchPlayerById).toHaveBeenCalledTimes(1);

    // The same player, but the server has no rank for them (pre-migration / no row) → the bare number, once.
    ui.unmount();
    fetchPlayerById.mockClear().mockResolvedValue({ userId: 'them-7', author: 'LazerLemon', rating: 46, gamesPlayed: 9 });
    useGame.setState({ careerOf: { userId: 'them-7', author: 'LazerLemon', rating: 46, gamesPlayed: 9 }, careerCache: null });
    ui = mount(<Career />);
    await flush();
    expect(fetchPlayerById).toHaveBeenCalledTimes(1);
    expect(ui.container.querySelector('.cv2-ranked .rankbar')).toBeNull();
    expect(ui.container.querySelector('.cv2-mmr-v')?.textContent).toBe('46');
    expect(ui.container.querySelector('.cv2-mmr-l')?.textContent).toBe('MMR');
  });
});

describe('the Heroes tab', () => {
  const heroesTab = (): HTMLButtonElement => ui.container.querySelectorAll<HTMLButtonElement>('.cv2-tabs [role=tab]')[1]!;
  const over = (el: Element, kind: 'mouseover' | 'mouseout'): void => {
    // React synthesises onMouseEnter/Leave from the bubbling mouseover/mouseout pair.
    act(() => { el.dispatchEvent(new MouseEvent(kind, { bubbles: true, relatedTarget: document.body })); });
  };

  it('shows every hero played as a PORTRAIT in the game\'s circular frame — name + "N games played" under it, most-played first — and no per-hero rows', () => {
    click(heroesTab());
    expect(heroesTab().getAttribute('aria-selected')).toBe('true');
    expect(ui.container.querySelector('.cv2-row'), 'the banners give way to the grid').toBeNull();
    expect(ui.container.querySelector('.cv2-sec-sub')?.textContent).toBe('2 heroes played');
    const grid = ui.container.querySelector('.cv2-herogrid');
    expect(grid).not.toBeNull();
    const tiles = [...grid!.querySelectorAll('.cv2-hcard')];
    expect(tiles).toHaveLength(2);
    expect(tiles.map((t) => t.querySelector('.cv2-hcard-name')?.textContent)).toEqual(['Brackus', 'Sable']); // 2 games vs 1
    expect(tiles.map((t) => t.querySelector('.cv2-hcard-games')?.textContent)).toEqual(['2 games played', '1 game played']);
    // The same circular frame markup the left column + recruit screen wear (.hero > .f > img.heroimg).
    for (const t of tiles) {
      const f = t.querySelector('.cv2-heroframe .hero .f');
      expect(f).not.toBeNull();
      expect(f!.querySelector('img.heroimg') ?? f!.querySelector('svg')).not.toBeNull();
      expect(t.getAttribute('tabindex')).toBe('0'); // keyboard-reachable, so the panel shows on focus too
      expect(t.getAttribute('title')).toBeNull();
    }
    // Nothing per-hero prints inline any more: no rows, no stat cells, no "runs".
    expect(ui.container.querySelector('.cv2-hrow, .cv2-hcell, .cv2-hrow-stats')).toBeNull();
    expect(grid!.textContent).not.toMatch(/runs?\b/);
    expect(grid!.textContent).not.toMatch(/fight/i);
    expect(ui.container.querySelector('[title]')).toBeNull();
  });

  it('hovering a portrait floats the hero\'s career beside it — MATCH W–L + win rate, avg placement, then 1st-place wins / best / last played — portalled; leaving hides it', () => {
    click(heroesTab());
    vi.useFakeTimers();
    try {
      const tiles = [...ui.container.querySelectorAll('.cv2-hcard')];
      over(tiles[0]!, 'mouseover');
      expect(document.querySelector('.cv2-herotip')).toBeNull(); // a short hover delay first
      act(() => { vi.advanceTimersByTime(200); });
      const tip = document.querySelector('.cv2-herotip');
      expect(tip).not.toBeNull();
      expect(tip!.parentElement).toBe(document.body); // portalled — the scrolling grid can't clip it
      expect(tip!.getAttribute('role')).toBe('tooltip');
      expect(tip!.classList.contains('right') || tip!.classList.contains('left')).toBe(true); // seated BESIDE the portrait
      expect((tip as HTMLElement).style.position || getComputedStyle(tip!).position).toMatch(/fixed|^$/);
      expect(tiles[0]!.getAttribute('aria-describedby')).toBe(tip!.id);
      expect(tip!.querySelector('.cv2-herotip-name')?.textContent).toBe('Brackus');
      // Brackus: 3rd (W) + 7th (L) → 1 W – 1 L = 50%; avg 5; 0 firsts; best 3rd. (Fights 5–5 + 2–5 play no part.)
      expect(tip!.querySelector('.cv2-herotip-record')?.getAttribute('aria-label')).toBe('1 wins, 1 losses');
      expect([...tip!.querySelectorAll('.cv2-herotip-n')].map((n) => n.textContent)).toEqual(['1', '1']);
      expect(tip!.querySelector('.cv2-herotip-rate')?.textContent).toBe('50%');
      expect([...tip!.querySelectorAll('.cv2-herotip-l')].map((n) => n.textContent)).toEqual(['Record', 'Avg Placement', '1st Place Wins', 'Best Placement', 'Last Played']);
      expect(tip!.querySelector('.cv2-herotip-v')?.textContent).toBe('5');
      const subs = [...tip!.querySelectorAll('.cv2-herotip-sv')];
      expect(subs[0]!.textContent).toBe('0');
      expect(subs[1]!.textContent).toBe('3rd');
      expect(subs[1]!.classList.contains('top4')).toBe(true);
      expect(subs[2]!.textContent).toMatch(/\d{4}$/);
      expect(tip!.textContent).not.toMatch(/7 wins|10 losses|fight/i);
      over(tiles[0]!, 'mouseout');
      expect(document.querySelector('.cv2-herotip')).toBeNull();
      expect(tiles[0]!.getAttribute('aria-describedby')).toBeNull();

      // Sable: 1 game, won it → 1 W – 0 L = 100%, avg 1, 1 first (green), best 1st (green).
      over(tiles[1]!, 'mouseover');
      act(() => { vi.advanceTimersByTime(200); });
      const tip2 = document.querySelector('.cv2-herotip')!;
      expect(tip2.querySelector('.cv2-herotip-name')?.textContent).toBe('Sable');
      expect([...tip2.querySelectorAll('.cv2-herotip-n')].map((n) => n.textContent)).toEqual(['1', '0']);
      expect(tip2.querySelector('.cv2-herotip-rate')?.textContent).toBe('100%');
      expect(tip2.querySelector('.cv2-herotip-v')?.textContent).toBe('1');
      const subs2 = [...tip2.querySelectorAll('.cv2-herotip-sv')];
      expect(subs2[0]!.textContent).toBe('1');
      expect(subs2[0]!.classList.contains('won')).toBe(true);
      expect(subs2[1]!.textContent).toBe('1st');
      expect(subs2[1]!.classList.contains('won')).toBe(true);
      over(tiles[1]!, 'mouseout');
      expect(document.querySelector('.cv2-herotip')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keyboard focus shows the same panel at once (no hover delay) and blur hides it', () => {
    click(heroesTab());
    const tile = ui.container.querySelector('.cv2-hcard') as HTMLElement;
    act(() => { tile.focus(); });
    const tip = document.querySelector('.cv2-herotip');
    expect(tip).not.toBeNull();
    expect(tip!.querySelector('.cv2-herotip-name')?.textContent).toBe('Brackus');
    expect(tile.getAttribute('aria-describedby')).toBe(tip!.id);
    act(() => { tile.blur(); });
    expect(document.querySelector('.cv2-herotip')).toBeNull();
  });

  it('the choice persists per browser and the tabs toggle back', async () => {
    click(heroesTab());
    expect(localStorage.getItem('ascent.career.tab')).toBe('heroes');
    ui.unmount();
    ui = mount(<Career />);
    await flush();
    expect(heroesTab().getAttribute('aria-selected')).toBe('true');
    expect(ui.container.querySelectorAll('.cv2-hcard')).toHaveLength(2);
    click(ui.container.querySelector('.cv2-tabs [role=tab]'));
    expect(localStorage.getItem('ascent.career.tab')).toBe('history');
    expect(ui.container.querySelectorAll('.cv2-row')).toHaveLength(3);
    expect(ui.container.querySelector('.cv2-hcard')).toBeNull();
  });

  it('with no runs it shows the designed "No games played yet" panel', async () => {
    ui.unmount();
    fetchMyRuns.mockResolvedValue([]);
    useGame.setState({ careerCache: null });
    ui = mount(<Career />);
    await flush();
    click(heroesTab());
    const none = ui.container.querySelector('.cv2-none');
    expect(none?.querySelector('.cv2-state-title')?.textContent).toBe('No games played yet');
    expect(none?.querySelector('.cv2-state-ico svg')).not.toBeNull();
    expect(ui.container.querySelector('.cv2-herogrid')).toBeNull();
  });
});
