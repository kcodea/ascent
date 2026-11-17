/**
 * ANCIENT BUFFS PLAY THE HERO-POWER TENDRIL (owner 2026-11-16, R-FX-ANCIENT-TENDRIL-01): "When ancients buff things like
 * that, they should have a tendril animation. Make sure this is wired."
 *
 * An Ancient is a transformation of the HERO POWER, so every stat grant one makes is the power's grant: it leaves the
 * hero-power button as the generic buff tendril, in the Shop and in combat, the moment it lands. ONE tag does it, never
 * a per-pairing hack: the grant's SOURCE LABEL. Every Ancient grant is already attributed to an Ancient's name
 * (`ANCIENTS[id].name`, "Ancient of Bonds") or, for the few pairings that print the power's own name, to that name
 * (`'Aegis'`, `'Pocket Magic'`, `'Rounded Spellbook'`, combat only, already mapped one by one in the ui). Those labels
 * are the contract:
 *
 *  · SHOP: `addBuff` (the one chokepoint every Shop stat gain crosses) records a `fromHeroPower` buff record for a board
 *    minion gaining stats from one of these labels, so a grant made inside ANY capture (or none) streams from the button.
 *  · COMBAT: `heroPowerBuffLabelFor` (ui `choreo/bindings.ts`) resolves these labels, so a combat `buff` event carrying
 *    one plays the same tendril from the side's hero-power button.
 *
 * Read lazily: `ANCIENTS` lives in `ancients.ts`, which imports `recruit.ts`, which imports this file.
 */
import { ANCIENTS } from './ancients';

let names: ReadonlySet<string> | null = null;

/** The six Ancients' names: the label every Ancient-made stat grant is attributed to. */
export function ancientBuffLabels(): ReadonlySet<string> {
  return names ??= new Set(Object.values(ANCIENTS).map((a) => a.name));
}

/** Is this buff source an Ancient's grant (its name)? The Shop tag `addBuff` reads; combat resolves the same names. */
export function isAncientBuffLabel(source: string | undefined): boolean {
  return !!source && ancientBuffLabels().has(source);
}
