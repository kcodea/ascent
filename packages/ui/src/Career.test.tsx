// @vitest-environment jsdom
/**
 * THE CAREER PAGE (owner rebuild 2026-09-19/20) — a jsdom render over three fixture runs from a mocked
 * `fetchMyRuns`: a 1st-place run with a full 7-minion (one gilded) team, two runes and a replay; a 3rd-place
 * run with no board / no runes / a clock but no watchable replay; and a light 7th-place run with no telemetry
 * at all. Pins the three-column layout's contents: the most-played hero in the in-run frame + the four tiles;
 * the Match History BANNERS (head: hero + record ‖ outcome block · team: 7 slots · foot: runes ‖ ONE Watch
 * button, live only with a replay); the MMR as a bare number (no delta); the three trend charts + window
 * toggle; the designed loading / signed-out / offline / empty states; the HEROES tab (per-hero rows folded over
 * every run, the choice persisted); the three columns sharing one header row. Also pins what must NOT be there:
 * any board-power stat, a Share button, a rating delta, the old Insight grid, a native `title` tooltip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';
import type { CareerRun } from './careerData';

// The real `Card` mounts a <canvas> sprite fallback; jsdom has no 2D context (and logs "not implemented" per
// card without this). `drawSprite` returns early on a null context.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const fetchMyRuns = vi.fn<(limit?: number, opts?: { userId?: string }) => Promise<CareerRun[] | null>>();
const fetchReplayPayload = vi.fn<(rowId: number) => Promise<unknown>>();
const startReplay = vi.fn();

vi.mock('./remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./remoteBoards')>()),
  remoteEnabled: () => true,
  fetchMyRuns: (...a: [number?, { userId?: string }?]) => fetchMyRuns(...a),
  fetchReplayPayload: (id: number) => fetchReplayPayload(id),
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
  startReplay.mockReset();
  useGame.setState({
    showCareer: true, careerOf: null, careerCache: null, playerName: 'Kev',
    account: { userId: 'me-1', email: null, anonymous: true, discriminator: null },
    profile: { ...useGame.getState().profile, rating: 1234 },
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

  it('prints the four tiles from the server runs: 1st Place Wins · Top 4 Finish · Avg Placement · Favorite Tribe', () => {
    const labels = text('.cv2-left .cv2-stat-l');
    const values = text('.cv2-left .cv2-stat-v');
    expect(labels).toEqual(['1st Place Wins', 'Top 4 Finish', 'Avg Placement', 'Favorite Tribe']);
    // placements 1, 3, 7 → 1 first; top-4 = 2/3 = 67%; avg = 11/3 = 3.7; tribes beast, mech, beast → Beast
    expect(values).toEqual(['1', '67%', '3.7', 'Beast']);
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
  it('lists the server runs newest first as banners that read head → team → foot: hero + record, the outcome block, 7 slots, runes, ONE button', () => {
    const rows = [...ui.container.querySelectorAll('.cv2-row')];
    expect(rows).toHaveLength(3);
    expect(ui.container.querySelector('.cv2-sec-sub')?.textContent).toBe('Last 3 runs');
    expect(text('.cv2-row .cv2-row-heroname')).toEqual(['Sable', 'Brackus', 'Brackus']);
    expect(rows.map((r) => r.querySelector('.cv2-row-record')?.getAttribute('aria-label'))).toEqual(['9 wins, 4 losses', '5 wins, 5 losses', '2 wins, 5 losses']);
    expect(text('.cv2-row .cv2-row-record-n')).toEqual(['9', '4', '5', '5', '2', '5']);
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
  it('Seasonal Ranked prints the account rating as a BARE MMR number — no delta, no tiers', () => {
    expect(ui.container.querySelector('.cv2-mmr-v')?.textContent).toBe('1234');
    expect(ui.container.querySelector('.cv2-mmr-l')?.textContent).toBe('MMR');
    expect(ui.container.querySelector('.cv2-mmr-d')).toBeNull();
    expect(ui.container.querySelector('.cv2-ranked')?.textContent).toBe('1234MMR');
    expect(ui.container.querySelector('.cv2-right .cv2-colhead')?.textContent).toBe('Seasonal Ranked');
    expect(ui.container.textContent).not.toMatch(/division|tier|bronze|silver|gold rank/i);
  });

  it('Performance Trends: three inline-SVG charts, 30 days by default, the window toggle re-scopes them', () => {
    expect(text('.cv2-trend-title')).toEqual(['Avg Placement', 'Fight Win Rate', 'Avg APM']);
    expect(ui.container.querySelectorAll('.cv2-chart svg')).toHaveLength(3);
    expect(ui.container.querySelectorAll('.cv2-chart canvas')).toHaveLength(0);
    const seg = [...ui.container.querySelectorAll<HTMLButtonElement>('.cv2-seg-btn')];
    expect(seg.map((b) => b.textContent)).toEqual(['7d', '30d', '90d']);
    expect(seg.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    // 30 days: the two recent runs → placements 3, 1 (avg 2); win rates 50, 69; APM from run 12 only (run 11 has no APT)
    expect(text('.cv2-trend-foot')).toEqual(['2 runs', '2 runs', '1 run']);
    expect(text('.cv2-trend-avg')[0]).toBe('2');
    click(seg[2]!);
    expect(text('.cv2-trend-foot')).toEqual(['3 runs', '3 runs', '1 run']);
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
    expect(ui.container.querySelector('.cv2-mmr-v')?.textContent).toBe('1234');
    expect(text('.cv2-left .cv2-stat-v')).toEqual(['0', '—', '—', '—']);
  });

  it('another player\'s career reads by their id, titles as theirs and prints THEIR rating', async () => {
    ui.unmount();
    fetchMyRuns.mockClear();
    useGame.setState({ careerOf: { userId: 'them-9', author: 'Mika', rating: 763, gamesPlayed: 4 }, careerCache: null });
    ui = mount(<Career />);
    await flush();
    expect(fetchMyRuns).toHaveBeenCalledWith(1000, { userId: 'them-9' }); // ALL their runs (the Heroes tab folds every one)
    expect(ui.container.querySelector('.lbtitle .esch')?.textContent).toBe('Mika’s Career');
    expect(ui.container.querySelector('.cv2-mmr-v')?.textContent).toBe('763');
    expect(ui.container.querySelector('.cv2-left .cv2-playername')?.textContent).toBe('Mika');
  });
});

describe('the Heroes tab', () => {
  const heroesTab = (): HTMLButtonElement => ui.container.querySelectorAll<HTMLButtonElement>('.cv2-tabs [role=tab]')[1]!;

  it('lists every hero played as a chunky row — portrait frame + name, runs, 1st-place wins, the fight record + win rate, avg / best placement, last played — most-played first', () => {
    click(heroesTab());
    expect(heroesTab().getAttribute('aria-selected')).toBe('true');
    expect(ui.container.querySelector('.cv2-row'), 'the banners give way to the hero rows').toBeNull();
    expect(ui.container.querySelector('.cv2-sec-sub')?.textContent).toBe('2 heroes played');
    const rows = [...ui.container.querySelectorAll('.cv2-hrow')];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.querySelector('.cv2-row-heroname')?.textContent)).toEqual(['Brackus', 'Sable']); // 2 runs vs 1
    for (const r of rows) expect(r.querySelector('.cv2-row-hero .cv2-heroframe.small .hero .f')).not.toBeNull();
    expect(rows.map((r) => r.querySelector('.cv2-hrow-runs')?.textContent)).toEqual(['2 runs', '1 run']);
    expect(text('.cv2-hrow:first-child .cv2-meta-l')).toEqual(['1st Place Wins', 'Fight Record', 'Avg Placement', 'Best', 'Last Played']);
    // Brackus: runs 11 + 10 → 0 firsts; fights 5–5 + 2–5 = 7 W – 10 L = 41%; placements 3, 7 → avg 5, best 3rd.
    const b = rows[0]!;
    expect(b.querySelector('.cv2-hcell:nth-child(1) .cv2-hcell-v')?.textContent).toBe('0');
    expect(b.querySelector('.cv2-hrow-record')?.getAttribute('aria-label')).toBe('7 wins, 10 losses');
    expect(b.querySelector('.cv2-hrow-rate')?.textContent).toBe('41% win rate');
    expect(b.querySelector('.cv2-hcell:nth-child(3) .cv2-hcell-v')?.textContent).toBe('5');
    expect(b.querySelector('.cv2-hcell:nth-child(4) .cv2-hcell-v')?.textContent).toBe('3rd');
    expect(b.querySelector('.cv2-hcell:nth-child(5) .cv2-hcell-v')?.textContent).toMatch(/\d{4}$/);
    // Sable: 1 run, won it: 1 first (green), 9–4 = 69%, avg 1, best 1st (green).
    const sb = rows[1]!;
    expect(sb.querySelector('.cv2-hcell:nth-child(1) .cv2-hcell-v')?.textContent).toBe('1');
    expect(sb.querySelector('.cv2-hcell:nth-child(1) .cv2-hcell-v')?.classList.contains('won')).toBe(true);
    expect(sb.querySelector('.cv2-hrow-rate')?.textContent).toBe('69% win rate');
    expect(sb.querySelector('.cv2-hcell:nth-child(4) .cv2-hcell-v')?.textContent).toBe('1st');
    expect(sb.querySelector('.cv2-hcell:nth-child(4) .cv2-hcell-v')?.classList.contains('won')).toBe(true);
    expect(ui.container.querySelector('[title]')).toBeNull();
  });

  it('the choice persists per browser and the tabs toggle back', async () => {
    click(heroesTab());
    expect(localStorage.getItem('ascent.career.tab')).toBe('heroes');
    ui.unmount();
    ui = mount(<Career />);
    await flush();
    expect(heroesTab().getAttribute('aria-selected')).toBe('true');
    expect(ui.container.querySelectorAll('.cv2-hrow')).toHaveLength(2);
    click(ui.container.querySelector('.cv2-tabs [role=tab]'));
    expect(localStorage.getItem('ascent.career.tab')).toBe('history');
    expect(ui.container.querySelectorAll('.cv2-row')).toHaveLength(3);
    expect(ui.container.querySelector('.cv2-hrow')).toBeNull();
  });

  it('with no runs it shows the designed "No heroes yet" panel', async () => {
    ui.unmount();
    fetchMyRuns.mockResolvedValue([]);
    useGame.setState({ careerCache: null });
    ui = mount(<Career />);
    await flush();
    click(heroesTab());
    const none = ui.container.querySelector('.cv2-none');
    expect(none?.querySelector('.cv2-state-title')?.textContent).toBe('No heroes yet');
    expect(none?.querySelector('.cv2-state-ico svg')).not.toBeNull();
  });
});
