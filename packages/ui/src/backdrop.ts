/**
 * BOARD BACKDROP — the player's pick of what lies behind the board (owner 2026-10-28: "how do we set this as a
 * selectable background option in the real game? can we add a dropdown in the settings menu?").
 *
 * Each backdrop is a PRESET: a texture (a seamless tile, or one painted image marked `cover` in BACKDROP_TEXTURES)
 * plus its TUNE: zoom and position (painted images), tile size (tiles), darkness, blur, tint and the board's shadow.
 * Picking one in Settings → Display → Board backdrop writes its tune as `--bd-*` on `:root` (styles.css .boardbg-tex
 * reads them). Saved per device in localStorage; read once at load.
 *
 * TUNING (owner 2026-10-29: "lets make a standalone background tuner. i dont want it in the scale and layout"): the
 * DEV Background Tuner (BackgroundTuner.tsx) edits ONE backdrop's tune live, plus the SHARED LOOK every backdrop wears
 * (the board's shadow and the hero shades, owner: "should be global"); its Save writes the numbers into
 * `backdrop-tuning.json` through the dev server (apps/web/backdropTuningPlugin.ts), which lays over the preset below,
 * so a saved tune ships to every player once the file is committed.
 *
 * To add a backdrop: drop the image in apps/web/public (a painted one also needs its 1600x900 `-sm` phone copy), add
 * it to `BACKDROP_TEXTURES` (layoutConfig.ts) and a preset here, then tune it in the Background Tuner.
 */
import { BACKDROP_TEXTURES, backdropFit, backdropSmallUrl } from './layoutConfig';
import savedTuning from './backdrop-tuning.json';

/** Everything the Background Tuner can change on ONE backdrop (the shared look is below). */
export interface BackdropTune {
  /** Painted images: how far the picture is enlarged, 1 = just fills the window. */
  zoom: number;
  /** Painted images: where the picture sits inside the room the zoom gives it, -100..100 (0 = centred, 100 = all
   *  the way). Positive moves the picture right / down. It never shows the picture's edge. */
  panX: number;
  panY: number;
  /** Tiles: tile size, reference px. */
  size: number;
  /** Black wash, 0..1. */
  dark: number;
  /** Blur on the texture, reference px (0 = sharp). */
  blur: number;
  /** Tint colour and its amount, 0..1. */
  tint: string;
  tintAmount: number;
}
export type BackdropTuneKey = keyof BackdropTune;
export type BackdropNumberKey = Exclude<BackdropTuneKey, 'tint'>;

/**
 * HERO SHADES (owner 2026-10-29: "another circle under each portrait that i can spread out and make very dark", then
 * "can we have the shadow under the hero power?", "is it possible for it to go under the board too?" and "the edits to
 * the hero shades should be global. the same effect on every background, no matter whats selected"): soft dark circles
 * in the backdrop layer, UNDER the board, behind your portrait, your hero power and (combat) the opponent's portrait, so
 * they read on a bright background. Separate from the portraits' own drop shadow. ONE setting for every backdrop.
 * Darkness 0..1 and Softness 0..100 (0 = a hard edge) are shared by the circles. Each circle's size is its diameter
 * and its X/Y its centre, measured from the board's centre, in reference px (x --scale), so it stays put relative to the
 * board at any screen size.
 */
export interface SharedLook {
  /** THE BOARD'S DROP SHADOW (owner 2026-10-29: "same with the board shadow settings"): strength 0..1 and offset,
   *  reference px. One setting for every backdrop, like the hero shades. */
  shadow: number;
  shadowX: number;
  shadowY: number;
  shadeDark: number;
  shadeSoft: number;
  /** Under your portrait. */
  shadeSize: number;
  shadeX: number;
  shadeY: number;
  /** Under your hero power. */
  powerShadeSize: number;
  powerShadeX: number;
  powerShadeY: number;
  /** Under the opponent's portrait (combat only). */
  oppShadeSize: number;
  oppShadeX: number;
  oppShadeY: number;
}
export type SharedKey = keyof SharedLook;

export interface BackdropPreset extends Partial<BackdropTune> {
  label: string;
  /** A `BACKDROP_TEXTURES` id. */
  texture: string;
}

/** What a preset leaves out. */
export const TUNE_DEFAULTS: Readonly<BackdropTune> = {
  zoom: 1, panX: 0, panY: 0, size: 430, dark: 0, blur: 0, tint: '#000000', tintAmount: 0,
};
export const NUMBER_KEYS: readonly BackdropNumberKey[] =
  ['zoom', 'panX', 'panY', 'size', 'dark', 'blur', 'tintAmount'];

/** The shared look (board shadow + hero shades) until the tuner saves it: the owner's final values (2026-10-29). */
export const SHARED_DEFAULTS: Readonly<SharedLook> = {
  shadow: 0.76, shadowX: 6, shadowY: 8,
  shadeDark: 1, shadeSoft: 100, shadeSize: 1050, shadeX: -1080, shadeY: 427,
  powerShadeSize: 0, powerShadeX: -60, powerShadeY: 232, oppShadeSize: 1020, oppShadeX: 1024, oppShadeY: -511,
};
export const SHARED_KEYS = Object.keys(SHARED_DEFAULTS) as SharedKey[];
const HEX = /^#[0-9a-f]{6}$/i;

