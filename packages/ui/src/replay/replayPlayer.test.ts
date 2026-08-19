/**
 * REPLAY V2 Phase B — playback core tests.
 *
 * Pure parts (seek binary search, clock clamping, the ShopView→run synthesis) are tested directly; the
 * snapshot/restore contract is tested against the REAL store (importable headlessly — its localStorage
 * plumbing is try/caught), because "watching a replay leaves your live run untouched" is the one guarantee
 * that must never regress.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRun, deltaShopFrameOf, expandFrames, reduce, shopFrameOf,
  SHOP_VIEW_EXCLUDED_KEYS, type ReplayFrame, type ReplayV2, type RunState,
} from '@game/sim';
import { clampStepMs, endReplay, frameIndexAt, seekReplay, startReplay , effectiveTimesOf} from './replayPlayer';
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
    expect(eff[1]! - eff[0]!, 'the 31 s gap clamps to the 5 s ceiling').toBe(5000);
    // Sub-350ms real deltas clamp UP to the floor, so every frame owns a visible slice of the bar.
    expect(eff[2]! - eff[1]!).toBe(350);
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
