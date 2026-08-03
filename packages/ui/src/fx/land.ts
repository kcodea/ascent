/**
 * LANDS — when each recipient receives a payload, and how many times.
 *
 * A **land** is the instant one recipient receives the effect: the visual, the sound, the stat numbers and
 * the float all commit together (see `docs/fx-vocabulary.md`). A traversal is a SCHEDULE of lands, and this
 * module is that schedule — nothing else.
 *
 * ── why this exists ──────────────────────────────────────────────────────────────────────────────────
 * "Walk an effect across N recipients with an offset" had been hand-written FIVE times before this: the shop
 * Ruby cue, the combat `rubied` fan-out, stacks inside each of those, and — queued — the CSS card layer and
 * the withheld-number release. Every copy re-derived the same arithmetic, and they drifted: one flattened
 * stacks away entirely, so a gilded Frenzied Excavator under-reported two Rubies as one.
 *
 * The arithmetic is the whole point, so it lives once:
 *
 *     at = (lead + recipientIndex × gap + repeatIndex × beat) ÷ speed
 *
 * ── nested, not flattened ────────────────────────────────────────────────────────────────────────────
 * `gap` walks BETWEEN recipients, `beat` repeats WITHIN one. Two Rubies on a minion play as two hits on THAT
 * minion before the sweep moves on — "each unit got two", not "everyone got hit twice". Those are different
 * claims about what happened, and only the nested one is true of a multiplier.
 *
 * `beat` must stay clearly shorter than `gap` or the grouping is illegible — that ratio IS the count
 * information. Not enforced here (it is a composition decision, and a caller may deliberately want a `volley`
 * with gap 0), but `beatExceedsGap` reports it so a caller can assert or warn.
 *
 * ── pure ─────────────────────────────────────────────────────────────────────────────────────────────
 * No timers, no DOM, no Pixi. Callers turn a schedule into `setTimeout`s themselves, because who owns the
 * cancellation differs per phase — the combat runner cancels on moment change, the shop cue on unmount. That
 * split is also what makes the whole thing testable in a repo with no jsdom.
 */

/** One recipient and how many times it receives — the input a traversal walks over. */
export interface Recipient {
  uid: string;
  /** How many payloads land on this recipient. `< 1` schedules nothing for it. */
  count: number;
}

/** One scheduled land. */
export interface Land {
  uid: string;
  /** Position in the traversal — 0 is the first recipient. */
  index: number;
  /** Which hit within this recipient's stack — 0 is the first. */
  repeat: number;
  /** Milliseconds from the traversal's start, already divided by `speed`. */
  at: number;
}

export interface ScheduleOptions {
  /** ms between RECIPIENTS. 0 makes the traversal a `volley` (everything at once). */
  gap: number;
  /** ms between hits WITHIN one recipient's stack. Ignored where every count is 1. */
  beat?: number;
  /** ms before the first land — room for a `tell` to play first. */
  lead?: number;
  /** Divides every offset: the combat replay's speed multiplier. Values ≤ 0 are treated as 1 rather than
   *  producing Infinity, because a paused replay reporting speed 0 must not schedule everything at once. */
  speed?: number;
}

/**
 * Every land, in fire order.
 *
 * Order is recipient-major: all of recipient 0's hits, then all of recipient 1's. That is also ascending `at`
 * whenever `beat × (count − 1) < gap` — i.e. whenever the legibility rule holds. A caller that violates the
 * rule gets an interleaved-in-time schedule, which is exactly what it asked for.
 */
export function scheduleLands(recipients: readonly Recipient[], opts: ScheduleOptions): Land[] {
  const { gap, beat = 0, lead = 0 } = opts;
  const speed = opts.speed !== undefined && opts.speed > 0 ? opts.speed : 1;
  const out: Land[] = [];
  recipients.forEach((r, index) => {
    for (let repeat = 0; repeat < r.count; repeat++) {
      out.push({ uid: r.uid, index, repeat, at: (lead + index * gap + repeat * beat) / speed });
    }
  });
  return out;
}

/**
 * Does this timing lose the count? True when a stack's hits are spaced as far apart as the walk between
 * recipients, at which point the eye cannot group hits per unit and a cascade of 2-stacks reads as one long
 * cascade of unrelated hits.
 *
 * Reported rather than enforced: `volley` (gap 0) is legitimate, and so is a single-hit traversal where the
 * question does not arise.
 */
export function beatExceedsGap(opts: ScheduleOptions): boolean {
  const { gap, beat = 0 } = opts;
  return gap > 0 && beat > 0 && beat >= gap;
}

/** The total span of a schedule, in ms — `0` when it is empty. Useful for "how long until this is done". */
export function scheduleDuration(lands: readonly Land[]): number {
  let max = 0;
  for (const l of lands) if (l.at > max) max = l.at;
  return max;
}
