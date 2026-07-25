import { Texture, type Renderer } from 'pixi.js';
import { SHAPE_NAMES, SHAPE_UNIT, getShapeTexture, type ShapeName } from './shapeTextures';

/**
 * The runtime registry behind the `shape` param: the six procedurally-drawn built-ins from
 * `shapeTextures.ts` PLUS whatever art the owner has imported (PNG / SVG), persisted to localStorage so an
 * import survives a reload. One selectable list, one id space.
 *
 * ── The one thing that makes this non-obvious: the texture's ALPHA channel is the SILHOUETTE, and that is
 * all it is. `particleMaterial.ts`'s PARTICLE_FRAG uses `tex.a` purely as a mask (a hard discard below 0.04
 * plus a final alpha multiply); the posterized cel bands come from a procedural radial field, not from the
 * alpha. Colour comes from `uPal` + the particle's core-bias tint by default — the imported art's RGB is
 * sampled only in `tintMode: 'texture'` (where it is quantised into `uBands` levels). So:
 *   • art with a real alpha channel is a silhouette already and imports as-is (`alphaFrom: 'alpha'`);
 *   • art that is fully opaque (a white/coloured shape on a solid black background, anything flattened like
 *     a JPEG) has alpha = 1 everywhere and would render as a SOLID RECTANGLE — the #1 expected frustration.
 * `importShapeFromFile` therefore auto-detects that case (>99% fully-opaque pixels, see
 * `shouldTraceLuminance`) and bakes the image's own brightness INTO the alpha channel
 * (`alphaFrom: 'luminance'`), turning shape-on-black into a proper silhouette. An explicit
 * `opts.alphaFrom` always wins over the detection.
 *
 * ── The other constraint: `getShapeTexture` (and therefore this module's lookup) is SYNCHRONOUS — it's
 * called from a primitive's constructor and from `setParams`, both on the render path — while decoding an
 * imported image is inherently async. So imports are PRE-DECODED into a `Texture` cache (at import time, and
 * at rehydration in `initShapeLibrary`), and `getShapeTextureById` falls back to a built-in until the decode
 * lands. A shape id that this browser has never imported (a def shared from another machine) resolves to the
 * same fallback rather than blowing up.
 *
 * Nothing here touches the DOM or localStorage at module scope — every access is inside a function and
 * guarded — so the module stays importable in the headless (node) test environment.
 */

/** A user-imported shape. `dataUrl` is the NORMALIZED PNG (square, fitted, alpha already baked per
 *  `alphaFrom`) — not the raw file — so rehydration is a plain decode with no re-processing. */
export interface ImportedShape {
  /** `custom:<slug>` — namespaced so an import can never collide with a built-in `SHAPE_NAMES` id. */
  id: string;
  /** Display name, derived from the filename. */
  label: string;
  /** The (possibly alpha-baked) PNG data URL the texture is built from. */
  dataUrl: string;
}

/** One row of the `shape` param's picker. */
export interface ShapeOption {
  id: string;
  label: string;
  builtin: boolean;
}

/** How an import's alpha channel is derived. See the module header. */
export type AlphaSource = 'alpha' | 'luminance';

/** The namespace prefix every imported id carries. */
export const CUSTOM_SHAPE_PREFIX = 'custom:';

/** localStorage key — ONE key holding the whole `ImportedShape[]`. Versioned so a future schema change is a
 *  key bump (old imports simply stop loading) rather than a migration. */
const STORAGE_KEY = 'ascent.fx.shapes.v1';

/** Cap on stored imports. Each is a 128px PNG data URL (~10-40 KB), so 24 stays comfortably inside a
 *  typical 5 MB localStorage budget even alongside the rest of the game's saves. Oldest drops out first. */
export const MAX_IMPORTED_SHAPES = 24;

/** Imports are rasterized into a square canvas of this size. `SHAPE_UNIT * 4` (=128) matches the built-ins'
 *  effective resolution (`getShapeTexture` bakes at `SHAPE_UNIT` with `resolution: 2`, and particles are
 *  routinely scaled up past 1) without hardcoding 32 — derived from the shared unit, per that constant's
 *  "one shared unit" contract, so a change there carries through here. */
export const IMPORT_CANVAS_SIZE = SHAPE_UNIT * 4;

/** The built-in every unresolvable id falls back to. `circle` is the softest, least surprising silhouette
 *  and is already the default of two of the three particle primitives. */
export const FALLBACK_SHAPE: ShapeName = 'circle';

/** Above this fraction of fully-opaque pixels an image is treated as "flattened art on a background" and
 *  its alpha is traced from brightness instead. Not 1.0: a single stray semi-transparent pixel (JPEG-ish
 *  ringing, an anti-aliased edge that survived flattening) must not defeat the detection. */
