/**
 * The post-game rank sequence as DATA (blueprint §7: Reveal → Establish → Apply → Resolve → Hold), planned
 * from a confirmed `RankResult`. Pure and node-testable; `rankTimeline.ts` turns the plan into a GSAP timeline
 * and `RankScreen.tsx` renders it. Keeping the plan separate is what lets a test assert "a demotion drains to
 * zero, transitions, then retreats from 100" without a DOM or a clock.
 */
import { isUncapped, POINTS_PER_DIVISION, medalOf, type RankResult } from './types';
import { outcomeText } from './rankFormat';

export type RankStep =
  /** Placement text + the pre-match crest settle in. */
  | { kind: 'reveal'; ms: number }
  /** Old label, old points and the actual awarded delta show. */
  | { kind: 'establish'; ms: number }
  /** The bar travels `from` → `to` inside one division; the counter follows. `uncapped` = counter only. */
  | { kind: 'bar'; ms: number; divisionIndex: number; from: number; to: number; uncapped: boolean }
  /** The bar endpoint illuminates: the gate just unlocked. */
  | { kind: 'gate'; ms: number }
  /** Crest / tier swap between two divisions (a medal change when the medals differ). */
  | { kind: 'transition'; ms: number; from: number; to: number; direction: 'up' | 'down'; medal: boolean }
  /** The outcome line appears and the sequence holds. */
  | { kind: 'outcome'; ms: number; text: string | null };

export const RANK_BEAT_MS = {
  reveal: 450,
  establish: 250,
  bar: 1200,
  /** Each half of a two-bar sequence (promotion / demotion) — shorter so the whole thing stays ~3 s. */
  barHalf: 700,
  gate: 500,
  /** An UP transition is the owner's `rank-up` FX: 280 ms ring collapse → hit → the burst's tail (900 ms def). */
  transitionUp: 900,
  /** A DOWN transition is the owner's `down-rank` FX (2026-09-21): shockwave at 60 ms → the shard fall at the
   *  90 ms hit → its tail (900 ms def). Both demotion kinds (division and medal) take it. */
  transitionDown: 900,
  outcome: 400,
} as const;

/** Plan the beats for one confirmed result. */
export function planRankSequence(r: RankResult): RankStep[] {
  const steps: RankStep[] = [
    { kind: 'reveal', ms: RANK_BEAT_MS.reveal },
    { kind: 'establish', ms: RANK_BEAT_MS.establish },
  ];
  const text = outcomeText(r);
  const medalChange = medalOf(r.before.divisionIndex) !== medalOf(r.after.divisionIndex);
  if (r.promoted) {
    // The old bar is already full (the gate). Transition the crest/tier, then the NEW division fills from
    // zero to wherever it landed (owner decision 2026-09-21: the 10/100 landing cushion — so the fill is a
    // small tick of "here is your new bar", kept on purpose; it was a 0 → 0 beat when the landing was 0).
    steps.push({ kind: 'transition', ms: RANK_BEAT_MS.transitionUp, from: r.before.divisionIndex, to: r.after.divisionIndex, direction: 'up', medal: medalChange });
    steps.push({ kind: 'bar', ms: RANK_BEAT_MS.barHalf, divisionIndex: r.after.divisionIndex, from: 0, to: r.after.points, uncapped: isUncapped(r.after.divisionIndex) });
  } else if (r.demoted && r.wasDemotionGame) {
    // A LOST DEMOTION GAME (owner 2026-09-20; since 2026-09-21 the ONLY way down — a division or a medal): the
    // bar already sits at 0 — hold it there a beat, transition the crest down, then the landing division's bar
    // fills to the landing points (100 + the award).
    steps.push({ kind: 'bar', ms: RANK_BEAT_MS.barHalf, divisionIndex: r.before.divisionIndex, from: 0, to: 0, uncapped: false });
    steps.push({ kind: 'transition', ms: RANK_BEAT_MS.transitionDown, from: r.before.divisionIndex, to: r.after.divisionIndex, direction: 'down', medal: medalChange });
    steps.push({ kind: 'bar', ms: RANK_BEAT_MS.barHalf, divisionIndex: r.after.divisionIndex, from: 0, to: r.after.points, uncapped: false });
  } else if (r.demoted) {
    // An INSTANT demotion: drain the old division to zero, transition down, then the previous division retreats
    // from 100. The rules no longer produce one (owner 2026-09-21: a loss that hits 0 halts there and arms; the
    // clamping loss plans as a plain bar drain to 0 + the demotion-game outcome line) — kept so a result settled
    // under the 2026-09-20 rules still replays truthfully.
    steps.push({ kind: 'bar', ms: RANK_BEAT_MS.barHalf, divisionIndex: r.before.divisionIndex, from: r.before.points, to: 0, uncapped: false });
    steps.push({ kind: 'transition', ms: RANK_BEAT_MS.transitionDown, from: r.before.divisionIndex, to: r.after.divisionIndex, direction: 'down', medal: medalChange });
    steps.push({ kind: 'bar', ms: RANK_BEAT_MS.barHalf, divisionIndex: r.after.divisionIndex, from: POINTS_PER_DIVISION, to: r.after.points, uncapped: false });
  } else {
    steps.push({ kind: 'bar', ms: RANK_BEAT_MS.bar, divisionIndex: r.before.divisionIndex, from: r.before.points, to: r.after.points, uncapped: isUncapped(r.after.divisionIndex) });
    if (r.promotionUnlocked) steps.push({ kind: 'gate', ms: RANK_BEAT_MS.gate });
  }
  steps.push({ kind: 'outcome', ms: RANK_BEAT_MS.outcome, text });
  return steps;
}

/** Total planned duration, for tests and the DEV panel's readout. */
export function sequenceDurationMs(steps: readonly RankStep[]): number {
  return steps.reduce((n, s) => n + s.ms, 0);
}
