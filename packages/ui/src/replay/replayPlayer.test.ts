/**
 * REPLAY V2 Phase B — playback core tests.
 *
 * Pure parts (seek binary search, clock clamping, the ShopView→run synthesis) are tested directly; the
 * snapshot/restore contract is tested against the REAL store (importable headlessly — its localStorage
 * plumbing is try/caught), because "watching a replay leaves your live run untouched" is the one guarantee
 * that must never regress.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRun, deltaShopFrameOf, expandFrames, reduce, shopFrameOf,
  SHOP_VIEW_EXCLUDED_KEYS, type DragPath, type InspectEvent, type ReplayFrame, type ReplayV2, type RunState,
} from '@game/sim';
import { clampStepMs, paceStepMs, endReplay, frameIndexAt, inspectEventsBetween, latestInspectAt, pauseReplay, playableDragPath, seekReplay, startReplay , effectiveTimesOf, setReplaySpeed, resumeReplay, replayRoundSpan} from './replayPlayer';
import { synthRunFromShopView } from './synthRun';
import { useGame } from '../store';

describe('frameIndexAt (seek binary search)', () => {
  const frames = [{ tMs: 0 }, { tMs: 500 }, { tMs: 1200 }, { tMs: 1200 }, { tMs: 9000 }];
  it('returns the greatest frame at or before tMs', () => {
    expect(frameIndexAt(frames, -50)).toBe(0);
    expect(frameIndexAt(frames, 0)).toBe(0);
    expect(frameIndexAt(frames, 499)).toBe(0);
    expect(frameIndexAt(frames, 500)).toBe(1);
    expect(frameIndexAt(frames, 1199)).toBe(1);
    expect(frameIndexAt(frames, 1200)).toBe(3); // ties resolve to the LAST frame at that instant
    expect(frameIndexAt(frames, 8999)).toBe(3);
    expect(frameIndexAt(frames, 99999)).toBe(4);
  });
  it('is total on an empty list', () => {
    expect(frameIndexAt([], 100)).toBe(0);
  });
});

describe('clampStepMs (clock pacing)', () => {
  it('floors fast steps, caps slow ones, defaults absent/zero deltas', () => {
    expect(clampStepMs(10)).toBe(350);
    expect(clampStepMs(350)).toBe(350);
    expect(clampStepMs(900)).toBe(900);
    expect(clampStepMs(5000)).toBe(5000);
    expect(clampStepMs(60000)).toBe(5000);
    expect(clampStepMs(0)).toBe(900);
    expect(clampStepMs(-40)).toBe(900); // a clock hiccup must not schedule a negative step
    expect(clampStepMs(undefined)).toBe(900);
  });

  it('paceStepMs — the LIVE 1:1 rule: recorded deltas play back verbatim, NO idle condensing at all', () => {
    expect(paceStepMs(100), 'two buys 100ms apart replay 100ms apart').toBe(100);
    expect(paceStepMs(2300), 'a 2.3s think replays as 2.3s — no ceiling, no 350ms floor').toBe(2300);
    expect(paceStepMs(60000), 'a full AFK minute plays back as a full minute (owner ruling: zero condensing)').toBe(60000);
    expect(paceStepMs(10), 'sub-frame deltas take the rendering-sanity floor').toBe(50);
    expect(paceStepMs(0), 'a degenerate capture falls back to the legibility default').toBe(900);
    expect(paceStepMs(undefined)).toBe(900);
  });
});

describe('synthRunFromShopView', () => {
  const run = createRun(1234);
  const frame = shopFrameOf(run, 'turnStart', 0);

  it('recovers every recruit-critical field from a real captured frame', () => {
    const synth = synthRunFromShopView(frame.view);
    expect(synth.phase).toBe('recruit');
    expect(synth.board).toEqual(run.board);
    expect(synth.hand).toEqual(run.hand);
    expect(synth.shop).toEqual(run.shop);
    expect(synth.embers).toBe(run.embers);
    expect(synth.tier).toBe(run.tier);
    expect(synth.wave).toBe(run.wave);
    expect(synth.heroId).toBe(run.heroId);
    expect(synth.seed).toBe(run.seed);
    expect(synth.resolve).toBe(run.resolve);
    expect(synth.history).toEqual(run.history);
    expect(synth.combatSettled).toBe(run.combatSettled);
  });

  it('gives the excluded engine keys harmless (non-crashy) defaults', () => {
    const synth = synthRunFromShopView(frame.view) as unknown as Record<string, unknown>;
    expect(synth['pool']).toEqual({});
    expect(synth['pendingTavern']).toEqual([]);
    expect(synth['rngCursor']).toBe(0);
    expect(synth['runDamage']).toEqual({});
    expect(synth['runProcs']).toEqual({});
    expect(synth['lastCombat']).toBeUndefined();
    // The REQUIRED RunState keys among the exclusions must all exist (optional ones may stay absent).
    for (const k of ['pool', 'pendingTavern', 'rngCursor', 'runDamage', 'runProcs']) {
      expect(SHOP_VIEW_EXCLUDED_KEYS).toContain(k);
      expect(synth[k]).toBeDefined();
    }
  });

  it('re-seats the recorded nextFoe as the pinned served board', () => {
    // A non-lobby run captures `nextFoe`; the synthesis must pin it so nextOpponent() never re-rolls
    // against today's pool (the §2 content-drift hole).
    const view = frame.view;
    if (view.nextFoe) {
      const synth = synthRunFromShopView(view);
      expect(synth.servedBoards?.[view.wave]).toEqual(view.nextFoe);
    }
    // Lobby runs record null — the pin is then an explicit null, still shadowing the pool fall-through.
    const nulled = { ...view, nextFoe: null };
    expect(synthRunFromShopView(nulled).servedBoards).toEqual({ [view.wave]: null });
  });

  it('round-trips through a delta-encoded frame (the expandFrames path playback actually consumes)', () => {
    const after = reduce(run, { type: 'roll' });
    const d = deltaShopFrameOf(frame.view, after, 'roll', 700);
    const frames: ReplayFrame[] = [frame, d.frame];
    const expanded = expandFrames(frames);
    expect(expanded).toHaveLength(2);
    const last = expanded[1]!;
    if (last.kind !== 'shop') throw new Error('expected a shop frame');
    const synth = synthRunFromShopView(last.view);
    expect(synth.shop).toEqual(after.shop);
    expect(synth.embers).toBe(after.embers);
  });
});

describe('startReplay / endReplay snapshot-restore (the store contract)', () => {
  afterEach(() => endReplay()); // never leak replay mode into another test

  function makeReplay(): { replay: ReplayV2; source: RunState } {
    const source = createRun(777);
    const f0 = shopFrameOf(source, 'turnStart', 0);
    const after = reduce(source, { type: 'roll' });
    const d = deltaShopFrameOf(f0.view, after, 'roll', 800);
    return {
      source,
      replay: {
        version: 2, seed: source.seed, heroId: source.heroId, mode: 'lobby',
        author: 'brackus', patch: 'test',
        frames: [f0, d.frame],
        result: { placement: 1, record: { wins: 0, losses: 0, draws: 0 }, finalBoard: null },
      },
    };
  }

  it('renders frame 0 as a synthetic run, flags replaying, and restores the exact pre-replay slice on exit', () => {
    const before = useGame.getState();
    const liveRun = before.run;
    const { replay } = makeReplay();

    startReplay(replay);
    const during = useGame.getState();
    expect(during.replaying).toBe(true);
    expect(during.replaySession).not.toBeNull();
    expect(during.replaySession?.total).toBe(2);
    expect(during.replaySession?.authorName).toBe('brackus');
    expect(during.run).not.toBe(liveRun); // the synthetic render target replaced the live run
    expect(during.run.seed).toBe(replay.seed);
    expect(during.run.phase).toBe('recruit');

    endReplay();
    const restored = useGame.getState();
    expect(restored.replaying).toBe(false);
    expect(restored.replaySession).toBeNull();
    expect(restored.combatReplayDone).toBe(false);
    expect(restored.replaySeekEpoch).toBe(0);
    // The user's real in-progress run survives IDENTICALLY — same reference, not a lookalike.
    expect(restored.run).toBe(liveRun);
    expect(restored.showTitle).toBe(before.showTitle);
    expect(restored.heroChoices).toBe(before.heroChoices);
  });

  it('swallows live dispatches while replaying (input is inert)', () => {
    const { replay } = makeReplay();
    startReplay(replay);
    const synthetic = useGame.getState().run;
    useGame.getState().dispatch({ type: 'roll' });
    expect(useGame.getState().run).toBe(synthetic); // nothing reduced
    // ...and the End-of-Turn transaction path is equally inert.
    expect(useGame.getState().preparePresentationAction({ type: 'faceOmen' })).toBeNull();
  });

  it('seeking jumps to the frame active at tMs and bumps the seek epoch (FX suppression)', () => {
    const { replay } = makeReplay();
    startReplay(replay);
    const epoch0 = useGame.getState().replaySeekEpoch;
    seekReplay(800);
    const st = useGame.getState();
    expect(st.replaySession?.index).toBe(1);
    expect(st.replaySeekEpoch).toBe(epoch0 + 1);
    seekReplay(0);
    expect(useGame.getState().replaySession?.index).toBe(0);
  });
});

describe('the clamped transport timeline (found live 2026-08-19)', () => {
  it('an idle gap in the capture cannot dominate the bar — deltas clamp to MAX_STEP', () => {
    // The live repro: frame 0 at t=0, a 31 s setup gap, then 61 frames in ~60 ms. Raw-proportional geometry
    // put 99.8% of the bar inside the gap, so clicking the right edge seeked to frame 0.
    const raw = [0, 31160, 31161, 31163, 31221];
    const eff = effectiveTimesOf(raw);
    expect(eff[0]).toBe(0);
    expect(eff[1]! - eff[0]!, 'the 31 s gap plays back verbatim — the bar timeline is literal too').toBe(31160);
    // A real 1ms delta takes only the 50ms rendering-sanity floor — the bar stays 1:1 with watch time.
    expect(eff[2]! - eff[1]!).toBe(50);
    const dur = eff[eff.length - 1]!;
    // The right edge of the bar maps to the LAST frame, not the gap.
    let lo = 0, hi = eff.length - 1, ans = 0;
    const target = 1 * dur;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (eff[mid]! <= target) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    expect(ans).toBe(raw.length - 1);
  });

  it('a zero-delta timeline (a scripted capture) still spans the bar', () => {
    const eff = effectiveTimesOf([0, 0, 0, 0]);
    expect(eff).toEqual([0, 900, 1800, 2700]); // a 0 delta reads as absent → the DEFAULT step, never 0 wide
  });
});

describe('the inspect trail — playback (owner ask 2026-08-19: 1:1 includes the inspect panel)', () => {
  const open = (tMs: number, cardId = 'imp'): InspectEvent => ({ tMs, inspect: { cardId } });
  const close = (tMs: number): InspectEvent => ({ tMs, inspect: null });

  it('inspectEventsBetween — events map to their step, boundaries excluded', () => {
    const trail = [open(0), close(100), open(500), close(799), open(800), close(1200)];
    // The step from frame t=0 to frame t=800: the boundary events belong to the frames, not the step —
    // an event at exactly t1 coincides with the next action, whose frame render closes the panel anyway.
    expect(inspectEventsBetween(trail, 0, 800)).toEqual([close(100), open(500), close(799)]);
    expect(inspectEventsBetween(trail, 800, 2000)).toEqual([close(1200)]);
    expect(inspectEventsBetween(trail, 0, 0)).toEqual([]);
  });

  it('latestInspectAt — the seek rule: latest event at-or-before, -1 when none', () => {
    const trail = [open(300), close(799), open(1000)];
    expect(latestInspectAt(trail, 0)).toBe(-1);
    expect(latestInspectAt(trail, 300)).toBe(0);
    expect(latestInspectAt(trail, 500)).toBe(0);
    expect(latestInspectAt(trail, 799)).toBe(1); // the implicit action-close wins at the frame boundary
    expect(latestInspectAt(trail, 5000)).toBe(2);
    expect(latestInspectAt([], 5000)).toBe(-1);
  });

  it('seeking applies the panel state recorded at the target — open mid-step, closed at a frame boundary', () => {
    const source = createRun(778);
    const f0 = shopFrameOf(source, 'turnStart', 0);
    const after = reduce(source, { type: 'roll' });
    const d = deltaShopFrameOf(f0.view, after, 'roll', 800);
    const replay: ReplayV2 = {
      version: 2, seed: source.seed, heroId: source.heroId, mode: 'lobby',
      author: 'brackus', patch: 'test',
      frames: [f0, d.frame],
      // Opened a card 300 ms in; the roll at t=800 closed it (the implicit close ticks just before the frame).
      inspectTrail: [open(300, 'imp'), close(799)],
      result: { placement: 1, record: { wins: 0, losses: 0, draws: 0 }, finalBoard: null },
    };
    try {
      startReplay(replay);
      expect(useGame.getState().inspect, 'frame 0 renders with the panel closed').toBeNull();
      seekReplay(500); // mid-step, after the open
      expect(useGame.getState().inspect?.cardId).toBe('imp');
      seekReplay(800); // the frame boundary — the action's implicit close wins
      expect(useGame.getState().inspect).toBeNull();
      seekReplay(100); // before the open
      expect(useGame.getState().inspect).toBeNull();
    } finally {
      endReplay();
    }
  });

  it('endReplay restores the viewer\'s own pre-replay inspect state (inspect is in the snapshot)', () => {
    const before = useGame.getState().inspect;
    const source = createRun(779);
    const replay: ReplayV2 = {
      version: 2, seed: source.seed, heroId: source.heroId, mode: 'lobby',
      author: 'brackus', patch: 'test',
      frames: [shopFrameOf(source, 'turnStart', 0)],
      inspectTrail: [open(100)],
      result: { placement: 1, record: { wins: 0, losses: 0, draws: 0 }, finalBoard: null },
    };
    startReplay(replay);
    seekReplay(200);
    expect(useGame.getState().inspect?.cardId).toBe('imp');
    endReplay();
    expect(useGame.getState().inspect).toBe(before);
  });
});

describe('mid-step scrub restores an open inspect (found live 2026-08-19)', () => {
  it('latestInspectAt at a mid-window time is the OPEN, at a frame boundary the close wins', () => {
    const trail = [
      { tMs: 14230, inspect: { cardId: 'k_beggy' } },
      { tMs: 29811, inspect: null },
    ] as never[];
    // Mid-window: the recorded player was looking at the card.
    const mid = latestInspectAt(trail as never, 22000);
    expect(mid).toBe(0);
    // At/after the close boundary: closed.
    expect(latestInspectAt(trail as never, 29811)).toBe(1);
    expect(latestInspectAt(trail as never, 14229), 'before the open — nothing').toBe(-1);
  });
});

describe('the drag ghost (owner ask 2026-08-19: "1:1 hands")', () => {
  const dragPath: DragPath = { cardId: 'imp', durMs: 400, pts: [[0.1, 0.2], [0.3, 0.3], [0.5, 0.5]] };

  function makeDragReplay(drag: DragPath | undefined): ReplayV2 {
    const source = createRun(781);
    const f0 = shopFrameOf(source, 'turnStart', 0);
    const after = reduce(source, { type: 'roll' });
    const d = deltaShopFrameOf(f0.view, after, 'buy', 800);
    if (drag) d.frame.drag = drag;
    return {
      version: 2, seed: source.seed, heroId: source.heroId, mode: 'lobby',
      author: 'brackus', patch: 'test',
      frames: [f0, d.frame],
      result: { placement: 1, record: { wins: 0, losses: 0, draws: 0 }, finalBoard: null },
    };
  }

  it('playableDragPath — malformed paths (0/1 points, no duration) skip the ghost', () => {
    expect(playableDragPath(undefined)).toBeNull();
    expect(playableDragPath({ cardId: 'imp', durMs: 400, pts: [] })).toBeNull();
    expect(playableDragPath({ cardId: 'imp', durMs: 400, pts: [[0.5, 0.5]] })).toBeNull();
    expect(playableDragPath({ cardId: 'imp', durMs: 0, pts: [[0.1, 0.1], [0.5, 0.5]] })).toBeNull();
    expect(playableDragPath(dragPath)).toBe(dragPath);
  });

  it('a frame with `drag` delays its render by durMs — the ghost flies over the previous world first', () => {
    vi.useFakeTimers();
    try {
      startReplay(makeDragReplay(dragPath));
      const worldAtFrame0 = useGame.getState().run;
      expect(useGame.getState().replaySession?.index).toBe(0);
      expect(useGame.getState().replayDragGhost).toBeNull();

      // The recorded delta CONTAINS the drag, so the step is armed SHORT by durMs (800 − 400 = 400 ms):
      // at 400 ms the clock advances INTO the drag frame — the GHOST launches, the frame has NOT landed.
      vi.advanceTimersByTime(400);
      const ghost = useGame.getState().replayDragGhost;
      expect(ghost).not.toBeNull();
      expect(ghost?.cardId).toBe('imp');
      expect(ghost?.durMs).toBe(400); // speed 1× — the literal recorded drag duration
      expect(ghost?.pts).toEqual(dragPath.pts);
      expect(useGame.getState().run, 'the world is still the PREVIOUS frame under the ghost').toBe(worldAtFrame0);
      expect(useGame.getState().replaySession?.index, 'the session still shows the pre-landing frame').toBe(0);

      // The ghost completes after the REAL recorded drag duration → the frame lands at exactly the
      // recorded 800 ms delta (step + flight = delta, never delta + durMs twice over).
      vi.advanceTimersByTime(400);
      expect(useGame.getState().replayDragGhost).toBeNull();
      expect(useGame.getState().replaySession?.index).toBe(1);
      expect(useGame.getState().run).not.toBe(worldAtFrame0);
    } finally {
      endReplay();
      vi.useRealTimers();
    }
  });

  it('a frame WITHOUT drag renders at its step boundary — no added time', () => {
    vi.useFakeTimers();
    try {
      startReplay(makeDragReplay(undefined));
      vi.advanceTimersByTime(400);
      expect(useGame.getState().replaySession?.index, 'no drag → the full 800ms delta applies').toBe(0);
      vi.advanceTimersByTime(400);
      expect(useGame.getState().replayDragGhost).toBeNull();
      expect(useGame.getState().replaySession?.index).toBe(1);
    } finally {
      endReplay();
      vi.useRealTimers();
    }
  });

  it('a SEEK skips the ghost entirely and renders the target frame immediately', () => {
    vi.useFakeTimers();
    try {
      startReplay(makeDragReplay(dragPath));
      seekReplay(800);
      expect(useGame.getState().replaySession?.index).toBe(1);
      expect(useGame.getState().replayDragGhost).toBeNull();
    } finally {
      endReplay();
      vi.useRealTimers();
    }
  });

  it('pausing mid-ghost lands the frame immediately (the paused world is never one frame behind)', () => {
    vi.useFakeTimers();
    try {
      startReplay(makeDragReplay(dragPath));
      vi.advanceTimersByTime(400); // ghost in flight
      expect(useGame.getState().replayDragGhost).not.toBeNull();
      pauseReplay();
      expect(useGame.getState().replayDragGhost).toBeNull();
      expect(useGame.getState().replaySession?.index).toBe(1);
    } finally {
      endReplay();
      vi.useRealTimers();
    }
  });

  it('endReplay mid-ghost clears the ghost slice — the layer never outlives the replay', () => {
    vi.useFakeTimers();
    try {
      startReplay(makeDragReplay(dragPath));
      vi.advanceTimersByTime(400);
      expect(useGame.getState().replayDragGhost).not.toBeNull();
      endReplay();
      expect(useGame.getState().replayDragGhost).toBeNull();
    } finally {
      endReplay();
      vi.useRealTimers();
    }
  });
});

describe('the step-progress ledger (owner report 2026-08-19: "the speed mod definitely breaks")', () => {
  it('a speed change mid-step resumes the REMAINDER — it never restarts the step from zero', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    try {
      const source = createRun(21, 'brackus');
      const f0 = shopFrameOf(source, 'turnStart', 0);
      const after = reduce(source, { type: 'roll' });
      const d = deltaShopFrameOf(f0.view, after, 'roll', 10_000); // a 10s think
      startReplay({ version: 2, seed: source.seed, heroId: source.heroId, mode: 'lobby', author: 'x', patch: 't',
        frames: [f0, d.frame], result: { placement: 1, record: { wins: 0, losses: 0, draws: 0 }, finalBoard: null } });
      vi.advanceTimersByTime(6_000);            // 6s of the 10s think has played at 1×
      setReplaySpeed(2);                        // the old bug re-armed the FULL 10s here (5s more at 2×)
      vi.advanceTimersByTime(1_999);
      expect(useGame.getState().replaySession?.index, '4s source remain → 2s at 2×, not 5s').toBe(0);
      vi.advanceTimersByTime(2);
      expect(useGame.getState().replaySession?.index).toBe(1);
    } finally {
      endReplay();
      vi.useRealTimers();
    }
  });

  it('pause + resume continues the step where it left off', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    try {
      const source = createRun(22, 'brackus');
      const f0 = shopFrameOf(source, 'turnStart', 0);
      const after = reduce(source, { type: 'roll' });
      const d = deltaShopFrameOf(f0.view, after, 'roll', 4_000);
      startReplay({ version: 2, seed: source.seed, heroId: source.heroId, mode: 'lobby', author: 'x', patch: 't',
        frames: [f0, d.frame], result: { placement: 1, record: { wins: 0, losses: 0, draws: 0 }, finalBoard: null } });
      vi.advanceTimersByTime(3_000);
      pauseReplay();
      vi.advanceTimersByTime(60_000); // paused time never counts
      resumeReplay();
      vi.advanceTimersByTime(999);
      expect(useGame.getState().replaySession?.index, '1s of the 4s step remained').toBe(0);
      vi.advanceTimersByTime(2);
      expect(useGame.getState().replaySession?.index).toBe(1);
    } finally {
      endReplay();
      vi.useRealTimers();
    }
  });
});

/**
 * ROUND-SCOPED TRANSPORT (owner ask 2026-08-30: *"have the timer only show that round's time, not the full
 * game. so the player clicks a round and can then easily scrub through that round"*).
 *
 * The bar spans the CURRENT round, so it needs that round's frame span. Frames arrive in wall-clock order and
 * a run never returns to an earlier wave, so a round's frames are contiguous — which is exactly the property
 * these tests hold down, because the linear walk outward depends on it.
 */
