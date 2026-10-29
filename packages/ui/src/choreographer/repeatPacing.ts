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
 * SEVERAL CHAINS SHARE ONE BUDGET (owner report 2026-10-26, R-REPEAT-05: "kringle was triggering super slowly and
 * causing freezes/massive slow downs"). Each long chain used to get the whole 2.5 s cap, so four Kringles played ten
 * seconds of End of Turn. Now the long chains of one End of Turn split `phaseCapMs` between them
 * (`repeatChainCapMs`), never below `minChainCapMs` each and never above `capMs`, and the lead-in never takes more
 * than `leadShare` of a chain's cap, so even a short chain still rolls its tail instead of jumping it. The slot floor
 * is `floorMs` (about 25 updates a second), so a batched tail changes the numbers a few times per second of chain, not
 * every frame: each change is one React commit and one repaint of the changed cards.
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
  /** The most of a chain's cap its lead-in may take (the rest is the tail and the settle). */
  leadShare: number;
  /** Total budget all the LONG chains of one End of Turn share, in ms (R-REPEAT-05). */
  phaseCapMs: number;
  /** The least a long chain gets when several share `phaseCapMs`, in ms. */
  minChainCapMs: number;
  /** A chain is LONG (shares the phase budget) from this many ticks. Shorter chains (a Chronos double) keep their pace. */
  longChainTicks: number;
  /** Particle quantity (`playDef` intensity) of a SPED-UP accent tick's ribbons: the first tick plays as authored. */
  accentFxIntensity: number;
}

export const REPEAT_PACING: RepeatPacingConfig = {
  leadScales: [1, 0.7, 0.45],
  tailFirstMs: 160,
  tailDecay: 0.6,
  floorMs: 40,
  capMs: 2500,
  settleMs: 240,
  accentGapMs: 130,
  leadShare: 0.62,
  phaseCapMs: 4000,
  minChainCapMs: 1000,
  longChainTicks: 5,
  accentFxIntensity: 0.4,
};

/**
 * How many of its authored particles a repeat tick's ribbons draw (`playDef` intensity, R-REPEAT-05). A plain beat and
 * a chain's first tick (played at full pace) are as authored; every sped-up accent after it draws `accentFxIntensity`,
 * so a long chain of overlapping ribbons (four Kringles paying the same two Dwarves) stays a light stream instead of a
 * pile of full bursts. The ribbon itself (its path, colour and timing) is unchanged.
 */
export function repeatTickFxIntensity(pace: { scale: number } | undefined, p: RepeatPacingConfig = REPEAT_PACING): number {
  return pace && pace.scale < 0.999 ? p.accentFxIntensity : 1;
}

/** Is a chain of `count` ticks LONG, so it shares the End of Turn's repeat budget (R-REPEAT-05)? */
export const isLongChain = (count: number, p: RepeatPacingConfig = REPEAT_PACING): boolean => Math.floor(count) >= p.longChainTicks;

/**
 * The cap ONE long chain gets when `longChains` long chains play in the same End of Turn (R-REPEAT-05): one chain keeps
 * the full `capMs`; several split `phaseCapMs`, each between `minChainCapMs` and `capMs`.
 */
