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
const FOIL: PackMaterial = { band: 0.8, fuzz: 0, depth: 0.1 };
/* Owner 2026-11-27: "lower relief depth to .1 for all and gloss boost to .8 for all". Fuzz stays per wrapper. */
/** The wrappers that ship a relief map, by their art file's id (`packs/<id>-pack.webp`), and what each is made of. */
const RELIEF: Readonly<Record<string, PackMaterial>> = {
  common: FOIL, rare: FOIL, epic: FOIL, legendary: FOIL, ancient: FOIL, secret: FOIL, launch: FOIL,
  eightbit: FOIL, voxel: FOIL, lowpoly: FOIL, encore: FOIL, sports: FOIL, stainedglass: FOIL, scifi: FOIL,
  plushie: { band: 0.8, fuzz: 1, depth: 0.1 },      // felt on a glossy ground
  scribble: { band: 0.8, fuzz: 0.5, depth: 0.1 }, // crayon on paper (finish 0.4 all over: the band as it was, a waxy tooth)
  crayon: { band: 0.8, fuzz: 0.5, depth: 0.1 }, // crayon on paper, like Scribble
  sketchbook: { band: 0.8, fuzz: 0.4, depth: 0.1 }, // pencil on paper (finish 0.3 all over)
};

/** The relief map for `look`, or null. */
export function packReliefFor(look: PackLook): string | null {
  const art = packArtFor(look);
  const id = art ? /packs\/([a-z]+)-pack\.webp$/.exec(art)?.[1] : undefined;
  return art && id && RELIEF[id] ? art.replace(/\.webp$/, '-relief.webp') : null;
}

const idOf = (src: string): string => /packs\/([a-z]+)-pack-relief\.webp$/.exec(src)?.[1] ?? '';

/*
 * THE RELIEF TUNER (dev only; owner 2026-11-26: "some are too aggressive. others dont make as much sense. id like to
 * determine which gets normal treatment and which dont"). The Pack Shop lab sets a depth per wrapper (0 = no relief),
 * kept in localStorage and applied live to every bound band. A shipped build never reads it.
 */
const TUNE_KEY = 'ascent.dev.packReliefDepth';
const DEV = import.meta.env.DEV;
let tuned: Record<string, number> | null = null;
function tuning(): Record<string, number> {
  if (tuned) return tuned;
  tuned = {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(TUNE_KEY) ?? '{}');
    if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && RELIEF[k]) tuned[k] = v;
  } catch { /* nothing stored */ }
  return tuned;
}
const MAT_KEY = 'ascent.dev.packReliefMat';
let tunedMat: Record<string, [number, number]> | null = null;
function matTuning(): Record<string, [number, number]> {
  if (tunedMat) return tunedMat;
  tunedMat = {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(MAT_KEY) ?? '{}');
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        if (RELIEF[k] && Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') tunedMat[k] = [v[0], v[1]];
      }
    }
  } catch { /* nothing stored */ }
  return tunedMat;
}
/** The dev bands bound to a relief map, by wrapper id: a depth or material change reaches them at once. */
const bound = new Map<GlossFx, string>();

/** Every wrapper that ships a relief map. */
export const PACK_RELIEF_IDS: readonly string[] = Object.keys(RELIEF);
/** The depth a wrapper ships with. */
export function reliefDefaultDepth(id: string): number { return RELIEF[id]?.depth ?? 0; }
/** The depth a wrapper shows now (the dev tuner's value when one is set). */
export function reliefDepth(id: string): number {
  return (DEV ? tuning()[id] : undefined) ?? reliefDefaultDepth(id);
}
/** Dev tuner: set a wrapper's depth (0 = no relief; null = back to what it ships with). */
export function setReliefDepth(id: string, depth: number | null): void {
  if (!DEV) return;
  const t = tuning();
  if (depth === null) delete t[id]; else t[id] = depth;
  try { localStorage.setItem(TUNE_KEY, JSON.stringify(t)); } catch { /* storage is full or blocked */ }
  const d = reliefDepth(id);
  for (const [g, gid] of bound) {
    if (gid !== id) continue;
    try { g.u.uRelief = d; } catch { bound.delete(g); }
  }
}

/** The band boost and fuzz a wrapper ships with, as [band, fuzz]. */
export function reliefDefaultMat(id: string): [number, number] { const m = RELIEF[id] ?? FOIL; return [m.band, m.fuzz]; }
/** The band boost and fuzz a wrapper shows now (the dev tuner's values when set). */
export function reliefMat(id: string): [number, number] {
  return (DEV ? matTuning()[id] : undefined) ?? reliefDefaultMat(id);
}
/** Dev tuner: set a wrapper's band boost and fuzz (null = back to what it ships with). */
export function setReliefMat(id: string, mat: [number, number] | null): void {
  if (!DEV) return;
  const t = matTuning();
  if (mat === null) delete t[id]; else t[id] = mat;
  try { localStorage.setItem(MAT_KEY, JSON.stringify(t)); } catch { /* storage is full or blocked */ }
  const m = reliefMat(id);
  for (const [g, gid] of bound) {
    if (gid !== id) continue;
    try { const um = g.u.uMat; um[0] = m[0]; um[1] = m[1]; } catch { bound.delete(g); }
  }
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
  if (DEV) bound.delete(gloss);
  if (!src) { set(flatRelief(), 0); return; }
  const id = idOf(src), mat = reliefMat(id);
  try { const um = gloss.u.uMat; um[0] = mat[0]; um[1] = mat[1]; } catch { /* the band was destroyed */ }
  const have = loaded.get(src);
  const bind = (t: Texture): void => { set(t, reliefDepth(id)); if (DEV) bound.set(gloss, id); };
  if (have) { bind(have); return; }
  set(flatRelief(), 0);
  const use = (t: Texture): void => { if (stillWanted()) bind(t); };
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
