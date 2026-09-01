import type { RuneArrivalCue } from './useRuneArrivalFx';


/**
 * ── Why this lives OUTSIDE `QuestBadges.tsx` ──────────────────────────────────────────────────────────────
 *
 * React Fast Refresh only handles a module whose exports are all components. Exporting this helper from the
 * component file made every edit to that file a FULL invalidate — the dev console said so out loud
 * ("Could not Fast Refresh (\"arrivalClasses\" export is incompatible)"), and a tuner-driven ceremony is
 * exactly the kind of work that gets tuned by editing and re-watching. So the pure part lives here.
 */
/**
 * THE ARRIVING BADGE (owner ask 2026-08-31). A rune's badge appears the instant the buy resolves — which is
 * before the lock-in ceremony has finished telling you that you won it. So while the ceremony runs the badge
 * is `arriving` (its art held back), and when the ceremony hands over it is `arrived` (the art pops in, on
 * the same beat as the implosion). Everything else about the badge — its slot, its tally, its hover — is
 * unchanged throughout, so the tray never reflows.
 *
 * ── The class per slot, as one pass over the tray ─────────────────────────────────────────────────────────
 *
 * Exported and pure because the walk is where the bug was (owner report 2026-08-31: *"the rune's art pop in
 * is only working on the first rune"*). There are TWO indices in play and they are not the same number:
 *
 *   · the SLOT — where the badge sits in the tray;
 *   · the OCCURRENCE — which copy of THIS RUNE ID the badge is.
 *
 * An arrival cue carries the occurrence, because that is the only thing that tells two badges apart when
 * Rune of Duplication puts the same rune in the tray twice — and `badgeCenterOf` resolves the FX anchor the
 * same way. Matching a cue against the slot instead works for exactly one case, the first rune of the run,
 * and silently fails for every rune after it.
 */
export function arrivalClasses(
  runes: readonly string[],
  cue: RuneArrivalCue | null,
): string[] {
  const seen = new Map<string, number>();
  return runes.map((id) => {
    const occurrence = seen.get(id) ?? 0;
    seen.set(id, occurrence + 1);
    if (!cue || cue.runeId !== id || cue.occurrence !== occurrence) return '';
    return cue.phase === 'pending' ? ' rune-arriving' : ' rune-arrived';
  });
}
