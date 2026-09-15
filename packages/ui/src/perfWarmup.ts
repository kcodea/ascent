/**
 * PERF WARM-UP — which store transitions count as a "phase start" for the monitor.
 *
 * Owner report (2026-09-15): *"Performance always spikes when a game starts, which destroys the graph — delay
 * the capture slightly so the initial spike doesn't wreck it."* The spike is real (module eval, shader link,
 * first paint of ~17 cards, the shop's DOM doubling) and it is also NOT what anyone is trying to diagnose — it
 * happens once per phase, the player expects a beat there, and it owned `worst` in every capture, so every
 * verdict was "the shop opening was slow" whatever the play itself did.
 *
 * `perfMonitor.beginWarmup(reason)` diverts the next stretch of frames (see `WarmupConfig`) into a separate
 * STARTUP record — recorded, exportable, shown on the timeline — instead of the main buckets. This module is
 * the pure half: given the previous and next run state, name the phase start (or `null` for a transition that
 * is not one). Kept DOM- and store-free so it is unit-tested; `Game.tsx` wires it to `useGame.subscribe`.
 */

/** The slice of `RunState` the rule reads. Structural so tests need no real run. */
export interface RunLike {
  seed: number;
  phase: string;
  wave: number;
  runeforgeOffer?: readonly string[] | undefined;
}

/** What starts a warm-up, in the words the HUD shows. */
export type PhaseStart = 'run' | 'shop' | 'combat' | 'runeforge' | 'end';

/**
 * The phase start crossed between `prev` and `next`, or `null`.
 *
 * Checked in priority order, because one transition can satisfy several: a NEW RUN is also a phase change
 * (its opening shop), and it is the run that matters — the warm-up is the same either way, the label is
 * not. A run start is a different `seed` (every entry path draws a fresh one) OR a wave reset to 1 from later
 * in a run (the belt-and-braces case: a fixed-seed tutorial or scenario restarted from its own end screen).
 */
export function phaseStartBetween(prev: RunLike | null | undefined, next: RunLike | null | undefined): PhaseStart | null {
  if (!next) return null;
  if (!prev) return 'run';
  if (next.seed !== prev.seed || (next.wave === 1 && prev.wave > 1)) return 'run';
  if (next.phase !== prev.phase) {
    if (next.phase === 'combat') return 'combat';
    if (next.phase === 'recruit') return 'shop';
    return 'end'; // gameover / victory — the end screen mounts a big tree too
  }
  // The Runeforge is an overlay inside the shop phase, not a phase of its own: it "starts" when its offer
  // appears. Closing it (offer → undefined) is a small transition and does not warm up.
  if (next.runeforgeOffer && !prev.runeforgeOffer) return 'runeforge';
  return null;
}
