/// <reference types="vite/client" />
import { Texture } from 'pixi.js';
import { isValidSlug, saveImage, slugify } from './defStore';

/**
 * The registry behind the `image` param: full-colour, display-resolution images for the `custom` primitive.
 *
 * Deliberately SEPARATE from `shapeLibrary.ts`. That module bakes imports to a 128 px square silhouette for
 * particles (alpha = mask, RGB discarded or cel-quantised) — right for a burst, wrong for a picture. This one
 * keeps the image as the author drew it: true RGBA, fitted within `IMAGE_MAX_PX` on its longest side, never
 * upscaled. The owner chose isolation over generalising the particle pipeline, so nothing there changes.
 *
 * ── Where the bytes live: ON DISK, from the moment of import. `importImageFromFile` posts the PNG to the
 * dev plugin (`/__fx/image` → `defs/images/<slug>.png`) and the id is `image:<slug>` immediately. There is no
 * local-only tier and no promote-on-Save step: a 1024 px PNG can't fit localStorage's ~5 MB budget, and a
 * def should reference the committed file it will ship with. Committed images are bundled by the glob below,
 * exactly like `defs/art/` — so ONLY COMMIT AN IMAGE MEANT TO SHIP.
 *
 * ── The glob is a Vite TRANSFORM (frozen when this module was last transformed), so a PNG written seconds
 * ago is invisible to it — and, measured 2026-09-12, a new glob-matched file makes Vite force a PAGE RELOAD,
 * which for an import (written mid-edit, not by Save) would yank the page away and could even race the
 * Inspector's state update. So `fxDefsPlugin` hides `defs/images/` from the watcher altogether, and three
 * belts cover the frozen glob instead: (1) `registerSavedImage` overlays the just-imported data URL for this
 * session; (2) the imported SLUGS (never bytes) persist in localStorage so the picker still lists them after a
 * reload; (3) a DEV-only `import.meta.url`-relative URL resolves any slug the frozen glob can't — the file is
 * still served, only the watcher is silenced. A dev-server restart lets the glob catch up and the persisted
 * list dedupes against it. Every path lands in one texture cache; the render-path lookup is SYNCHRONOUS and
 * returns `null` until a decode lands, so a primitive can always construct and simply appears when ready.
 *
 * Nothing touches the DOM at module scope, so this stays importable in the headless (node) test environment.
 */

/** The one id namespace: `image:<slug>` ⇔ `defs/images/<slug>.png`. */
export const IMAGE_ID_PREFIX = 'image:';
/** "No image picked" — a legal `image` param value (a fresh layer has nothing chosen yet). */
export const IMAGE_NONE = '';
/** Longest side an import is fitted within. Sized for the biggest case (a screen-scale splash). */
export const IMAGE_MAX_PX = 1024;

export interface ImageOption {
  id: string;
  label: string;
}

export function imageId(slug: string): string {
  return `${IMAGE_ID_PREFIX}${slug}`;
}

export function isImageId(id: string): boolean {
  return id.startsWith(IMAGE_ID_PREFIX) && id.length > IMAGE_ID_PREFIX.length;
}

/** `image:coin` → `coin`; anything else → `''`. */
export function imageSlugOf(id: string): string {
  return isImageId(id) ? id.slice(IMAGE_ID_PREFIX.length) : '';
}

/** Fit `iw × ih` within `max` on the longest side, aspect preserved, NEVER upscaling. Degenerate input is
 *  clamped to 1 px so a caller can always allocate a canvas. */
export function fitWithin(iw: number, ih: number, max: number): { w: number; h: number } {
  const w = Math.max(1, Math.round(iw));
  const h = Math.max(1, Math.round(ih));
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h };
  const k = max / longest;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** `Coin Flip.png` → `Coin Flip` (the extension only — the slug is derived from this). */
export function labelFromFilename(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '');
  return stem === '' ? name : stem;
}

