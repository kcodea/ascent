// @vitest-environment jsdom
/**
 * VERSUS SPECTATING, the live extras (owner 2026-10-14). Pinned:
 *  - PLAYER side: with nobody watching, no action tag, no pointer listener, no timer, nothing sent; while watched, a
 *    committed action becomes a tag (a drag carries its path) and the cursor goes out coalesced, ~15 Hz, as window
 *    fractions, with the card in hand; a backgrounded tab sends one hide and then nothing.
 *  - SPECTATOR side: tagged actions play in order: a drag flies the player's path over the old screen and lands; a
 *    button action replays the button's own press cue; a backlog lands without flights; switching seats drops it all;
 *    the cursor is interpolated between samples.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVersusRun, reduce, type Action } from '@game/sim';
import { newPublisher, nextSpectatorMessage } from './spectatorView';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const tap = await import('./spectateTap');
const sp = await import('./spectate');
const { cursorAt } = await import('./SpectatorCursor');
const press = await import('../pressCue');
const trace = await import('../replay/dragTrace');

afterEach(() => { tap.setSpectatorTap(false, null, null); vi.useRealTimers(); });

describe('player side', () => {
  it('nobody watching: no tag, no listener, nothing sent', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const add = vi.spyOn(window, 'addEventListener');
    tap.setSpectatorTap(false, 'p1', send);
    tap.tapAct({ type: 'roll' } as Action);
    expect(tap.takeActs()).toEqual([]);
    expect(add.mock.calls.some((c) => c[0] === 'pointermove')).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
    add.mockRestore();
  });

  it('watched: actions become tags (a drag carries its path); the cursor goes out coalesced with the card in hand', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const send = vi.fn();
    tap.setSpectatorTap(true, 'p1', send);
    tap.tapAct({ type: 'roll' } as Action);
    trace.beginDragTrace('cardx', 10, 10, 'u9');
    trace.endDragTrace(400, 300);
    tap.tapAct({ type: 'buy', uid: 'u9' } as Action);
    tap.tapAct({ type: 'combatScoutPreview' } as unknown as Action); // bookkeeping: not tagged
    const acts = tap.takeActs();
    expect(acts.map((a) => a.t)).toEqual(['roll', 'buy']);
    expect(acts[1]!.uid).toBe('u9');
    expect(acts[1]!.drag?.pts.length).toBeGreaterThanOrEqual(2);
    // three moves inside one tick -> one sample, the latest
    for (const [x, y] of [[100, 100], [200, 150], [384, 216]]) window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS);
    const cursor = send.mock.calls.filter((c) => c[0] === tap.SPECTATE_CURSOR_EVENT);
    expect(cursor).toHaveLength(1);
    expect(cursor[0]![1]).toMatchObject({ seat: 'p1', x: Math.round((384 / window.innerWidth) * 1000) / 1000 });
    // no movement -> nothing more
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS * 3);
    expect(send.mock.calls.filter((c) => c[0] === tap.SPECTATE_CURSOR_EVENT)).toHaveLength(1);
    // idle -> one hide, then nothing
    vi.advanceTimersByTime(tap.CURSOR_IDLE_MS + 200);
    const hides = send.mock.calls.filter((c) => c[0] === tap.SPECTATE_CURSOR_EVENT && (c[1] as { hide?: boolean }).hide);
    expect(hides).toHaveLength(1);
    tap.setSpectatorTap(false, null, null);
    expect(tap.spectatorTapOn()).toBe(false);
  });
});

describe('spectator side', () => {
  const run0 = createVersusRun(5, 'warden', 'set2');
  let frames: { seat: 'p1' | 'p2'; frame: unknown }[] = [];
  const io = { latestFrames: vi.fn(async () => frames), requestKey: vi.fn(), loadRounds: vi.fn(), lobbyFor: vi.fn(() => undefined) };
  const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    sp.installSpectateIo(io);
  });
  afterEach(() => { sp.resetSpectate(); sp.installSpectateIo(null); vi.unstubAllGlobals(); });

  it('a dragged buy flies over the old screen, then lands; a freeze replays the Freeze press', async () => {
    const pub = newPublisher('p1');
    frames = [{ seat: 'p1', frame: nextSpectatorMessage(pub, run0, 1, true) }];
    sp.spectateSync({ id: 'mx', phase: 'shop', round: 1 } as never, {});
    await flush();
    vi.useFakeTimers();
    const before = useGame.getState().run;
    const offer = run0.shop[0]!;
    const bought = reduce(run0, { type: 'buy', uid: offer.uid });
    const d1 = nextSpectatorMessage(pub, bought, 1)!;
    d1.acts = [{ t: 'buy', uid: offer.uid, drag: { cardId: offer.cardId, uid: offer.uid, durMs: 400, pts: [[0.5, 0.3], [0.5, 0.8]] } }];
    sp.receiveSpectate(d1);
    expect(useGame.getState().replayDragGhost).not.toBeNull(); // flying
    expect(useGame.getState().run).toBe(before); // over the old screen
    vi.advanceTimersByTime(450);
    expect(useGame.getState().replayDragGhost).toBeNull();
    expect(useGame.getState().run.hand.length).toBe(bought.hand.length); // landed
    const freezePress = vi.fn();
    const off = press.onPressCue('freeze', freezePress);
    const frozen = reduce(bought, { type: 'freeze' });
    const d2 = nextSpectatorMessage(pub, frozen, 1)!;
    d2.acts = [{ t: 'freeze' }];
    vi.advanceTimersByTime(100);
    sp.receiveSpectate(d2);
    vi.advanceTimersByTime(100);
    expect(freezePress).toHaveBeenCalledTimes(1);
    off();
  });

  it('a backlog lands without flights, in order; switching seats drops the queue', async () => {
    const pub = newPublisher('p1');
    frames = [{ seat: 'p1', frame: nextSpectatorMessage(pub, run0, 1, true) }];
    sp.spectateSync({ id: 'my', phase: 'shop', round: 1 } as never, {});
    await flush();
    vi.useFakeTimers();
    let run = run0;
    const drag = { cardId: 'x', durMs: 600, pts: [[0.5, 0.3], [0.5, 0.8]] as [number, number][] };
    for (let i = 0; i < 4; i++) {
      run = reduce(run, { type: 'freeze' });
      const m = nextSpectatorMessage(pub, run, 1)!;
      m.acts = [{ t: 'freeze', ...(i === 0 ? { drag } : {}) }];
      sp.receiveSpectate(m);
    }
    vi.advanceTimersByTime(5000);
    expect(!!useGame.getState().run.frozen).toBe(!!run.frozen);
    expect(useGame.getState().replayDragGhost).toBeNull(); // the backlog never flew
    sp.watchSeat('p2');
    expect(useGame.getState().replayDragGhost).toBeNull();
  });
});

describe('the cursor glide', () => {
  it('interpolates between samples and holds at the ends', () => {
    const pts = [{ t: 0, x: 0, y: 0 }, { t: 100, x: 1, y: 0.5 }];
    expect(cursorAt(pts, 50)).toEqual({ x: 0.5, y: 0.25 });
    expect(cursorAt(pts, -10)).toEqual({ x: 0, y: 0 });
    expect(cursorAt(pts, 500)).toEqual({ x: 1, y: 0.5 });
    expect(cursorAt([], 5)).toBeNull();
  });
});
