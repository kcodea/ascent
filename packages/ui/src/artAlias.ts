/**
 * Art-file aliases: a card id → the art filename it wears. Lets one card share another's illustration (or ship
 * updated art under a new name) without a second file — the art tree sits right at the itch.io zip-count guard
 * (`artNoRedundantMasters.test.ts`), so a duplicate portrait is a real cost. Glob-free on purpose: `art.ts` owns
 * the Vite globs, and the art-coverage test needs this map without dragging those in.
 */
export const ART_ALIAS: Readonly<Record<string, string>> = {
  // Empty since 2026-09-16: its one entry (`n3_yazzus` → `yazzus`) went when the set-3 Yazzus fork became THE
  // Yazzus. Keep the map — the next shared face goes here, not in a second file.
};
