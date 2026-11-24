/**
 * PACK OPENING: its tunable feel numbers (spec §7). The defaults are the owner's tuned values from the prototype
 * (docs/superpowers/specs/2026-11-23-pack-opening-prototype.html), verbatim. Overrides persist to localStorage so
 * the dev tuner keeps them between reloads; a malformed stored value falls back to the defaults, key by key.
 * Read `getPackFeel()` when an opening STARTS (the object is replaced, never mutated, on every change).
 */

import { PACK_GEOM } from './packGeom';

export interface PackFeel {
  /** Peel-off angle at the tear (radians). */
  peelAngle: number;
  /** How far the torn edge lifts toward the camera (px at PACK_BASE_SIZE). */
  edgeTowardCamera: number;
  /** Slack before it tears (0.7..1 of the strip). */
  slackBeforeTear: number;
  /** How closely the torn edge follows the hand. */
  edgeFollowsHand: number;
  /** Max tear speed. */
  maxTearSpeed: number;
  /** Fibre catch (stutter). */
  fibreCatch: number;
  /** Pinch twist. */
  pinchTwist: number;
  /** How readily it tears when pulled straight up. */
  tearsStraightUp: number;
  /** Highlight strength. */
  highlight: number;
  /** Perspective distance. */
  perspective: number;
  /** Master volume. */
  volume: number;
  /** Sleeve: grip before it slides (px at PACK_BASE_SIZE). */
  sleeveGrip: number;
  /** Sleeve: follows hand. */
  sleeveFollows: number;
  /** Sleeve: rim drags on the cards. */
  sleeveRimDrag: number;
  /** Sleeve: finger pinch. */
  sleeveFingerPinch: number;
  /** Sleeve: pull to let go (px at PACK_BASE_SIZE). */
  sleeveLetGo: number;
  /** Stack zoom. */
  stackZoom: number;
  /** Quick open: the whole auto-open's duration. */
  quickOpenMs: number;
  /** The sealed pack's rarity glow: a master multiplier on its per-tier strength (packGlow.ts). */
  packGlow: number;
  /** The cards' rarity glow (backs and revealed faces): a master multiplier on its per-tier strength (packGlow.ts). */
  cardGlow: number;
  /** The clear-coat gloss over the strip and the sleeve: its strength (0 = none; packTilt.ts `glossBand`). */
  gloss: number;
  /** The gloss's finish: 0 = satin (a wide soft sheen), 1 = glassy (a narrow bright streak). */
  glossSharpness: number;
  /** The sealed pack's mouse tilt: a multiplier on the drag dive's `tiltMax` (dragFeel.ts); 0 = none. */
  packTilt: number;
  /** The big-pull light burst's strength (Legendary / Ancient flips, bigPull.ts); 0 = off. */
  bigPull: number;
  /** The big-pull theatre shake (px) for a Legendary; Ancient shakes 1.5x. 0 = none. */
  bigPullShake: number;
  /** After a big pull lands, the next flip waits this long (ms; Reveal all too). */
  bigPullHoldMs: number;
  /** The holographic / pearlescent sheen on Epic+ packs and faces (packHolo.ts): a master multiplier; 0 = off. */
  holo: number;
}

export const DEFAULT_PACK_FEEL: PackFeel = {
  peelAngle: 0.4,
  edgeTowardCamera: 139,
  slackBeforeTear: 0.92,
  edgeFollowsHand: 0.1,
  maxTearSpeed: 18,
  fibreCatch: 0.7,
  pinchTwist: 0.65,
  tearsStraightUp: 0.15,
  highlight: 0.65,
  perspective: 1780,
  volume: 0.45,
  sleeveGrip: 80,
  sleeveFollows: 0.36,
  sleeveRimDrag: 1,
  sleeveFingerPinch: 0.08,
  sleeveLetGo: 295,
  stackZoom: 0.3,
  quickOpenMs: 1000,
  packGlow: 1,
  cardGlow: 1,
  gloss: 0.3,
  glossSharpness: 0.7,
  packTilt: 0.6,
  bigPull: 1,
  bigPullShake: 6,
  bigPullHoldMs: 450,
  holo: 1,
};

/** The pack size the px values are tuned at; scale them by (rendered width / w). */
export const PACK_BASE_SIZE = { w: PACK_GEOM.W, h: PACK_GEOM.H + PACK_GEOM.BODY_H } as const;

export interface PackFeelKnob { key: keyof PackFeel; label: string; min: number; max: number; step: number }

