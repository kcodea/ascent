/**
 * Which mechanics have authored PNG medallion art, and where it lives. Keyed by MECHANIC ID (not glyph): glyph
 * names like `sword`/`skull`/`shield` are reused for generic non-mechanic icons and must stay SVG. A mechanic not
 * in the set renders its `<Icon>` SVG glyph as before (hybrid). See the spec for the mapping.
 */
export const MECH_MEDALLION_PNGS: ReadonlySet<string> = new Set([
  'shout', 'echo', 'startCombat', 'endTurn', 'avenge', 'rally', 'chooseOne', 'cleave',
  // 'execute' wears the two-sword art (renamed from flurry.webp); Flurry no longer takes a medallion — its
  // attack animation distinguishes it, so its art was repurposed for Execute (owner ask 2026-09-23).
  'crit', 'execute', 'rise', 'rebirth', 'attachment', 'watcher', 'spend', 'pummel',
  // Overflow shows the Watcher eye (art alias below); Sell (on-sell effects, e.g. River Drake) and Equip get
  // their own art (owner ask 2026-09-23).
  'overflow', 'sell', 'equip',
]);

/** Mechanics that render ANOTHER mechanic's art (a shared icon). Overflow uses the Watcher eye (owner ask
 *  2026-09-23). Keyed source mechanic → the art id whose webp to serve. */
const MECH_MEDALLION_ART_ALIAS: Readonly<Record<string, string>> = {
  overflow: 'watcher',
};

/** The webp URL for a mechanic's medallion art, or null when it has none. BASE_URL-relative (itch/exe serve from
 *  a CDN sub-path, where a root-absolute '/medallions/…' 404s). Some mechanics alias another's art (see above). */
export function mechMedallionSrc(mechanicId: string): string | null {
  if (!MECH_MEDALLION_PNGS.has(mechanicId)) return null;
  const art = MECH_MEDALLION_ART_ALIAS[mechanicId] ?? mechanicId;
  return `${import.meta.env.BASE_URL}medallions/${art}.webp`;
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
  sell: 0.8,    // owner ask 2026-09-23 — −10%, then another −10%
};

export function mechMedallionArtScale(mechanicId: string): number {
  return MECH_MEDALLION_ART_SCALE[mechanicId] ?? 1;
}

/** Per-mechanic art ROTATION (degrees clockwise), for a single medallion that reads better turned. Applied on
 *  top of the art scale; `0` (the default for anything unlisted) means no rotation. Owner-tuned. */
export const MECH_MEDALLION_ART_ROTATE: Readonly<Record<string, number>> = {
  shout: 32.4, // owner ask 2026-09-23 — 9% of a full turn, clockwise
};

export function mechMedallionArtRotate(mechanicId: string): number {
  return MECH_MEDALLION_ART_ROTATE[mechanicId] ?? 0;
}

/** Per-mechanic art TINT — a colour washed over the art through the `.cgem-tint` overlay (masked to the art
 *  shape), with a blend mode. Execute gets a red multiply sheen (owner ask 2026-09-23). `amt` is the overlay
 *  opacity (0–1). A mechanic not listed here uses the global tuner tint (off by default). */
export interface MechArtTint { color: string; amt: number; blend: string; }
export const MECH_MEDALLION_ART_TINT: Readonly<Record<string, MechArtTint>> = {
  execute: { color: '#dc3b3b', amt: 1, blend: 'multiply' },
};

export function mechMedallionArtTint(mechanicId: string): MechArtTint | null {
  return MECH_MEDALLION_ART_TINT[mechanicId] ?? null;
}

/**
 * THE TINT OVERLAY'S MASK, ONE STYLESHEET RULE PER ART (R-PERF-MEDALLION-MASK-01, perf degradation hunt 2026-10-30:
 * "performance degrades over a game, worse on phones").
 *
 * The `.cgem-tint` overlay used to take its mask from an INLINE custom property (`--cgem-artsrc: url("…")`, set per
 * card and substituted into `mask` through `var()`). A `url()` that arrives through a custom property is parsed again
 * for every element that resolves it, so each card medallion that mounted (and every trigger pulse remounts one: it is
 * keyed on the pulse nonce) made a NEW image value and asked the network stack for the picture again. Measured on a
 * bench build (perf:gauntlet --img-census): ~300 medallion requests a round from round 2 on (shout, endTurn, watcher,
 * echo, rally, …), each a fresh fetch + decode that the renderer and GPU process kept, while the distinct URL count
 * stayed flat. A literal `url()` in a stylesheet rule is ONE image value shared by every element it matches, fetched
 * and decoded once per document. So the overlay names its art (`data-art`) and this sheet holds one rule per art.
 */
export function mechMedallionArtId(mechanicId: string): string | null {
  return MECH_MEDALLION_PNGS.has(mechanicId) ? MECH_MEDALLION_ART_ALIAS[mechanicId] ?? mechanicId : null;
}

/** The stylesheet text: `.cgem-tint[data-art="<art>"] { mask-image: url(<the art>) }`, one rule per medallion art. */
export function mechMedallionMaskCss(base: string = import.meta.env.BASE_URL): string {
  const arts = new Set([...MECH_MEDALLION_PNGS].map((id) => MECH_MEDALLION_ART_ALIAS[id] ?? id));
  return [...arts].map((art) => {
    const u = `url("${base}medallions/${art}.webp")`;
    return `.cgem-tint[data-art="${art}"]{-webkit-mask-image:${u};mask-image:${u}}`;
  }).join('\n');
}

/** Installs the mask sheet once (browser only). Imported for its effect by the components that draw `.cgem-tint`. */
export function installMechMedallionMasks(): void {
  if (typeof document === 'undefined' || document.getElementById('cgem-art-masks')) return;
  const style = document.createElement('style');
  style.id = 'cgem-art-masks';
  style.textContent = mechMedallionMaskCss();
  document.head.appendChild(style);
}
installMechMedallionMasks();