export function repeatChainCapMs(longChains: number, p: RepeatPacingConfig = REPEAT_PACING): number {
  const n = Math.max(1, Math.floor(longChains));
  if (n <= 1) return p.capMs;
  return Math.min(p.capMs, Math.max(p.minChainCapMs, p.phaseCapMs / n));
}

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
export function repeatChainSchedule(count: number, fullSpanMs: number, p: RepeatPacingConfig = REPEAT_PACING, capMs: number = p.capMs): RepeatTickPace[] {
  const n = Math.max(0, Math.floor(count));
  const full = Math.max(0, fullSpanMs);
  if (n <= 1) return n === 1 ? [{ spanMs: full, sharesSlot: false, accent: true }] : [];

  // The cap never STRETCHES a short chain: a chain that fits at full pace keeps its budget below full pace.
  const cap = Math.min(capMs, n * full);
  const settle = Math.min(p.settleMs, full);
  const spans: { span: number; shares: boolean }[] = [];

  // 1. Lead-in (never the final tick: the final tick is the settle below).
  const leadCount = Math.min(p.leadScales.length, n - 1);
  // A beat tuned very long (or a chain sharing the End of Turn's budget, R-REPEAT-05) could push the lead-in alone past
  // its share of the cap: shrink the lead-in to fit, never the cap. A chain whose ticks all fit at full pace is untouched.
  let leadSum = 0;
  for (let i = 0; i < leadCount; i++) leadSum += full * p.leadScales[i]!;
  const leadRoom = n * full <= cap ? cap - settle : Math.min(cap - settle, cap * p.leadShare);
  const leadFit = leadSum > 0 && leadSum > leadRoom ? Math.max(0, leadRoom) / leadSum : 1;
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

/** One beat of the LEGACY End-of-Turn runner, as `legacyEotRepeatPlan` paces it. */
export interface LegacyBeatPace {
  /** How long this beat holds before the runner moves on (the beat's share of its slot), in ms. Null when the beat is
   *  not part of a repeat chain: the runner keeps its own fixed timing for it. */
  holdMs: number | null;
  /** The gap after the hold, in ms (null with `holdMs`). Zero inside a batched slot: the next tick plays at once. */
  gapMs: number | null;
  /** Plays its ribbons and medallion cue. A non-accent tick lands its stats silently, as on the authoritative path. */
  accent: boolean;
}

/**
 * THE LEGACY RUNNER BATCHES TOO (owner report 2026-10-29, R-REPEAT-06: "my kringle is buffing 1 by 1 again for some
 * reason, it doesnt happen everytime but it randomly does this").
 *
 * The legacy End-of-Turn runner (`Recruit.tsx`, the `ascent.choreo = '0'` rollback valve) plays one fixed 760 + 170 ms
 * beat per entry of its beat list, and a "Repeat for every card played" card takes one entry PER TICK, so a Kringle
 * that saw 60 cards played sat on screen for a minute, its ribbons flying to the end Dwarves one at a time. This is the
 * same R-REPEAT-04/05 schedule the compiler lays authoritative ticks on, applied to the legacy beat list: a run of
 * consecutive beats from one source (`uids`, '' = a sourceless quest beat, never a chain) is a chain; its ticks
 * accelerate, batch several to a slot and fit the cap, and several long chains share the End of Turn's budget.
 *
 * PURE: the beat list in, one pace per beat out (1:1). Presentation only.
 */
export function legacyEotRepeatPlan(uids: readonly string[], beatMs: number, gapMs: number, p: RepeatPacingConfig = REPEAT_PACING): LegacyBeatPace[] {
  const full = Math.max(1, beatMs + gapMs);
  const holdShare = beatMs / full;
  const runs: { start: number; count: number }[] = [];
  for (let i = 0; i < uids.length;) {
    let j = i + 1;
    while (j < uids.length && uids[j] && uids[j] === uids[i]) j++;
    if (uids[i] && j - i >= 2) runs.push({ start: i, count: j - i });
    i = j;
  }
  const longCap = repeatChainCapMs(runs.filter((r) => isLongChain(r.count, p)).length, p);
  const out: LegacyBeatPace[] = uids.map(() => ({ holdMs: null, gapMs: null, accent: true }));
  for (const r of runs) {
    const schedule = repeatChainSchedule(r.count, full, p, isLongChain(r.count, p) ? longCap : p.capMs);
    for (let k = 0; k < r.count; k++) {
      const tick = schedule[k]!;
      // The runner moves on after this tick's slot, or at once when the next tick shares it.
      const next = schedule[k + 1];
      const span = next?.sharesSlot ? 0 : tick.spanMs;
      out[r.start + k] = { holdMs: span * holdShare, gapMs: span - span * holdShare, accent: tick.accent };
    }
  }
  return out;
}
