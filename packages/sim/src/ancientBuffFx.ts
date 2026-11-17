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
import { ANCIENTS, ancientPairingHeroId, type AncientId } from './ancients';
import type { RunState } from './state';

let names: ReadonlySet<string> | null = null;

/** The six Ancients' names: the label every Ancient-made stat grant is attributed to. */
export function ancientBuffLabels(): ReadonlySet<string> {
  return names ??= new Set(Object.values(ANCIENTS).map((a) => a.name));
}

/** Is this buff source an Ancient's grant (its name)? The Shop tag `addBuff` reads; combat resolves the same names. */
export function isAncientBuffLabel(source: string | undefined): boolean {
  return !!source && ancientBuffLabels().has(source);
}

/**
 * WHERE AN ANCIENT'S TENDRIL STARTS, per pairing (owner rulings 2026-11-17, R-FX-ANCIENT-ORIGIN-01): "frank should
 * tendril from the minion, drakko should just show a self buff on drakkos themselves, warden should go from the minion as
 * well, albus goes from hero power, this should show tendrils from the minion that was buffed".
 *
 * An override on top of the shared tag above, never a rewrite of it: every pairing not listed here keeps `'hero'`.
 *  · `'hero'`    the hero-power button (the shared tag's default).
 *  · `'trigger'` the minion that set the grant off: a sold Clearance minion's slot (Frank), the Ward minion that gained
 *                stats (Warden), the Gilded minion that gained stats (Midas). The grant's own capture source.
 *  · `'self'`    no tendril: the recipient plays the self-buff effect on itself (Drakko's Drakkos).
 *
 * SHOP: `addBuff` reads it for the live pairing (`ancientGrantOriginOf`): a non-`hero` grant pushes no hero-power record,
 * so the enclosing capture attributes it to its source (`trigger`), or skips it so the Shop's self-buff burst tells it
 * (`self`). COMBAT: `ancientCombatMods` hands the origin to the three combat grants (Warden, Midas, Drakko), and the
 * simulator stamps the body on the `buff` event's `from` (presentation only).
 */
export type AncientGrantOrigin = 'hero' | 'trigger' | 'self';

export const ANCIENT_GRANT_ORIGIN: Readonly<Record<string, Partial<Record<AncientId, AncientGrantOrigin>>>> = {
  albus: { bonds: 'hero' },
  drakko: { bonds: 'self' },
  frank: { bonds: 'trigger' },
  midas: { bonds: 'trigger' }, // "the minion that was buffed": the Gilded minion whose gain set it off (owner 2026-11-17)
  warden: { bonds: 'trigger' },
};

/** The origin of `heroId` × `ancient`'s grants (`'hero'` when the table has no row). Pure. */
export function ancientGrantOrigin(heroId: string, ancient: AncientId | undefined): AncientGrantOrigin {
  return (ancient && ANCIENT_GRANT_ORIGIN[heroId]?.[ancient]) || 'hero';
}

/** The live pairing's grant origin (`'hero'` outside an Ancients run or before the pick). */
export function ancientGrantOriginOf(state: RunState): AncientGrantOrigin {
  const picked = state.ancientsEnabled ? state.ancients?.picked : undefined;
  return picked ? ancientGrantOrigin(ancientPairingHeroId(state), picked) : 'hero';
}
