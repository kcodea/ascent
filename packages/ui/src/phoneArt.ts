/**
 * PHONE ART — the lighter way a phone loads and holds the game's art (owner 2026-10-18: "the iPhone crashes a lot").
 *
 * The desktop contract is "load everything, no pop-in" (Boot.tsx, owner 2026-09-30): the splash waits for every
 * image a session can show, and the preloader keeps every decoded image alive for the session. On an iPhone that is
 * ~1.1 GB of decoded art plus an 83 s first load, and iOS kills the tab (or the Home Screen app) far below that. The
 * owner approved relaxing the rule ON PHONES / TOUCH ONLY. This module is the one switch for that ("lite art"):
 *
 *   1. WHO IS A PHONE (`detectLiteArt`): an iOS device (iPhone / iPod / iPad, including iPadOS that reports a desktop
 *      Mac UA but has a touch screen), OR a coarse pointer on a small screen (shorter side under 600 CSS px: phones,
 *      not tablets or touch laptops). `?art=lite|full` or `localStorage['ascent.artMode']` overrides it for testing.
 *   2. SMALLER FILES (`phoneAssetUrl` / `phonePublicUrl`): the production build writes a downscaled copy of the big
 *      art beside the original (`apps/web/phoneArtPlugin.ts`): card / minion / spell / rune art at 256 px, heroes and
 *      skins at 384, card frames and shop buttons at 512, the two 3840 px boards at 1920. On a lite device the art
 *      lookups return the copy; desktop never sees it. The build bakes the exact list of copies it wrote
 *      (`__PHONE_ART__`), so a lookup can only ever point at a file that exists.
 *   3. LESS HELD (`artPreload.ts`): a lite device keeps a bounded LRU of decoded images instead of all of them.
 *   4. A SHORTER GATE (`preloadPlan.ts` / `Boot.tsx`): only the title + menu art gates the splash; the rest streams
 *      in the background, hero select and the run's shop first.
 */

/** The build's list of phone copies (null in dev and tests: no copies exist, every lookup is the original). */
export interface PhoneArtManifest {
  /** Folder under `assets/` (hashed art) and under the site root (public art) that holds the copies. */
  dir: string;
  /** Source paths of bundled art that HAVE a copy, relative to `packages/ui/src/` (`art/minions/whelp.webp`). */
  assets: string[];
  /** Public paths that have a copy, relative to the site root (`frames/oval-beast.webp`). */
  public: string[];
}
declare const __PHONE_ART__: PhoneArtManifest | null | undefined;

/** Bump when a cap below changes: the copies keep their original's hashed name, so the folder must change instead. */
export const PHONE_ART_VERSION = 1;
export const PHONE_ART_DIR = `m${PHONE_ART_VERSION}`;

/** Longest side (px) of the phone copy of bundled art, by its folder under `packages/ui/src/art/`. A folder not listed
 *  gets no copy. Card art is drawn at about 150-330 device px on a phone (the shop card to the hover preview). */
export const PHONE_ASSET_CAPS: Readonly<Record<string, number>> = {
  minions: 256, spells: 256, runes: 256, equipment: 256, quests: 256, powers: 256, ranks: 256,
  heroes: 384, skins: 384, ancients: 384,
  modes: 1024, // the title's mode tiles: drawn far larger than a card
};

/** Longest side (px) of the phone copy of a PUBLIC image, or null for none. Only images every reference to which
 *  goes through `phonePublicUrl` belong here (the build also drops any file a stylesheet names, see the plugin). */
export function phonePublicCap(rel: string): number | null {
  if (rel === 'playingboard.webp' || rel === 'playingboard-combat.webp') return 1920;
  // The menu backdrop plates (1920 x 1080 masters, drawn behind every menu): about a phone screen's own width
  // (R-TOUCH-GPU-MEMORY-01). `hall-dim` is already 960 wide and a stylesheet names it.
  if (rel === 'backdrops/hall-soft.webp' || rel === 'backdrops/hall.webp') return 1280;
  // The return trip's vista on a phone (owner 2026-10-24: "Phone-sized return-trip images: yea send em"): the one
  // flattened picture, a 2560 x 1440 master decoded on Shop mount and held for the run. About a phone screen's width;
  // a CSS custom property `applyPhoneCssArt` re-points. (The door's cut-out was a second one until 2026-10-25: it is a
  // vector clip now, vistaDoor.ts, R-PRESENT-36.)
  if (rel === 'vista-flat.webp') return 1280;
  // Card frames, plates, desc boxes, tier stars, the shop buttons. NOT the title logo (drawn huge on the title), the
  // Compendium frame (a border-image sliced in image pixels) or the ranked gate (CSS-painted).
  if (/^frames\/(?!title-logo|compendium-|ranked-gate)/.test(rel)) return 512;
  // The painted chests (body + lid, 840 px masters) as the Chest Shop and the Collection bay draw them in plain DOM
  // (`ChestPicture`, about 230 / 124 stage px). ChestPicture lays out in percents of the body's width, so a smaller
  // copy composes the same. The opening theatre (Pixi, `crateFx/chestArt.ts`) still loads the originals.
  if (/^collection\/(?:chest_[a-z]+|crate)_(?:body|lid)\.webp$/.test(rel)) return 512;
  return null;
}

