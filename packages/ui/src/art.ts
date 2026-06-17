/// <reference types="vite/client" />

/**
 * Per-card illustrated art. Drop a PNG named by the card id into
 * `packages/ui/src/art/minions/<id>.png` (e.g. `whelp.png`) and it's picked up
 * at build time — the Card renders it in place of the pixel sprite. Recommended:
 * 512×512, transparent background, subject centred with a little margin.
 */
const modules = import.meta.glob('./art/minions/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const MINION_ART: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const id = path.split('/').pop()?.replace(/\.png$/, '') ?? '';
  if (id) MINION_ART[id] = url;
}

/** The illustrated art URL for a card id, or undefined if none has been added. */
export const artFor = (cardId?: string): string | undefined => (cardId ? MINION_ART[cardId] : undefined);

/** Keyword/effect overlay art (e.g. the Divine Shield bubble drawn over a shielded minion). */
const fxModules = import.meta.glob('./art/effects/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const FX_ART: Record<string, string> = {};
for (const [path, url] of Object.entries(fxModules)) {
  const id = path.split('/').pop()?.replace(/\.png$/, '') ?? '';
  if (id) FX_ART[id] = url;
}
export const effectArt = (name: string): string | undefined => FX_ART[name];