export const OPAQUE_TRACE_THRESHOLD = 0.99;

// ─── pure helpers (unit-testable without a DOM, a canvas, or a WebGL context) ──────────────────────────

/** Rec. 709 luminance of an 8-bit RGB triple, as an 8-bit alpha value. This is the whole "trace opaque art"
 *  trick: a white shape on black becomes alpha 255 on alpha 0. */
export function luminanceAlpha(r: number, g: number, b: number): number {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l < 0 ? 0 : l > 255 ? 255 : Math.round(l);
}

/** Should an image with this fraction of fully-opaque pixels have its alpha traced from brightness? */
export function shouldTraceLuminance(opaqueRatio: number): boolean {
  return opaqueRatio > OPAQUE_TRACE_THRESHOLD;
}

/** Fraction of RGBA pixels in `rgba` whose alpha is 255. */
export function opaqueRatio(rgba: ArrayLike<number>): number {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return 0;
  let opaque = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] === 255) opaque++;
  }
  return opaque / pixels;
}

/** Filename → id slug. Drops the extension, lowercases, and collapses everything that isn't `a-z0-9` into
 *  single dashes, so an id is always URL/JSON/DOM-safe and stable across re-imports of the same file. */
export function slugifyShapeName(filename: string): string {
  const stem = filename.replace(/\.[^./\\]+$/, '');
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'shape' : slug;
}

/** Namespace a slug into a full shape id. */
export function customShapeId(slug: string): string {
  return `${CUSTOM_SHAPE_PREFIX}${slug}`;
}

/** Filename → display label (the stem, extension dropped, whitespace tidied). */
export function labelFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^./\\]+$/, '').trim();
  return stem === '' ? 'Imported shape' : stem;
}

/** Is `id` one of the six procedurally-drawn built-ins? */
export function isBuiltinShapeId(id: string): id is ShapeName {
  return (SHAPE_NAMES as readonly string[]).includes(id);
}

/**
 * Pure render-path resolution: what does `id` actually draw with, given whether its imported texture has
 * finished decoding? Extracted so the fallback rule is testable without a `Renderer` (every alternative
 * needed a live WebGL context). A built-in draws itself; a ready import draws itself; anything else — an
 * unknown id, or an import still decoding — draws `FALLBACK_SHAPE`.
 */
export function resolveShapeSource(
  id: string,
  importedReady: boolean,
): { kind: 'builtin'; name: ShapeName } | { kind: 'imported' } {
  if (isBuiltinShapeId(id)) return { kind: 'builtin', name: id };
  if (importedReady) return { kind: 'imported' };
  return { kind: 'builtin', name: FALLBACK_SHAPE };
}

/** Where to draw a `iw × ih` image inside a `size × size` square, preserving aspect and centring. An image
 *  with no intrinsic size (an SVG with no width/height attributes) falls back to filling the square. */
export function fitRect(iw: number, ih: number, size: number): { x: number; y: number; w: number; h: number } {
  if (!(iw > 0) || !(ih > 0)) return { x: 0, y: 0, w: size, h: size };
  const scale = Math.min(size / iw, size / ih);
  const w = iw * scale;
  const h = ih * scale;
  return { x: (size - w) / 2, y: (size - h) / 2, w, h };
}

/** Shape-check one persisted entry. Malformed entries are DROPPED (repaired by omission), never thrown on:
 *  a corrupted store must not take the workbench down with it. */
function isImportedShape(v: unknown): v is ImportedShape {
  if (v === null || typeof v !== 'object') return false;
  const s = v as Partial<ImportedShape>;
  return (
    typeof s.id === 'string' &&
    s.id.startsWith(CUSTOM_SHAPE_PREFIX) &&
    typeof s.label === 'string' &&
    typeof s.dataUrl === 'string' &&
    s.dataUrl !== ''
  );
}

/** Parse a raw localStorage payload into imports. Pure + exported so the "malformed JSON is ignored, not
 *  thrown" contract is testable without a storage stub. Never throws. */
export function parseStoredShapes(raw: string | null): ImportedShape[] {
  if (raw === null || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isImportedShape).slice(0, MAX_IMPORTED_SHAPES);
  } catch {
    return [];
  }
}

// ─── module state ─────────────────────────────────────────────────────────────────────────────────────

/** Imports, in insertion order (oldest first) — mirrors what's in storage. */
let imported: ImportedShape[] = [];
/** id → decoded Texture. Renderer-agnostic (built from an HTMLImageElement, unlike the built-ins'
 *  `renderer.generateTexture`), so ONE cache serves every renderer. These textures are SHARED by every live
 *  primitive that selected the shape — see `getShapeTextureById` — and are never destroyed here. */
