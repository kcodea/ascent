// @vitest-environment jsdom
/**
 * R-VERSUS-RELIABLE-04 (owner 2026-10-27: reconnects where "it would simply pause when someone returned"). THE PAUSE,
 * EVERYWHERE, NEVER A DEAD END:
 *  - the absent player came back but has not pressed Unpause: once the reconnect time is over, everyone else gets an
 *    Unpause of their own (before: "X is back. Waiting for them to unpause" forever);
 *  - a pause during Hero Select shows the same veil over the picker (before: the shop HUD that draws it is not mounted
 *    there, so the pick clock froze with nothing on screen);
 *  - a running 3-2-1 (any Unpause, or the server resuming a returning heartbeat itself) shows only the count.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'me' }));

const { mount } = await import('../renderedText.mount');
const { versusPauseView, absentIsBack, VersusHeroSelectPause } = await import('./VersusHud');
const { useVersus } = await import('./versusStore');
const { useGame } = await import('../store');
type Match = import('./versusRemote').VersusMatch;

const NOW = Date.parse('2026-10-27T12:00:00Z');
const iso = (ms: number): string => new Date(ms).toISOString();
const paused = (over: Partial<Match> = {}): Match => ({
  id: 'm1', p1_user: 'me', p2_user: 'you', p1_name: 'Me', p2_name: 'Kev', phase: 'shop', round: 3,
  paused_seat: 'p2', paused_at: iso(NOW - 30_000), pause_grace_until: iso(NOW - 1000), resume_at: null,
  ...over,
} as Match);

afterEach(() => {
  useVersus.setState({ match: null, room: null });
  useGame.setState({ heroChoices: null, pendingMode: null } as never);
});

describe('R-VERSUS-RELIABLE-04: the pause panel', () => {
  it('the absent player is back, inside the reconnect time: we wait for their Unpause', () => {
    expect(versusPauseView({ match: paused(), seat: 'p1', graceIn: 5, absentBack: true }))
      .toEqual({ kind: 'panel', title: 'Kev is back', body: 'Waiting for them to unpause.', action: null });
  });

  it('the absent player is back and the reconnect time is over: everyone else may Unpause (no dead end)', () => {
    expect(versusPauseView({ match: paused(), seat: 'p1', graceIn: 0, absentBack: true }))
      .toEqual({ kind: 'panel', title: 'Kev is back', body: 'Unpause to play on.', action: 'unpause' });
  });

  it('the rest of the panel is as before: my own pause, the reconnect time, gone for good', () => {
    expect(versusPauseView({ match: paused(), seat: 'p2', graceIn: 0, absentBack: true })).toMatchObject({ title: 'Welcome back', action: 'resume' });
    expect(versusPauseView({ match: paused(), seat: 'p1', graceIn: 12, absentBack: false })).toMatchObject({ title: 'Kev disconnected', body: 'Reconnect time 12s', action: null });
    expect(versusPauseView({ match: paused(), seat: 'p1', graceIn: 0, absentBack: false })).toMatchObject({ title: 'Kev has not come back', action: 'unpause' });
  });

  it('a running 3-2-1 shows only the count, whoever started it', () => {
    expect(versusPauseView({ match: paused({ resume_at: iso(NOW + 2000) }), seat: 'p1', graceIn: 0, absentBack: true })).toEqual({ kind: 'count' });
    expect(versusPauseView({ match: paused({ resume_at: iso(NOW + 2000) }), seat: 'p2', graceIn: 0, absentBack: true })).toEqual({ kind: 'count' });
  });

  it('"back" means a heartbeat inside the 12 s lease', () => {
    const m = paused();
    expect(absentIsBack(m, [{ userId: 'you', lastSeenAt: iso(NOW - 3000) }], NOW)).toBe(true);
    expect(absentIsBack(m, [{ userId: 'you', lastSeenAt: iso(NOW - 30_000) }], NOW)).toBe(false);
  });

  it('player-facing text: no em dashes, no "--"', () => {
    for (const graceIn of [0, 9]) for (const absentBack of [true, false]) for (const seat of ['p1', 'p2'] as const) {
      const v = versusPauseView({ match: paused(), seat, graceIn, absentBack });
      if (v.kind === 'panel') expect(`${v.title} ${v.body ?? ''}`).not.toMatch(/—|--/);
    }
  });
});

describe('R-VERSUS-RELIABLE-04: a pause during Hero Select', () => {
  it('shows the veil over the picker, with its Unpause, for a seated player', () => {
    useGame.setState({ heroChoices: ['a', 'b', 'c'], pendingMode: 'versus' } as never);
    useVersus.setState({ match: paused({ phase: 'hero_select', paused_seat: 'p1' }), room: null });
    const ui = mount(<VersusHeroSelectPause />);
    try {
      expect(ui.container.querySelector('.vsveil')).not.toBeNull();
      expect(ui.container.querySelector('.vspanel-title')?.textContent).toBe('Welcome back');
      expect(ui.container.querySelector('.vspanel-actions button')?.textContent).toBe('Unpause');
      act(() => { useVersus.setState({ match: paused({ phase: 'hero_select', paused_at: null, paused_seat: null }) }); });
      expect(ui.container.querySelector('.vsveil'), 'gone on the resume').toBeNull();
    } finally { ui.unmount(); }
  });

  it('nothing outside a Versus Hero Select, and nothing for a spectator', () => {
    useVersus.setState({ match: paused({ phase: 'hero_select' }), room: null });
    const ui = mount(<VersusHeroSelectPause />);
    try {
      expect(ui.container.querySelector('.vsveil'), 'no picker up').toBeNull();
      act(() => { useGame.setState({ heroChoices: ['a', 'b', 'c'], pendingMode: 'versus' } as never); });
      act(() => { useVersus.setState({ match: paused({ phase: 'hero_select', p1_user: 'x', p2_user: 'y' }) }); });
      expect(ui.container.querySelector('.vsveil'), 'not seated').toBeNull();
    } finally { ui.unmount(); }
  });
});
