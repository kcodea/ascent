// @vitest-environment jsdom
/**
 * R-REPLAY-STREAM-01: the replay records the SAME cursor messages the live spectator sender broadcasts.
 *
 * The live sender (`versus/spectateTap.ts`) and the replay recorder (`replay/streamRecorder.ts`) both subscribe to the
 * one builder (`versus/cursorSource.ts`). Driven with the same inputs (pointer moves over anchored and plain UI, a card
 * picked up with its drop gap, a committed drop, a refused drop, an aim line, an idle hide), every message the stands
 * received comes back out of the recorded stream exactly, minus the seat and the legacy window fractions. Also pinned:
 * one segment per round (the fight included since 2026-10-22), nothing recorded when the run records no replay, the overlay and Skip
 * events, and a resume splicing restored rounds in front on the clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EV_OVERLAY, EV_SKIP, decodeStreamEvents, decodeStreamSegment, type Action, type StreamCursorBody } from '@game/sim';
import { dragStore } from '../dragStore';
import { liveAim } from '../aimState';
import * as tap from '../versus/spectateTap';
import { cursorSubscribers } from '../versus/cursorSource';
import {
  installStreamRecorder, noteStreamOverlay, noteStreamSkip, prependStream, resetStream, startStreamCapture, takeStream, takeStreamSegments,
} from './streamRecorder';

function placed(attrs: Record<string, string>, r: { left: number; top: number; width: number; height: number }): HTMLElement {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => r }) as DOMRect;
  document.body.appendChild(el);
  return el;
}
/** A pointer move stamped on the page clock (as a real event is), then 17 ms of time (ticks run as they fall due). */
const move = (target: EventTarget, x: number, y: number): void => {
  const e = new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(e, 'timeStamp', { value: performance.now() });
  target.dispatchEvent(e);
  vi.advanceTimersByTime(17);
};
let stops: (() => void)[] = [];
const capture = (): void => { stops.push(startStreamCapture()); };
const view = { cardId: 'dw_pimm' } as never;
const hold = (uid: string, gap = -1): void => dragStore.set({
  drag: { uid, source: 'hand', view, active: true, ox: 0, oy: 0, grabOx: 0, grabOy: 0, w: 0, h: 0, startX: 0, startY: 0, x: 0, y: 0 } as never,
  overZone: gap >= 0 ? 'warband' : null,
  decision: { ...dragStore.get().decision, gapIndex: gap, overWarband: gap >= 0 },
  snapping: false,
});
const stripSent = (p: unknown): Omit<StreamCursorBody, 'x' | 'y'> => {
  const { seat: _s, x: _x, y: _y, ...rest } = p as StreamCursorBody & { seat: string };
  void _s; void _x; void _y;
  return rest;
};

