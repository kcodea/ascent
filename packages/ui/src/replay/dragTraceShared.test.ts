// @vitest-environment jsdom
/**
 * R-REPLAY-DRAG-SHARED-01 (2026-10-22): one drag path, two consumers.
 *
 * A ranked lobby game is RECORDED (the replay frames) and can be WATCHED (the spectator tap) at the same time. Both
 * read the drop's drag path for the same committed action: the recorder inside the store's commit, then `tapAct`
 * just after it. Each used to TAKE the parked path (take-and-clear), so the recorder got it and the spectator tag got
 * null: the stands saw the card teleport instead of travel. `dragTraceOf(action)` takes once and hands the same path
 * to every consumer of that action.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRun, shopFrameOf, type Action, type RunState } from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const tap = await import('../versus/spectateTap');
const trace = await import('./dragTrace');

afterEach(() => { tap.setSpectatorTap(false, null, null); vi.useRealTimers(); });

function shopRun(): RunState {
  const base = createRun(11, 'warden');
  return { ...base, phase: 'recruit', embers: 10 } as RunState;
}

describe('R-REPLAY-DRAG-SHARED-01: the replay frame and the spectator tag get the same drag path', () => {
  it('a drag-bought minion in a recorded AND watched game: both carry the path', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const run = shopRun();
    const offer = run.shop[0]!;
    useGame.setState({ run, replaying: false, replayFrames: [shopFrameOf(run, 'turnStart', 0)] });
    tap.setSpectatorTap(true, 'p1', vi.fn());

    trace.beginDragTrace(offer.cardId, 100, 100, offer.uid);
    trace.sampleDragTrace(200, 200);
    trace.endDragTrace(400, 500);
    useGame.getState().dispatch({ type: 'buy', uid: offer.uid } as Action);

    const frame = useGame.getState().replayFrames.at(-1)!;
    expect(frame.kind).toBe('shop');
    const recorded = frame.kind === 'shop' ? frame.drag : undefined;
    expect(recorded, 'the replay frame carries the path').toBeTruthy();
    const tag = tap.takeActs().find((a) => a.t === 'buy');
    expect(tag?.drag, 'the spectator tag carries the path too (it used to be null)').toBeTruthy();
    expect(tag!.drag).toEqual(recorded);
  });

  it('a later, different action does not inherit the path; a non-drag action never takes the park', () => {
    trace.beginDragTrace('cardx', 10, 10, 'u1');
    trace.endDragTrace(300, 300);
    const roll = { type: 'roll' } as Action;
    expect(trace.dragTraceOf(roll), 'a roll is not a drag cause').toBeNull();
    const buy = { type: 'buy', uid: 'u1' } as Action;
    const first = trace.dragTraceOf(buy);
    expect(first?.cardId).toBe('cardx');
    expect(trace.dragTraceOf(buy), 'the same action object: the same path').toBe(first);
    expect(trace.dragTraceOf({ type: 'buy', uid: 'u1' } as Action), 'a new action finds the park already taken').toBeNull();
  });

  it('the staleness rule still holds through dragTraceOf', () => {
    trace.beginDragTrace('cardy', 10, 10);
    trace.endDragTrace(300, 300);
    const late = performance.now() + trace.DRAG_TRACE_STALE_MS + 1;
    expect(trace.dragTraceOf({ type: 'play', uid: 'x' } as Action, late)).toBeNull();
  });
});
