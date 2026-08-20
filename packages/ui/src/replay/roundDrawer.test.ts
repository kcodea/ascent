/**
 * REPLAY V2 Phase D — metrics drawer data-wiring tests (§7.4 of docs/replay-v2-handoff.md).
 *
 * The drawer shows exactly three numbers per round — Gold spent / Actions / Shop tier at start — read off
 * the cached `rollupRounds` fold. These tests drive the REAL reducer with the real bot (like the Phase A
 * suite in packages/sim/src/replayV2.test.ts), capture frames under the store's exact rules, and assert
 * that what the drawer would display equals the rollup's truth — including the edge rounds: a zero-action
 * turn, a final round that recorded combat but no shop, and a partial recording that starts mid-run.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BOT, combatFrameOf, createLobbyRun, deltaShopFrameOf, reduce, rollupRounds, roundMarks,
  runRecord, shopFrameOf,
  type ReplayFrame, type ReplayV2, type RunState, type ShopView,
} from '@game/sim';
import { endReplay, replayRoundStats, startReplay } from './replayPlayer';
import { drawerStatFor, statsByWave } from './roundDrawer';

/** Drive the real reducer with the real bot, capturing frames exactly as the store does: a `turnStart`
 *  KEYFRAME at every shop opening, a DELTA frame per state-changing recruit action, a combat frame per
 *  `faceOmen`. (Mirrors the Phase A capture loop, minus its independent truth tally — the drawer's truth
 *  oracle here IS `rollupRounds`, per the §7.4 contract.) */
function captureBotRun(seed: number, heroId: string, maxSteps = 4000): { final: RunState; frames: ReplayFrame[] } {
  let s = createLobbyRun(seed, heroId);
  const first = shopFrameOf(s, 'turnStart', 0);
  const frames: ReplayFrame[] = [first];
  let lastView: ShopView = first.view;
  let t = 0;
  let guard = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && guard++ < maxSteps) {
    const action = DEFAULT_BOT.act(s);
    const next = reduce(s, action);
    if (next === s) break;
    t += 100;
    if (action.type === 'faceOmen' && next.lastCombat) {
      frames.push(combatFrameOf(s, next, t));
    } else if (next.phase === 'recruit' && s.phase !== 'recruit') {
      const kf = shopFrameOf(next, 'turnStart', t);
      frames.push(kf);
      lastView = kf.view;
    } else if (next.phase === 'recruit' && s.phase === 'recruit') {
      const d = deltaShopFrameOf(lastView, next, action.type, t);
      frames.push(d.frame);
      lastView = d.view;
    }
    s = next;
  }
  return { final: s, frames };
}

function replayOf(final: RunState, frames: ReplayFrame[]): ReplayV2 {
  return {
    version: 2, seed: final.seed, heroId: final.heroId, mode: final.mode ?? 'lobby',
    author: 'bot', patch: 'test',
    frames,
    result: { placement: 8, record: runRecord(final), finalBoard: null },
  };
}

const capture = captureBotRun(4242, 'brackus');

describe('drawerStatFor — the three displayed values equal the rollupRounds truth', () => {
  const stats = rollupRounds(capture.frames);
  const byWave = statsByWave(stats);

  it('captured a real multi-round run to fold over', () => {
    expect(stats.length).toBeGreaterThan(2);
  });

  it('matches the fold exactly, for every recorded wave', () => {
    for (const truth of stats) {
      const shown = drawerStatFor(truth.wave, byWave);
      expect(shown.goldSpent, `wave ${truth.wave} Gold spent`).toBe(truth.goldSpent);
      expect(shown.actions, `wave ${truth.wave} Actions`).toBe(truth.actions);
      expect(shown.tierAtStart, `wave ${truth.wave} Shop tier at start`).toBe(truth.tierAtStart);
    }
  });

  it('spot-check: waves 1 and 3 read the fold, not zeros or stale bases', () => {
    const w1 = drawerStatFor(1, byWave);
    const t1 = stats.find((st) => st.wave === 1)!;
    expect(w1).toEqual({ wave: 1, goldSpent: t1.goldSpent, actions: t1.actions, tierAtStart: t1.tierAtStart });
    expect(w1.tierAtStart).toBe(1); // every run's shop opens at tier 1
    const t3 = stats.find((st) => st.wave === 3);
    if (t3) expect(drawerStatFor(3, byWave)).toEqual({ wave: 3, goldSpent: t3.goldSpent, actions: t3.actions, tierAtStart: t3.tierAtStart });
  });
});

