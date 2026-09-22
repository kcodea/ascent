/**
 * Which mechanics have authored PNG medallion art, and where it lives. Keyed by MECHANIC ID (not glyph): glyph
 * names like `sword`/`skull`/`shield` are reused for generic non-mechanic icons and must stay SVG. A mechanic not
 * in the set renders its `<Icon>` SVG glyph as before (hybrid). See the spec for the mapping.
 */
export const MECH_MEDALLION_PNGS: ReadonlySet<string> = new Set([
  'shout', 'echo', 'startCombat', 'endTurn', 'avenge', 'rally', 'chooseOne', 'cleave',
  'crit', 'flurry', 'rise', 'rebirth', 'attachment', 'watcher', 'spend', 'pummel',
]);

/** The webp URL for a mechanic's medallion art, or null when it has none. BASE_URL-relative (itch/exe serve from
 *  a CDN sub-path, where a root-absolute '/medallions/…' 404s). */
export function mechMedallionSrc(mechanicId: string): string | null {
  return MECH_MEDALLION_PNGS.has(mechanicId) ? `${import.meta.env.BASE_URL}medallions/${mechanicId}.webp` : null;
}

/**
 * Per-mechanic art-size correction. Some source PNGs seat their glyph smaller within the 256² canvas, so at the
 * same box size they read smaller than their neighbours. This multiplies ONLY that mechanic's art — on top of the
 * global Art-inset dial (🎖️ Medallions tuner) — to normalise the on-card size, without touching the box, the
 * circle, or every other medallion. `1` (the default for anything unlisted) means no correction. Owner-tuned by
 * eye; add an entry as an art reads off.
 */
export const MECH_MEDALLION_ART_SCALE: Readonly<Record<string, number>> = {
  shout: 1.15,   // owner ask 2026-09-22 — reads small next to the others
  endTurn: 0.9, // owner ask 2026-09-22 — reads large next to the others (−15%, then +5%)
};

export function mechMedallionArtScale(mechanicId: string): number {
  return MECH_MEDALLION_ART_SCALE[mechanicId] ?? 1;
}
