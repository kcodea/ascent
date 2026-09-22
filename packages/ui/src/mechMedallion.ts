/**
 * Which mechanics have authored PNG medallion art, and where it lives. Keyed by MECHANIC ID (not glyph): glyph
 * names like `sword`/`skull`/`shield` are reused for generic non-mechanic icons and must stay SVG. A mechanic not
 * in the set renders its `<Icon>` SVG glyph as before (hybrid). See the spec for the mapping.
 */
export const MECH_MEDALLION_PNGS: ReadonlySet<string> = new Set([
  'shout', 'echo', 'startCombat', 'endTurn', 'avenge', 'rally', 'chooseOne', 'cleave',
  'crit', 'flurry', 'rise', 'rebirth', 'attachment', 'watcher', 'spend',
]);

/** The webp URL for a mechanic's medallion art, or null when it has none. BASE_URL-relative (itch/exe serve from
 *  a CDN sub-path, where a root-absolute '/medallions/…' 404s). */
export function mechMedallionSrc(mechanicId: string): string | null {
  return MECH_MEDALLION_PNGS.has(mechanicId) ? `${import.meta.env.BASE_URL}medallions/${mechanicId}.webp` : null;
}
