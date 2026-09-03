/// <reference types="vite/client" />
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
 * ── There are therefore TWO namespaces of non-builtin art, and the difference is where the bytes live:
 *   • `custom:<slug>` — imported on THIS machine, PNG bytes in localStorage. Doesn't travel.
 *   • `art:<slug>`    — COMMITTED to `fx/defs/art/<slug>.png` and loaded by a build-time glob. Travels with
 *     the repo, so a def shared with the other developer renders what its author saw. The workbench's Save
 *     flow is what promotes a `custom:` import to an `art:` reference (it uploads the data URL — see
 *     `getImportedDataUrl` — via `defStore.saveArt`).
 * Both resolve through the same texture cache and the same "fall back to a built-in until ready" rule.
 *
 * ── The trap in that second namespace, and the OVERLAY that closes it: the glob is a build-time expansion,
 * so a PNG written by this session's own Save is invisible to it until the dev server restarts — and the Save
 * has already rewritten the layer to `art:<slug>`, so a reload rendered the fallback circle and the effect
 * "vanished". `registerSavedArt` records a pointer (never a copy) to the local import the art was promoted
 * from, so the id keeps resolving across the reload; see that function and `pruneArtAliases`.
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

/** One row of the `shape` param's picker. A row's KIND is readable from its id — a bare `SHAPE_NAMES` entry
 *  is a built-in, `custom:` is a local-only import, `art:` is committed (see `isArtShapeId`) — so this stays
 *  the same three fields it always was. */
export interface ShapeOption {
  id: string;
  label: string;
  builtin: boolean;
}

/** How an import's alpha channel is derived. See the module header. */
export type AlphaSource = 'alpha' | 'luminance';

/** The namespace prefix every imported id carries. */
export const CUSTOM_SHAPE_PREFIX = 'custom:';

/** The namespace prefix every COMMITTED (`fx/defs/art/<slug>.png`) id carries. */
export const ART_SHAPE_PREFIX = 'art:';

/** localStorage key — ONE key holding the whole `ImportedShape[]`. Versioned so a future schema change is a
 *  key bump (old imports simply stop loading) rather than a migration. */
const STORAGE_KEY = 'ascent.fx.shapes.v1';

/** localStorage key for the committed-art OVERLAY (see `ArtAlias` / `registerSavedArt`). Its own key rather
 *  than a field on the imports array, so a schema change to either is an independent key bump. */
const ART_ALIAS_KEY = 'ascent.fx.art.v1';

/** Cap on stored imports. Each is a 128px PNG data URL (~10-40 KB), so 24 stays comfortably inside a
 *  typical 5 MB localStorage budget even alongside the rest of the game's saves. Oldest drops out first. */
export const MAX_IMPORTED_SHAPES = 24;

/** Cap on the committed-art overlay (`ArtAlias[]`). Each entry is two short strings — a few dozen bytes, not
 *  a second copy of the PNG (see `ArtAlias`) — so the cap exists purely so the list cannot grow without
 *  bound across sessions, not because the bytes are expensive. Oldest drops out first, exactly as the imports
 *  array does. Entries are ALSO pruned on every hydration (see `readAliases`), so in practice the list holds
 *  only art committed since the dev server last restarted. */
export const MAX_ART_ALIASES = 24;

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

/** Namespace a slug into a full COMMITTED shape id. */
export function artShapeId(slug: string): string {
  return `${ART_SHAPE_PREFIX}${slug}`;
}

/** Is `id` a committed-art reference? */
export function isArtShapeId(id: string): boolean {
  return id.startsWith(ART_SHAPE_PREFIX);
}

/** `art:ember` → `ember`. Returns `''` for anything that isn't an `art:` id. */
export function artSlugOf(id: string): string {
  return isArtShapeId(id) ? id.slice(ART_SHAPE_PREFIX.length) : '';
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

/**
 * One entry of the committed-art OVERLAY: "`defs/art/<slug>.png` exists on disk, and the bytes are the ones
 * already stored under this machine's `<sourceId>` import."
 *
 * A POINTER, never a second copy of the PNG. Committing art is always a promotion of an import this browser
 * already holds (`Workbench.uploadArtRefs` reads `getImportedDataUrl` and posts it), so the bytes are in
 * `STORAGE_KEY` already; duplicating them would double the library's localStorage cost for nothing and put a
 * quota failure between the author and their own art.
 */
export interface ArtAlias {
  /** The committed slug — `coin` for `defs/art/coin.png`, resolved as the id `art:coin`. */
  slug: string;
  /** The `custom:<slug>` import whose `dataUrl` this alias borrows. */
  sourceId: string;
}

function isArtAlias(v: unknown): v is ArtAlias {
  if (v === null || typeof v !== 'object') return false;
  const a = v as Partial<ArtAlias>;
  return (
    typeof a.slug === 'string' &&
    a.slug !== '' &&
    typeof a.sourceId === 'string' &&
    a.sourceId.startsWith(CUSTOM_SHAPE_PREFIX)
  );
}

/** Parse a raw localStorage payload into art aliases. Same total, never-throws contract as
 *  `parseStoredShapes` — a corrupted overlay costs you the overlay, never the workbench. */
export function parseStoredArtAliases(raw: string | null): ArtAlias[] {
  if (raw === null || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isArtAlias).slice(0, MAX_ART_ALIASES);
  } catch {
    return [];
  }
}