describe('replayRoundSpan — the frame range of the round you are in', () => {
  afterEach(() => { endReplay(); });

  /** A replay whose frames carry the given waves, in order. */
  const withWaves = (waves: number[]): ReplayV2 => {
    const source = createRun(7, 'brackus');
    const frames: ReplayFrame[] = waves.map((wave, i) => ({
      ...shopFrameOf({ ...source, wave } as RunState, i === 0 ? 'turnStart' : 'roll', i * 100),
    }));
    return {
      version: 2, seed: source.seed, heroId: source.heroId, mode: 'lobby',
      author: 'brackus', patch: 'test', frames,
      result: { placement: 1, record: { wins: 0, losses: 0, draws: 0 }, finalBoard: null },
    } as ReplayV2;
  };

  it('spans exactly the contiguous run of frames sharing a wave', () => {
    startReplay(withWaves([1, 1, 1, 2, 2, 3]));
    expect(replayRoundSpan(0)).toEqual({ from: 0, to: 2 });
    expect(replayRoundSpan(2)).toEqual({ from: 0, to: 2 }); // from the last frame of the round
    expect(replayRoundSpan(3)).toEqual({ from: 3, to: 4 });
    expect(replayRoundSpan(5)).toEqual({ from: 5, to: 5 }); // a one-frame round
  });

  it('clamps an out-of-range index instead of returning nonsense', () => {
    startReplay(withWaves([1, 1, 2]));
    expect(replayRoundSpan(-5)).toEqual({ from: 0, to: 1 });
    expect(replayRoundSpan(99)).toEqual({ from: 2, to: 2 });
  });

  it('handles a single-round replay as one span', () => {
    startReplay(withWaves([4, 4, 4, 4]));
    expect(replayRoundSpan(2)).toEqual({ from: 0, to: 3 });
  });

  it('is total when no replay is loaded', () => {
    // The transport reads this on every render; an idle player must not make it throw.
    endReplay();
    expect(replayRoundSpan(0)).toEqual({ from: 0, to: 0 });
  });
});
