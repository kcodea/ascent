// @vitest-environment jsdom
/**
 * R-SPECTATE-SMOOTH-01 (owner 2026-10-20: "cursor tracking is janky sometimes, shop buys and moves still don't seem to
 * work with re-orienting cards etc, things happen once placed instead of in real time"). Pinned:
 *  - the player's messages carry their own clock (`ts`) and a 60 Hz path (`tr`) at 20 messages a second;
 *  - the stands map that clock onto their own (fastest delivery + an eased jitter buffer) and draw the hand at an even
 *    pace: interpolated, carried briefly on its velocity when the data runs dry, never stamped by arrival time;
 *  - the card in hand, the drop gap, the aim and the hover apply when playback reaches them, not on arrival;
 *  - a drop says whether it committed (`de`): a committed card stays where it was let go until its action lands, then
 *    the rows settle ONCE through the player's own drop FLIP (`presentAction('dropping')`); a refused one springs back;
 *  - an action hurries its publish (`ACT_FLUSH_MS`) and lands when the drawn hand gets there;
 *  - an older player (no `ts`) still plays exactly as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVersusRun, type Action, type BoardCard, type RunState } from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const pb = await import('./cursorPlayback');
const sp = await import('./spectate');
const tap = await import('./spectateTap');
const { dragStore } = await import('../dragStore');
const { setActionPresenter } = await import('../actionPresenter');
const { newPublisher, nextSpectatorMessage } = await import('./spectatorView');
const { useGame } = await import('../store');

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
let frames: { seat: 'p1' | 'p2'; frame: unknown }[] = [];
const io = { latestFrames: vi.fn(async () => frames), requestKey: vi.fn(), loadRounds: vi.fn(), lobbyFor: vi.fn(() => undefined) };
const bc = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'dwarf', attack: 2, health: 2, keywords: [], golden: false }) as unknown as BoardCard;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  sp.installSpectateIo(io);
});
afterEach(() => {
  sp.resetSpectate();
  sp.installSpectateIo(null);
  dragStore.reset();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  tap.setSpectatorTap(false, null, null);
});

describe('the playback clock (pure)', () => {
  it('interpolates between points, holds before the first, and carries the last velocity for a bounded time', () => {
    const pts = [{ s: 0, x: 0, y: 0 }, { s: 16, x: 16, y: 0 }, { s: 32, x: 32, y: 8 }];
    expect(pb.pointAt(pts, 8)).toEqual({ x: 8, y: 0 });
    expect(pb.pointAt(pts, 24)).toEqual({ x: 24, y: 4 });
    expect(pb.pointAt(pts, -50)).toEqual({ x: 0, y: 0 });
    // Past the newest: the last segment's velocity (1 px/ms in x, 0.5 in y), for at most EXTRAPOLATE_MS.
    expect(pb.pointAt(pts, 32 + 10)).toEqual({ x: 42, y: 13 });
    expect(pb.pointAt(pts, 32 + 500)).toEqual({ x: 32 + pb.EXTRAPOLATE_MS, y: 8 + pb.EXTRAPOLATE_MS / 2 });
    // A long pause between the last two points is not a motion: nothing to carry.
    expect(pb.pointAt([{ s: 0, x: 0, y: 0 }, { s: 1000, x: 10, y: 0 }], 1100)).toEqual({ x: 10, y: 0 });
    expect(pb.pointAt([], 5)).toBeNull();
  });

  it('a point that arrives late slots in by its own time; a repeat replaces', () => {
    const pts: { s: number; x: number; y: number }[] = [];
    pb.addPoint(pts, { s: 10, x: 1, y: 1 });
    pb.addPoint(pts, { s: 30, x: 3, y: 3 });
    pb.addPoint(pts, { s: 20, x: 2, y: 2 });
    pb.addPoint(pts, { s: 30, x: 9, y: 9 });
    expect(pts.map((p) => p.s)).toEqual([10, 20, 30]);
    expect(pts[2]!.x).toBe(9);
  });

  it('maps the sender clock by its fastest delivery and buffers the jitter (grows fast, shrinks slowly, clamped)', () => {
    const c = pb.newRemoteClock();
    // A steady 40 ms network: the buffer settles near one send interval plus the margin.
    for (let i = 0; i < 40; i++) pb.noteDelivery(c, 1000 + i * 50, 5040 + i * 50);
    expect(c.base).toBe(4040);
    expect(c.buffer).toBeGreaterThanOrEqual(pb.MIN_BUFFER_MS);
    expect(c.buffer).toBeLessThan(pb.SEND_INTERVAL_MS + 40);
    const steady = c.buffer;
    // Jitter arrives (deliveries 0..150 ms late): the buffer grows within a few messages.
    for (let i = 40; i < 60; i++) pb.noteDelivery(c, 1000 + i * 50, 5040 + i * 50 + (i % 2 ? 150 : 0));
    expect(c.buffer).toBeGreaterThan(steady + 80);
    expect(c.buffer).toBeLessThanOrEqual(pb.MAX_BUFFER_MS);
    // Playback runs `base + buffer` behind the sender, and an action at sender time s is reached at s + base + buffer.
    expect(pb.playbackTime(c, 10_000)).toBeCloseTo(10_000 - c.base - c.buffer, 6);
    expect(pb.localTimeOf(c, 2000)).toBeCloseTo(2000 + c.base + c.buffer, 6);
  });
});

describe('the sender: the player clock, a 60 Hz path, the drop verdict, a hurried action', () => {
  const move = (x: number, y: number, t: number): void => {
    const e = new MouseEvent('pointermove', { clientX: x, clientY: y });
    Object.defineProperty(e, 'timeStamp', { value: t });
    window.dispatchEvent(e);
  };

  it('one message carries the newest point (old fields intact) plus its earlier points ~16 ms apart, on the player clock', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const send = vi.fn();
    tap.setSpectatorTap(true, 'p1', send);
    move(100, 100, 1000);
    move(110, 100, 1005); // same 16 ms slot: the newest move in it wins
    move(115, 100, 1012);
    move(200, 150, 1020);
    move(384, 216, 1040);
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS);
    const msgs = send.mock.calls.filter((c) => c[0] === tap.SPECTATE_CURSOR_EVENT).map((c) => c[1]);
    expect(msgs).toHaveLength(1);
    const m = msgs[0]!;
    expect(m.ts).toBe(1040);
    expect(m.x).toBe(Math.round((384 / window.innerWidth) * 1000) / 1000); // an older spectator still reads x / y
    expect(m.tr.map((p: number[]) => p[0])).toEqual([28, 20]); // 1012 and 1020, as ms before 1040
    expect(tap.CURSOR_TICK_MS).toBe(50);
  });

  it('a drag that ends with an action is a committed drop (c); one that ends without is refused (x); actions carry ts and hurry the publish', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const send = vi.fn();
    const publish = vi.fn();
    const publishNow = vi.fn();
    tap.setSpectatorTap(true, 'p1', send, publish, publishNow);
    const view = { cardId: 'dw_pimm' } as never;
    const hold = (uid: string): void => dragStore.set({ drag: { uid, source: 'hand', view, active: true, ox: 0, oy: 0, grabOx: 0, grabOy: 0, w: 0, h: 0, startX: 0, startY: 0, x: 0, y: 0 } as never });
    const last = (): Record<string, unknown> => send.mock.calls.filter((c) => c[0] === tap.SPECTATE_CURSOR_EVENT).at(-1)![1];
    hold('h1');
    move(10, 10, 100);
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS);
    expect((last().drag as { uid: string }).uid).toBe('h1');
    dragStore.endDrag();
    tap.tapAct({ type: 'play', uid: 'h1' } as Action);
    expect(publish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS);
    expect(last()).toMatchObject({ drag: null, de: 'c' });
    expect(publishNow).toHaveBeenCalledTimes(1); // within ACT_FLUSH_MS, not at idle time
    expect(typeof tap.takeActs()[0]!.ts).toBe('number');
    // A refused drop (no action, or the card springing back) is `x`.
    hold('h2');
    move(20, 10, 300);
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS);
    dragStore.set({ snapping: true });
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS);
    expect(last()).toMatchObject({ drag: null, de: 'x' });
  });
});

/** Watch a run from the shop (seat p1). */
async function watch(run: RunState, id: string): Promise<ReturnType<typeof newPublisher>> {
  const pub = newPublisher('p1');
  frames = [{ seat: 'p1', frame: nextSpectatorMessage(pub, run, run.wave, true) }];
  sp.spectateSync({ id, phase: run.phase === 'combat' ? 'combat' : 'shop', round: run.wave } as never, {});
  await flush();
  return pub;
}
const shopRun = (): RunState => ({ ...createVersusRun(5, 'warden', 'set2'), board: [bc('b1', 'dw_foreman')], hand: [bc('h1', 'dw_pimm')] } as RunState);
const sample = (patch: object): unknown => ({ seat: 'p1', x: 0.5, y: 0.5, gx: 0.5, gy: 0.5, ...patch });
const dragOf = (uid: string, g = { z: 'warband', gi: 0 }) => ({ uid, source: 'hand', cardId: 'dw_pimm', g });