export const PACK_FEEL_KNOBS: readonly PackFeelKnob[] = [
  { key: 'peelAngle', label: 'Peel-off angle at the tear', min: 0.2, max: 1.55, step: 0.05 },
  { key: 'edgeTowardCamera', label: 'Edge toward camera', min: 0, max: 160, step: 1 },
  { key: 'slackBeforeTear', label: 'Slack before it tears', min: 0.7, max: 1, step: 0.01 },
  { key: 'edgeFollowsHand', label: 'Edge follows hand', min: 0.1, max: 1, step: 0.01 },
  { key: 'maxTearSpeed', label: 'Max tear speed', min: 3, max: 40, step: 1 },
  { key: 'fibreCatch', label: 'Fibre catch (stutter)', min: 0, max: 1, step: 0.05 },
  { key: 'pinchTwist', label: 'Pinch twist', min: 0, max: 1, step: 0.05 },
  { key: 'tearsStraightUp', label: 'Tears when pulled straight up', min: 0, max: 0.6, step: 0.05 },
  { key: 'highlight', label: 'Highlight', min: 0, max: 1, step: 0.05 },
  { key: 'perspective', label: 'Perspective', min: 350, max: 2200, step: 10 },
  { key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.05 },
  { key: 'sleeveGrip', label: 'SLEEVE: grip before it slides (px)', min: 0, max: 80, step: 1 },
  { key: 'sleeveFollows', label: 'SLEEVE: follows hand', min: 0.1, max: 1, step: 0.01 },
  { key: 'sleeveRimDrag', label: 'SLEEVE: rim drags on cards', min: 0, max: 1, step: 0.05 },
  { key: 'sleeveFingerPinch', label: 'SLEEVE: finger pinch', min: 0, max: 0.2, step: 0.01 },
  { key: 'sleeveLetGo', label: 'SLEEVE: pull to let go (px)', min: 60, max: 340, step: 5 },
  { key: 'stackZoom', label: 'Stack zoom', min: 0, max: 0.6, step: 0.02 },
  { key: 'quickOpenMs', label: 'Quick open duration (ms)', min: 300, max: 3000, step: 50 },
  { key: 'packGlow', label: 'GLOW: pack rarity glow', min: 0, max: 2, step: 0.05 },
  { key: 'cardGlow', label: 'GLOW: card rarity glow', min: 0, max: 2, step: 0.05 },
  { key: 'gloss', label: 'GLOSS: strength', min: 0, max: 1.5, step: 0.05 },
  { key: 'glossSharpness', label: 'GLOSS: satin to glassy', min: 0, max: 1, step: 0.05 },
  { key: 'packTilt', label: 'TILT: sealed pack mouse tilt (x drag dive)', min: 0, max: 1.5, step: 0.05 },
  { key: 'bigPull', label: 'BIG PULL: light burst strength', min: 0, max: 2, step: 0.05 },
  { key: 'bigPullShake', label: 'BIG PULL: shake (px, Ancient x1.5)', min: 0, max: 20, step: 1 },
  { key: 'bigPullHoldMs', label: 'BIG PULL: hold before the next flip (ms)', min: 0, max: 1500, step: 25 },
  { key: 'holo', label: 'HOLO: pack + card holo sheen (0 = off)', min: 0, max: 2, step: 0.05 },
];

const STORAGE_KEY = 'ascent.packFeel.v1';
const RANGE = new Map(PACK_FEEL_KNOBS.map((k) => [k.key, k] as const));

/** One value, clamped into its knob's range; junk (NaN, a string that is not a number) is the default. */
function safeValue(key: keyof PackFeel, value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  const k = RANGE.get(key);
  if (!Number.isFinite(n) || !k) return DEFAULT_PACK_FEEL[key];
  return Math.min(k.max, Math.max(k.min, n));
}

function sanitize(saved: unknown): PackFeel {
  const out: PackFeel = { ...DEFAULT_PACK_FEEL };
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    if (k in DEFAULT_PACK_FEEL) out[k as keyof PackFeel] = safeValue(k as keyof PackFeel, v);
  }
  return out;
}

let feel: PackFeel = (() => {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_PACK_FEEL };
  }
})();

const listeners = new Set<() => void>();
const emit = (): void => { listeners.forEach((cb) => cb()); };

export function getPackFeel(): PackFeel {
  return feel;
}

export function setPackFeel(patch: Partial<PackFeel>): void {
  const next: PackFeel = { ...feel };
  for (const [k, v] of Object.entries(patch)) {
    if (k in DEFAULT_PACK_FEEL && v !== undefined) next[k as keyof PackFeel] = safeValue(k as keyof PackFeel, v);
  }
  feel = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(feel)); } catch { /* ignore */ }
  emit();
}

export function resetPackFeel(): void {
  feel = { ...DEFAULT_PACK_FEEL };
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  emit();
}

export function subscribePackFeel(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