// ─── committed images (`fx/defs/images/*.png`, resolved by an `image:<slug>` id) ───────────────────────

/** slug → bundled URL for every committed PNG. SHIPS: a committed `defs/images/<slug>.png` is bundled for
 *  players. `import.meta.glob` is a transform-time expansion, so its options must be an inline literal; the
 *  `try` covers a loader that never transforms it (a plain node import), where it degrades to "no images". */
function imageModules(): Record<string, string> {
  try {
    return import.meta.glob('./defs/images/*.png', { eager: true, query: '?url', import: 'default' }) as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

let indexCache: Map<string, string> | null = null;

function globIndex(): Map<string, string> {
  if (indexCache) return indexCache;
  const out = new Map<string, string>();
  for (const [p, url] of Object.entries(imageModules())) {
    const slug = p.split('/').pop()?.replace(/\.png$/, '') ?? '';
    if (slug !== '') out.set(slug, url);
  }
  indexCache = out;
  return out;
}

/** This session's imports (slug → PNG data URL), covering the window before the glob has been re-expanded. */
const overlay = new Map<string, string>();

/** Slugs imported on this machine that the frozen glob may not list yet — persisted so a reload keeps them
 *  in the picker. Slugs only, never bytes (those are on disk); a stale one simply resolves to nothing. */
const STORE_KEY = 'fx.images.v1';
let persisted: string[] | null = null;

function readPersisted(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORE_KEY);
    const v: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s !== '') : [];
  } catch {
    return [];
  }
}

function persistedSlugs(): string[] {
  if (persisted === null) persisted = readPersisted();
  return persisted;
}

function rememberSlug(slug: string): void {
  if (persistedSlugs().includes(slug)) return;
  persisted = [...persistedSlugs(), slug];
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(persisted));
  } catch {
    // A blocked/full store costs the post-reload listing, never the import itself.
  }
}

/** DEV only: a URL the dev server can serve for a file the frozen glob can't see. Production bundles resolve
 *  through the glob alone — an unknown id there is genuinely absent and must stay `null`. */
function devUrl(slug: string): string | null {
  try {
    if (!import.meta.env?.DEV) return null;
    return new URL(`./defs/images/${slug}.png`, import.meta.url).href;
  } catch {
    return null;
  }
}

/** The URL (or data URL) an `image:` id decodes from, or `null` for anything unresolvable. Also what the
 *  workbench thumbnails. */
export function imageUrlFor(id: string): string | null {
  const slug = imageSlugOf(id);
  if (slug === '') return null;
  return overlay.get(slug) ?? globIndex().get(slug) ?? devUrl(slug);
}

/** Every slug the build can see, plus this session's imports, plus this machine's remembered imports —
 *  sorted, de-duplicated. */
export function listCommittedImages(): string[] {
  return [...new Set([...globIndex().keys(), ...overlay.keys(), ...persistedSlugs()])].sort();
}

/** Every selectable image right now, as picker rows. */
export function listImageOptions(): ImageOption[] {
  return listCommittedImages().map((slug) => ({ id: imageId(slug), label: slug }));
}

// ─── decoding ─────────────────────────────────────────────────────────────────────────────────────────

const textureCache = new Map<string, Texture>();
const decoding = new Map<string, Promise<Texture | null>>();

/** Decode a URL or data URL into an `<img>`. Works for PNG and SVG alike — an `<img>` rasterises SVG
 *  natively, which is why there is no SVG-specific branch anywhere in this module. */
async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** Build (and cache) the Texture for an id. Idempotent + de-duplicated; resolves to `null` headless, on an
 *  unresolvable id, or on a decode failure — the render path just keeps waiting / drawing nothing. */