let round = { wave: 3, shop: true };
let recording = true;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
  Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true });
  round = { wave: 3, shop: true };
  recording = true;
  // The identity clock: the frames' clock IS the player's clock here, so `ts` compares directly.
  installStreamRecorder({ clockAt: (t) => t, recording: () => (recording ? round : null) });
  resetStream();
});
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  tap.setSpectatorTap(false, null, null);
  dragStore.endDrag();
  liveAim.current = null;
  installStreamRecorder(null);
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('R-REPLAY-STREAM-01: the recorder stores exactly what the live sender sends', () => {
  it('same inputs, same messages: moves, anchors, trails, a held card with its gap, drops, an aim, a hide', () => {
    const send = vi.fn();
    tap.setSpectatorTap(true, 'p1', send);
    capture();
    expect(cursorSubscribers()).toBe(2); // one builder, two subscribers
    const card = placed({ 'data-uid': 'b1' }, { left: 400, top: 300, width: 120, height: 160 });
    const btn = placed({ 'data-spec': 'endTurn' }, { left: 1600, top: 900, width: 200, height: 80 });
    const step = (): void => { vi.advanceTimersByTime(tap.CURSOR_TICK_MS); };
    // hover a card, then a button (anchored points, trails)
    for (let i = 0; i < 6; i++) move(card, 420 + i * 10, 320 + i * 5);
    for (let i = 0; i < 4; i++) move(btn, 1650 + i * 7, 920);
    // pick a card up, drag it over the board with a gap, drop it: committed
    hold('h1', 2);
    for (let i = 0; i < 6; i++) move(document.body, 600 + i * 40, 700 - i * 20);
    hold('h1', 3);
    move(document.body, 880, 560);
    step();
    dragStore.endDrag();
    tap.tapAct({ type: 'play', uid: 'h1' } as Action);
    step();
    // a refused drop: the card springs back
    hold('h2');
    move(document.body, 700, 700);
    step();
    dragStore.set({ snapping: true });
    step();
    dragStore.endDrag();
    // an aim line from the hero power, on a target and off it
    liveAim.current = { from: { x: 960, y: 1000 }, onTarget: false };
    move(document.body, 900, 500);
    step();
    liveAim.current = { from: { x: 960, y: 1000 }, onTarget: true, defId: 'ruby-target' };
    dragStore.set({ aimTargetUid: 'b1' });
    move(card, 450, 360);
    step();
    liveAim.current = null;
    dragStore.set({ aimTargetUid: null });
    move(card, 455, 362);
    step();
    // idle: one hide, still over the card
    vi.advanceTimersByTime(tap.CURSOR_IDLE_MS + 200);

    const sent = send.mock.calls.filter((c) => c[0] === tap.SPECTATE_CURSOR_EVENT).map((c) => stripSent(c[1]));
    expect(sent.length).toBeGreaterThan(10);
    expect(sent.some((m) => m.an?.k === 'u:b1')).toBe(true);
    expect(sent.some((m) => m.an?.k === 's:endTurn')).toBe(true);
    expect(sent.some((m) => m.tr?.length)).toBe(true);
    expect(sent.some((m) => m.drag?.g?.gi === 3)).toBe(true);
    expect(sent.some((m) => m.de === 'c')).toBe(true);
    expect(sent.some((m) => m.de === 'x')).toBe(true);
    expect(sent.some((m) => m.aim?.def === 'ruby-target' && m.aim.t === 'b1')).toBe(true);
    expect(sent.at(-1)?.hide).toBe(true);

    // Through JSON, as it is stored and uploaded.
    const stream = JSON.parse(JSON.stringify(takeStream()));
    expect(stream.v).toBe(1);
    const recorded = stream.segs.flatMap(decodeStreamSegment);
    expect(recorded).toEqual(sent);
    stops.pop()!();
    expect(cursorSubscribers()).toBe(1);
  });

  it('the recorder alone (nobody watching) records the same messages, drops included', () => {
    const send = vi.fn();
    capture();
    hold('h1');
    move(document.body, 600, 600);
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS);
    dragStore.endDrag();
    tap.tapAct({ type: 'play', uid: 'h1' } as Action); // counted for the drop even with nobody watching
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS);
    const rec = takeStreamSegments().flatMap(decodeStreamSegment);
    expect(rec.at(-1)).toMatchObject({ drag: null, de: 'c' });
    expect(send).not.toHaveBeenCalled();
    stops.pop()!();
    expect(cursorSubscribers()).toBe(0);
  });
});

describe('R-REPLAY-STREAM-01: what the recorder keeps', () => {
  it('one segment per round, the fight included (R-SPECTATE-COMBATCURSOR-01); nothing when the run records no replay', () => {
    capture();
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS); // the join's first message (the hand's state at once)
    move(document.body, 100, 100);
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS);
    round = { wave: 3, shop: false }; // the fight: recorded too since 2026-10-22
    move(document.body, 200, 100);
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS);
    round = { wave: 4, shop: true };
    move(document.body, 300, 100);
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS);
    recording = false; // a replay, a sandbox: nothing
    move(document.body, 400, 100);
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS);
    const segs = takeStreamSegments();
    expect(segs.map((g) => [g.w, g.n])).toEqual([[3, 3], [4, 1]]);
  });

  it('records the overlay minimize state and the fight\'s Skip as events, through the tap', () => {
    vi.advanceTimersByTime(5000);
    tap.tapOverlay({ discover: false, power: false, quest: false, forge: true });
    tap.tapOverlay({ discover: false, power: false, quest: false, forge: true }); // unchanged: not recorded again
    round = { wave: 3, shop: false };
    vi.advanceTimersByTime(4000);
    tap.tapSkipCombat();
    const ev = takeStreamSegments().flatMap(decodeStreamEvents);
    expect(ev.map((e) => e.code)).toEqual([EV_OVERLAY, EV_SKIP]);
    expect(ev[0]!.value).toBe(8);
    expect(ev[1]!.t).toBeGreaterThan(ev[0]!.t);
    noteStreamOverlay({ discover: false, power: false, quest: false, forge: false });
    noteStreamSkip();
    tap.tapOverlay({ discover: false, power: false, quest: false, forge: false });
  });

  it('a resume puts the restored rounds in front and moves this session along the clock', () => {
    capture();
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS);
    const before = takeStreamSegments()[0]!;
    const restored = [{ w: 1, t0: 0, t1: 900, n: 0, k: [], m: '' }];
    prependStream(restored, 2000);
    const segs = takeStreamSegments();
    expect(segs[0]).toBe(restored[0]);
    expect(segs[1]!.t0).toBe(before.t0 + 2000);
    expect(decodeStreamSegment(segs[1]!)[0]!.ts).toBe(decodeStreamSegment(before)[0]!.ts + 2000);
  });
});
