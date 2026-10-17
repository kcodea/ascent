// @vitest-environment jsdom
/**
 * VERSUS ROOMS OPEN on the menus (owner 2026-10-17: "can we add a way to show if a lobby is up in versus mode so
 * players know to look"; R-VERSUS-OPEN-ROOMS-01). Pinned against the real Title, side menu, store and shared poller,
 * with the network faked:
 *   - count > 0: the Mode screen's Versus tile glows with "N open", the title's Play and the side menu's Play carry the
 *     badge, and each says "N Versus rooms open" in the game's data-tip bubble (no title=);
 *   - count 0, offline, Versus not public, or the migration not run: nothing shows;
 *   - no request while a game is on screen (the title hidden) or a Versus match of mine is being played, including
 *     on the 45 s tick; one timer serves every surface.
 * The viewer's own room is left out by the SQL itself (versusOpenRooms.db.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const net = vi.hoisted(() => ({ open: 2, remote: true, versus: true, fail: null as null | string, calls: 0 }));
vi.mock('../remoteBoards', async (importOriginal) => ({ ...(await importOriginal<typeof import('../remoteBoards')>()), remoteEnabled: () => net.remote }));
vi.mock('./versusFlag', async (importOriginal) => ({ ...(await importOriginal<typeof import('./versusFlag')>()), versusEnabled: () => net.versus }));
vi.mock('./versusRemote', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./versusRemote')>();
  return {
    ...orig,
    versusRemote: {
      ...orig.versusRemote,
      openRooms: async () => {
        net.calls++;
        if (net.fail) throw new orig.VersusError(net.fail);
        return { open: net.open, seatOpen: net.open };
      },
    },
  };
});

import { Title } from '../Title';
import { useGame } from '../store';
import { useVersus } from './versusStore';
import { __versusOpenRooms } from './versusOpenRooms';
import { MENU_POLL_MS, menuPollRunning } from '../menuPoll';

let ui: Mounted | null = null;
const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const poll = async (): Promise<void> => { await act(async () => { await __versusOpenRooms.poll(); }); };

beforeEach(() => {
  Object.assign(net, { open: 2, remote: true, versus: true, fail: null, calls: 0 });
  __versusOpenRooms.resetDeployed();
  useVersus.setState({ match: null });
  useGame.setState({ showTitle: true, titleView: 'modes', savedRun: null, practiceSetupOpen: false });
});
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); useGame.setState({ titleView: 'menu' }); });

describe('the open Versus rooms indicator', () => {
  it('shows on the Versus tile, the title Play and the side menu Play while rooms are open, and hides at 0', async () => {
    ui = mount(<Title onSettings={() => {}} />);
    await poll();
    const tile = $('.modecard[data-mp="versus"]')!;
    expect(tile.classList.contains('vs-open')).toBe(true);
    expect(tile.querySelector('.vs-openchip')?.textContent).toBe('2 open');
    expect(tile.dataset.tip).toBe('2 Versus rooms open');
    expect($('.titlenav .vs-badge')?.textContent).toBe('2');
    expect($('.titlenav .tn-item')?.dataset.tip).toBe('2 Versus rooms open');
    expect($('.msb .sb-play .vs-badge')?.textContent).toBe('2');
    expect($('.msb .msb-item')?.dataset.tip).toBe('2 Versus rooms open');
    expect(document.querySelector('[title]')).toBeNull();

    net.open = 1;
    await poll();
    expect(tile.dataset.tip).toBe('1 Versus room open');

    net.open = 0;
    await poll();
    expect($('.modecard[data-mp="versus"]')!.classList.contains('vs-open')).toBe(false);
    expect(document.querySelector('.vs-openchip, .vs-badge')).toBeNull();
    expect($('.modecard[data-mp="versus"]')!.dataset.tip).toBeUndefined();
    expect($('.titlenav .tn-item')).toBeNull(); // no saved run, no rooms: Play is unwrapped again
  });

  it('shows nothing offline, when Versus is not public, or before the migration runs (then stops asking)', async () => {
    ui = mount(<Title onSettings={() => {}} />);
    await poll();
    expect($('.vs-badge')).not.toBeNull();

    net.remote = false;
    await poll();
    expect($('.vs-badge')).toBeNull();
    net.remote = true;

    net.versus = false;
    await poll();
    expect($('.vs-badge')).toBeNull();
    net.versus = true;

    net.fail = 'not_deployed';
    await poll();
    expect($('.vs-badge')).toBeNull();
    const calls = net.calls;
    net.fail = null;
    await poll();
    expect(net.calls).toBe(calls); // not deployed: no more requests this session
    expect($('.vs-badge')).toBeNull();
  });

  it('a saved run keeps its warning on Play, with the rooms line after it', async () => {
    ui = mount(<Title onSettings={() => {}} />);
    await poll();
    act(() => { useGame.setState({ savedRun: { wave: 3 } as never }); });
    expect($('.titlenav .tn-item')?.dataset.tip).toMatch(/^New run\. Replaces your saved run\..* 2 Versus rooms open\.$/);
  });
});

describe('no polling during a game (R-VERSUS-OPEN-ROOMS-01)', () => {
  it('asks nothing while the title is hidden or a Versus match of mine is live, on the tick or on demand', async () => {
    vi.useFakeTimers();
    ui = mount(<Title onSettings={() => {}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(menuPollRunning()).toBe(true);
    const start = net.calls;
    expect(start).toBeGreaterThan(0); // the first surface asked at once

    // A menu is on screen: the shared tick asks once per interval.
    await act(async () => { await vi.advanceTimersByTimeAsync(MENU_POLL_MS); });
    expect(net.calls).toBe(start + 1);

    // A match is on screen (the title hidden): the tick and a direct poll ask nothing, and the badge is gone.
    act(() => { useGame.setState({ showTitle: false }); });
    const inGame = net.calls;
    await act(async () => { await vi.advanceTimersByTimeAsync(MENU_POLL_MS * 3); });
    await poll();
    expect(net.calls).toBe(inGame);
    expect(__versusOpenRooms.get()).toBe(0);

    // Back on the menu, but a Versus match of mine is being played: still nothing.
    act(() => { useGame.setState({ showTitle: true }); useVersus.setState({ match: { phase: 'shop' } as never }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(MENU_POLL_MS); });
    expect(net.calls).toBe(inGame);

    // The match is over: the menu asks again.
    act(() => { useVersus.setState({ match: { phase: 'complete' } as never }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(MENU_POLL_MS); });
    expect(net.calls).toBe(inGame + 1);
  });
});