const textureCache = new Map<string, Texture>();
/** In-flight decodes, so a shape referenced by three layers decodes once. */
const decoding = new Map<string, Promise<Texture | null>>();
let hydrated = false;

// ─── storage (every access guarded + try/caught: unavailable or full storage degrades to in-memory) ────

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Some privacy modes throw on merely *touching* the property.
    return null;
  }
}

function readStore(): ImportedShape[] {
  try {
    return parseStoredShapes(storage()?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return [];
  }
}

/** Best-effort persist. A quota error (a big import pushing past the budget) leaves the library working
 *  for this session and simply doesn't survive a reload — never an exception into the caller. */
function writeStore(): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(imported));
  } catch {
    /* ignore — persistence is best-effort */
  }
}

// ─── decoding ─────────────────────────────────────────────────────────────────────────────────────────

/** Decode a data URL into an `<img>`. Works for both PNG and SVG data URLs — an `<img>` rasterizes SVG
 *  natively, which is why there is no SVG-specific branch anywhere in this module. */
async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** Build (and cache) the Texture for an import. Idempotent + de-duplicated; resolves to null in a headless
 *  environment or on a decode failure, in which case the render path keeps using the built-in fallback. */
function ensureTexture(shape: ImportedShape): Promise<Texture | null> {
  const cached = textureCache.get(shape.id);
  if (cached) return Promise.resolve(cached);
  const inFlight = decoding.get(shape.id);
  if (inFlight) return inFlight;
  const job = (async (): Promise<Texture | null> => {
    if (typeof document === 'undefined') return null;
    const img = await loadImage(shape.dataUrl);
    return Texture.from(img);
  })()
    .then((tex) => {
      if (tex) textureCache.set(shape.id, tex);
      decoding.delete(shape.id);
      return tex;
    })
    .catch(() => {
      decoding.delete(shape.id);
      return null;
    });
  decoding.set(shape.id, job);
  return job;
}

// ─── normalization + alpha bake (the key UX fix — see the module header) ──────────────────────────────

/**
 * Rasterize a decoded image into the canonical square, and derive its alpha channel.
 *
 * 1. Fit the image (aspect preserved, centred) into a transparent `IMPORT_CANVAS_SIZE` square. An SVG with
 *    no intrinsic size fills the square instead (see `fitRect`).
 * 2. Pick the alpha source: `opts.alphaFrom` if given, else `'luminance'` when the DRAWN REGION is >99%
 *    fully opaque (`shouldTraceLuminance`) — measuring the drawn region, not the whole canvas, so the
 *    transparent letterbox padding around a non-square image can't dilute the ratio and defeat detection.
 * 3. For `'luminance'`, rewrite every pixel's alpha to its own Rec. 709 brightness. RGB is left untouched
 *    (the shader ignores it), so this is purely "brightness becomes the silhouette".
 * 4. Export as PNG — that data URL is what gets stored and re-decoded, so the bake happens exactly once.
 */
function normalizeImage(
  img: HTMLImageElement,
  explicit?: AlphaSource,
): { dataUrl: string; alphaFrom: AlphaSource } {
  const size = IMPORT_CANVAS_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D canvas context to process the image.');

  const rect = fitRect(img.naturalWidth || img.width, img.naturalHeight || img.height, size);
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);

  let alphaFrom: AlphaSource;
  if (explicit) {
    alphaFrom = explicit;
  } else {
    const rx = Math.max(0, Math.floor(rect.x));
    const ry = Math.max(0, Math.floor(rect.y));
    const rw = Math.max(1, Math.min(size - rx, Math.ceil(rect.w)));
    const rh = Math.max(1, Math.min(size - ry, Math.ceil(rect.h)));
    const region = ctx.getImageData(rx, ry, rw, rh);
    alphaFrom = shouldTraceLuminance(opaqueRatio(region.data)) ? 'luminance' : 'alpha';
  }

  if (alphaFrom === 'luminance') {
    const full = ctx.getImageData(0, 0, size, size);
    const d = full.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i + 3] = luminanceAlpha(d[i], d[i + 1], d[i + 2]);
    }
    ctx.putImageData(full, 0, 0);
  }

  return { dataUrl: canvas.toDataURL('image/png'), alphaFrom };
}

/** File → data URL. Used instead of `URL.createObjectURL` so there is no revoke bookkeeping and the same
 *  code path serves PNG and SVG identically. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('Could not read that file.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

/** First free `custom:<slug>` id, disambiguating a repeat filename with `-2`, `-3`, … so importing a second
 *  `star.png` never silently overwrites the first. */