/**
 * Which aliases are still worth keeping, given what the glob can see and what is still imported here.
 *
 * PURE, and the whole "must not silently grow without bound" answer. Two independent reasons to drop one, and
 * both are permanent — an alias never becomes useful again once either fires:
 *   • **Redundant.** `committedSlugs` (the build-time glob) has caught up with the file, so `art:<slug>`
 *     resolves from the bundle. This is the normal end of an alias's life: it survives exactly until the dev
 *     server next restarts, and is then swept on the following hydration.
 *   • **Dangling.** The import it points at is gone (removed, or aged out of the 24-import cap), so there are
 *     no bytes to serve and the id falls back to a built-in either way.
 * Later entries win a duplicate slug, so a re-commit of the same name replaces rather than accumulates.
 */
export function pruneArtAliases(
  aliases: readonly ArtAlias[],
  committedSlugs: ReadonlySet<string>,
  importedIds: ReadonlySet<string>,
): ArtAlias[] {
  const bySlug = new Map<string, ArtAlias>();
  for (const a of aliases) {
    if (committedSlugs.has(a.slug)) continue;
    if (!importedIds.has(a.sourceId)) continue;
    bySlug.set(a.slug, a);
  }
  return [...bySlug.values()].slice(-MAX_ART_ALIASES);
}

// ─── module state ─────────────────────────────────────────────────────────────────────────────────────

/** Imports, in insertion order (oldest first) — mirrors what's in storage. */
let imported: ImportedShape[] = [];
/** The committed-art overlay, pruned at hydration — mirrors what's in storage. See `ArtAlias`. */
let artAliases: ArtAlias[] = [];
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

function readAliasStore(): ArtAlias[] {
  try {
    return parseStoredArtAliases(storage()?.getItem(ART_ALIAS_KEY) ?? null);
  } catch {
    return [];
  }
}

