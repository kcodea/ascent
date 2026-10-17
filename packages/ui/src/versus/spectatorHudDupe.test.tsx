// @vitest-environment jsdom
/**
 * THE SPECTATOR HUD SHOWS ME ONCE, AND MY EMOTE WHEEL OPENS DOWNWARD (owner 2026-10-16, via the coordinator;
 * R-SPECTATE-HUD-02). Pinned: the stands drop my own id (every id that is me) and collapse one account to one chip, in
 * Versus and Live Games; one spectator HUD at a time; a spectator's wheel is placed below the plate when it fits,
 * above only when it must, always inside the stage; the player's own wheel keeps its fixed offset.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createLobbyRun } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'me-1' }));

const { useGame } = await import('../store');
const rt = await import('../emotes/emoteRuntime');
const se = await import('./spectatorEmotes');
const w = await import('./watchers');
const sp = await import('./spectate');
const { SpectatorSelf } = await import('./SpectatorHud');
const { versusWatchersOf } = await import('./versusStore');
const { LiveWatchBar } = await import('../live/LiveWatchBar');
const { useLiveWatch } = await import('../live/liveWatch');

const W = (id: string, name = id): { id: string; name: string; profile: null } => ({ id, name, profile: null });
let ui: Mounted | null = null;
afterEach(() => {
  ui?.unmount(); ui = null;
  act(() => { w.setWatchers([]); sp.useSpectate.setState({ active: false }); useLiveWatch.setState({ game: null }); });
  se.resetSpectatorEmotesForTests();
  rt.resetEmotesForTests();
});

describe('R-SPECTATE-HUD-02: never two of me', () => {
  it('the stands drop every id that is me, and one account is one chip', () => {
    const rows = [W('me-1', 'Orangez'), W('u-2', 'Sam'), W('u-2', 'Sam'), W('me-auth', 'Orangez'), W('u-3')];
    expect(w.othersInStands(rows, ['me-1', 'me-auth', null]).map((x) => x.id)).toEqual(['u-2', 'u-3']);
    expect(w.uniqueWatchers(rows).map((x) => x.id)).toEqual(['me-1', 'u-2', 'me-auth', 'u-3']);
    act(() => { w.setWatchers(rows); });
    expect(w.useWatchers.getState().list.filter((x) => x.id === 'u-2')).toHaveLength(1); // the list itself is deduped
  });

  it('the top-left row draws me ONCE even when the stands list me (and twice)', () => {
    act(() => { w.setWatchers([W('me-1', 'Orangez'), W('me-1', 'Orangez'), W('u-2', 'Sam')]); });
    ui = mount(<SpectatorSelf onLeave={() => undefined} />);
    const ids = [...ui.container.querySelectorAll('[data-watcher]')].map((e) => e.getAttribute('data-watcher'));
    expect(ids).toEqual(['me-1', 'u-2']);
    expect(ui.container.querySelectorAll('.vsspec-leave')).toHaveLength(1);
  });

  it('Versus: a spectator sees the other spectators once each, never themselves', () => {
    const m = (userId: string, role: string) => ({ userId, role, displayName: userId, profile: {}, lastSeenAt: '' });
    const room = { members: [m('p1', 'p1'), m('me-1', 'spectator'), m('u-2', 'spectator'), m('u-2', 'spectator')] } as unknown as Parameters<typeof versusWatchersOf>[0];
    expect(versusWatchersOf(room, false, 'me-1').map((x) => x.id)).toEqual(['u-2']);
    expect(versusWatchersOf(room, true, 'p1').map((x) => x.id)).toEqual(['me-1', 'u-2']);
  });

  it('one spectator HUD at a time: the live bar stands down on a Versus watch screen', () => {
    const row = { game_id: 'g', display_name: 'Rooks', hero_id: 'warden', cosmetics: null, division_index: 0, rank_points: 0, rating: 0, round: 1, phase: 'shop' as const, placement: null, spectators: 1, started_at: '' };
    act(() => { useLiveWatch.setState({ game: row }); sp.useSpectate.setState({ active: true }); useGame.setState({ run: createLobbyRun(1, 'warden') }); });
    ui = mount(<LiveWatchBar />);
    expect(ui.container.querySelectorAll('.vsself')).toHaveLength(1);
    act(() => { useGame.setState({ run: { ...useGame.getState().run, mode: 'versus' } }); });
    expect(ui.container.querySelector('.vsself')).toBeNull();
  });
});

describe('R-SPECTATE-HUD-02: the spectator wheel opens downward, inside the stage', () => {
  const vp = { w: 1600, h: 900 };
  const size = { w: 440, h: 300 };
  it('below the top-left plate when it fits', () => {
    const p = rt.placeEmoteMenu({ x: 60, top: 20, bottom: 74 }, size, vp);
    expect(p.side).toBe('below');
    expect(p.top).toBe(74 + 14);
    expect(p.left).toBe(8); // clamped to the stage's left edge, never off it
  });
  it('flips above only when there is no room below; always inside the stage', () => {
    const low = rt.placeEmoteMenu({ x: 1580, top: 700, bottom: 760 }, size, vp);
    expect(low.side).toBe('above');
    expect(low.top + size.h).toBeLessThanOrEqual(700 - 14);
    expect(low.left + size.w).toBeLessThanOrEqual(vp.w - 8); // clamped to the right edge
    const cramped = rt.placeEmoteMenu({ x: 800, top: 300, bottom: 340 }, { w: 440, h: 800 }, vp);
    expect(cramped.top).toBeGreaterThanOrEqual(8);
  });
  it('the spectator plate opens a PLACED menu; the player own portrait menu is unchanged (no anchor, fixed offset)', () => {
    se.installSpectatorEmotes('me-1', () => undefined);
    rt.openEmoteMenu({ x: 60, y: 74 }, { spectator: true, below: true, anchor: { top: 20, bottom: 74 } });
    expect(rt.useEmoteUi.getState().menu).toMatchObject({ below: true, anchor: { top: 20, bottom: 74 } });
    se.uninstallSpectatorEmotes();
    act(() => { rt.closeEmoteMenu(); });
    rt.markEmotePhase('shop', 1);
    act(() => { useGame.setState({ run: createLobbyRun(2, 'warden'), replaying: false, replaySession: null }); });
    rt.openEmoteMenu({ x: 100, y: 800 });
    expect(rt.useEmoteUi.getState().menu).toEqual({ x: 100, y: 800 });
  });
});
