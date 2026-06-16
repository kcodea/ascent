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