// ─── detection ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DeviceProbe {
  ua: string;
  /** `navigator.maxTouchPoints` */
  maxTouchPoints: number;
  /** `matchMedia('(pointer: coarse)')` */
  coarse: boolean;
  /** min(screen.width, screen.height) in CSS px */
  shortSide: number;
  /** `?art=` or the stored override, when set */
  override?: string | null;
}

export type LiteReason = 'override' | 'ios' | 'touch-small-screen' | null;

/** Pure: is this device a "lite art" device, and why. Exported for its test. */
export function detectLiteArt(p: DeviceProbe): { lite: boolean; reason: LiteReason } {
  if (p.override === 'lite') return { lite: true, reason: 'override' };
  if (p.override === 'full') return { lite: false, reason: 'override' };
  // iPhone / iPod / iPad, and iPadOS 13+ which reports a desktop Mac UA (it is the only "Macintosh" with touch).
  if (/iPhone|iPod|iPad/.test(p.ua) || (/Macintosh/.test(p.ua) && p.maxTouchPoints > 1)) return { lite: true, reason: 'ios' };
  // Android phones and other small touch screens. A coarse pointer alone is not enough: a touch laptop or a big
  // tablet has the memory to run the desktop path.
  if (p.coarse && p.shortSide > 0 && p.shortSide < 600) return { lite: true, reason: 'touch-small-screen' };
  return { lite: false, reason: null };
}

function readOverride(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get('art');
    if (q === 'lite' || q === 'full') return q;
  } catch { /* no location */ }
  try {
    const s = window.localStorage.getItem('ascent.artMode');
    if (s === 'lite' || s === 'full') return s;
  } catch { /* storage blocked */ }
  return null;
}

/** Read the live device. Safe headless (tests, SSR): reports a desktop. */
export function probeDevice(): DeviceProbe {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return { ua: '', maxTouchPoints: 0, coarse: false, shortSide: 0 };
  let coarse = false;
  try { coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches; } catch { /* ignore */ }
  const sw = typeof screen !== 'undefined' ? Math.min(screen.width || 0, screen.height || 0) : 0;
  return { ua: navigator.userAgent || '', maxTouchPoints: navigator.maxTouchPoints || 0, coarse, shortSide: sw, override: readOverride() };
}

const DETECTED = detectLiteArt(probeDevice());
/** True on a phone / touch device: smaller art, bounded memory, the short loading gate. Fixed for the session. */
export const LITE_ART: boolean = DETECTED.lite;
/** Why (for the bug report / measuring script). */
export const LITE_ART_REASON: LiteReason = DETECTED.reason;

/**
 * Whether a Pixi canvas asks for MSAA. Off on a phone: a 4x multisampled buffer is four more full-screen colour
 * buffers per canvas (the game runs several), and at a phone's 2-3x pixel density the edges it smooths are already
 * sub-pixel. Desktop keeps it.
 */
export const PIXI_ANTIALIAS: boolean = !LITE_ART;

// ─── variant selection ──────────────────────────────────────────────────────────────────────────────────────────────

const MANIFEST: PhoneArtManifest | null = typeof __PHONE_ART__ !== 'undefined' ? __PHONE_ART__ ?? null : null;
let assetSet: Set<string> | null = null;
let publicSet: Set<string> | null = null;

/** Normalise a glob key (`./art/minions/x.webp`, `../art/frames/y.webp`) to a path under `packages/ui/src/`. */
export function normaliseArtKey(key: string): string {
  return key.replace(/^(?:\.\.?\/)+/, '');
}

