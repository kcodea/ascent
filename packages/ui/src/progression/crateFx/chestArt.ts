/**
 * THE CHEST ART CACHE (tiered chest openings, final review 2026-10-19). Every real opening mounts a FRESH theatre with a
 * fresh Pixi controller, so a per-controller cache meant every theatre fetched and decoded its tier's chest cold, in the
 * middle of the anticipation: ~2 MB of RGBA decode, the keyhole mask's `getImageData` and a lazy GPU upload landing on
 * the frames the player is watching, and a 300 ms race the art could lose on a cold cache. So the PICTURES live here,
 * once per page, and are ready before any Pixi work needs them:
 *  - `preloadChestArt(tier)` starts both layers' fetch and resolves only once each is DECODED (`img.decode()`), with the
 *    keyhole mask already cut. One promise per tier, kept for the page's life; a failed load is dropped, so a later ask
 *    tries again.
 *  - It is called as early as it is cheap: when the Chest Shop's tier is picked, when the Collection bay holds a sealed
 *    tiered chest, at the theatre's mount (its first chest, and every tier in its queue) and at the click.
 *  - `warmChestArt` is that call for the screens: a no-op for Standard (the theatre bakes it at mount), under reduced
 *    motion and where Pixi may not run, since nothing there would ever draw the art.
 * The controller (`crateFxPixi.ts`) turns these pictures into textures, uploads them to the GPU and swaps them in.
 * Standard's two layers come through here too, so a second theatre bakes them without a second decode.
 */
import { CHEST_ART, CHEST_TIER_ART, loadChestImages, type ChestArt } from './chestModel';
import type { ChestTier } from './chestTiers';
import { cutKeyholeMask } from './crateTextures';
import { pixiAllowed } from '../../phoneDiag';
import { publicArt } from '../../phoneArt';

/** One chest's pictures, decoded, and its keyhole's light mask (null when it could not be cut: a round glow only). */
export interface ChestArtImages { body: HTMLImageElement; lid: HTMLImageElement; mask: HTMLCanvasElement | null }

export type ChestImageLoader = (url: string) => Promise<HTMLImageElement>;

/** A tier's art and anchors (Standard is the owner's original chest). */
export const chestArtFor = (tier: ChestTier): ChestArt => (tier === 'standard' ? CHEST_ART : CHEST_TIER_ART[tier]);

/** A chest layer's URL for the opening theatre: public-folder art carries BASE_URL (itch serves from a CDN sub-path).
 *  Always the ORIGINAL file: the theatre's anchors are pixels of the master. */
export const chestArtUrl = (rel: string): string => `${import.meta.env.BASE_URL}${rel}`;

/** A chest layer's URL for the screens' plain-DOM picture (`ChestPicture`): the phone copy on a lite-art phone
 *  (`phonePublicCap`, R-TOUCH-GPU-MEMORY-01), else the original. The picture lays out in percents of the body's width,
 *  so a smaller copy composes the same. */
export const chestPictureUrl = (rel: string): string => publicArt(rel);

/**
 * Load one picture and resolve only once it is decoded, so drawing it later never decodes on the main thread. A browser
 * without `decode()` falls back to `onload`. A decode that rejects on a picture that did load (some browsers reject a
 * decode they could not schedule) still resolves; a broken picture rejects.
 */
export function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    const fail = (): void => reject(new Error(`could not load ${url}`));
    if (typeof im.decode !== 'function') {
      im.onload = () => resolve(im);
      im.onerror = fail;
      im.src = url;
      return;
    }
    im.src = url;
    im.decode().then(() => resolve(im), () => (im.complete && im.naturalWidth > 0 ? resolve(im) : fail()));
  });
}

let loader: ChestImageLoader = decodeImage;
const cache = new Map<ChestTier, Promise<ChestArtImages | null>>();

async function fetchChestArt(tier: ChestTier, load: ChestImageLoader): Promise<ChestArtImages | null> {
  const art = chestArtFor(tier);
  const imgs = await loadChestImages(chestArtUrl(''), load, art);
  if (!imgs) return null;
  let mask: HTMLCanvasElement | null = null;
  try { mask = cutKeyholeMask(imgs.body, art.bodySrcW, art.keyhole); } catch { mask = null; }
  return { body: imgs.body, lid: imgs.lid, mask };
}

/**
 * A tier's chest pictures, fetched and decoded once per page (see the header). Resolves null when either layer fails,
 * never rejects. `load` (tests only) bypasses the cache with a loader of its own.
 */
export function preloadChestArt(tier: ChestTier, load?: ChestImageLoader): Promise<ChestArtImages | null> {
  if (load) return fetchChestArt(tier, load);
  const have = cache.get(tier);
  if (have) return have;
  const p = fetchChestArt(tier, loader);
  cache.set(tier, p);
  void p.then((v) => { if (!v && cache.get(tier) === p) cache.delete(tier); });
  return p;
}

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** The screens' early preload (the shop's tier pick, the bay's sealed chests): only where the art could ever be drawn. */
export function warmChestArt(tier: ChestTier | undefined): void {
  if (!tier || tier === 'standard' || reducedMotion() || !pixiAllowed()) return;
  void preloadChestArt(tier);
}

/** Tests: swap the picture loader (null = the real one) and forget every cached tier. */
export function setChestArtLoaderForTests(f: ChestImageLoader | null): void {
  loader = f ?? decodeImage;
  cache.clear();
}