/** Same best-effort contract as `writeStore`. */
function writeAliasStore(): void {
  try {
    storage()?.setItem(ART_ALIAS_KEY, JSON.stringify(artAliases));
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

// ─── committed art (`fx/defs/art/*.png`, resolved by an `art:<slug>` id) ──────────────────────────────

/**
 * slug → bundled URL for every committed PNG. This glob SHIPS (un-gated 2026-08-17): a committed
 * `fx/defs/art/<slug>.png` is bundled for players, so a def referencing `art:<slug>` renders the real art
 * instead of a procedural fallback — the same promise `fxDefs.ts` makes for committed JSON defs. This is what
 * lets the coin FX (`art:group-14035`), the ruby/shop-buff FX (`art:gemshard`), and `ale-bubbles`
 * (`art:bubble`) reach the shipped game.
 *
 * THE POLICY THAT KEEPS THE BUNDLE HONEST: this folder is also where the workbench's art IMPORT writes, so it
 * accumulates whatever an author drops in during a session. The glob bundles every PNG on disk at build time —
 * so **only commit a PNG here that is meant to ship.** Uncommitted scratch imports stay local (CI builds from
 * committed files only, so they never reach players); a committed PNG is a shipped asset, reviewed in its PR
 * like card art. `docs/fx-workbench-guide.md` documents this; `prodPlayback.test.ts` pins that committed art
 * resolves with `DEV` false.
 *
 * `import.meta.glob` is a Vite TRANSFORM, not a runtime function — the call is replaced at transform time,
 * which is why its options must be an inline literal. That also holds under Vitest (it runs source through
 * Vite), so the committed-art path is exercised by the test suite. The `try` covers any OTHER loader (a
 * plain node/tsx import), where the untransformed call would throw: there it degrades to "no committed art",
 * i.e. exactly the existing fallback behaviour.
 */
function artModules(): Record<string, string> {
  try {
    return import.meta.glob('./defs/art/*.png', { eager: true, query: '?url', import: 'default' }) as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

let artIndexCache: Map<string, string> | null = null;

function artIndex(): Map<string, string> {
  if (artIndexCache) return artIndexCache;
  const out = new Map<string, string>();
  for (const [p, url] of Object.entries(artModules())) {
    const slug = p.split('/').pop()?.replace(/\.png$/, '') ?? '';
    if (slug !== '') out.set(slug, url);
  }
  artIndexCache = out;
  return out;
}

/**
 * The bytes an `art:<slug>` id should decode from, or `null` if nothing here knows about it.
 *
 * TWO sources, glob first: the bundled URL when the build-time glob can see the file, otherwise the OVERLAY —
 * an `ArtAlias` pointing at the local import the art was promoted from. The order matters and is the same
 * precedence `pruneArtAliases` encodes: once the glob has caught up, the committed file is the authority and
 * the alias is swept.
 */
function artSourceUrl(slug: string): string | null {
  const bundled = artIndex().get(slug);
  if (bundled !== undefined) return bundled;
  const alias = artAliases.find((a) => a.slug === slug);
  if (alias === undefined) return null;
  return imported.find((s) => s.id === alias.sourceId)?.dataUrl ?? null;
}

/** Kick off (once) the decode for a committed `art:<slug>` id. A slug neither the glob nor the overlay knows
 *  is a no-op — the render path keeps using the built-in fallback, which is exactly what a def referencing
 *  art that was never committed should do. */
function ensureArtTexture(id: string): void {
  if (textureCache.has(id) || decoding.has(id)) return;
  const slug = artSlugOf(id);
  const url = artSourceUrl(slug);
  if (url === null) return;
  // Reuses the import decode path verbatim — an `<img>` doesn't care whether its src is a data URL or a
  // bundled file URL, so one cache and one fallback rule serve both namespaces.
  void ensureTexture({ id, label: slug, dataUrl: url });
}

/** Every art slug that resolves right now, sorted: the ones the build-time glob can see, PLUS the ones only
 *  the overlay knows about (committed since the dev server last started — see `registerSavedArt`). */
/**
 * BOOT WARM-UP: hydrate the library and resolve once every imported / committed-art texture has decoded, with
 * the decoded textures — the boot loader then uploads each to every live renderer (`warmFx` in playDef.ts),
 * so the first def that draws `art:<slug>` never pays the decode OR the GPU upload on its first frame.
 */
export async function awaitShapeTextures(timeoutMs = 4000): Promise<Texture[]> {
  initShapeLibrary();
  // Bounded: `img.decode()` can stall indefinitely in a hidden/throttled tab (the same trap art.ts guards
  // against), and a stalled decode must not hold the boot — whatever HAS decoded by then gets uploaded, and
  // the rest uploads on its first draw, as before.
  await Promise.race([Promise.all([...decoding.values()]), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
  return [...textureCache.values()];
}

export function listCommittedArt(): string[] {
  // Self-initializing like every other entry point (see `initShapeLibrary`) — the overlay half of the answer
  // lives in hydrated state, so reading this before hydration would report only the globbed slugs. Re-entrant
  // from `initShapeLibrary` itself, which is safe: `hydrated` is set before the call.
  initShapeLibrary();
  const slugs = new Set(artIndex().keys());
  for (const a of artAliases) slugs.add(a.slug);
  return [...slugs].sort((a, b) => a.localeCompare(b));
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
  // Prune the overlay against what this build's glob can now see and what is still imported (see
  // `pruneArtAliases`), and write the pruned list straight back — that sweep is what keeps the stored list
  // from growing across sessions. Deliberately BEFORE the decodes, so a dangling alias never starts one.
  const before = readAliasStore();
  artAliases = pruneArtAliases(before, new Set(artIndex().keys()), new Set(imported.map((s) => s.id)));
  if (artAliases.length !== before.length) writeAliasStore();
  for (const shape of imported) void ensureTexture(shape);
  // Committed art is decoded up front too (there are only ever a handful of files, and they're already in
  // the bundle) so a def that references `art:<slug>` doesn't render one frame of the fallback circle. The
  // overlay's slugs are in `listCommittedArt()` alongside the globbed ones, so this covers both.
  for (const slug of listCommittedArt()) ensureArtTexture(artShapeId(slug));
}

/**
 * Record that `defs/art/<slug>.png` was just written from the import `sourceId`, so `art:<slug>` resolves
 * NOW and STILL RESOLVES after a reload.
 *
 * This is `fxDefs.ts`'s `registerSavedDef` for art, and it exists for the same reason: `artModules()`'s
 * `import.meta.glob` is a Vite TRANSFORM, expanded when this module was last transformed, so a PNG written
 * seconds ago is invisible to it. That is the bug the owner hit — import a coin, tune, Save, reload, and the
 * effect renders a fallback circle, because Save rewrites the layer's `custom:coin` to `art:coin` and nothing
 * on the far side of the reload can resolve that id.
 *
 * Where it DIFFERS from `registerSavedDef`, and why it is not just an in-memory Map:
 *   • A def only has to survive to the next reload — `fxDefsPlugin` invalidates the glob owner and reloads on
 *     `add`, so the reloaded page's glob has the file. This module's glob is now invalidated the same way (see
 *     the art watcher in `apps/web/fxDefsPlugin.ts`), which is what genuinely closes the loop; the overlay is
 *     the belt to that braces, covering a write the watcher never saw and any ordering where the reload
 *     outruns the invalidation.
 *   • A PNG is BINARY and its decode is ASYNC, while the lookup on the render path is synchronous. So this
 *     both starts the decode immediately (closing the in-session gap: previewing a def straight out of the
 *     library after Save used to draw the fallback) and persists a POINTER for the next session to re-decode
 *     from — never a second copy of the bytes. See `ArtAlias`.
 *
 * Total: an unusable slug/source is ignored rather than thrown on, and a storage failure costs the overlay,
 * not the save.
 */
export function registerSavedArt(slug: string, sourceId: string): void {
  initShapeLibrary();
  if (slug === '' || !sourceId.startsWith(CUSTOM_SHAPE_PREFIX)) return;
  if (!imported.some((s) => s.id === sourceId)) return;
  artAliases = [...artAliases.filter((a) => a.slug !== slug), { slug, sourceId }].slice(-MAX_ART_ALIASES);
  writeAliasStore();
  ensureArtTexture(artShapeId(slug));
}

/** Every selectable shape right now: the built-ins, then this machine's imports (in import order), then the
 *  committed art. Committed rows are labelled so they're distinguishable from a local-only import — the
 *  difference matters (only a committed one travels to the other developer). */
export function listShapeOptions(): ShapeOption[] {
  initShapeLibrary();
  return [
    ...SHAPE_NAMES.map((name) => ({ id: name, label: name, builtin: true })),
    ...imported.map((s) => ({ id: s.id, label: s.label, builtin: false })),
    ...listCommittedArt().map((slug) => ({ id: artShapeId(slug), label: `${slug} (committed)`, builtin: false })),
  ];
}

/** The current imports (a copy — callers can't mutate the registry through it). */
export function listImportedShapes(): ImportedShape[] {
  initShapeLibrary();
  return imported.slice();
}

/**
 * The stored PNG data URL behind a `custom:` id, or `null` for anything else (a built-in, an `art:` id, an
 * id this machine never imported). This is the seam the Save flow needs: to promote a def's local-only
 * `custom:<slug>` shape into a committed `art:<slug>`, it has to get the actual bytes out of the library.
 */
export function getImportedDataUrl(id: string): string | null {
  initShapeLibrary();
  return imported.find((s) => s.id === id)?.dataUrl ?? null;
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
  // A committed id may be referenced by a def that was loaded after init (or after a `refreshDefs`), so its
  // decode is kicked off here as well as at init. Idempotent — two Map lookups once the texture is cached.
  if (isArtShapeId(id)) ensureArtTexture(id);
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
  // Any overlay entry borrowing this import's bytes is now dangling (see `pruneArtAliases`) — drop it here
  // too rather than leaving it for the next hydration to sweep, so the picker stops offering a row that can
  // only ever draw the fallback. An already-decoded `art:` texture is deliberately left alone: it is live
  // this frame, exactly as the import's own texture is.
  const kept = artAliases.filter((a) => a.sourceId !== id);
  if (kept.length !== artAliases.length) {
    artAliases = kept;
    writeAliasStore();
  }
}

/** Test seam: drop all in-memory AND persisted state, so the next call rehydrates from scratch. */
export function resetShapeLibrary(): void {
  imported = [];
  artAliases = [];
  textureCache.clear();
  decoding.clear();
  artIndexCache = null;
  hydrated = false;
  try {
    storage()?.removeItem(STORAGE_KEY);
    storage()?.removeItem(ART_ALIAS_KEY);
  } catch {
    /* ignore — best-effort */
  }
}
