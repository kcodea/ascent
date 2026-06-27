/// <reference types="vite/client" />

/**
 * Per-card illustrated art. Drop a PNG named by the card id into
 * `packages/ui/src/art/minions/<id>.png` (e.g. `whelp.png`) and it's picked up at build time — the
 * Card renders it in place of the pixel sprite. Recommended master: 512×512+, transparent background,
 * subject centred with a little margin. Run `npm run optimize-art` to downscale + convert to WebP
 * (the in-repo build copy becomes `<id>.webp`; the high-res master stays under `C:\Game Assets\Ascent Art\`).
 * The globs below accept both `.png` and `.webp`, preferring WebP — so a freshly-dropped PNG shows up
 * immediately, and the optimizer can convert it later without any rewiring.
 *
 * NB: `import.meta.glob`'s options MUST be an inline object literal — Vite analyses the call statically,
 * so a shared/hoisted options variable fails the build with "Invalid glob import syntax".
 */
type ArtModules = Record<string, string>;

/** Build an id → url map from a glob, preferring the `.webp` build copy when both formats exist. */
function indexArt(modules: ArtModules): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(modules)) {
    const id = path.split('/').pop()?.replace(/\.(png|webp)$/, '') ?? '';
    if (id && (!out[id] || path.endsWith('.webp'))) out[id] = url;
  }
  return out;
}

const MINION_ART = indexArt(
  import.meta.glob('./art/minions/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);

/** Small deterministic string hash — picks a stable art variant per minion instance. */
const hashStr = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/** Art-file aliases: a card id → a different art filename. Lets us ship updated art under a new name without
 *  renaming the card. Now EMPTY — the full art refresh (2026-06-26) names every master by card id, so the old
 *  aliases (heckbinder2 / combinator2 / guel2 / demonanomaly2 / goldfont / goldpouch — all pre-refresh art)
 *  were retired and their stale files deleted; the mechanism stays for future one-off art swaps. */
const ART_ALIAS: Record<string, string> = {};

/** The illustrated art URL for a card id, or undefined if none has been added. `uid` lets cards
 *  with multiple art variants pick one per instance (stable across re-renders, ~50/50 split). */
export const artFor = (cardId?: string, uid?: string): string | undefined => {
  if (!cardId) return undefined;
  // Pup ships two variants (pup / pup2) — flip a coin per spawn (by uid) for a little flavor.
  if (cardId === 'pup' && MINION_ART.pup2 && uid) {
    return hashStr(uid) % 2 === 0 ? MINION_ART.pup : MINION_ART.pup2;
  }
  const alias = ART_ALIAS[cardId];
  if (alias && MINION_ART[alias]) return MINION_ART[alias];
  return MINION_ART[cardId];
};

/** Hero portraits — drop a PNG into `packages/ui/src/art/heroes/<id>.png` (e.g. `warden.png`). */
const HERO_ART = indexArt(
  import.meta.glob('./art/heroes/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);
export const heroArt = (name: string): string | undefined => HERO_ART[name];

/** Hero-POWER button art — drop a PNG into `packages/ui/src/art/powers/<heroId>.png` (e.g. `warden.png`).
 *  The button is a circle (object-fit: cover), so use a square master with the subject centred. Falls back
 *  to the placeholder glyph when absent. */
const POWER_ART = indexArt(
  import.meta.glob('./art/powers/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as ArtModules,
);
export const heroPowerArt = (heroId: string): string | undefined => POWER_ART[heroId];

/** Every bundled art URL (minions + heroes + powers), deduped — the warm-up set. */
const ALL_ART_URLS: string[] = [
  ...new Set([...Object.values(MINION_ART), ...Object.values(HERO_ART), ...Object.values(POWER_ART)]),
];

let warmed = false;
/**
 * Preload (fetch + decode) every bundled art file so cards render with their art already cached — no
 * "pop-in" a beat after the card frame on a cold load (the itch CDN especially: each webp is a separate
 * round-trip the first time its card appears). Idempotent and non-blocking: it kicks off detached `Image`
 * loads on idle (the browser fetches + decodes off the render path), so it never competes with first paint.
 * Call once the title / hero-select screen is up. Platform-independent — fixes the web + itch-embed build,
 * not just a future local/desktop wrap (which only removes the network half).
 */
export function warmArt(): void {
  if (warmed || typeof Image === 'undefined') return;
  warmed = true;
  const run = (): void => {
    for (const url of ALL_ART_URLS) {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      // decode() pre-decodes off the main thread where supported; best-effort (ignore failures / abort).
      void img.decode?.().catch(() => {});
    }
  };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (typeof ric === 'function') ric(run);
  else setTimeout(run, 200);
}