describe('the stands: state on the hand\'s clock, the drop parks until its action lands', () => {
  it('a stamped drag applies when playback reaches it, not on arrival; an older (unstamped) one applies at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    await watch(shopRun(), 'sm1');
    const t0 = performance.now();
    sp.receiveSpectatorCursor(sample({ ts: t0, drag: dragOf('h1') }));
    expect(sp.cursorFeed.drag).toBeNull(); // arrived, not yet drawn
    vi.advanceTimersByTime(400);
    sp.advanceCursorFeed(performance.now());
    expect(sp.cursorFeed.drag?.uid).toBe('h1');
    expect(sp.cursorFeed.drag?.decision.gapIndex).toBe(0);
    sp.resetSpectate();
    await watch(shopRun(), 'sm1b');
    sp.receiveSpectatorCursor(sample({ drag: dragOf('h1') })); // no ts: the older wire
    expect(sp.cursorFeed.legacy).toBe(true);
    expect(sp.cursorFeed.drag?.uid).toBe('h1');
  });

  it('a committed drop parks the card (its gap stays open); the action takes it and primes the player\'s drop FLIP', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const run = shopRun();
    const pub = await watch(run, 'sm2');
    const presented: { kind: string }[] = [];
    const off = setActionPresenter((a) => presented.push(a));
    const t0 = performance.now();
    sp.receiveSpectatorCursor(sample({ ts: t0, drag: dragOf('h1') }));
    sp.receiveSpectatorCursor(sample({ ts: t0 + 50, drag: null, de: 'c' }));
    sp.receiveSpectatorCursor(sample({ ts: t0 + 40, drag: dragOf('h1') })); // out of order: slots in before the drop
    vi.advanceTimersByTime(400);
    sp.advanceCursorFeed(performance.now());
    expect(sp.cursorFeed.drag).toBeNull();
    expect(sp.cursorFeed.landing?.drag.uid).toBe('h1');
    // The action arrives: the minion is played.
    const next = { ...run, hand: [], board: [bc('h1', 'dw_pimm'), ...run.board] } as RunState;
    const msg = nextSpectatorMessage(pub, next, next.wave)!;
    msg.acts = [{ t: 'play', uid: 'h1' }];
    sp.receiveSpectate(msg);
    vi.advanceTimersByTime(100);
    expect(presented.find((p) => p.kind === 'dropping')).toMatchObject({ kind: 'dropping', uid: 'h1', drop: 'place' });
    expect(sp.cursorFeed.landing).toBeNull();
    expect(useGame.getState().run.board.map((c) => c.uid)).toEqual(['h1', 'b1']);
    off();
  });

  it('an action that lands while the hand still shows the card takes it, and queued states never lift it again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const run = shopRun();
    const pub = await watch(run, 'sm2b');
    const t0 = performance.now();
    sp.receiveSpectatorCursor(sample({ ts: t0, drag: dragOf('h1') }));
    vi.advanceTimersByTime(400);
    sp.advanceCursorFeed(performance.now());
    expect(sp.cursorFeed.drag?.uid).toBe('h1');
    sp.receiveSpectatorCursor(sample({ ts: t0 + 400, drag: dragOf('h1') })); // still queued when the action lands
    const next = { ...run, hand: [], board: [bc('h1', 'dw_pimm'), ...run.board] } as RunState;
    const msg = nextSpectatorMessage(pub, next, next.wave)!;
    msg.acts = [{ t: 'play', uid: 'h1' }]; // no ts: lands on arrival
    sp.receiveSpectate(msg);
    vi.advanceTimersByTime(100);
    expect(sp.cursorFeed.drag).toBeNull();
    vi.advanceTimersByTime(400);
    sp.advanceCursorFeed(performance.now());
    expect(sp.cursorFeed.drag).toBeNull();
    expect(sp.cursorFeed.landing).toBeNull();
  });

  it('a refused drop springs back; a committed drop whose action never comes springs back after LAND_WAIT_MS', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    await watch(shopRun(), 'sm3');
    let t = performance.now();
    sp.receiveSpectatorCursor(sample({ ts: t, drag: dragOf('h1') }));
    sp.receiveSpectatorCursor(sample({ ts: t + 20, drag: null, de: 'x' }));
    vi.advanceTimersByTime(400);
    sp.advanceCursorFeed(performance.now());
    expect(sp.cursorFeed.spring?.uid).toBe('h1');
    expect(sp.cursorFeed.landing).toBeNull();
    sp.endSpring();
    t = performance.now();
    sp.receiveSpectatorCursor(sample({ ts: t, drag: dragOf('h1') }));
    sp.receiveSpectatorCursor(sample({ ts: t + 20, drag: null, de: 'c' }));
    vi.advanceTimersByTime(400);
    sp.advanceCursorFeed(performance.now());
    expect(sp.cursorFeed.landing?.drag.uid).toBe('h1');
    vi.advanceTimersByTime(sp.LAND_WAIT_MS + 50);
    sp.advanceCursorFeed(performance.now());
    expect(sp.cursorFeed.landing).toBeNull();
    expect(sp.cursorFeed.spring?.uid).toBe('h1');
  });

  it('an action stamped on the player clock waits for the drawn hand to reach it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const run = shopRun();
    const pub = await watch(run, 'sm4');
    const t0 = performance.now();
    sp.receiveSpectatorCursor(sample({ ts: t0 }));
    const next = { ...run, embers: (run.embers ?? 0) + 1 } as RunState;
    const msg = nextSpectatorMessage(pub, next, next.wave, false, true)!;
    msg.acts = [{ t: 'freeze', ts: t0 }];
    sp.receiveSpectate(msg);
    expect(useGame.getState().run.embers).toBe(run.embers); // the hand is not there yet
    vi.advanceTimersByTime(300);
    expect(useGame.getState().run.embers).toBe(next.embers);
  });
});
