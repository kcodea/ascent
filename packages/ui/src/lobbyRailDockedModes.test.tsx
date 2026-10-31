// @vitest-environment jsdom
/**
 * EVERY MODE ON THE DOCKED RAIL (owner 2026-10-31: "I think we should move all modes to this rail type. 1v1, even 3 and 4
 * player group games"; R-RAIL-DOCKED-ALLMODES-01). The rendered half, with the board's anchors fixed (jsdom has no
 * layout, so the measuring hook is replaced by the pure layout over a 1080p board):
 *  - Versus 1v1: two slices (you and the opponent), no separate opponent block, the opponent's state on its slice;
 *  - Versus Group: one slice per player with their state;
 *  - Versus Duos: the slices grouped per team (one plate each), the team's one Health bar per pair, the teammate's slice
 *    distinct and a click on it opens their board.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createLobbyRun, type RunState } from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

vi.mock('./useDockedRail', async () => {
  const { dockedLayout, DOCK_DEFAULTS } = await import('./lobbyRailDockedLayout');
  const A = {
    refresh: { left: 1437, top: 134, right: 1700, bottom: 246 },
    gem: { left: 1517, top: 382, right: 1669, bottom: 548 },
    gold: { left: 1535, top: 662, right: 1648, bottom: 775 },
    view: { left: 0, top: 0, right: 1920, bottom: 1080 },
  };
  return {
    useDockedRail: (on: boolean, _ref: unknown, live: string[], dead: string[], _cfg: unknown, _paused: boolean, teamOf?: number[], teamLead?: boolean) =>
      (on ? dockedLayout(A, live, dead, DOCK_DEFAULTS, teamOf, teamLead) : null),
  };
});
const enterTeammateView = vi.fn();
vi.mock('./versus/teammateView', async (orig) => ({ ...(await orig<typeof import('./versus/teammateView')>()), enterTeammateView: () => enterTeammateView() }));

const { mount } = await import('./renderedText.mount');
const { LobbyPanel } = await import('./LobbyPanel');
const { useGame } = await import('./store');
const { useVersus } = await import('./versus/versusStore');
const { setIdentity } = await import('./identity');
const { setSliceLabel } = await import('./lobbyRailVariant');
const { getHero } = await import('@game/sim');
type Mounted = Awaited<ReturnType<typeof mount>>;

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; useVersus.setState({ match: null }); setIdentity(null); enterTeammateView.mockClear(); });

const versusRun = (n: number): RunState => {
  const base = createLobbyRun(4242, 'warden');
  return { ...base, mode: 'versus', wave: 3, lobby: { ...base.lobby!, round: 3, seats: base.lobby!.seats.slice(0, n) } } as RunState;
};
const seat = (seat: string, p: Record<string, unknown> = {}) => ({ seat, userId: seat === 'p1' ? 'me' : seat, name: seat, health: 30, armor: 0, hero: null, locked: false, ready: false, intro: false, auto: false, missed: 0, eliminatedRound: null, outReason: null, placement: null, ...p });
const show = (run: RunState, match: unknown): HTMLElement => {
  setIdentity({ userId: 'me' } as never);
  act(() => { useGame.setState({ run }); useVersus.setState({ match: match as never }); });
  ui = mount(<LobbyPanel lobby={run.lobby!} />);
  return ui.container;
};
const slices = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('.lobbyrail.lrv-docked .lobbyseat[data-seat]')];

describe('the Docked rail in every mode', () => {
  it('Versus 1v1: you and the opponent as two slices on the rail, no opponent block; their state on their slice', () => {
    const c = show(versusRun(2), {
      phase: 'shop', round: 3, p1_user: 'me', p2_user: 'them', paused_seat: null,
      p1_locked: false, p2_locked: true, p1_ready: false, p2_ready: false, p1_auto: false, p2_auto: false,
    });
    expect(document.querySelector('.vsfoe')).toBeNull();
    const s = slices(c);
    expect(s.map((x) => x.dataset.seat)).toEqual(expect.arrayContaining(['s0', 's1']));
    expect(s).toHaveLength(2);
    expect(c.querySelector('.lobbyseat.you[data-seat="s0"]')).not.toBeNull();
    expect(c.querySelector('[data-seat="s1"] .lrv-status')?.textContent).toBe('Locked in');
    expect(c.querySelector('[data-seat="s0"] .lrv-status')).toBeNull(); // yours is on your gem
    // The round slice ties into Refresh like a lobby game's: the round and the max damage.
    expect(c.querySelector('.lobbyrailhead.lrv-docked .lobbyround')?.textContent).toBe('Round 3');
    expect(c.querySelector('.lobbyrailhead.lrv-docked .lobbymax')?.textContent).toBe('Max dmg 5');
    // Each slice has its own Health bar.
    expect(c.querySelectorAll('.lobbyseat .lrv-bar')).toHaveLength(2);
    // THE SHIPPED LOOK (owner pick 2026-10-31, "Full art"): the hero art, no label on the slice; each slice is still told
    // apart by its marks (your gold edge, the next foe's swords) and the hover card carries the names.
    expect(c.querySelectorAll('.lrv-name')).toHaveLength(0);
    expect(c.querySelectorAll('.lrv-tileart .lobbyface')).toHaveLength(2);
    expect(c.querySelector('[data-seat="s1"] .lrv-vs')).not.toBeNull();
  });

  it.each([3, 4])('Versus Group of %i: one slice per player, each with their state', (n) => {
    const raw = { phase: 'shop', paused_at: null, paused_seat: null, options: { mode: 'group' }, seats: Array.from({ length: n }, (_, i) => seat(`p${i + 1}`, { locked: i === n - 1 })) };
    const c = show(versusRun(n), { phase: 'shop', round: 3, p1_user: 'me', group: { me: 'p1', raw } });
    expect(document.querySelector('.vsfoe')).toBeNull();
    expect(slices(c)).toHaveLength(n);
    expect(c.querySelector(`[data-seat="s${n - 1}"] .lrv-status`)?.textContent).toBe('Locked in');
    expect(c.querySelectorAll('.lrv-team')).toHaveLength(0);
  });

  it('Versus Duos: slices grouped per team, one Health bar per pair, the teammate distinct; clicking them opens their board', () => {
    const raw = { phase: 'shop', paused_at: null, paused_seat: null, options: { mode: 'duos' }, seats: ['p1', 'p2', 'p3', 'p4'].map((x) => seat(x)) };
    const c = show(versusRun(4), { phase: 'shop', round: 3, p1_user: 'me', group: { me: 'p1', raw, duos: { team: 'a', mate: 'p2', first: { a: 'p1', b: 'p3' } } } });
    expect(slices(c)).toHaveLength(4);
    const teams = [...c.querySelectorAll<HTMLElement>('.lrv-team')];
    expect(teams).toHaveLength(2);
    expect(teams.filter((t) => t.classList.contains('you'))).toHaveLength(1);
    // The shared pool once per team: two bars for four players.
    expect(c.querySelectorAll('.lobbyseat .lrv-bar')).toHaveLength(2);
    const mate = c.querySelector<HTMLElement>('.lobbyseat.mate[data-seat="s1"]')!;
    expect(mate).not.toBeNull();
    act(() => { mate.click(); });
    expect(enterTeammateView).toHaveBeenCalledTimes(1);
    // No old team slots on the Docked rail.
    expect(c.querySelector('.lobbyteamslot')).toBeNull();
  });

  it('the slice label follows Tuner 2 "Slice label" in every mode: player name, hero name, or none', () => {
    const run = versusRun(2);
    const match = { phase: 'shop', round: 3, p1_user: 'me', p2_user: 'them', paused_seat: null };
    try {
      setSliceLabel('hero');
      const c = show(run, match);
      const labels = [...c.querySelectorAll('.lrv-name-t')].map((e) => e.getAttribute('aria-label'));
      expect(labels).toEqual(expect.arrayContaining(run.lobby!.seats.map((x) => getHero(x.heroId).name)));
      act(() => { setSliceLabel('none'); });
      expect(c.querySelectorAll('.lrv-name')).toHaveLength(0);
      act(() => { setSliceLabel('player'); });
      expect([...c.querySelectorAll('.lrv-name-t')].map((e) => e.getAttribute('aria-label'))).toEqual(expect.arrayContaining(run.lobby!.seats.map((x) => x.label)));
    } finally { setSliceLabel('none'); }
  });
});
