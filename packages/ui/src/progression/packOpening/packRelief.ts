/**
 * PACK RELIEF (owner 2026-11-26: "deeply analyze the plushie pack art ... and create a normal map so that the sheen
 * responds to it and makes it look more 3d"). A wrapper may ship a RELIEF MAP beside its art, `packs/<id>-pack-relief.webp`
 * (300 x 450: R / G = which way the surface leans, 128 = flat; B = its height), built by `scripts/pack-relief-maps.cjs`
 * from the art. The gloss band's shader (`packFx.ts` GLOSS_FRAG) reads it: the band bends over the raised parts and
 * brightens on the slopes that face the light, so the sheen travels over an embossed surface, not a flat picture.
 *
 * A look with no relief map uses one flat pixel, which leaves the band exactly as it was.
 */
import { CanvasSource, ImageSource, Texture } from 'pixi.js';
import type { PackLook } from '@game/progression';
import { packArtFor } from './packArt';
import type { GlossFx } from './packFx';

/** The wrappers that ship a relief map, by their art file's id (`packs/<id>-pack.webp`). */
const RELIEF_IDS: ReadonlySet<string> = new Set(['plushie']);
/** How strongly the band answers the relief (0 = flat). */
export const RELIEF_STRENGTH = 1;

/** The relief map for `look`, or null. */
export function packReliefFor(look: PackLook): string | null {
  const art = packArtFor(look);
  const id = art ? /packs\/([a-z]+)-pack\.webp$/.exec(art)?.[1] : undefined;
  return art && id && RELIEF_IDS.has(id) ? art.replace(/\.webp$/, '-relief.webp') : null;
}

let flat: Texture | null = null;
/** One flat pixel: no lean anywhere. Shared, never destroyed. */
export function flatRelief(): Texture {
  if (flat) return flat;
  const c = document.createElement('canvas');
  c.width = 1; c.height = 1;
  const g = c.getContext('2d');
  if (g) { g.fillStyle = 'rgb(128, 128, 128)'; g.fillRect(0, 0, 1, 1); }
  flat = new Texture({ source: new CanvasSource({ resource: c }) });
  return flat;
}

/** Loaded relief maps by url: shared by every pack that wears the look, kept for the session (a few small textures). */
const loaded = new Map<string, Texture>();
const waiting = new Map<string, ((t: Texture) => void)[]>();

/**
 * Bind `look`'s relief to a gloss band: at once when it is loaded (or the look has none), else when its image arrives,
 * unless `stillWanted` says the band has moved on to another look by then.
 */
export function bindRelief(gloss: GlossFx, look: PackLook, stillWanted: () => boolean): void {
  const src = packReliefFor(look);
  const set = (t: Texture, k: number): void => {
    try { gloss.mesh.shader!.resources.uTex3 = t.source; gloss.u.uRelief = k; } catch { /* the band was destroyed */ }
  };
  if (!src) { set(flatRelief(), 0); return; }
  const have = loaded.get(src);
  if (have) { set(have, RELIEF_STRENGTH); return; }
  set(flatRelief(), 0);
  const use = (t: Texture): void => { if (stillWanted()) set(t, RELIEF_STRENGTH); };
  const queue = waiting.get(src);
  if (queue) { queue.push(use); return; }
  waiting.set(src, [use]);
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    const t = new Texture({ source: new ImageSource({ resource: img }) });
    loaded.set(src, t);
    for (const f of waiting.get(src) ?? []) f(t);
    waiting.delete(src);
  };
  img.onerror = () => { waiting.delete(src); };
  img.src = src;
}