/** A single painted image (a `cover` texture): shown as painted until tuned. */
function image(label: string, texture: string): BackdropPreset {
  return { label, texture };
}

export const BACKDROPS = {
  stone: { label: 'Cobblestone', texture: 'stone', size: 420, dark: 0.05, tint: '#90abfe', tintAmount: 0.06 },
  oak: { label: 'Oak planks', texture: 'oak', size: 430, dark: 0.24, tint: '#472a00', tintAmount: 0.16 },
  aether: { label: 'Aether Stone', texture: 'aether', size: 660, dark: 0.18, tint: '#7a33ff', tintAmount: 0.09 },
  sand: { label: 'Sand', texture: 'sand', size: 1770, dark: 0.2, tint: '#ffa8f3', tintAmount: 0.13 },
  pavers: { label: 'Stone Pavers', texture: 'moonstone', size: 450, dark: 0.19, tint: '#69b1dd', tintAmount: 0.04 },
  // Single painted images (owner 2026-10-29): each fills the window instead of tiling.
  castle: image('Castle', 'castle'),
  runicSlate: image('Runic Slate', 'runicSlate'),
  cosmicEnergy: image('Cosmic Energy', 'cosmicEnergy'),
  darkSanctum: image('Dark Sanctum', 'darkSanctum'),
  temple: image('Temple', 'temple'),
  stoneCourtyard: image('Stone Courtyard', 'stoneCourtyard'),
  koiPond: image('Koi Pond', 'koiPond'),
  freshPond: image('Fresh Pond', 'freshPond'),
  bambooForest: image('Bamboo Forest', 'bambooForest'),
  treasureHoard: image('Treasure Hoard', 'treasureHoard'),
  celestial: image('Celestial', 'celestial'),
  autumnFire: image('Autumn Fire', 'autumnFire'),
} as const satisfies Record<string, BackdropPreset>;
export type BackdropId = keyof typeof BACKDROPS;
export const BACKDROP_IDS = Object.keys(BACKDROPS) as BackdropId[];
export const DEFAULT_BACKDROP: BackdropId = 'castle';
/** A backdrop's small 16:9 preview (400x225, apps/web/public), shown when its Settings option is hovered (owner 2026-10-30). */
export function backdropThumbUrl(id: BackdropId): string { return `/backdrop-thumb-${id}.webp`; }
export const BACKDROP_KEY = 'ascent.backdrop';

export function isBackdropId(v: unknown): v is BackdropId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(BACKDROPS, v);
}

/** Only the well-formed entries of a tune record (the saved file, or a live edit). */
function cleanTune(raw: unknown): Partial<BackdropTune> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<BackdropTune> = {};
  for (const k of NUMBER_KEYS) if (typeof r[k] === 'number' && Number.isFinite(r[k])) out[k] = r[k] as number;
  if (typeof r.tint === 'string' && HEX.test(r.tint)) out.tint = r.tint;
  return out;
}

/** What the Background Tuner SAVED (`backdrop-tuning.json`). It wins over the presets above. */
const SAVED: Partial<Record<BackdropId, Partial<BackdropTune>>> = (() => {
  const file = savedTuning as { backdrops?: Record<string, unknown> };
  const out: Partial<Record<BackdropId, Partial<BackdropTune>>> = {};
  for (const [id, t] of Object.entries(file.backdrops ?? {})) if (isBackdropId(id)) out[id] = cleanTune(t);
  return out;
})();

/** DEV: the Background Tuner's unsaved edits, per backdrop. Wins over the saved file until Save or Reset. */
let live: Partial<Record<BackdropId, Partial<BackdropTune>>> = {};

function cleanShared(raw: unknown): Partial<SharedLook> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<SharedLook> = {};
  for (const k of SHARED_KEYS) if (typeof r[k] === 'number' && Number.isFinite(r[k])) out[k] = r[k] as number;
  return out;
}
/** The shared look the tuner SAVED (`backdrop-tuning.json` → allBackgrounds), the same for every backdrop. */
const SAVED_SHARED: Partial<SharedLook> = cleanShared((savedTuning as { allBackgrounds?: unknown }).allBackgrounds);
/** DEV: unsaved edits to the shared look. */
let liveShared: Partial<SharedLook> = {};

/** The shared look (board shadow + hero shades), whatever backdrop is on: defaults, then saved, then unsaved edits. */
export function sharedLook(): SharedLook {
  return { ...SHARED_DEFAULTS, ...SAVED_SHARED, ...liveShared };
}

/** A backdrop's full tune: defaults, then its preset, then what was saved, then any unsaved tuner edit. */
export function tuneOf(id: BackdropId): BackdropTune {
  return { ...TUNE_DEFAULTS, ...cleanTune(BACKDROPS[id]), ...SAVED[id], ...live[id] };
}

