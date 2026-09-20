// @vitest-environment jsdom
/**
 * THE CAREER PAGE (owner rebuild 2026-09-19) — a jsdom render over three fixture runs from a mocked
 * `fetchMyRuns`. Pins the three-column layout's contents: the most-played hero in the in-run frame + the four
 * tiles; the Match History banners (hero + record · 7 team slots · outcome / date + length / Gold · ONE Watch
 * button, live only with a replay); the MMR number + last delta; the three trend charts + window toggle. Also
 * pins what must NOT be there: any board-power stat, a Share button, the old Insight grid.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';
import type { CareerRun } from './careerData';

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
  goldSpent: 80, apt: 25, ratingDelta: 10, seed: 1, dominantTribe: 'beast', mode: 'lobby', board: null, detailed: true,
  replayRowId: null, durationMs: null, ...over,
});
const RUNS: CareerRun[] = [
  run({ id: 12, heroId: 'sable', atMs: NOW - 1 * DAY, wins: 9, losses: 4, placement: 1, goldSpent: 120, apt: 26.1, wave: 15, ratingDelta: 41, dominantTribe: 'beast', replayRowId: 97, durationMs: 883_179,
    board: { minions: [{ cardId: 'alleycat', name: 'Alleycat', attack: 5, health: 5 }, { cardId: 'stray', name: 'Stray', attack: 2, health: 2 }], wave: 15, heroId: 'sable' } as never }),
  run({ id: 11, heroId: 'brackus', atMs: NOW - 2 * DAY, wins: 5, losses: 5, placement: 3, goldSpent: 90, apt: null, durationMs: 690_108, board: null, dominantTribe: 'mech' }), // no APT → no APM point, length still known
  run({ id: 10, heroId: 'brackus', atMs: NOW - 40 * DAY, wins: 2, losses: 5, placement: 7, goldSpent: null, apt: null, durationMs: null, board: null, dominantTribe: 'beast', detailed: false }),
];

let ui: Mounted;
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const text = (sel: string): string[] => [...ui.container.querySelectorAll(sel)].map((n) => (n.textContent ?? '').trim());
const click = (el: Element | null): void => { act(() => { (el as HTMLElement).click(); }); };

beforeEach(async () => {
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
  });

  it('prints the four tiles from the server runs: 1st Place Wins · Top 4 Finish · Avg Placement · Favorite Tribe', () => {
    const labels = text('.cv2-left .cv2-stat-l');
    const values = text('.cv2-left .cv2-stat-v');
    expect(labels).toEqual(['1st Place Wins', 'Top 4 Finish', 'Avg Placement', 'Favorite Tribe']);
    // placements 1, 3, 7 → 1 first; top-4 = 2/3 = 67%; avg = 11/3 = 3.7; tribes beast, mech, beast → Beast
    expect(values).toEqual(['1', '67%', '3.7', 'Beast']);
  });
});

describe('Match History', () => {
  it('lists the server runs newest first as banners: hero + record, the 7-slot final team, the outcome block', () => {
    const rows = [...ui.container.querySelectorAll('.cv2-row')];
    expect(rows).toHaveLength(3);
    expect(text('.cv2-row .cv2-row-heroname')).toEqual(['Sable', 'Brackus', 'Brackus']);
    expect(text('.cv2-row .cv2-row-record')).toEqual(['9–4', '5–5', '2–5']);
    // Row 1 has a board: exactly 7 slots — 2 real cards, 5 blank.
    const team = rows[0]!.querySelectorAll('.cv2-team .cv2-tile');
    expect(team).toHaveLength(7);
    expect(rows[0]!.querySelectorAll('.cv2-team .cv2-tile .card')).toHaveLength(2);
    expect(rows[0]!.querySelectorAll('.cv2-team .cv2-tile.empty')).toHaveLength(5);
    // Rows 2 + 3 stored no board → outcome block only.
    expect(rows[1]!.querySelector('.cv2-team')).toBeNull();
    expect(rows[2]!.querySelector('.cv2-team')).toBeNull();
    expect(rows[1]!.querySelector('.cv2-row-outcome')).not.toBeNull();
  });

  it('the outcome block: VICTORY for 1st (green) else the placement; the date + run length; Gold or "—"', () => {
    const verdicts = [...ui.container.querySelectorAll('.cv2-verdict')];
    expect(verdicts.map((v) => v.textContent)).toEqual(['VICTORY', '3RD', '7TH']);
    expect(verdicts[0]!.classList.contains('won')).toBe(true);
    expect(verdicts[2]!.classList.contains('lost')).toBe(true);
    const when = text('.cv2-row-when');
    expect(when[0]).toMatch(/· 15 min$/);   // 883 s
    expect(when[1]).toMatch(/· 12 min$/);   // 690 s
    expect(when[2]).not.toMatch(/min/);     // no telemetry clock
    expect(text('.cv2-row-gold-v')).toEqual(['120', '90', '—']);
  });

  it('ONE button per row — Watch Replay — enabled only where a replay row exists; no Share button, no power stat', () => {
    const rows = [...ui.container.querySelectorAll('.cv2-row')];
    for (const r of rows) expect(r.querySelectorAll('button')).toHaveLength(1);
    const buttons = [...ui.container.querySelectorAll<HTMLButtonElement>('.cv2-watch')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Watch Replay', 'Watch Replay', 'Watch Replay']);
    expect(buttons.map((b) => b.disabled)).toEqual([false, true, true]);
    const all = ui.container.textContent ?? '';
    expect(all).not.toMatch(/share/i);
    expect(all).not.toMatch(/power/i);
    expect(ui.container.querySelector('.carinsights')).toBeNull();
  });

  it('Watch Replay fetches THAT run\'s telemetry payload and hands it to the replay viewer', async () => {
    click(ui.container.querySelector('.cv2-watch'));
    await flush();
    expect(fetchReplayPayload).toHaveBeenCalledWith(97);
    expect(startReplay).toHaveBeenCalledTimes(1);
    expect((startReplay.mock.calls[0] as unknown[])[1]).toMatchObject({ authorName: 'Kev' });
  });
});

describe('the right column', () => {
  it('Seasonal Ranked prints the account rating as a plain MMR number with the last run\'s delta — no tiers', () => {
    expect(ui.container.querySelector('.cv2-mmr-l')?.textContent).toBe('MMR');
    expect(ui.container.querySelector('.cv2-mmr-v')?.textContent).toBe('1234');
    const d = ui.container.querySelector('.cv2-mmr-d');
    expect(d?.textContent).toBe('+41');
    expect(d?.classList.contains('up')).toBe(true);
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

  it('with no account session it asks the player to sign in (the account panel affordance) and fetches nothing', async () => {
    ui.unmount();
    fetchMyRuns.mockClear();
    useGame.setState({ account: { userId: null, email: null, anonymous: true, discriminator: null }, careerCache: null });
    ui = mount(<Career />);
    await flush();
    expect(ui.container.textContent).toContain('Sign in to see your career');
    expect(fetchMyRuns).not.toHaveBeenCalled();
    click(ui.container.querySelector('.cv2-signin button'));
    expect(useGame.getState().accountPanelOpen).toBe(true);
    useGame.setState({ accountPanelOpen: false });
  });

  it('a failed fetch reads as "couldn\'t reach the server" with a Retry, not as "no runs"', async () => {
    ui.unmount();
    fetchMyRuns.mockResolvedValue(null);
    useGame.setState({ careerCache: null });
    ui = mount(<Career />);
    await flush();
    expect(ui.container.textContent).toContain('Couldn’t reach the server');
    expect(ui.container.textContent).not.toContain('No runs yet');
    fetchMyRuns.mockResolvedValue([]);
    click(ui.container.querySelector('.cv2-signin button'));
    await flush();
    expect(ui.container.textContent).toContain('No runs yet');
  });
});
