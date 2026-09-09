/**
 * Art-file aliases: a card id → the art filename it wears. Lets one card share another's illustration (or ship
 * updated art under a new name) without a second file — the art tree sits right at the itch.io zip-count guard
 * (`artNoRedundantMasters.test.ts`), so a duplicate portrait is a real cost. Glob-free on purpose: `art.ts` owns
 * the Vite globs, and the art-coverage test needs this map without dragging those in.
 */
export const ART_ALIAS: Readonly<Record<string, string>> = {
  // The set-3 Yazzus (`n3_yazzus`, a fork of `yazzus` — 2026-09-09) is the same card wearing the same face.
  n3_yazzus: 'yazzus',
};