/**
 * CASTLE FOR EVERYONE, ONCE (owner 2026-10-30: "we want castle to be the default experience. planks was available
 * before the default experience was"). A pick saved before Castle became the default is cleared the first time a
 * device loads this version, so every player starts on Castle; from then on their pick is theirs again. The marker
 * makes it one-time: a pick made after it is never reset.
 */
export const CASTLE_RESET_KEY = 'ascent.backdrop.castleReset';
function resetToCastleOnce(): void {
  try {
    if (localStorage.getItem(CASTLE_RESET_KEY) === '1') return;
    localStorage.removeItem(BACKDROP_KEY);
    localStorage.setItem(CASTLE_RESET_KEY, '1');
  } catch { /* storage blocked: nothing saved, so the default (Castle) already shows */ }
}

function readStored(): BackdropId {
  resetToCastleOnce();
  try {
    const v = localStorage.getItem(BACKDROP_KEY);
    return isBackdropId(v) ? v : DEFAULT_BACKDROP;
  } catch {
    return DEFAULT_BACKDROP;
  }
}

/** The `:root` vars a backdrop writes. */
export function backdropVars(id: BackdropId): Record<string, string> {
  const p: BackdropPreset = BACKDROPS[id];
  const t = tuneOf(id);
  const s = sharedLook();
  const tex = BACKDROP_TEXTURES[p.texture] ?? BACKDROP_TEXTURES.stone!;
  return {
    '--bd-img': `url('${tex.url}')`,
    // A painted backdrop's phone copy (touchUi.css swaps it in on touch devices); a tile uses its one image.
    '--bd-img-sm': `url('${backdropSmallUrl(p.texture) ?? tex.url}')`,
    '--bd-zoom': String(t.zoom),
    '--bd-pan-x': String(t.panX),
    '--bd-pan-y': String(t.panY),
    '--bd-size': `${t.size}px`,
    '--bd-dark': String(t.dark),
    '--bd-blur': `${t.blur}px`,
    '--bd-tint-col': t.tint,
    '--bd-tint': String(t.tintAmount),
    '--bd-shadow-a': String(s.shadow),
    '--bd-shadow-x': `${s.shadowX}px`,
    '--bd-shadow-y': `${s.shadowY}px`,
    '--bd-shade-a': String(s.shadeDark),
    '--bd-shade-core': `${100 - s.shadeSoft}%`,
    // Radius (half the diameter) and centre, reference px: styles.css .boardbg-shade multiplies by --scale.
    '--bd-shade-r': `${s.shadeSize / 2}px`,
    '--bd-shade-x': `${s.shadeX}px`,
    '--bd-shade-y': `${s.shadeY}px`,
    '--bd-pshade-r': `${s.powerShadeSize / 2}px`,
    '--bd-pshade-x': `${s.powerShadeX}px`,
    '--bd-pshade-y': `${s.powerShadeY}px`,
    '--bd-oshade-r': `${s.oppShadeSize / 2}px`,
    '--bd-oshade-x': `${s.oppShadeX}px`,
    '--bd-oshade-y': `${s.oppShadeY}px`,
  };
}

function apply(id: BackdropId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(backdropVars(id))) root.setProperty(k, v);
  // A single-image (cover) backdrop fills the window instead of tiling: styles.css .boardbg-tex reads this.
  if (backdropFit(BACKDROPS[id].texture) === 'cover') document.documentElement.dataset.bdFit = 'cover';
  else delete document.documentElement.dataset.bdFit;
}

let current: BackdropId = typeof localStorage === 'undefined' ? DEFAULT_BACKDROP : readStored();
apply(current);

export function getBackdrop(): BackdropId { return current; }

export function setBackdrop(id: BackdropId): void {
  if (!isBackdropId(id)) return;
  current = id;
  try { localStorage.setItem(BACKDROP_KEY, id); } catch { /* ignore */ }
  apply(id);
}

/** DEV (Background Tuner): change one knob of one backdrop, live. Shown at once when it is the backdrop on screen. */
export function setLiveTune<K extends BackdropTuneKey>(id: BackdropId, key: K, value: BackdropTune[K]): void {
  if (!isBackdropId(id)) return;
  live = { ...live, [id]: { ...live[id], ...cleanTune({ [key]: value }) } };
  if (id === current) apply(id);
}

/** DEV (Background Tuner): change one shared knob (board shadow or hero shade), live, for every backdrop. */
export function setLiveShared(key: SharedKey, value: number): void {
  if (!SHARED_KEYS.includes(key) || !Number.isFinite(value)) return;
  liveShared = { ...liveShared, [key]: value };
  apply(current);
}

/** DEV (Background Tuner): drop every unsaved edit (backdrops and the shared look), back to what is saved. */
export function clearLiveTune(): void {
  live = {};
  liveShared = {};
  apply(current);
}
