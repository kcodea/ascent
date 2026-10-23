// @vitest-environment jsdom
/**
 * R-REPLAY-PLAYBACK-01: a replay with a recorded spectator stream plays through the watch screen's own pipeline.
 *
 * Pinned here, against the REAL store and replay player:
 *  - the recorded messages go into the spectator cursor feed on the replay's clock: the held card is in hand when the
 *    recording had it there, and a drag frame lands at its recorded moment with NO ghost flight (the hand carried the
 *    card), the held card handed to the drop;
 *  - a seek rebuilds the hand at the target deterministically (the same target gives the same feed, whatever played
 *    before, and a fresh start seeking there agrees);
 *  - the recorded overlay minimize state follows the replay clock and a seek; a recorded Skip is requested at its point;
 *  - an OLD replay (no stream) plays exactly as before: the ghost flight, no stream, no feed clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EV_OVERLAY, EV_SKIP, createRun, deltaShopFrameOf, encodeStreamEvent, encodeStreamMessage, newStreamEncoder, reduce, sealStreamSegment,
  shopFrameOf, type DragPath, type ReplayV2, type StreamCursorBody,
} from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const player = await import('./replayPlayer');
const sp = await import('../versus/spectate');
const rs = await import('./replayStreamPlayer');

const msg = (ts: number, gx: number, drag: StreamCursorBody['drag'] = null, de?: 'c' | 'x'): StreamCursorBody =>
  ({ x: 0, y: 0, gx, gy: 0.5, drag, aim: null, ts, ...(de ? { de } : {}) });

/** A shop opening at 0 and a drag-bought minion committed at 800, with a stream of the hand doing it. */
function makeReplay(opts: { stream: boolean; drag?: DragPath }): { replay: ReplayV2; uid: string } {
  const source = { ...createRun(781), phase: 'recruit' as const, embers: 10 };
  const offer = source.shop.find((o) => !!o)!;
  const f0 = shopFrameOf(source, 'turnStart', 0);
  const after = reduce(source, { type: 'buy', uid: offer.uid });
  const d = deltaShopFrameOf(f0.view, after, 'buy', 800);
  if (opts.drag) d.frame.drag = { ...opts.drag, cardId: offer.cardId, uid: offer.uid };
  const held = { uid: offer.uid, source: 'shop', cardId: offer.cardId, g: { z: 'hand' as const, cl: 1 as const } };
  const enc = newStreamEncoder(1, 100);
  for (const m of [msg(100, 0.2), msg(150, 0.25), msg(300, 0.3, held), msg(500, 0.4, held), msg(780, 0.5, held), msg(830, 0.5, null, 'c'), msg(900, 0.6)]) encodeStreamMessage(enc, m, m.ts!);
  encodeStreamEvent(enc, 200, EV_OVERLAY, 8);
  encodeStreamEvent(enc, 850, EV_OVERLAY, 0);
  const replay: ReplayV2 = {
    version: 2, seed: source.seed, heroId: source.heroId, mode: 'lobby', author: 'brackus', patch: 'test',
    frames: [f0, d.frame],
    ...(opts.stream ? { stream: { v: 1, segs: [sealStreamSegment(enc)] } } : {}),
    result: { placement: 1, record: { wins: 0, losses: 0, draws: 0 }, finalBoard: null },
  };
  return { replay, uid: offer.uid };
}

/** The hand as the feed holds it (what `SpectatorCursor` draws), drawn at the replay clock now. */
function handState(): unknown {
  sp.advanceCursorFeed(performance.now());
  const f = sp.cursorFeed;
  return {
    drag: f.drag?.uid ?? null, hidden: f.hidden, aim: f.aim, landing: f.landing?.drag.uid ?? null, spring: f.spring?.uid ?? null,
    pts: f.pts.map((p) => [p.s, Math.round(p.x), Math.round(p.y)]), pending: f.pending.map((p) => p.s),
    overlay: rs.useReplayStream.getState().overlay,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
  Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true });
});
afterEach(() => {
  player.endReplay();
  vi.useRealTimers();
});

