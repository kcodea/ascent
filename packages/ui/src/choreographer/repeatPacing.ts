/**
 * REPEAT CHAIN PACING — a repeating End-of-Turn effect ACCELERATES (owner 2026-09-27, R-REPEAT-04).
 *
 *   "kringle and other end of turn effects that REPEAT, need to go extremely fast, this is going to take me
 *   minutes to finish."
 *
 * The repeat pattern (R-REPEAT-01) gives every repeat its OWN root trigger and its own beat, and that stays: a
 * Kringle that saw 106 cards played still plays 107 ticks, each its own beat, each rolling the stats. What
 * changes is how long each tick is ON SCREEN. At the shipped own-beat pace (120 / 540 / 170 ms) 107 ticks took
 * about 76 seconds. This module is the pure schedule the compiler lays those ticks on:
 *
 *   1. LEAD-IN. The first three ticks play near-normal (100 %, 70 %, 45 % of the beat) so the player reads WHAT
 *      is repeating.
 *   2. ACCELERATE. The next ticks shrink geometrically (160 ms × 0.6ᵏ) down to a floor of 20 ms (about a frame).
 *   3. BATCH. When the rest would not fit the chain's hard cap, the remaining ticks are packed several to a
 *      visual slot (they share one start, so they land in the same frame). Every tick still gets its own beat
 *      and its own deliveries, so the numbers still land on the exact final values.
 *   4. SETTLE. The last tick gets a short hold, so the final number sits before the next source fires.
 *
 * The whole chain (first tick's start → last tick's recovery end) never exceeds `capMs`, whatever the count.
 *
 * ACCENTS thin the FX and sound. A tick is an accent when it is a lead-in tick, the final tick, or the first tick
 * of a slot that starts at least `accentGapMs` after the previous accent. The player plays the source cue, the
 * trigger sound and the per-buff ribbons only on accents; the other ticks still land their stats (the
 * projection folds every delivery), so the numbers roll without a wall of ribbons or a wall of noise.
 *
 * PURE and deterministic, like the compiler that calls it: no clock, no DOM. Presentation only, it can never
 * change an outcome: the sim already resolved every tick before any of this runs.
 */

export interface RepeatPacingConfig {
  /** Scale of each lead-in tick's full beat (completion + recovery). */
  leadScales: readonly number[];
  /** Span of the first accelerating tick after the lead-in, in ms. */
  tailFirstMs: number;
  /** Geometric shrink per accelerating tick. */
  tailDecay: number;
  /** The shortest a visual slot gets, in ms (about one frame at 60 Hz). */
  floorMs: number;
  /** Hard cap on the whole chain, in ms. */
  capMs: number;
  /** The last tick's hold, in ms, so the final value reads before the next source. */
  settleMs: number;
  /** Minimum spacing between accent ticks (FX + sound), in ms. */
  accentGapMs: number;
}

export const REPEAT_PACING: RepeatPacingConfig = {
  leadScales: [1, 0.7, 0.45],
  tailFirstMs: 160,
  tailDecay: 0.6,
  floorMs: 20,
  capMs: 2500,
  settleMs: 240,
  accentGapMs: 130,
};

/** One tick of a repeat chain, as the compiler places it. */
export interface RepeatTickPace {
  /** How long this tick's beat occupies the timeline (start → recovery end), in ms. */
  spanMs: number;
  /** Starts together with the previous tick (a batched slot) instead of after it. */
  sharesSlot: boolean;
  /** Plays the source cue, trigger sound and ribbons. Non-accent ticks land their stats silently. */
  accent: boolean;
}

/**
 * The schedule for a chain of `count` ticks whose un-paced beat spans `fullSpanMs` (completion + recovery).
 * `count <= 1` is a plain effect and comes back untouched (one full, accented tick).
 */
export function repeatChainSchedule(count: number, fullSpanMs: number, p: RepeatPacingConfig = REPEAT_PACING): RepeatTickPace[] {
  const n = Math.max(0, Math.floor(count));
  const full = Math.max(0, fullSpanMs);
  if (n <= 1) return n === 1 ? [{ spanMs: full, sharesSlot: false, accent: true }] : [];

  // The cap never STRETCHES a short chain: a chain that fits at full pace keeps its budget below full pace.
  const cap = Math.min(p.capMs, n * full);
  const settle = Math.min(p.settleMs, full);
  const spans: { span: number; shares: boolean }[] = [];

  // 1. Lead-in (never the final tick: the final tick is the settle below).
  const leadCount = Math.min(p.leadScales.length, n - 1);
  // A beat tuned very long could push the lead-in alone past the cap: shrink the lead-in to fit, never the cap.
  let leadSum = 0;
  for (let i = 0; i < leadCount; i++) leadSum += full * p.leadScales[i]!;
  const leadFit = leadSum > 0 && leadSum + settle > cap ? Math.max(0, cap - settle) / leadSum : 1;
  let used = 0;
  for (let i = 0; i < leadCount; i++) {
    const span = full * p.leadScales[i]! * leadFit;
    spans.push({ span, shares: false });
    used += span;
  }

  // 2 + 3. The tail between the lead-in and the final tick.
  const tail = n - 1 - leadCount;
  if (tail > 0) {
    const floor = Math.min(p.floorMs, full);
    let budget = Math.max(0, cap - used - settle);
    const first = Math.min(p.tailFirstMs, leadCount ? spans[leadCount - 1]!.span : full);
    // Accelerate while the natural span is still above the floor AND there is budget left for it.
    let k = 0;
    while (k < tail) {
      const span = Math.max(floor, first * Math.pow(p.tailDecay, k));
      if (span <= floor || span > budget) break;
      spans.push({ span, shares: false });
      budget -= span;
      used += span;
      k++;
    }
    const rest = tail - k;
    if (rest > 0) {
      // Pack the rest into as many floor-width slots as the budget allows (at least one), spread evenly.
      const slots = Math.max(1, Math.min(rest, Math.floor(budget / Math.max(1, floor))));
      const span = Math.min(floor, budget / slots);
      for (let s = 0; s < slots; s++) {
        const size = Math.floor((rest * (s + 1)) / slots) - Math.floor((rest * s) / slots);
        for (let j = 0; j < size; j++) spans.push({ span, shares: j > 0 });
        used += span;
      }
    }
  }

  // 4. Settle: the final tick.
  const lastLead = leadCount === n - 1 ? spans[leadCount - 1]?.span ?? full : 0;
  spans.push({ span: Math.max(settle, Math.min(lastLead, full)), shares: false });

  // Accents: lead-in, final, and slot starts spaced at least `accentGapMs` apart.
  const out: RepeatTickPace[] = [];
  let at = 0;
  let lastAccentAt = Number.NEGATIVE_INFINITY;
  let slotStart = 0;
  for (let i = 0; i < spans.length; i++) {
    const { span, shares } = spans[i]!;
    if (!shares) { slotStart = at; at += span; }
    const lead = i < leadCount;
    const final = i === spans.length - 1;
    const accent = lead || final || (!shares && slotStart - lastAccentAt >= p.accentGapMs);
    if (accent) lastAccentAt = slotStart;
    out.push({ spanMs: span, sharesSlot: shares, accent });
  }
  return out;
}

/** Total time the chain occupies (the sum of its slot spans). */
export function repeatChainDurationMs(schedule: readonly RepeatTickPace[]): number {
  let t = 0;
  for (const s of schedule) if (!s.sharesSlot) t += s.spanMs;
  return t;
}
