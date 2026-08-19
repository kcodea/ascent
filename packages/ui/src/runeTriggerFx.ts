import { useEffect, useRef } from 'react';
import { bindingFor } from './choreo/bindings';
import { canPlayDefs, playDef } from './fx/playDef';

/**
 * The RUNE-TRIGGER flourish — a bound def fired on a rune's own badge each time that rune's effect goes off.
 *
 * ── why this is not a `questTrigger` moment ────────────────────────────────────────────────────────────
 * `bindings.json` already binds `questTrigger` → `quest-trigger`, and that binding has never played a single
 * particle. The combat score's own note says why (`score.ts`, above `questTrigger`): the event names a
 * `flag`/`questId` and a side, never a UNIT, so `anchorsForUnits(null, null)` returns null and the def is
 * skipped silently. The score can only anchor to board units, and a rune is a HUD badge — so a rune effect
 * is unreachable from there by construction, not by oversight.
 *
 * What IS reachable is the badge itself. `QuestBadges` already renders every rune with a stable
 * `data-source-id`, and already knows the moment a rune fires — it keys the scale-punch bounce off exactly
 * the counters used below. This module hangs the FX on that same signal, so the burst and the bounce are
 * driven by one truth rather than two that can disagree.
 *
 * ── what counts as "triggered" ─────────────────────────────────────────────────────────────────────────
 * Both places a rune can go off, matching what the badge already bounces for:
 *   · a COMBAT trigger — `combatTriggeredQuests[id]`, beat-synced, counts up per fire during the replay;
 *   · a recurring END-OF-TURN reward — the rune's `recurringEndOfTurn` effect appearing in this action's
 *     `questTendrilFx`, stamped with `questTendrilSeq` so a re-proc of the same effect still reads as new.
 *
 * ── slots, not ids ────────────────────────────────────────────────────────────────────────────────────
 * Rune of Duplication legitimately puts the SAME rune id in `ownedRunes` twice, which is why `QuestBadges`
 * keys its badges by slot. Everything here is per-SLOT for the same reason: keyed by id, two copies would
 * share one pulse count and only ever fire once between them.
 */

/**
 * Gap between repeat bursts on the SAME badge.
 *
 * Sized against the DEF, not against taste: `rune-burst` runs 900ms with a 1050ms particle life, so two
 * copies fired 110ms apart (the first attempt) overlap for almost their whole length and read as a single
 * slightly brighter pop — which is exactly the "only one burst for two Void Cubs" report, since the sim puts
 * both of a Deathrattle's summons on the SAME step and the replay therefore reveals both triggers in one
 * commit. At 300ms the first burst's flash has resolved before the second starts, so two reads as two.
 */
const REPEAT_STAGGER_MS = 300;

/** Ceiling on bursts from a single bump. Real triggers produce one or two; anything larger is a bug in what
 *  is being fed to `pulse`, and this keeps that bug a missing burst rather than a frame-long particle storm. */
const MAX_REPEAT_BURSTS = 4;

/** One rune badge as the hook sees it: where it sits in `ownedRunes`, and its current pulse count. */
export interface RuneSlotPulse {
  /** Index in `ownedRunes` — the slot, which is what makes a duplicated rune two independent badges. */
  slot: number;
  /** The rune id, used only to find the badge in the DOM (`data-source-id`). */
  id: string;
  /** A true cumulative COUNT of fires (combat triggers + shop procs). Its DELTA is how many times to burst,
   *  so this may only ever be fed numbers that count events. */
  pulse: number;
  /**
   * A SEQUENCE stamp, not a count — the End-of-Turn tendril channel (`questTendrilSeq`) is a global
   * per-action counter that jumps by however many actions have happened, so its delta is meaningless as a
   * burst count. Any CHANGE here is exactly one fire.
   *
   * Kept as its own field rather than folded into `pulse` because folding them was a real (caught) defect:
   * with `pulse` deltas driving the repeat count, a single End-of-Turn proc would have fired one burst per
   * intervening action — dozens of pops for one trigger.
   */
  seq?: number;
}

/**
 * PURE: which slots fired since the last look, and HOW MANY times, given the previous per-slot counts.
 *
 * Only an INCREASE is a fire, and the size of the increase is the number of fires. Both halves are
 * load-bearing, and both were wrong in the first cut (owner report 2026-08-19, Rune of the Hatchery):
 *
 *  · **A DECREASE is not a fire.** `combatTriggeredQuests` is reset to `{}` the moment combat settles, so a
 *    rune that fired twice goes 2 → 0. Treating any change as a fire made that reset burst the badge — a
 *    phantom pop after the fight was over, with nothing to attribute it to.
 *  · **A jump of N is N fires.** The counters are cumulative and the replay can reveal two triggers in one
 *    commit (two summons resolving in the same step). A "did it change" test collapses those into one burst,
 *    which is exactly the missing second Void Cub pop. Returning the delta lets the caller stagger them.
 *
 * A slot seen for the FIRST time never fires, which stops a page load or a mid-combat remount from
 * detonating every owned rune at once — the initial count is a state to record, not an event that happened.
 */
