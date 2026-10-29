/**
 * BOARD BACKDROP — the player's pick of what lies behind the board (owner 2026-10-28: "how do we set this as a
 * selectable background option in the real game? can we add a dropdown in the settings menu?").
 *
 * Each backdrop is a PRESET: a seamless texture plus the darkness, tint and board shadow the owner tuned for it in the Layout Lab
 * (Backdrop group). Picking one in Settings → Display → Board backdrop writes its values as `--bd-*` on `:root`; the
 * board's CSS reads the Layout Lab's `--btex-*` first (DEV only, and only for a slider moved off its shipped value),
 * then these, then the Stone fallbacks. Saved per device in localStorage; read once at load.
 *
 * To add a backdrop: drop its tile in apps/web/public, add it to `BACKDROP_TEXTURES` (layoutConfig.ts) so the Layout
 * Lab can tune it, then copy the tuned values into a preset here.
 */
import { BACKDROP_TEXTURES } from './layoutConfig';

export interface BackdropPreset {
  label: string;
  /** A `BACKDROP_TEXTURES` id. */
  texture: string;
  /** Tile size, reference px. */
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
}

export const BACKDROPS = {
  stone: { label: 'Cobblestone', texture: 'stone', size: 420, blur: 0, dark: 0.05, tint: '#90abfe', tintAmount: 0.06, shadow: 0.72, shadowX: 6, shadowY: 8 },
  oak: { label: 'Oak planks', texture: 'oak', size: 430, blur: 0, dark: 0.24, tint: '#472a00', tintAmount: 0.16, shadow: 0.72, shadowX: 6, shadowY: 8 },
  aether: { label: 'Aether Stone', texture: 'aether', size: 660, blur: 0, dark: 0.18, tint: '#7a33ff', tintAmount: 0.09, shadow: 0.72, shadowX: 6, shadowY: 8 },
  sand: { label: 'Sand', texture: 'sand', size: 1770, blur: 0, dark: 0.2, tint: '#ffa8f3', tintAmount: 0.13, shadow: 0.72, shadowX: 6, shadowY: 8 },
  pavers: { label: 'Stone Pavers', texture: 'moonstone', size: 450, blur: 0, dark: 0.19, tint: '#69b1dd', tintAmount: 0.04, shadow: 0.72, shadowX: 6, shadowY: 8 },
} as const satisfies Record<string, BackdropPreset>;
export type BackdropId = keyof typeof BACKDROPS;
export const BACKDROP_IDS = Object.keys(BACKDROPS) as BackdropId[];
export const DEFAULT_BACKDROP: BackdropId = 'oak';
export const BACKDROP_KEY = 'ascent.backdrop';

function isBackdropId(v: unknown): v is BackdropId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(BACKDROPS, v);
}

function readStored(): BackdropId {
  try {
    const v = localStorage.getItem(BACKDROP_KEY);
    return isBackdropId(v) ? v : DEFAULT_BACKDROP;
  } catch {
    return DEFAULT_BACKDROP;
  }
}

/** The `:root` vars a preset writes. */
export function backdropVars(id: BackdropId): Record<string, string> {
  const p: BackdropPreset = BACKDROPS[id];
  const tex = BACKDROP_TEXTURES[p.texture] ?? BACKDROP_TEXTURES.stone!;
  return {
    '--bd-img': `url('${tex.url}')`,
    '--bd-size': `${p.size}px`,
    '--bd-dark': String(p.dark),
    '--bd-blur': `${p.blur}px`,
    '--bd-tint-col': p.tint,
    '--bd-tint': String(p.tintAmount),
    '--bd-shadow-a': String(p.shadow),
    '--bd-shadow-x': `${p.shadowX}px`,
    '--bd-shadow-y': `${p.shadowY}px`,
  };
}

function apply(id: BackdropId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(backdropVars(id))) root.setProperty(k, v);
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
