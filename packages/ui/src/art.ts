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

/** Small deterministic string hash — picks a stable art variant per minion instance. */
const hashStr = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/** The illustrated art URL for a card id, or undefined if none has been added. `uid` lets cards
 *  with multiple art variants pick one per instance (stable across re-renders, ~50/50 split). */
export const artFor = (cardId?: string, uid?: string): string | undefined => {
  if (!cardId) return undefined;
  // Pup ships two variants (pup / pup2) — flip a coin per spawn (by uid) for a little flavor.
  if (cardId === 'pup' && MINION_ART.pup2 && uid) {
    return hashStr(uid) % 2 === 0 ? MINION_ART.pup : MINION_ART.pup2;
  }
  return MINION_ART[cardId];
};

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

/** Hero portraits — drop a PNG into `packages/ui/src/art/heroes/<id>.png` (e.g. `warden.png`). */
const heroModules = import.meta.glob('./art/heroes/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const HERO_ART: Record<string, string> = {};
for (const [path, url] of Object.entries(heroModules)) {
  const id = path.split('/').pop()?.replace(/\.png$/, '') ?? '';
  if (id) HERO_ART[id] = url;
}
export const heroArt = (name: string): string | undefined => HERO_ART[name];
