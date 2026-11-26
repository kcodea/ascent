/**
 * PACK RELIEF (owner 2026-11-26: "deeply analyze the plushie pack art ... and create a normal map so that the sheen
 * responds to it and makes it look more 3d"). A wrapper may ship a RELIEF MAP beside its art, `packs/<id>-pack-relief.webp`
 * (300 x 450: R / G = which way the surface leans, 128 = flat; B = its finish, 255 = glossy ground, 0 = matte felt), built by `scripts/pack-relief-maps.cjs`
 * from the art. The gloss band's shader (`packFx.ts` GLOSS_FRAG) reads it: the band bends over the raised parts and
 * brightens on the slopes that face the light, so the sheen travels over an embossed surface, not a flat picture.
 *
 * A look with no relief map uses one flat pixel, which leaves the band exactly as it was.
 */
import { CanvasSource, ImageSource, Texture } from 'pixi.js';
import type { PackLook } from '@game/progression';
import { packArtFor } from './packArt';
import type { GlossFx } from './packFx';

/**
 * A wrapper's MATERIAL: `band` = how much brighter the gloss band is where the finish is full gloss (1 = the band as a
 * flat pack shows it), `fuzz` = how fuzzy its matte parts are (0..1: the fibre grain and the soft rim), `depth` = how
 * strongly the wrapper answers its relief (1 = the Plushie felt; a printed wrapper is far shallower, so its small
 * lettering stays readable).
 */
interface PackMaterial { band: number; fuzz: number; depth: number }
/** Printed foil all over: the band as it always was, glints on every slope, no fuzz. */
const FOIL: PackMaterial = { band: 1, fuzz: 0, depth: 0.42 };
/** The wrappers that ship a relief map, by their art file's id (`packs/<id>-pack.webp`), and what each is made of. */
const RELIEF: Readonly<Record<string, PackMaterial>> = {
  common: FOIL, rare: FOIL, epic: FOIL, legendary: FOIL, ancient: FOIL, secret: FOIL, launch: FOIL,
  eightbit: FOIL, voxel: FOIL, lowpoly: FOIL,
  plushie: { band: 3, fuzz: 1, depth: 1 },      // felt on a glossy ground
  scribble: { band: 2.5, fuzz: 0.5, depth: 0.4 }, // crayon on paper (finish 0.4 all over: the band as it was, a waxy tooth)
  sketchbook: { band: 3, fuzz: 0.4, depth: 0.35 }, // pencil on paper (finish 0.3 all over)
};

/** The relief map for `look`, or null. */
export function packReliefFor(look: PackLook): string | null {
  const art = packArtFor(look);
  const id = art ? /packs\/([a-z]+)-pack\.webp$/.exec(art)?.[1] : undefined;
  return art && id && RELIEF[id] ? art.replace(/\.webp$/, '-relief.webp') : null;
}

function materialFor(src: string): PackMaterial {
  return RELIEF[/packs\/([a-z]+)-pack-relief\.webp$/.exec(src)?.[1] ?? ''] ?? FOIL;
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
  const mat = materialFor(src);
  try { const um = gloss.u.uMat; um[0] = mat.band; um[1] = mat.fuzz; } catch { /* the band was destroyed */ }
  const have = loaded.get(src);
  if (have) { set(have, mat.depth); return; }
  set(flatRelief(), 0);
  const use = (t: Texture): void => { if (stillWanted()) set(t, mat.depth); };
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