describe('R-REPLAY-PLAYBACK-01: a stream replay plays through the spectator pipeline', () => {
  it('the hand holds the card on the replay clock; the drag frame lands at its recorded moment with no ghost', () => {
    const { replay, uid } = makeReplay({ stream: true, drag: { cardId: 'x', durMs: 500, pts: [[0.1, 0.1], [0.5, 0.5]] } });
    player.startReplay(replay);
    expect(useGame.getState().replaySession?.hasStream).toBe(true);
    expect(useGame.getState().replaySession?.hasCursorTrail).toBe(false);
    vi.advanceTimersByTime(400);
    expect((handState() as { drag: string }).drag, 'held at 400 (picked up at 300)').toBe(uid);
    expect(useGame.getState().replayDragGhost, 'never a ghost flight').toBeNull();
    expect(useGame.getState().replaySession?.index, 'the step is the full recorded delta').toBe(0);
    vi.advanceTimersByTime(420);
    expect(useGame.getState().replaySession?.index).toBe(1);
    expect(useGame.getState().replayDragGhost).toBeNull();
    // The frame's landing took the held card (the watch screen's own drop), and the later drop message picks nothing up.
    vi.advanceTimersByTime(100);
    const h = handState() as { drag: string | null; landing: string | null; spring: string | null };
    expect(h.drag).toBeNull();
    expect(h.landing).toBeNull();
    expect(h.spring).toBeNull();
  });

  it('a seek rebuilds the hand at its target deterministically', () => {
    const { replay, uid } = makeReplay({ stream: true });
    player.startReplay(replay);
    player.pauseReplay();
    player.seekReplay(600);
    const at600 = handState();
    expect((at600 as { drag: string }).drag).toBe(uid);
    expect((at600 as { overlay: unknown }).overlay).toEqual({ discover: false, power: false, quest: false, forge: true });
    // play, scrub around, come back: the same hand
    player.resumeReplay();
    vi.advanceTimersByTime(300);
    player.seekReplay(50);
    expect((handState() as { drag: string | null }).drag).toBeNull();
    expect((handState() as { overlay: unknown }).overlay, 'before any recorded minimize: the screen keeps its own').toBeNull();
    player.pauseReplay();
    player.seekReplay(600);
    expect(handState()).toEqual(at600);
    // a fresh start seeking straight there agrees
    player.endReplay();
    player.startReplay(replay);
    player.pauseReplay();
    player.seekReplay(600);
    expect(handState()).toEqual(at600);
  });

  it('the overlay state follows the clock; a recorded Skip is requested at its point in the fight', () => {
    const { replay } = makeReplay({ stream: true });
    player.startReplay(replay);
    vi.advanceTimersByTime(250);
    expect(rs.useReplayStream.getState().overlay?.forge).toBe(true);
    // Skip: a fight shown from 1000 to 9000 with the player's Skip recorded at 1700.
    player.endReplay();
    const enc = newStreamEncoder(2, 1000);
    encodeStreamMessage(enc, msg(1000, 0.5), 1000);
    encodeStreamEvent(enc, 1700, EV_SKIP);
    expect(rs.startStreamPlayback({ v: 1, segs: [sealStreamSegment(enc)] }, () => 1000, () => 1)).toBe(true);
    rs.streamFightShown(2, 1000, 9000);
    vi.advanceTimersByTime(650);
    expect(rs.useReplayStream.getState().skip).toBeNull();
    vi.advanceTimersByTime(60);
    expect(rs.useReplayStream.getState().skip?.wave).toBe(2);
    rs.stopStreamPlayback();
    expect(rs.useReplayStream.getState().skip).toBeNull();
  });
});

describe('R-REPLAY-PLAYBACK-01: an old replay (no stream) plays as before', () => {
  it('ghost flight, no stream flag, the feed left alone', () => {
    const dragPath: DragPath = { cardId: 'imp', durMs: 400, pts: [[0.1, 0.2], [0.3, 0.3], [0.5, 0.5]] };
    const { replay } = makeReplay({ stream: false, drag: dragPath });
    player.startReplay(replay);
    expect(useGame.getState().replaySession?.hasStream).toBe(false);
    expect(rs.streamPlaying()).toBe(false);
    vi.advanceTimersByTime(400);
    expect(useGame.getState().replayDragGhost?.pts, 'the ghost flies the recorded path').toEqual(dragPath.pts);
    vi.advanceTimersByTime(400);
    expect(useGame.getState().replaySession?.index).toBe(1);
    expect(sp.cursorFeed.pts).toHaveLength(0);
  });

  it('a malformed stream is ignored: the replay plays the old way', () => {
    const { replay } = makeReplay({ stream: false });
    player.startReplay({ ...replay, stream: { v: 1, segs: [{ w: 1 }] } as never });
    expect(useGame.getState().replaySession?.hasStream).toBe(false);
  });
});
