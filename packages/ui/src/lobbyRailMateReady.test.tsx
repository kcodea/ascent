// @vitest-environment jsdom
/**
 * R-DUOS-MATE-READY-01 (owner 2026-11-02: "add an animation when your teammate readies up during the shop round ... their
 * lobby rail card should go CHING! and thud and glow green with a green check mark icon in the top corner of their
 * rail"). On the Docked Duos rail, the teammate's slice glows green with a check chip while they are Locked in, and the
 * moment they lock in (not a lock the rail first sees already set) fires the slam once.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const slam = vi.fn();
vi.mock('./versus/mateReadySlam', () => ({ playMateReadySlam: (el: Element | null | undefined) => slam(el) }));

const { mount } = await import('./renderedText.mount');
const { LobbyPanel } = await import('./LobbyPanel');
const { useGame } = await import('./store');
const { useVersus } = await import('./versus/versusStore');
const { setIdentity } = await import('./identity');
type Mounted = Awaited<ReturnType<typeof mount>>;

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; useVersus.setState({ match: null }); setIdentity(null); slam.mockClear(); });

const run = (): RunState => {
  const base = createLobbyRun(4242, 'warden');
  return { ...base, mode: 'versus', wave: 3, lobby: { ...base.lobby!, round: 3, seats: base.lobby!.seats.slice(0, 4) } } as RunState;
};
const seat = (seat: string, p: Record<string, unknown> = {}) => ({ seat, userId: seat === 'p1' ? 'me' : seat, name: seat, health: 30, armor: 0, hero: null, locked: false, ready: false, intro: false, auto: false, missed: 0, eliminatedRound: null, outReason: null, placement: null, ...p });
const match = (mateLocked: boolean, phase = 'shop') => {
  const raw = { phase, paused_at: null, paused_seat: null, options: { mode: 'duos' }, seats: ['p1', 'p2', 'p3', 'p4'].map((x) => seat(x, x === 'p2' ? { locked: mateLocked } : {})) };
  return { phase, round: 3, p1_user: 'me', group: { me: 'p1', raw, duos: { team: 'a', mate: 'p2', first: { a: 'p1', b: 'p3' } } } };
};
const show = (m: unknown): HTMLElement => {
  const r = run();
  setIdentity({ userId: 'me' } as never);
  act(() => { useGame.setState({ run: r }); useVersus.setState({ match: m as never }); });
  ui = mount(<LobbyPanel lobby={r.lobby!} />);
  return ui.container;
};
const mate = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>('.lobbyseat.mate[data-seat="s1"]')!;

describe('R-DUOS-MATE-READY-01: the teammate readying up on the Docked rail', () => {
  it('locking in during the shop slams once, then the slice stays green with a check (no Locked in pill)', () => {
    const c = show(match(false));
    expect(mate(c).classList.contains('mate-ready')).toBe(false);
    expect(c.querySelector('.lrv-ready')).toBeNull();
    act(() => { useVersus.setState({ match: match(true) as never }); });
    expect(mate(c).classList.contains('mate-ready')).toBe(true);
    expect(mate(c).classList.contains('slam')).toBe(true);
    expect(mate(c).querySelector('.lrv-ready')).not.toBeNull();
    expect(mate(c).querySelector('.lrv-status')).toBeNull();
    expect(slam).toHaveBeenCalledTimes(1);
    expect(slam.mock.calls[0]![0]).toBe(mate(c));
    // Unlocking clears it; locking again slams again.
    act(() => { useVersus.setState({ match: match(false) as never }); });
    expect(mate(c).classList.contains('mate-ready')).toBe(false);
    act(() => { useVersus.setState({ match: match(true) as never }); });
    expect(slam).toHaveBeenCalledTimes(2);
  });

  it('a teammate already locked in when the rail first sees them shows the glow without the slam', () => {
    const c = show(match(true));
    expect(mate(c).classList.contains('mate-ready')).toBe(true);
    expect(mate(c).classList.contains('slam')).toBe(false);
    expect(slam).not.toHaveBeenCalled();
  });

  it('the fight screen never shows it (Locked in is a shop state)', () => {
    const c = show(match(true, 'combat'));
    expect(mate(c).classList.contains('mate-ready')).toBe(false);
    expect(c.querySelector('.lrv-ready')).toBeNull();
  });

  it('the slam is the rune arrival implosion in green with its arrival sound and a thud, and the punch is transform-only', () => {
    const src = readFileSync(join(__dirname, 'versus', 'mateReadySlam.ts'), 'utf8');
    expect(src).toMatch(/playDef\('rune-select-implosion'[\s\S]*recolor: MATE_READY_GREEN/);
    expect(src).toMatch(/sfx\.runeSelectImplosion\(/);
    expect(src).toMatch(/sfx\.mateReadyDing\(1\)/); // the owner's ding, on its own fader, loudest of the three
    expect(src).toMatch(/sfx\.tallyImpact\(/);
    const css = readFileSync(join(__dirname, 'lobbyRailDocked.css'), 'utf8');
    const kf = css.match(/@keyframes lrvReadySlam \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(kf).toMatch(/transform/);
    expect(kf).not.toMatch(/filter|box-shadow|background/);
  });
});

// R-DUOS-VIEW-YOU-01 (the Duos tour of 2026-11-09): while I watch my teammate the rail is drawn from THEIR run, whose own
// seat (s0) is theirs and whose teammate seat (s1) is mine. The "You" chip sat on the teammate's plate.
describe('R-DUOS-VIEW-YOU-01: "You" stays on my plate while I watch my teammate', () => {
  it('on my own board: You on s0, the teammate look on s1', () => {
    const c = show(match(false));
    expect(c.querySelector('.lobbyseat.you')?.getAttribute('data-seat')).toBe('s0');
    expect(c.querySelector('.lrv-you')?.closest('.lobbyseat')?.getAttribute('data-seat')).toBe('s0');
    expect(c.querySelector('.lobbyseat.mate')?.getAttribute('data-seat')).toBe('s1');
  });
  it('watching my teammate: You (chip and edge) is on s1, my plate there; their plate wears the teammate look; one chip only', async () => {
    const { useSpectate } = await import('./versus/spectate');
    const c = show(match(false));
    act(() => { useSpectate.setState({ teammate: true }); });
    try {
      expect(c.querySelectorAll('.lrv-you')).toHaveLength(1);
      expect(c.querySelector('.lrv-you')?.closest('.lobbyseat')?.getAttribute('data-seat')).toBe('s1');
      expect(c.querySelector('.lobbyseat.you')?.getAttribute('data-seat')).toBe('s1');
      expect(c.querySelector('.lobbyseat[data-seat="s0"]')?.classList.contains('you')).toBe(false);
      expect(c.querySelector('.lobbyseat.mate')?.getAttribute('data-seat')).toBe('s0');
    } finally { act(() => { useSpectate.setState({ teammate: false }); }); }
    expect(c.querySelector('.lrv-you')?.closest('.lobbyseat')?.getAttribute('data-seat')).toBe('s0'); // back on my own board
  });
  it('not a Duos seat (a spectator, a solo lobby): the run\'s own seat keeps it', async () => {
    const { railWearsYou } = await import('./LobbyPanel');
    expect(railWearsYou(true, 's0', true, null)).toBe(true);
    expect(railWearsYou(false, 's1', true, null)).toBe(false);
    expect(railWearsYou(false, 's1', true, 's1')).toBe(true);
    expect(railWearsYou(true, 's0', false, 's1')).toBe(true);
  });
});