/** The phone copy's URL for a hashed asset URL: the same file name one folder down (`…/assets/m1/x-HASH.webp`). */
export function toPhoneAssetUrl(url: string, dir = PHONE_ART_DIR): string {
  const i = url.lastIndexOf('/assets/');
  if (i < 0 || /^(data|blob):/i.test(url)) return url;
  return `${url.slice(0, i)}/assets/${dir}/${url.slice(i + '/assets/'.length)}`;
}

/**
 * The URL to load for bundled art (`globKey` as `import.meta.glob` reported it, `url` its resolved URL). Pure given
 * its inputs; the defaults read this session's device + build. Exported (with explicit args) for its test.
 */
export function phoneAssetUrl(
  globKey: string,
  url: string,
  lite: boolean = LITE_ART,
  manifest: PhoneArtManifest | null = MANIFEST,
): string {
  if (!lite || !manifest) return url;
  let set = manifest === MANIFEST ? assetSet : null;
  if (!set) {
    set = new Set(manifest.assets);
    if (manifest === MANIFEST) assetSet = set;
  }
  return set.has(normaliseArtKey(globKey)) ? toPhoneAssetUrl(url, manifest.dir) : url;
}

/** The URL to load for a PUBLIC image, `rel` relative to the site root (`frames/oval-beast.webp`). */
export function phonePublicUrl(
  rel: string,
  base: string = import.meta.env?.BASE_URL ?? '/',
  lite: boolean = LITE_ART,
  manifest: PhoneArtManifest | null = MANIFEST,
): string {
  if (!lite || !manifest) return `${base}${rel}`;
  let set = manifest === MANIFEST ? publicSet : null;
  if (!set) {
    set = new Set(manifest.public);
    if (manifest === MANIFEST) publicSet = set;
  }
  return set.has(rel) ? `${base}${manifest.dir}/${rel}` : `${base}${rel}`;
}

/** Shorthand every UI module uses for a public image: `publicArt('frames/oval-beast.webp')`. */
export const publicArt = (rel: string): string => phonePublicUrl(rel);

/** The stylesheet's custom properties a phone re-points at the phone copy (each var's default names the original). */
export const PHONE_CSS_VARS: ReadonlyArray<readonly [string, string]> = [
  ['--board', 'playingboard.webp'],
  ['--board-combat', 'playingboard-combat.webp'],
  // The return trip's vista (R-TOUCH-RUN-MEMORY-02): `.wipevista-flat` reads this.
  ['--vista-flat', 'vista-flat.webp'],
];

/**
 * Point the stylesheet's board art at its phone copy (the board is a CSS custom property, `--board`). Absolute URLs:
 * a relative url() set inline would resolve against the page, which is what we want, but an absolute one cannot be
 * misread. Called once at boot; a no-op on desktop.
 */
export function applyPhoneCssArt(): void {
  if (!LITE_ART || !MANIFEST || typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.add('lite-art');
  for (const [name, rel] of PHONE_CSS_VARS) {
    const u = phonePublicUrl(rel);
    if (u.endsWith(`${MANIFEST.dir}/${rel}`)) root.style.setProperty(name, `url("${new URL(u, document.baseURI).href}")`);
  }
}

/**
 * THE FULL-RESOLUTION URL of a phone copy (owner 2026-10-25, R-PHONE-CRISP-01: "the inspect looks grainy/not crisp").
 * The enlarged card views on a phone (Inspect, the popped hand card) draw a card at 350-850 device px, past what the
 * 256 / 512 px phone copies hold, so they load the original for the one card they show (`fullResArt.ts`). Pure given its
 * inputs: any URL that is not a phone copy (desktop, a CSS url, a data: URL) comes back unchanged.
 */
export function fullResUrl(url: string, manifest: PhoneArtManifest | null = MANIFEST, base: string = import.meta.env?.BASE_URL ?? '/'): string {
  if (!manifest || !url || /^(data|blob):/i.test(url)) return url;
  const dir = manifest.dir;
  const a = url.indexOf(`/assets/${dir}/`);
  if (a >= 0) return url.slice(0, a) + '/assets/' + url.slice(a + `/assets/${dir}/`.length);
  // A public copy: `<base><dir>/<rel>` (relative or absolute), whose `<rel>` is in the manifest.
  const p = url.indexOf(`${base}${dir}/`);
  if (p >= 0) {
    const rel = url.slice(p + `${base}${dir}/`.length);
    if (manifest.public.includes(rel)) return url.slice(0, p) + base + rel;
  }
  return url;
}