export function bumpedSlots(
  current: readonly RuneSlotPulse[],
  prev: Map<number, { pulse: number; seq?: number }>,
): { slot: RuneSlotPulse; times: number }[] {
  const out: { slot: RuneSlotPulse; times: number }[] = [];
  for (const s of current) {
    const before = prev.get(s.slot);
    if (before === undefined) continue;      // first sight — record, never fire
    const counted = s.pulse > before.pulse ? s.pulse - before.pulse : 0;
    const seqFire = s.seq !== undefined && before.seq !== undefined && s.seq !== before.seq ? 1 : 0;
    // Capped: a burst-per-fire is right for the handful a real trigger produces, but an unbounded repeat
    // count is one arithmetic slip away from a hundred-burst storm on a single frame — the exact failure the
    // `seq` split above exists to prevent, so the cap is the belt to its braces.
    const times = Math.min(MAX_REPEAT_BURSTS, counted + seqFire);
    if (times > 0) out.push({ slot: s, times });
  }
  return out;
}

/** Replace `prev` with the current counts, dropping slots that no longer exist (a sold rune). Mutates in
 *  place: this runs on every render of the badge row, so it allocates nothing per pass. */
export function captureSlots(current: readonly RuneSlotPulse[], prev: Map<number, { pulse: number; seq?: number }>): void {
  prev.clear();
  for (const s of current) prev.set(s.slot, { pulse: s.pulse, seq: s.seq });
}

/** The badge element for a rune slot. `data-source-id` is not unique when a rune is duplicated, so the Nth
 *  MATCHING node is taken rather than the first — `occurrence` is which copy of this id the slot is. */
export function badgeCenterOf(id: string, occurrence: number): { x: number; y: number } | null {
  const nodes = document.querySelectorAll<HTMLElement>(`.runebadge[data-source-id="${CSS.escape(id)}"]`);
  const el = nodes[occurrence] ?? nodes[0];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null; // unmounted / display:none — nothing to anchor to
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Fire the bound def on every rune slot that triggered since the last render.
 *
 * The def comes from `bindings.json` (`kinds.runeTriggered`), never a hardcoded id, so it is re-authorable
 * from the workbench like every other bound effect — and an unbound kind costs one table lookup and does
 * nothing, which is the state this ships in for anyone who removes the binding.
 */
export function useRuneTriggerFx(slots: readonly RuneSlotPulse[]): void {
  const prev = useRef<Map<number, { pulse: number; seq?: number }>>(new Map());
  // Bursts waiting for the next frame. Held in a REF rather than scheduled per effect run, because the effect
  // re-runs constantly during a combat replay: the first cut cancelled its pending `requestAnimationFrame` in
  // the effect's cleanup, so any re-render between a bump and the next frame silently swallowed that burst
  // (owner report 2026-08-19 — the second Void Cub never popped). Queueing instead means a burst survives as
  // many re-renders as it takes to reach a frame.
  const pending = useRef<{ id: string; occurrence: number; index: number }[]>([]);
  const raf = useRef(0);
  useEffect(() => {
    const fired = bumpedSlots(slots, prev.current);
    captureSlots(slots, prev.current);
    if (fired.length === 0 || !canPlayDefs()) return;
    const binding = bindingFor(null, 'runeTriggered');
    if (!binding) return;
    // How many earlier slots hold this same rune id — the badge's index among its duplicates.
    const seen = new Map<string, number>();
    for (const s of slots) {
      const occurrence = seen.get(s.id) ?? 0;
      seen.set(s.id, occurrence + 1);
      const hit = fired.find((f) => f.slot === s);
      if (!hit) continue;
      // One entry per fire: a rune that triggered twice between commits bursts twice.
      for (let n = 0; n < hit.times; n++) pending.current.push({ id: s.id, occurrence, index: s.slot });
    }
    if (pending.current.length === 0 || raf.current !== 0) return;
    // Measured on the next frame, not now: the badge re-rendered this commit (its inner node is REMOUNTED by
    // the pulse key), so its box is only trustworthy after layout.
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const queue = pending.current;
      pending.current = [];
      const camera = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      // Repeats on one badge are STAGGERED — two bursts fired on the same frame land exactly on top of each
      // other and read as one. `REPEAT_STAGGER_MS` apart, they read as two.
      const perBadge = new Map<string, number>();
      for (const q of queue) {
        const key = `${q.id}#${q.occurrence}`;
        const nth = perBadge.get(key) ?? 0;
        perBadge.set(key, nth + 1);
        const fire = (): void => {
          const at = badgeCenterOf(q.id, q.occurrence);
          if (!at) return; // badge left the DOM (rune sold, screen changed) before it could play
          playDef(binding.def, { source: at, camera }, { index: q.index });
        };
        if (nth === 0) fire();
        else setTimeout(fire, nth * REPEAT_STAGGER_MS);
      }
    });
  }, [slots]);
  // Unmount only — a pending burst must survive re-renders (see `pending`), but not the component going away.
  useEffect(() => () => { if (raf.current !== 0) cancelAnimationFrame(raf.current); }, []);
}
