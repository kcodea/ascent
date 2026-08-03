/**
 * LANDS — when each recipient receives a payload.
 *
 * A **land** is the instant one recipient receives the effect: the visual, the sound, the stat numbers and
 * the float all commit together (see `docs/fx-vocabulary.md`). A traversal is a SCHEDULE of lands, and this
 * module is that schedule — nothing else.
 *
 * ── the model: groups and members ────────────────────────────────────────────────────────────────────
 * A traversal is a list of GROUPS. `gap` spaces the groups; `beat` spaces the MEMBERS inside one group.
 * That single shape covers every order in the vocabulary:
 *
 *   | order      | groups                          | beat |
 *   |------------|---------------------------------|------|
 *   | `cascade`  | one per recipient               | > 0 for a stack, else unused |
 *   | `volley`   | ONE group holding everyone      | 0    |
 *   | waves      | one per wave, members together  | 0    |
 *   | `ripple`   | groups ordered by distance      | —    |
 *   | `chain`    | as cascade, `gap` = effect life | —    |
 *
 * The two-level shape is not decoration. "Each unit got two" (a cascade of 2-stacks) and "everyone got hit
 * twice" (two cascades) are different claims about what happened, and a flat stagger cannot tell them apart —
 * which is exactly how a gilded Frenzied Excavator once under-reported two Rubies as one.
 *
 * ── this is a UNION of two systems that already existed ──────────────────────────────────────────────
 * The Ruby cue counted repeats per recipient but had no notion of simultaneity. The buff-tendril replay had
 * waves (members firing together) and a wave CAP, but no notion of repeats. Each had been written without
 * knowledge of the other, and the tendril side was the more capable — its `maxGroups` cap exists because ~30
 * itemized-reward waves collapse into a strobe, which the Ruby side would have rediscovered eventually.
 * Both now describe themselves with the same words.
 *
 * ── what is deliberately NOT here ────────────────────────────────────────────────────────────────────
 * **Coalescing** (`coalesceBuffFxByTarget`) stays in `buffFxConfig.ts`. Deciding WHICH events deserve a land
 * is a selection question about the events' own meaning — one tendril per target because a target's stats
 * jump once — and it needs to know what a `targetUid` is. Timing does not, and keeping it ignorant is what
 * lets every caller share it.
 *
 * **Timers.** Callers turn a schedule into `setTimeout`s themselves, because who owns the cancellation
 * differs per phase: the combat runner cancels on moment change, the shop cue on unmount. That split is also
 * what makes the whole thing testable in a repo with no jsdom.
 */

/** One member of a group — a single land's worth of payload. `count` expands to that many members. */
export interface Recipient {
  uid: string;
  /** How many payloads land here. `< 1` schedules nothing. Defaults to 1. */
  count?: number;
}

/** Members that belong to the same step of the traversal. Spaced from each other by `beat`, if at all. */
export type Group = readonly Recipient[];

/** One scheduled land. */
export interface Land {
  uid: string;
  /** Which step of the traversal — 0 is the first group. */
  group: number;
  /** Position within the group — 0 is the first member. */
  member: number;
  /** Milliseconds from the traversal's start, already divided by `speed`. */
  at: number;
}

export interface ScheduleOptions {
  /** ms between GROUPS. 0 collapses the traversal into a volley. */
  gap: number;
  /** ms between members WITHIN a group. 0 (the default) fires a group simultaneously. */
  beat?: number;
  /** ms before the first land — room for a `tell` to play first. */
  lead?: number;
  /** Divides every offset: the combat replay's speed multiplier. Values ≤ 0 are treated as 1 rather than
   *  producing Infinity, because a paused replay reporting 0 must not push every land to never. */
  speed?: number;
  /**
   * Cap on the number of groups. Everything past the cap merges into one final group.
   *
   * Lifted from the tendril replay's `coalesceWaves`, where it is load-bearing: an Attachment build can
   * produce ~30 waves, at which point the per-wave gap collapses to a strobe. Any traversal long enough to
   * hit this wants the same treatment.
   */
  maxGroups?: number;
}

/** Every land, in fire order: all of group 0, then group 1, and so on. */
export function scheduleLands(groups: readonly Group[], opts: ScheduleOptions): Land[] {
  const { gap, beat = 0, lead = 0 } = opts;
  const speed = opts.speed !== undefined && opts.speed > 0 ? opts.speed : 1;
  const out: Land[] = [];
  capGroups(groups, opts.maxGroups).forEach((g, group) => {
    let member = 0;
    for (const r of g) {
      for (let n = 0; n < (r.count ?? 1); n++) {
        out.push({ uid: r.uid, group, member, at: (lead + group * gap + member * beat) / speed });
        member++;
      }
    }
  });
  return out;
}

/** `groups` with everything past `max` merged into one final group. */
function capGroups(groups: readonly Group[], max?: number): Group[] {
  if (max === undefined || groups.length <= Math.max(1, max)) return [...groups];
  const limit = Math.max(1, Math.round(max));
  const out = groups.slice(0, limit - 1).map((g) => [...g]);
  out.push(groups.slice(limit - 1).flat());
  return out;
}

// ─── shaping helpers: the vocabulary's orders, as groups ─────────────────────────────────────────────

/** A CASCADE: one group per recipient, so the traversal walks them one at a time. A recipient with `count`
 *  above 1 becomes a STACK — its hits spaced by `beat` before the walk moves on. */
export function cascade(recipients: readonly Recipient[]): Group[] {
  return recipients.map((r) => [r]);
}

/** A VOLLEY: one group holding everyone, so every recipient lands together. */
export function volley(recipients: readonly Recipient[]): Group[] {
  return recipients.length > 0 ? [recipients] : [];
}

/** WAVES: pre-grouped members that each fire together, staggered group to group. The shape the buff-tendril
 *  replay produces from `fxWave` tags. */
export function waves(grouped: readonly (readonly Recipient[])[]): Group[] {
  return grouped.filter((g) => g.length > 0).map((g) => [...g]);
}

// ─── reporting ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Does this timing lose the count? True when a stack's hits are spaced as far apart as the walk between
 * groups, at which point the eye cannot group hits per recipient and a cascade of 2-stacks reads as one long
 * cascade of unrelated hits.
 *
 * Reported rather than enforced: a volley (`gap` 0) is legitimate, and so is a traversal with no `beat`.
 */
export function beatExceedsGap(opts: ScheduleOptions): boolean {
  const { gap, beat = 0 } = opts;
  return gap > 0 && beat > 0 && beat >= gap;
}

/** The span of a schedule in ms — `0` when empty. "How long until this traversal is done." */
export function scheduleDuration(lands: readonly Land[]): number {
  let max = 0;
  for (const l of lands) if (l.at > max) max = l.at;
  return max;
}