describe('edge rounds', () => {
  // A round the player skipped entirely records exactly two frames: the shop opening and the fight. Build
  // that recording from the REAL capture's wave-1 keyframe + combat frame (dropping the action frames is
  // precisely what the store would have captured had the player taken none).
  const open = capture.frames.find((f) => f.kind === 'shop' && f.cause === 'turnStart' && f.wave === 1)!;
  const combat = capture.frames.find((f) => f.kind === 'combat' && f.wave === 1)!;

  it('a zero-action round still renders all three numbers (Actions 0, Gold spent 0, real tier)', () => {
    expect(open && combat).toBeTruthy();
    const frames: ReplayFrame[] = [open, combat];
    const byWave = statsByWave(rollupRounds(frames));
    const shown = drawerStatFor(1, byWave);
    expect(shown.actions).toBe(0);
    expect(shown.goldSpent).toBe(0); // `goldSpentThisTurn` on the opening frame — nothing was bought
    expect(shown.tierAtStart).toBe(1);
  });

  it('a final round with combat frames but NO shop frames renders 0 / 0 / unknown tier', () => {
    // Simulate the truncation: wave 2 recorded only its combat (capture died before the shop frame landed).
    const orphan = { ...combat, wave: 2, tMs: combat.tMs + 100 };
    const frames: ReplayFrame[] = [open, combat, orphan];
    const marks = roundMarks(frames);
    expect(marks.map((m) => m.wave)).toEqual([1, 2]); // the rail still lists the round…
    const byWave = statsByWave(rollupRounds(frames));
    expect(byWave.has(2)).toBe(false); // …but the fold has no shop data for it
    const shown = drawerStatFor(2, byWave);
    expect(shown.goldSpent).toBe(0);
    expect(shown.actions).toBe(0);
    expect(shown.tierAtStart).toBeNull(); // rendered as an em-dash — the tier is genuinely unrecorded
  });

  it('a partial replay whose first recorded round is not wave 1 keys by wave, not index', () => {
    // Slice the bot capture from a later shop opening — turnStart frames are full keyframes, so the tail
    // is a self-contained recording exactly like a `partial: true` capture.
    const start = capture.frames.findIndex((f) => f.kind === 'shop' && f.cause === 'turnStart' && f.wave >= 3);
    expect(start).toBeGreaterThan(0);
    const tail = capture.frames.slice(start);
    const firstWave = tail[0]!.wave;
    expect(firstWave).toBeGreaterThan(1);
    const stats = rollupRounds(tail);
    const byWave = statsByWave(stats);
    expect(byWave.has(1)).toBe(false);
    // The full capture's fold for these waves is the oracle — the tail must agree with it wave-for-wave.
    const fullByWave = statsByWave(rollupRounds(capture.frames));
    for (const st of stats) {
      expect(drawerStatFor(st.wave, byWave)).toEqual(drawerStatFor(st.wave, fullByWave));
    }
  });
});

describe('replayRoundStats — the once-per-replay cache the drawer reads', () => {
  afterEach(() => endReplay());

  it('is empty when idle, equals rollupRounds(frames) during playback, and clears on exit', () => {
    expect(replayRoundStats()).toEqual([]);
    startReplay(replayOf(capture.final, capture.frames));
    const cached = replayRoundStats();
    expect(cached).toEqual(rollupRounds(capture.frames));
    expect(replayRoundStats()).toBe(cached); // the SAME array back — cached, not re-folded per call
    endReplay();
    expect(replayRoundStats()).toEqual([]);
  });
});
