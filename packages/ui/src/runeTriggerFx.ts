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

/** One rune badge as the hook sees it: where it sits in `ownedRunes`, and its current pulse count. */
export interface RuneSlotPulse {
  /** Index in `ownedRunes` — the slot, which is what makes a duplicated rune two independent badges. */
  slot: number;
  /** The rune id, used only to find the badge in the DOM (`data-source-id`). */
  id: string;
  /** Monotonic-ish "how many times this has fired" — any CHANGE is a fire (see `bumpedSlots`). */
  pulse: number;
}

/**
 * PURE: which slots fired since the last look, given the previous per-slot counts.
 *
 * Any CHANGE counts, not just an increase. The counters are not globally monotonic — `combatTriggeredQuests`
 * is reset to `{}` when a replay ends and re-derived per fight, so a strict `>` test would go blind for the
 * whole of the next combat after a reset dropped the number. A rune that is SOLD and re-bought lands in a
 * different slot, so a stale count cannot leak across.
 *
 * A slot seen for the FIRST time never fires, which is what stops a page load / a mid-combat remount from
 * detonating every owned rune at once — the initial pulse is a state to record, not an event that happened.
 */
export function bumpedSlots(
  current: readonly RuneSlotPulse[],
  prev: Map<number, number>,
): RuneSlotPulse[] {
  const out: RuneSlotPulse[] = [];
  for (const s of current) {
    const before = prev.get(s.slot);
    if (before !== undefined && before !== s.pulse) out.push(s);
  }
  return out;
}

/** Replace `prev` with the current counts, dropping slots that no longer exist (a sold rune). Mutates in
 *  place: this runs on every render of the badge row, so it allocates nothing per pass. */
export function captureSlots(current: readonly RuneSlotPulse[], prev: Map<number, number>): void {
  prev.clear();
  for (const s of current) prev.set(s.slot, s.pulse);
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
  const prev = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    const fired = bumpedSlots(slots, prev.current);
    captureSlots(slots, prev.current);
    if (fired.length === 0 || !canPlayDefs()) return;
    const binding = bindingFor(null, 'runeTriggered');
    if (!binding) return;
    // Measured on the next frame, not now: the badge re-rendered this commit (its inner node is REMOUNTED by
    // the pulse key), so its box is only trustworthy after layout.
    const raf = requestAnimationFrame(() => {
      // How many earlier slots hold this same rune id — the badge's index among its duplicates.
      const seen = new Map<string, number>();
      for (const s of slots) {
        const occurrence = seen.get(s.id) ?? 0;
        seen.set(s.id, occurrence + 1);
        if (!fired.includes(s)) continue;
        const at = badgeCenterOf(s.id, occurrence);
        if (!at) continue;
        // `camera` alongside `source` so a camera-anchored layer added later frames on the viewport rather
        // than resolving to ORIGIN in the screen corner — the same pairing the shop cues make.
        playDef(binding.def, { source: at, camera: { x: window.innerWidth / 2, y: window.innerHeight / 2 } }, { index: s.slot });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [slots]);
}
