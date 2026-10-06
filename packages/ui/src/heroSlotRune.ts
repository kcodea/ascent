/**
 * THE HERO-POWER RUNE (R-RUNESLOT-01, owner report 2026-10-06).
 *
 * Runesmith's turn-5 forge and Guardian's turn-8 Epic forge are HERO POWERS, so the rune each one sells sits
 * in the hero-power slot (`run.heroGrantArt`), not in the rune rack. The rack only has three sockets
 * (`.questbadges .questbadge:nth-child(1..3)`), and it used to draw EVERY owned rune — so the hero's pick showed
 * twice, and with Rune of Duplication on top (basic + hero pick + its copy + the turn-9 Epic = 4) the fourth
 * badge had no socket and floated loose beside the third.
 *
 * Kept free of React and of the store so the rack, the arrival ceremony and the FX anchors all read the same
 * answer from one place.
 */
import type { RunState } from '@game/sim';

/** The rune the hero-power slot is wearing, if any (a QUEST grant is not a rune). */
export function heroSlotRuneId(run: Pick<RunState, 'heroGrantArt'>): string | null {
  return run.heroGrantArt?.kind === 'rune' ? run.heroGrantArt.id : null;
}

/**
 * The runes the RACK draws: `ownedRunes` minus ONE copy of the hero-slot rune, which lives in the power slot.
 * Only one copy leaves: a Duplication copy of the hero's pick (or the same rune bought again later) is a
 * second rune the player holds, and it keeps its rack socket. The LAST occurrence is the one removed, so the
 * copies still in the rack keep their order.
 */
export function rackRunes(owned: readonly string[], heroRune: string | null): string[] {
  const out = [...owned];
  if (!heroRune) return out;
  const at = out.lastIndexOf(heroRune);
  if (at >= 0) out.splice(at, 1);
  return out;
}

/** Rune ids are plain snake_case, but escape anyway where the DOM offers it (a test DOM shim may not). */
const esc = (id: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id);

/** The hero-power button while it wears `runeId`. StatusBar stamps `data-hero-rune` on it for this lookup. */
export function heroSlotRuneEl(runeId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(`.statusbar .heropowerbtn[data-hero-rune="${esc(runeId)}"]`);
}

/**
 * Where a rune stands on screen, for an FX that starts or lands on it: its rack badge, else the hero-power
 * slot when that is where the rune lives. Every "out of the rune's badge" lookup goes through here, because a
 * rune in the power slot has no rack badge and those lookups used to skip their FX silently.
 */
export function runeNodeEl(runeId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(`.questbadges .runebadge[data-source-id="${esc(runeId)}"]`)
    ?? heroSlotRuneEl(runeId);
}
