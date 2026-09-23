/**
 * "Epic" units — those that change the NUMBER OF TIMES something happens (trigger / cast multipliers: Drakko's
 * Shouts twice, Sylus's Echoes an extra time, Chronos's End-of-Turn twice, Yazzus's targeted spells again, …).
 * They wear a SEPARATE 'epic' medallion, distinct from the mechanic gem: always the same icon (no gild / silver
 * treatment), positioned + sized by its own tuner (epicMedallionConfig.ts), sharing the medallion drop shadow.
 *
 * Curated BY CARD ID for owner control (many carry a `triggerMultiplier` in content, but Yazzus is resolved by
 * id in @game/sim, so a data predicate would miss it — an explicit set is the reliable, owner-editable source).
 */
export const EPIC_UNITS: ReadonlySet<string> = new Set([
  // The four named units.
  'drummer', // Drakko — Shouts trigger twice
  'sylus',   // Echoes trigger 1 additional time
  'chronos', // End of Turn effects trigger twice
  'yazzus',  // targeted spells cast an additional time
  // Group A — trigger multipliers, same archetype (owner ask 2026-09-23).
  'uron',                    // Uron, Oathbringer — Rallies / End of Turns / Start of Combats +1
  'zyff',                    // Zyff, the Betrayer — Battlecries + Deathrattles +1
  'echowarden',              // Echo Warden — summons trigger one more time
  'attachmentconductor',     // Attachment Conductor — Magnetics magnetize twice
  'b2_elderhorn',            // Elderhorn — Beast Rallies +1
  'd2_orivax',               // Orivax, the Spellchoir — Shouts +1 / first Shop spell ×3
  'dw_edward',               // Edward Keg-hands — Dwarven Ales trigger twice
  'ce3_constellationprime',  // Constellation Prime — Star Crashes cast an additional time
  'k_deepdelve',             // Deepdelve Paragon — Rubies in combat give 2× stats (owner ask 2026-09-23)
]);

export function isEpicUnit(cardId: string): boolean {
  return EPIC_UNITS.has(cardId);
}

/** The epic medallion art. BASE_URL-relative (itch/exe serve from a CDN sub-path). */
export const EPIC_MEDALLION_SRC = `${import.meta.env.BASE_URL}medallions/epic.webp`;
