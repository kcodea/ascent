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
 * DEV Background Tuner (BackgroundTuner.tsx) edits ONE backdrop's tune live; its Save writes the numbers into
 * `backdrop-tuning.json` through the dev server (apps/web/backdropTuningPlugin.ts), which lays over the preset below,
 * so a saved tune ships to every player once the file is committed.
 *
 * To add a backdrop: drop the image in apps/web/public (a painted one also needs its 1600x900 `-sm` phone copy), add
 * it to `BACKDROP_TEXTURES` (layoutConfig.ts) and a preset here, then tune it in the Background Tuner.
 */
import { BACKDROP_TEXTURES, backdropFit, backdropSmallUrl } from './layoutConfig';
import savedTuning from './backdrop-tuning.json';

/** Everything the Background Tuner can change on one backdrop. */
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
  /** The board's drop shadow on this backdrop: strength 0..1 and offset, reference px. */
  shadow: number;
  shadowX: number;
  shadowY: number;
  /** HERO SHADES (owner 2026-10-29: "another circle under each portrait that i can spread out and make very dark"): a
   *  soft dark circle under the player's portrait and the opponent's, separate from the portraits' own drop shadow, so
   *  they read on a bright background. Darkness 0..1 and Softness 0..100 (0 = a hard edge) are shared. */
  shadeDark: number;
  shadeSoft: number;
  /** The player's circle: diameter in portrait widths (2 = twice the portrait), and its offset from the portrait's
   *  centre in % of the portrait. Relative to the portrait, so it fits at any screen size and any portrait scale. */
  shadeSize: number;
  shadeX: number;
  shadeY: number;
  /** The opponent's circle (combat): the same, against the opponent's portrait. */
  oppShadeSize: number;
  oppShadeX: number;
  oppShadeY: number;
}
export type BackdropTuneKey = keyof BackdropTune;
export type BackdropNumberKey = Exclude<BackdropTuneKey, 'tint'>;

export interface BackdropPreset extends Partial<BackdropTune> {
  label: string;
  /** A `BACKDROP_TEXTURES` id. */
  texture: string;
}

/** What a preset leaves out. */
export const TUNE_DEFAULTS: Readonly<BackdropTune> = {
  zoom: 1, panX: 0, panY: 0, size: 430, dark: 0, blur: 0, tint: '#000000', tintAmount: 0, shadow: 0.72, shadowX: 6, shadowY: 8,
  shadeDark: 0.6, shadeSoft: 70, shadeSize: 2.4, shadeX: 0, shadeY: 0, oppShadeSize: 2.4, oppShadeX: 0, oppShadeY: 0,
};
export const NUMBER_KEYS: readonly BackdropNumberKey[] =
  ['zoom', 'panX', 'panY', 'size', 'dark', 'blur', 'tintAmount', 'shadow', 'shadowX', 'shadowY',
    'shadeDark', 'shadeSoft', 'shadeSize', 'shadeX', 'shadeY', 'oppShadeSize', 'oppShadeX', 'oppShadeY'];
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

/** A backdrop's full tune: defaults, then its preset, then what was saved, then any unsaved tuner edit. */
export function tuneOf(id: BackdropId): BackdropTune {
  return { ...TUNE_DEFAULTS, ...cleanTune(BACKDROPS[id]), ...SAVED[id], ...live[id] };
}

function readStored(): BackdropId {
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
    '--bd-shadow-a': String(t.shadow),
    '--bd-shadow-x': `${t.shadowX}px`,
    '--bd-shadow-y': `${t.shadowY}px`,
    '--bd-shade-a': String(t.shadeDark),
    '--bd-shade-core': `${100 - t.shadeSoft}%`,
    '--bd-shade-size': String(t.shadeSize),
    '--bd-shade-x': String(t.shadeX),
    '--bd-shade-y': String(t.shadeY),
    '--bd-oshade-size': String(t.oppShadeSize),
    '--bd-oshade-x': String(t.oppShadeX),
    '--bd-oshade-y': String(t.oppShadeY),
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

/** DEV (Background Tuner): drop every unsaved edit, back to what is saved. */
export function clearLiveTune(): void {
  live = {};
  apply(current);
}