function ensureImageTexture(id: string): Promise<Texture | null> {
  const cached = textureCache.get(id);
  if (cached) return Promise.resolve(cached);
  const inFlight = decoding.get(id);
  if (inFlight) return inFlight;
  const job = (async (): Promise<Texture | null> => {
    if (typeof document === 'undefined') return null;
    const src = imageUrlFor(id);
    if (src === null) return null;
    const img = await loadImage(src);
    return Texture.from(img);
  })()
    .then((tex) => {
      if (tex) textureCache.set(id, tex);
      decoding.delete(id);
      return tex;
    })
    .catch(() => {
      decoding.delete(id);
      return null;
    });
  decoding.set(id, job);
  return job;
}

let hydrated = false;

/** Kick off decodes for every committed image so a def referencing one doesn't draw a blank first frame. */
export function initImageLibrary(): void {
  if (hydrated) return;
  hydrated = true; // set BEFORE the decodes so a re-entrant lookup can't loop
  for (const slug of globIndex().keys()) void ensureImageTexture(imageId(slug));
}

/**
 * SYNCHRONOUS lookup for the render path. `null` until the decode lands (or forever, for an id nothing can
 * resolve) — never a throw, so a primitive can always construct and simply appears when the texture is ready.
 * The returned texture is SHARED across every instance using that image: a caller must never destroy it.
 */
export function getImageTexture(id: string): Texture | null {
  if (!isImageId(id)) return null;
  initImageLibrary();
  const cached = textureCache.get(id);
  if (cached) return cached;
  void ensureImageTexture(id);
  return null;
}

/** Record that `defs/images/<slug>.png` was just written from `dataUrl`, so `image:<slug>` resolves NOW
 *  (the glob is frozen — see the module header) and any stale texture for a re-imported slug is dropped. */
export function registerSavedImage(slug: string, dataUrl: string): void {
  if (slug === '' || dataUrl === '') return;
  overlay.set(slug, dataUrl);
  rememberSlug(slug);
  textureCache.delete(imageId(slug));
  void ensureImageTexture(imageId(slug));
}

// ─── import ───────────────────────────────────────────────────────────────────────────────────────────

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Import a PNG or SVG as a selectable image: decode → fit within `IMAGE_MAX_PX` (aspect preserved, never
 * upscaled) → write it to `defs/images/<slug>.png` through the dev plugin → overlay it for this session.
 * A PNG that already fits is sent BYTE-FOR-BYTE (no canvas re-encode, which can inflate a well-optimised
 * file); anything resized, and every SVG, is rasterised through a canvas. Resolves with the picker row (its
 * `id` is what to write into the `image` param); rejects with a readable Error the caller should surface.
 */
export async function importImageFromFile(file: File): Promise<ImageOption> {
  if (typeof document === 'undefined') throw new Error('Importing an image needs a browser environment.');
  const name = file.name;
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(name);
  const isPng = file.type === 'image/png' || /\.png$/i.test(name);
  if (!isSvg && !isPng) throw new Error('Only PNG or SVG files can be imported.');
  const slug = slugify(labelFromFilename(name));
  if (!isValidSlug(slug)) throw new Error(`'${name}' doesn't make a usable name (letters, digits and dashes).`);

  const raw = await readAsDataUrl(file);
  const img = await loadImage(raw);
  let iw = img.naturalWidth;
  let ih = img.naturalHeight;
  // An SVG with no intrinsic size decodes as 0×0 — give it the full square so it still rasterises.
  if (!(iw > 0 && ih > 0)) { iw = IMAGE_MAX_PX; ih = IMAGE_MAX_PX; }
  const { w, h } = fitWithin(iw, ih, IMAGE_MAX_PX);

  let dataUrl: string;
  if (isPng && w === iw && h === ih && raw.startsWith(PNG_DATA_URL_PREFIX)) {
    dataUrl = raw;
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas available to rasterise the image.');
    ctx.drawImage(img, 0, 0, w, h);
    dataUrl = canvas.toDataURL('image/png');
  }

  const saved = await saveImage(slug, dataUrl);
  if (!saved.ok) throw new Error(saved.error);
  registerSavedImage(slug, dataUrl);
  return { id: imageId(slug), label: slug };
}