function uniqueImportId(filename: string): string {
  const slug = slugifyShapeName(filename);
  const taken = new Set(imported.map((s) => s.id));
  let id = customShapeId(slug);
  let n = 2;
  while (taken.has(id)) {
    id = customShapeId(`${slug}-${n}`);
    n++;
  }
  return id;
}

// ─── public API ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Rehydrate persisted imports and kick off their decodes. Idempotent and safe to call from anywhere — every
 * other entry point calls it first, so the library self-initializes on first use (the render path included)
 * without any bootstrap wiring in `player.ts` / `registry.ts`.
 */
export function initShapeLibrary(): void {
  if (hydrated) return;
  hydrated = true; // set BEFORE the decodes so a re-entrant lookup can't loop
  imported = readStore();
  for (const shape of imported) void ensureTexture(shape);
}

/** Every selectable shape right now: the built-ins, then the imports (in import order). */
export function listShapeOptions(): ShapeOption[] {
  initShapeLibrary();
  return [
    ...SHAPE_NAMES.map((name) => ({ id: name, label: name, builtin: true })),
    ...imported.map((s) => ({ id: s.id, label: s.label, builtin: false })),
  ];
}

/** The current imports (a copy — callers can't mutate the registry through it). */
export function listImportedShapes(): ImportedShape[] {
  initShapeLibrary();
  return imported.slice();
}

/**
 * SYNCHRONOUS texture lookup for the primitives' render path — the drop-in replacement for
 * `getShapeTexture(renderer, name)`. Built-ins delegate to that function unchanged (same cache, same
 * baking); imports come from this module's own decoded cache. An unknown id, or an import whose decode is
 * still in flight, returns the `FALLBACK_SHAPE` built-in — never null, never a throw, so a primitive can
 * always construct.
 *
 * The returned texture is SHARED (by every primitive using that shape, and across renderers for imports):
 * a caller must never destroy it — the same rule the primitives' `destroy()` already documents for the
 * built-ins.
 */
export function getShapeTextureById(renderer: Renderer, id: string): Texture {
  initShapeLibrary();
  const cached = textureCache.get(id);
  const source = resolveShapeSource(id, cached !== undefined);
  if (source.kind === 'imported') return cached as Texture;
  return getShapeTexture(renderer, source.name);
}

/**
 * Import raw file bytes as a selectable shape: decode → normalize + bake alpha (see `normalizeImage`) →
 * pre-decode the Texture so the sync lookup can serve it immediately → persist. Resolves with the stored
 * entry (its `id` is what to write into the `shape` param). Rejects with a readable Error on a failure the
 * caller should surface (unreadable file, undecodable image, no canvas).
 */
export async function importShapeFromFile(
  file: File,
  opts?: { alphaFrom?: AlphaSource },
): Promise<ImportedShape> {
  initShapeLibrary();
  if (typeof document === 'undefined') throw new Error('Importing a shape needs a browser environment.');
  const sourceUrl = await readFileAsDataUrl(file);
  let img: HTMLImageElement;
  try {
    img = await loadImage(sourceUrl);
  } catch {
    throw new Error(`Could not decode '${file.name}' — is it a valid PNG or SVG?`);
  }
  const { dataUrl } = normalizeImage(img, opts?.alphaFrom);
  const shape: ImportedShape = { id: uniqueImportId(file.name), label: labelFromFilename(file.name), dataUrl };
  // Decode BEFORE publishing the shape, so the moment the picker selects it the sync lookup already has a
  // real texture (rather than one frame of the fallback circle).
  await ensureTexture(shape);
  imported = [...imported, shape].slice(-MAX_IMPORTED_SHAPES);
  writeStore();
  return shape;
}

/**
 * Forget an imported shape. Its Texture is dropped from the cache but deliberately NOT destroyed: a live
 * `ParticleContainer` may still be bound to it this frame, and destroying a texture out from under one is
 * exactly the failure the primitives' `destroy()` comments warn about. It becomes ordinary garbage once
 * nothing references it. A built-in id is ignored (there is nothing to remove).
 */
export function removeImportedShape(id: string): void {
  initShapeLibrary();
  if (!imported.some((s) => s.id === id)) return;
  imported = imported.filter((s) => s.id !== id);
  textureCache.delete(id);
  decoding.delete(id);
  writeStore();
}

/** Test seam: drop all in-memory AND persisted state, so the next call rehydrates from scratch. */
export function resetShapeLibrary(): void {
  imported = [];
  textureCache.clear();
  decoding.clear();
  hydrated = false;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore — best-effort */
  }
}
