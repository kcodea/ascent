import { COSMETIC_RARITIES, type CosmeticRarity } from '@game/progression';
import type { TunerControl, TunerSpec, TunerUnit } from '../../tunerSchema';
import type { TailOpts } from '../../audio/tailFade';
import { clipNames } from '../../sfx';

/**
 * THE CRATE OPENING: its tunable numbers (owner ask 2026-09-28: "make the collection screen separate and build a
 * AAA animation for crate opening, with pixi and everything. put a tuner in for it to test it"; redone the same
 * day after "crate opening looks like a 2/10, i need it to be at least an 8/10").
 *
 * Follows the tuner convention (the Good Luck intro's, the Discover entrance's): localStorage-persisted in DEV
 * only, production always plays `CRATE_FX_DEFAULTS`. Every value is read when an opening STARTS, so moving a
 * slider changes the next play, and the tuner's Play buttons show it at once without spending a real crate.
 * Shipping a feel = pasting the tuner's Copy JSON into `CRATE_FX_DEFAULTS`.
 *
 * THE SEQUENCE (one crate). The rarity is only known when the server answers, so the opening is split in two:
 *
 *   click  ->  ANTICIPATION (at once, while the request is in flight: the chest breathes in pulses, warm light
 *              leaks from the seam, the lid rattles; it lasts at least `anticipationMs`, and HOLDS while the
 *              server is slower)
 *   answer ->  CHARGE (the gem ignites in the rarity colour, rarity light floods the seam then the cracks, the
 *              pulses accelerate, energy is pulled in, the camera pushes in; a big rarity ends in a slow-motion
 *              hitch)
 *          ->  FREEZE (a rarity with a SIGNATURE only, today Ancient's "Time stops": the chest freezes mid-shake, the
 *              hum cuts to silence and the scene drains to grey for `<rarity>FreezeMs`)
 *          ->  BURST  (white flash, rarity punch, rings, rays, the lid and shards fly, sparks and embers, a heavy
 *              decaying screen shake; Legendary bursts twice and throws gold coins; Ancient's prismatic crack splits
 *              the view and the colour floods back)
 *          ->  REVEAL (the nameplate rises out of the light with an overshoot, its gem pops, the name stamps, the
 *              rarity ribbon stamps with a small shake, a shine sweeps it; god rays turn slowly behind)
 *          ->  SETTLE (the light dims to a lingering glow; the Pixi ticker stops)
 *
 * A failed answer winds the anticipation down and says "Could not open the crate. Try again." Reduced motion
 * skips all of it for a short fade.
 */

export type CrateRarity = CosmeticRarity;
export const CRATE_RARITIES: readonly CrateRarity[] = COSMETIC_RARITIES;

/**
 * A rarity's SIGNATURE reveal moment, on top of its dials. 'none' = the dials alone (Common to Legendary).
 * 'timestop' (Ancient, owner pick 2026-10-02, concept 3 "Prismatic Aurora"): the chest freezes mid-shake and the scene
 * drains to grey for `<rarity>FreezeMs`, then a prismatic crack splits the view and the colour floods back at the burst.
 * SWAPPABLE: a new signature is one id here plus its CSS (`.crth.sig-<id>`) and, if it freezes, a FreezeMs dial.
 */
export const CRATE_SIGNATURES = ['none', 'timestop'] as const;
export type CrateSignature = (typeof CRATE_SIGNATURES)[number];
export const RARITY_SIGNATURE: Readonly<Record<CrateRarity, CrateSignature>> = {
  common: 'none', rare: 'none', epic: 'none', legendary: 'none', ancient: 'timestop',
};

/** The per-rarity dials. Each one exists once per rarity in the config, as `<rarity><Suffix>`. */
const RARITY_NUM_SUFFIXES = [
  'ChargeMs', 'HitchMs', 'BurstMs', 'RevealHoldMs', 'ChargeParticles', 'BurstSparks', 'Embers', 'Debris', 'Coins',
  'Shake', 'ScreenShake', 'Push', 'Flash', 'Rings', 'Rays', 'DoubleBurst', 'Pitch', 'FreezeMs',
] as const;
type RaritySuffix = (typeof RARITY_NUM_SUFFIXES)[number];
type RarityNumKey = `${CrateRarity}${RaritySuffix}`;
type RarityColorKey = `${CrateRarity}Color`;

interface CrateFxGlobals {
  // ── Anticipation ──
  /** The least time the anticipation plays before the charge can start, even when the server answers at once. */
  anticipationMs: number;
  /** The chest's shake at the end of the anticipation, in px (it escalates from a tremble). */
  anticipationShake: number;
  /** How much warm light leaks from the seam during the anticipation (0..1). */
  anticipationGlow: number;
  /** The heartbeat: ms between pulses in the anticipation. */
  pulseStartMs: number;
  /** The heartbeat at the end of the charge (it accelerates to this). */
  pulseEndMs: number;
  /** After this long without an answer, "Still opening" shows under the chest. */
  slowNoteMs: number;
  /** A failed (or empty) answer: how long the light and shake take to die down before the message shows. */
  windDownMs: number;
  /** The hitch's time scale: how slow the held breath before a big burst runs (0.1 = nearly frozen). */
  hitchScale: number;
  // ── Reveal ──
  /** The nameplate rising out of the light (overshoot, settle). */
  riseMs: number;
  /** From the reveal to the gem popping on the plate. */
  gemDelayMs: number;
  /** From the reveal to the name stamping in. */
  stampDelayMs: number;
  /** The name's stamp (shrinks onto the plate as it fades in). */
  stampMs: number;
  /** From the reveal to the rarity ribbon stamping (with a small shake). */
  ribbonDelayMs: number;
  /** From the reveal to the shine sweeping the plate. */
  shineDelayMs: number;
  /** The shine's sweep. */
  shineMs: number;
  /** The light dimming from the reveal to its lingering idle glow. */
  settleMs: number;
  /** Open all: the pause after one reward settles before the next crate starts. */
  autoNextMs: number;
  /** The chest's size (the body's scale), as a multiplier on its fitted size. */
  crateScale: number;
  // ── The chest (the owner's two layers, 2026-09-28) ──
  /** Nudge the lid on the body, in % of the chest's width (0 = the measured fit). */
  lidOffsetX: number;
  lidOffsetY: number;
  /** The lid's size against the body (1 = the measured fit). */
  lidScale: number;
  /** How far the lid jumps on each heartbeat, in % of the chest's width (it rises with the pressure). */
  lidJump: number;
  /** The lid's launch at the burst: sideways and upward speed (chest widths per second), spin (turns per
   *  second) and gravity (chest widths per second squared). */
  lidLaunchX: number;
  lidLaunchY: number;
  lidSpin: number;
  lidGravity: number;
  /** The seam light: its line against the rim (% of the chest's width), its width (x the rim) and strength. */
  seamOffsetY: number;
  seamWidth: number;
  seamGlow: number;
  /** The keyhole light's strength. */
  keyholeGlow: number;
  /** The open body's glow after the lid is gone (the light pouring out). */
  openGlow: number;
  /** The blur on the page behind the theatre, in px (static: applied once). */
  backdropBlur: number;
  /** Reduced motion: the reward's fade. */
  reducedFadeMs: number;
  // ── Sound ──
  sfxHumClip: string;
  sfxHumGain: number;
  sfxPulseClip: string;
  sfxPulseGain: number;
  sfxChargeClip: string;
  sfxChargeGain: number;
  sfxBurstClip: string;
  sfxBurstGain: number;
  sfxCrackClip: string;
  sfxCrackGain: number;
  sfxWhooshClip: string;
  sfxWhooshGain: number;
  sfxRevealClip: string;
  sfxRevealGain: number;
  sfxRevealStartMs: number;
  sfxRevealLenMs: number;
  sfxRevealFadeMs: number;
  sfxStampClip: string;
  sfxStampGain: number;
  sfxCoinClip: string;
  sfxCoinGain: number;
  sfxStingClip: string;
  sfxStingGain: number;
  reverbMix: number;
  reverbSec: number;
  // ── Art ──
  /** A ONE-PICTURE override: a URL for a single crate picture that replaces the owner's two-layer chest (empty =
   *  the two-layer chest, `collection/crate_body.webp` + `crate_lid.webp`). A single picture shakes, charges and
   *  bursts as one piece (no separate lid). */
  crateArt: string;
}

export type CrateFxConfig = CrateFxGlobals & { [K in RarityNumKey]: number } & { [K in RarityColorKey]: string };

/** An empty clip = silent. */
export const NO_CLIP = '';
/** The owner's sparkle-whoosh clip; the reveal plays only its glitter tail (the Good Luck intro's window). */
export const SPARKLE_CLIP = 'fx/djartmusic-christmas-sparkle-whoosh-1-275404';

/** Shipped values. See `crateBeats` for the resulting timeline per rarity. */
export const CRATE_FX_DEFAULTS: CrateFxConfig = {
  anticipationMs: 650,
  anticipationShake: 1.6,
  anticipationGlow: 0.6,
  pulseStartMs: 460,
  pulseEndMs: 150,
  slowNoteMs: 2500,
  windDownMs: 420,
  hitchScale: 0.12,
  riseMs: 620,
  gemDelayMs: 100,
  stampDelayMs: 150,
  stampMs: 340,
  ribbonDelayMs: 450,
  shineDelayMs: 620,
  shineMs: 700,
  settleMs: 900,
  autoNextMs: 700,
  crateScale: 1,
  lidOffsetX: 0,
  lidOffsetY: 0,
  lidScale: 1,
  lidJump: 2.2,
  lidLaunchX: 1.4,
  lidLaunchY: 6.2,
  lidSpin: 1.1,
  lidGravity: 13,
  seamOffsetY: 0,
  seamWidth: 1,
  seamGlow: 1,
  keyholeGlow: 1,
  openGlow: 0.85,
  backdropBlur: 6,
  reducedFadeMs: 240,

  commonColor: '#d6e0ec',
  commonChargeMs: 380,
  commonHitchMs: 0,
  commonBurstMs: 480,
  commonRevealHoldMs: 450,
  commonChargeParticles: 14,
  commonBurstSparks: 34,
  commonEmbers: 12,
  commonDebris: 10,
  commonCoins: 0,
  commonShake: 2.5,
  commonScreenShake: 4,
  commonPush: 0.03,
  commonFlash: 0.55,
  commonRings: 2,
  commonRays: 0.35,
  commonDoubleBurst: 0,
  commonFreezeMs: 0,
  commonPitch: 1.12,

  rareColor: '#5aa8ff',
  rareChargeMs: 680,
  rareHitchMs: 0,
  rareBurstMs: 580,
  rareRevealHoldMs: 650,
  rareChargeParticles: 28,
  rareBurstSparks: 56,
  rareEmbers: 20,
  rareDebris: 14,
  rareCoins: 0,
  rareShake: 4,
  rareScreenShake: 7,
  rarePush: 0.05,
  rareFlash: 0.7,
  rareRings: 2,
  rareRays: 0.55,
  rareDoubleBurst: 0,
  rareFreezeMs: 0,
  rarePitch: 1.04,

  epicColor: '#c07bff',
  epicChargeMs: 1100,
  epicHitchMs: 160,
  epicBurstMs: 720,
  epicRevealHoldMs: 850,
  epicChargeParticles: 48,
  epicBurstSparks: 84,
  epicEmbers: 30,
  epicDebris: 18,
  epicCoins: 0,
  epicShake: 5.5,
  epicScreenShake: 10,
  epicPush: 0.075,
  epicFlash: 0.85,
  epicRings: 3,
  epicRays: 0.75,
  epicDoubleBurst: 0,
  epicFreezeMs: 0,
  epicPitch: 0.96,

  legendaryColor: '#ffb938',
  legendaryChargeMs: 1700,
  legendaryHitchMs: 300,
  legendaryBurstMs: 950,
  legendaryRevealHoldMs: 1150,
  legendaryChargeParticles: 76,
  legendaryBurstSparks: 120,
  legendaryEmbers: 44,
  legendaryDebris: 24,
  legendaryCoins: 40,
  legendaryShake: 7.5,
  legendaryScreenShake: 15,
  legendaryPush: 0.1,
  legendaryFlash: 1,
  legendaryRings: 3,
  legendaryRays: 1,
  legendaryDoubleBurst: 1,
  legendaryPitch: 0.88,
  legendaryFreezeMs: 0,

  // ANCIENT (owner 2026-10-02, concept 3 "Prismatic Aurora", the "Time stops" signature): cyan #8af5ff shading to
  // magenta #ff7ae0 (the Pixi light is the cyan; the DOM crack and ribbon carry the gradient). Bigger than Legendary
  // in every dial, plus the freeze. No coins (the gold shower is Legendary's).
  ancientColor: '#8af5ff',
  ancientChargeMs: 1900,
  ancientHitchMs: 260,
  ancientBurstMs: 1050,
  ancientRevealHoldMs: 1400,
  ancientChargeParticles: 90,
  ancientBurstSparks: 150,
  ancientEmbers: 52,
  ancientDebris: 26,
  ancientCoins: 0,
  ancientShake: 8,
  ancientScreenShake: 18,
  ancientPush: 0.12,
  ancientFlash: 1,
  ancientRings: 4,
  ancientRays: 1,
  ancientDoubleBurst: 1,
  ancientPitch: 0.82,
  ancientFreezeMs: 650,

  // Layers (all existing clips): the hum is the End Turn charge build; the pulse a soft trigger tick on every
  // heartbeat; the charge the rune implosion (energy pulled in); the burst the Reborn shatter (a crack, not a
  // boom) with the Ward-break glass under it; the whoosh under the plate's rise; the reveal the sparkle's glitter
  // tail; the stamp the Equipment sheen; the coins the shop's buy clink; the Legendary sting the triple reward.
  // Each rarity plays them at its own pitch (`<rarity>Pitch`): bigger = lower.
  sfxHumClip: 'turncharge',
  sfxHumGain: 0.45,
  sfxPulseClip: 'triggerpulse',
  sfxPulseGain: 0.5,
  sfxChargeClip: 'runeselectimplosion',
  sfxChargeGain: 0, // owner-tuned 2026-09-28: the charge implosion is muted (tuner Copy JSON baked in)
  sfxBurstClip: 'rebornshatter',
  sfxBurstGain: 1,
  sfxCrackClip: 'divineshieldbreak',
  sfxCrackGain: 0.55,
  sfxWhooshClip: 'ceremony/woosh1',
  sfxWhooshGain: 0.55,
  sfxRevealClip: SPARKLE_CLIP,
  sfxRevealGain: 0.8,
  sfxRevealStartMs: 1100,
  sfxRevealLenMs: 900,
  sfxRevealFadeMs: 350,
  sfxStampClip: 'equipmentsheen',
  sfxStampGain: 0.6,
  sfxCoinClip: 'buy1',
  sfxCoinGain: 0.45,
  sfxStingClip: 'triplereward',
  sfxStingGain: 0.7,
  reverbMix: 0.18,
  reverbSec: 0.8,

  crateArt: '',
};

type NumKey = { [K in keyof CrateFxConfig]: CrateFxConfig[K] extends number ? K : never }[keyof CrateFxConfig];
type StrKey = { [K in keyof CrateFxConfig]: CrateFxConfig[K] extends string ? K : never }[keyof CrateFxConfig];

const RARITY_RANGES: Record<RaritySuffix, [number, number, number]> = {
  ChargeMs: [0, 4000, 10],
  HitchMs: [0, 800, 10],
  BurstMs: [100, 2500, 10],
  RevealHoldMs: [0, 4000, 10],
  ChargeParticles: [0, 160, 1],
  BurstSparks: [0, 200, 1],
  Embers: [0, 120, 1],
  Debris: [0, 40, 1],
  Coins: [0, 80, 1],
  Shake: [0, 16, 0.1],
  ScreenShake: [0, 30, 0.5],
  Push: [0, 0.3, 0.005],
  Flash: [0, 1, 0.01],
  Rings: [0, 4, 1],
  Rays: [0, 1, 0.01],
  DoubleBurst: [0, 1, 1],
  Pitch: [0.5, 1.5, 0.01],
  FreezeMs: [0, 2000, 10],
};

/** [min, max, step] for every numeric key. Values outside are clamped on write AND on load. */
export const CRATE_FX_RANGES: Record<NumKey, [number, number, number]> = {
  anticipationMs: [0, 3000, 10],
  anticipationShake: [0, 8, 0.1],
  anticipationGlow: [0, 1, 0.01],
  pulseStartMs: [120, 1200, 10],
  pulseEndMs: [60, 800, 10],
  slowNoteMs: [500, 10000, 100],
  windDownMs: [0, 1500, 10],
  hitchScale: [0.02, 1, 0.01],
  riseMs: [100, 1500, 10],
  gemDelayMs: [0, 1500, 10],
  stampDelayMs: [0, 1500, 10],
  stampMs: [80, 1200, 10],
  ribbonDelayMs: [0, 2000, 10],
  shineDelayMs: [0, 2500, 10],
  shineMs: [100, 2000, 10],
  settleMs: [0, 3000, 10],
  autoNextMs: [0, 3000, 10],
  crateScale: [0.5, 2, 0.01],
  lidOffsetX: [-10, 10, 0.1],
  lidOffsetY: [-10, 10, 0.1],
  lidScale: [0.8, 1.25, 0.005],
  lidJump: [0, 6, 0.1],
  lidLaunchX: [0, 5, 0.1],
  lidLaunchY: [0, 14, 0.1],
  lidSpin: [0, 4, 0.05],
  lidGravity: [0, 40, 0.5],
  seamOffsetY: [-10, 10, 0.1],
  seamWidth: [0.3, 1.4, 0.01],
  seamGlow: [0, 2, 0.01],
  keyholeGlow: [0, 2, 0.01],
  openGlow: [0, 1, 0.01],
  backdropBlur: [0, 20, 0.5],
  reducedFadeMs: [0, 800, 10],
  sfxHumGain: [0, 2, 0.01],
  sfxPulseGain: [0, 2, 0.01],
  sfxChargeGain: [0, 2, 0.01],
  sfxBurstGain: [0, 2, 0.01],
  sfxCrackGain: [0, 2, 0.01],
  sfxWhooshGain: [0, 2, 0.01],
  sfxRevealGain: [0, 2, 0.01],
  sfxRevealStartMs: [0, 4000, 10],
  sfxRevealLenMs: [0, 4000, 10],
  sfxRevealFadeMs: [0, 1000, 10],
  sfxStampGain: [0, 2, 0.01],
  sfxCoinGain: [0, 2, 0.01],
  sfxStingGain: [0, 2, 0.01],
  reverbMix: [0, 0.6, 0.01],
  reverbSec: [0.2, 2, 0.05],
  ...(Object.fromEntries(
    CRATE_RARITIES.flatMap((r) => RARITY_NUM_SUFFIXES.map((s) => [`${r}${s}`, RARITY_RANGES[s]] as const)),
  ) as Record<RarityNumKey, [number, number, number]>),
};

const STR_KEYS: readonly StrKey[] = [
  'sfxHumClip', 'sfxPulseClip', 'sfxChargeClip', 'sfxBurstClip', 'sfxCrackClip', 'sfxWhooshClip', 'sfxRevealClip',
  'sfxStampClip', 'sfxCoinClip', 'sfxStingClip', 'crateArt',
  ...CRATE_RARITIES.map((r) => `${r}Color` as RarityColorKey),
];
const isStrKey = (k: string): k is StrKey => (STR_KEYS as readonly string[]).includes(k);
const isColorKey = (k: string): boolean => k.endsWith('Color');
const HEX = /^#[0-9a-f]{6}$/i;

/** One value, made safe: numbers clamped into range (NaN = the default), colours must be #rrggbb, the art key is
 *  a trimmed string, clips any string. Unknown keys return undefined (dropped). */
export function clampCrateFxValue<K extends keyof CrateFxConfig>(key: K, value: unknown): CrateFxConfig[K] | undefined {
  if (!(key in CRATE_FX_DEFAULTS)) return undefined;
  const def = CRATE_FX_DEFAULTS[key];
  if (isStrKey(key)) {
    if (typeof value !== 'string') return def;
    if (isColorKey(key)) return (HEX.test(value.trim()) ? value.trim().toLowerCase() : def) as CrateFxConfig[K];
    return value.trim().slice(0, 300) as CrateFxConfig[K];
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return def;
  const [min, max] = CRATE_FX_RANGES[key as NumKey];
  return Math.min(max, Math.max(min, n)) as CrateFxConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeCrateFxConfig(saved: unknown): CrateFxConfig {
  const out: CrateFxConfig = { ...CRATE_FX_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampCrateFxValue(k as keyof CrateFxConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.cratefx';

let cfg: CrateFxConfig = (() => {
  if (!import.meta.env.DEV) return { ...CRATE_FX_DEFAULTS };
  try {
    return sanitizeCrateFxConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return { ...CRATE_FX_DEFAULTS };
  }
})();

export function getCrateFxConfig(): CrateFxConfig {
  return cfg;
}

export function setCrateFxValue(key: keyof CrateFxConfig, value: number | string): void {
  const safe = clampCrateFxValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetCrateFxConfig(): void {
  cfg = { ...CRATE_FX_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// ─── the preview speed (DEV only, never saved: it is how you are LOOKING, not what ships) ─────────────────────

export const CRATE_FX_SPEEDS = [1, 0.5, 0.25] as const;
export type CrateFxSpeed = (typeof CRATE_FX_SPEEDS)[number];
let speed: CrateFxSpeed = 1;
/** The playback speed every opening runs at. Always 1 in production. */
export function crateFxSpeed(): CrateFxSpeed { return import.meta.env.DEV ? speed : 1; }
export function setCrateFxSpeed(s: CrateFxSpeed): void { speed = s; }

// ─── the rarity preset (pure) ─────────────────────────────────────────────────────────────────────────────────

export interface CratePreset {
  rarity: CrateRarity;
  /** Rarity colour as a Pixi number and as CSS. */
  color: number;
  colorCss: string;
  chargeMs: number;
  /** The slow-motion held breath at the END of the charge (inside `chargeMs`). */
  hitchMs: number;
  hitchScale: number;
  burstMs: number;
  revealHoldMs: number;
  chargeParticles: number;
  burstSparks: number;
  embers: number;
  debris: number;
  coins: number;
  shake: number;
  screenShake: number;
  /** Camera push-in through the charge (0.1 = 10% closer). */
  push: number;
  flash: number;
  rings: number;
  /** God-ray strength (0..1). */
  rays: number;
  /** A second, smaller burst right after the first. */
  doubleBurst: boolean;
  /** Sound pitch for this rarity's cues. */
  pitch: number;
  /** The heartbeat at the end of the charge (ms between pulses). */
  pulseEndMs: number;
  /** The Legendary sting plays (Legendary and Ancient). */
  sting: boolean;
  /** The rarity's signature moment ('none' for most). */
  signature: CrateSignature;
  /** Time stops: the chest holds, frozen, this long between the charge and the burst (0 = no freeze). */
  freezeMs: number;
}

const hexNum = (hex: string, fallback: string): number => parseInt((HEX.test(hex) ? hex : fallback).slice(1), 16);

/** The rarity a reward plays as. An unknown (a newer server's item on an older client) plays as Common. */
export function crateRarityOf(rarity: string | null | undefined): CrateRarity {
  return (CRATE_RARITIES as readonly string[]).includes(rarity ?? '') ? (rarity as CrateRarity) : 'common';
}

/** Map a reward's rarity to the presentation preset it plays with (pure; reads the given config). */
export function presetFor(rarity: string | null | undefined, c: CrateFxConfig = cfg): CratePreset {
  const r = crateRarityOf(rarity);
  const n = (s: RaritySuffix): number => {
    const v = c[`${r}${s}` as RarityNumKey];
    return Number.isFinite(v) ? v : CRATE_FX_DEFAULTS[`${r}${s}` as RarityNumKey];
  };
  const colorCss = HEX.test(c[`${r}Color`]) ? c[`${r}Color`] : CRATE_FX_DEFAULTS[`${r}Color`];
  const chargeMs = n('ChargeMs');
  return {
    rarity: r,
    color: hexNum(colorCss, CRATE_FX_DEFAULTS[`${r}Color`]),
    colorCss,
    chargeMs,
    hitchMs: Math.min(n('HitchMs'), chargeMs * 0.6),
    hitchScale: Number.isFinite(c.hitchScale) ? c.hitchScale : CRATE_FX_DEFAULTS.hitchScale,
    burstMs: n('BurstMs'),
    revealHoldMs: n('RevealHoldMs'),
    chargeParticles: Math.round(n('ChargeParticles')),
    burstSparks: Math.round(n('BurstSparks')),
    embers: Math.round(n('Embers')),
    debris: Math.round(n('Debris')),
    coins: Math.round(n('Coins')),
    shake: n('Shake'),
    screenShake: n('ScreenShake'),
    push: n('Push'),
    flash: n('Flash'),
    rings: Math.round(n('Rings')),
    rays: n('Rays'),
    doubleBurst: n('DoubleBurst') >= 0.5,
    pitch: n('Pitch'),
    pulseEndMs: Number.isFinite(c.pulseEndMs) ? c.pulseEndMs : CRATE_FX_DEFAULTS.pulseEndMs,
    sting: r === 'legendary' || r === 'ancient',
    signature: RARITY_SIGNATURE[r],
    freezeMs: n('FreezeMs'),
  };
}

/** The chest's fit and motion values, as the scene takes them (pure). */
export function chestTuningOf(c: CrateFxConfig = cfg): {
  lidOffsetX: number; lidOffsetY: number; lidScale: number; lidJump: number; lidLaunchX: number; lidLaunchY: number;
  lidSpin: number; lidGravity: number; seamOffsetY: number; seamWidth: number; seamGlow: number; keyholeGlow: number; openGlow: number;
} {
  return {
    lidOffsetX: c.lidOffsetX, lidOffsetY: c.lidOffsetY, lidScale: c.lidScale, lidJump: c.lidJump,
    lidLaunchX: c.lidLaunchX, lidLaunchY: c.lidLaunchY, lidSpin: c.lidSpin, lidGravity: c.lidGravity,
    seamOffsetY: c.seamOffsetY, seamWidth: c.seamWidth, seamGlow: c.seamGlow, keyholeGlow: c.keyholeGlow, openGlow: c.openGlow,
  };
}

// ─── the beats (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/** One opening's beats in ms, counted from the BRANCH (the answer is in and the anticipation's minimum is over).
 *  Already divided by the playback speed. */
export interface CrateBeats {
  /** The least anticipation before the branch (from the click). */
  anticipationMs: number;
  chargeAt: number;
  /** The slow-motion hitch starts (== the charge's end when there is none). The hum cuts here: silence before the hit. */
  hitchAt: number;
  /** Time stops (a freezing signature), or -1. The burst follows `freezeMs` later. */
  freezeAt: number;
  burstAt: number;
  /** The second burst (Legendary), or -1. */
  burst2At: number;
  /** The nameplate starts rising out of the light (the whoosh). */
  revealAt: number;
  gemAt: number;
  stampAt: number;
  ribbonAt: number;
  shineAt: number;
  /** The light starts dimming; the Open next / Done buttons are live from here. */
  settleAt: number;
  /** Everything idle. */
  endAt: number;
  riseMs: number;
  stampMs: number;
  shineMs: number;
}

/** Where in the burst the reward begins to rise. */
export const REVEAL_IN_BURST = 0.3;
/** Where in the burst the Legendary second burst lands (capped at 320 ms, as the scene does). */
export const SECOND_BURST_IN = 0.3;

export function crateBeats(p: CratePreset, c: CrateFxConfig = cfg, opts: { reduced?: boolean; speed?: number } = {}): CrateBeats {
  const k = 1 / Math.max(0.05, opts.speed ?? 1);
  const pos = (v: number): number => Math.max(0, Number.isFinite(v) ? v : 0);
  if (opts.reduced) {
    const fade = pos(c.reducedFadeMs) * k;
    return { anticipationMs: 0, chargeAt: 0, hitchAt: 0, freezeAt: -1, burstAt: 0, burst2At: -1, revealAt: 0, gemAt: 0, stampAt: 0, ribbonAt: 0, shineAt: 0, settleAt: fade, endAt: fade, riseMs: fade, stampMs: 0, shineMs: 0 };
  }
  const chargeAt = 0;
  const chargeEnd = chargeAt + pos(p.chargeMs);
  const freeze = pos(p.freezeMs);
  const burstAt = chargeEnd + freeze;
  const hitchAt = chargeEnd - pos(p.hitchMs);
  // the second burst waits for the first's revealing flash; the plate waits for the second when there is one
  const burst2 = p.doubleBurst ? burstAt + Math.min(320, pos(p.burstMs) * SECOND_BURST_IN) : -1;
  const revealAt = Math.max(burstAt + pos(p.burstMs) * REVEAL_IN_BURST, burst2 >= 0 ? burst2 : 0);
  // landed = the plate, the name and the ribbon are in (the shine plays on into the hold)
  const landed = Math.max(pos(c.riseMs), pos(c.stampDelayMs) + pos(c.stampMs), pos(c.ribbonDelayMs) + 200);
  const settleAt = revealAt + landed + pos(p.revealHoldMs);
  const endAt = settleAt + pos(c.settleMs);
  return {
    anticipationMs: pos(c.anticipationMs) * k,
    chargeAt: chargeAt * k,
    hitchAt: hitchAt * k,
    freezeAt: freeze > 0 ? chargeEnd * k : -1,
    burstAt: burstAt * k,
    burst2At: burst2 >= 0 ? burst2 * k : -1,
    revealAt: revealAt * k,
    gemAt: (revealAt + pos(c.gemDelayMs)) * k,
    stampAt: (revealAt + pos(c.stampDelayMs)) * k,
    ribbonAt: (revealAt + pos(c.ribbonDelayMs)) * k,
    shineAt: (revealAt + pos(c.shineDelayMs)) * k,
    settleAt: settleAt * k,
    endAt: endAt * k,
    riseMs: pos(c.riseMs) * k,
    stampMs: pos(c.stampMs) * k,
    shineMs: pos(c.shineMs) * k,
  };
}

// ─── sound cues ───────────────────────────────────────────────────────────────────────────────────────────────

export type CrateCue = 'hum' | 'pulse' | 'charge' | 'burst' | 'crack' | 'whoosh' | 'reveal' | 'stamp' | 'coin' | 'sting';
/** Each cue's own mixer fader (see audio/config.ts). */
export const CRATE_CUE_CATEGORY: Record<CrateCue, string> = {
  hum: 'crateHum', pulse: 'cratePulse', charge: 'crateCharge', burst: 'crateBurst', crack: 'crateBurst', whoosh: 'crateWhoosh',
  reveal: 'crateReveal', stamp: 'crateStamp', coin: 'crateCoin', sting: 'crateSting',
};

export interface CrateCueSetting { clip: string; gain: number; startMs: number; lenMs: number; tail: TailOpts }

export function crateCue(c: CrateFxConfig, cue: CrateCue): CrateCueSetting {
  const tail = (fadeOutMs: number): TailOpts => ({ fadeOutMs, reverbMix: c.reverbMix, reverbSec: c.reverbSec });
  const dry: TailOpts = { fadeOutMs: 0, reverbMix: 0, reverbSec: 0 };
  switch (cue) {
    case 'hum': return { clip: c.sfxHumClip, gain: c.sfxHumGain, startMs: 0, lenMs: 0, tail: dry };
    case 'pulse': return { clip: c.sfxPulseClip, gain: c.sfxPulseGain, startMs: 0, lenMs: 0, tail: dry };
    case 'charge': return { clip: c.sfxChargeClip, gain: c.sfxChargeGain, startMs: 0, lenMs: 0, tail: tail(200) };
    case 'burst': return { clip: c.sfxBurstClip, gain: c.sfxBurstGain, startMs: 0, lenMs: 0, tail: tail(200) };
    case 'crack': return { clip: c.sfxCrackClip, gain: c.sfxCrackGain, startMs: 0, lenMs: 0, tail: tail(200) };
    case 'whoosh': return { clip: c.sfxWhooshClip, gain: c.sfxWhooshGain, startMs: 0, lenMs: 0, tail: tail(250) };
    case 'reveal': return { clip: c.sfxRevealClip, gain: c.sfxRevealGain, startMs: c.sfxRevealStartMs, lenMs: c.sfxRevealLenMs, tail: tail(c.sfxRevealFadeMs) };
    case 'stamp': return { clip: c.sfxStampClip, gain: c.sfxStampGain, startMs: 0, lenMs: 0, tail: tail(250) };
    case 'coin': return { clip: c.sfxCoinClip, gain: c.sfxCoinGain, startMs: 0, lenMs: 0, tail: dry };
    case 'sting': return { clip: c.sfxStingClip, gain: c.sfxStingGain, startMs: 0, lenMs: 0, tail: tail(300) };
  }
}

// ─── the tuner ────────────────────────────────────────────────────────────────────────────────────────────────

const RARITY_LABEL: Record<CrateRarity, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', ancient: 'Ancient' };

/** [label, unit, hint] per rarity suffix. */
const RARITY_SPECS: Record<RaritySuffix, [string, TunerUnit | undefined, string]> = {
  ChargeMs: ['Charge', 'ms', 'The build after the server answers: the gem ignites, rarity light floods the seam and cracks, energy is pulled in.'],
  HitchMs: ['Hitch', 'ms', 'The slow-motion held breath at the END of the charge, before the burst. 0 = none.'],
  BurstMs: ['Burst', 'ms', 'The explosion: flash, rings, rays, the lid and shards. The plate starts rising 30% in (after the second burst, if any).'],
  RevealHoldMs: ['Reveal hold', 'ms', 'How long the reveal stays at full glow before it settles.'],
  ChargeParticles: ['Pulled particles', undefined, 'Energy streaks pulled into the chest during the charge.'],
  BurstSparks: ['Burst sparks', undefined, 'Fast sparks and streaks the burst throws.'],
  Embers: ['Embers', undefined, 'Slow, flickering embers that drift and fall after the burst.'],
  Debris: ['Shards', undefined, 'Wood and bronze shards the chest breaks into.'],
  Coins: ['Coins', undefined, 'Gold coins thrown by the burst. 0 = none.'],
  Shake: ['Chest shake', 'px', 'How hard the chest shakes at the peak of the charge.'],
  ScreenShake: ['Screen shake', 'px', 'The burst hit on the whole view (it decays). A fifth of it rumbles through the charge.'],
  Push: ['Camera push', '×', 'How far the view pushes in through the charge (it snaps back on the burst). 0.1 = 10%.'],
  Flash: ['Flash', 'opacity', 'The white-hot flash at the burst.'],
  Rings: ['Shockwave rings', undefined, 'Rings the burst sends out, each slower and wider.'],
  Rays: ['God rays', 'opacity', 'The light rays: peeking in the charge, behind the reward after. 0 = none.'],
  DoubleBurst: ['Double burst', undefined, 'A second, smaller burst (with the coins) right after the first.'],
  Pitch: ['Sound pitch', '×', 'The pitch of this rarity’s cues. Lower = bigger.'],
  FreezeMs: ['Time stop', 'ms', 'A freezing signature (Ancient): how long the chest holds frozen, drained to grey, before the burst. 0 = none.'],
};

/** [label, unit, hint, group] for the global numeric keys. Declaration order is render order. */
const GLOBAL_SPECS: Partial<Record<NumKey, [string, TunerUnit | undefined, string, string]>> = {
  anticipationMs: ['Anticipation', 'ms', 'The least time the chest breathes after the click, even if the server answers at once. It holds longer if the server is slow.', 'Anticipation'],
  anticipationShake: ['Anticipation shake', 'px', 'The shake the anticipation escalates to.', 'Anticipation'],
  anticipationGlow: ['Seam light', 'opacity', 'How much warm light leaks from the seam while it waits.', 'Anticipation'],
  pulseStartMs: ['Heartbeat', 'ms', 'Time between pulses while it waits.', 'Anticipation'],
  pulseEndMs: ['Heartbeat at the burst', 'ms', 'The pulses accelerate through the charge to this.', 'Anticipation'],
  hitchScale: ['Hitch speed', '×', 'How slow the held breath runs (0.1 = nearly frozen).', 'Anticipation'],
  slowNoteMs: ['Slow note after', 'ms', 'Without an answer by then, "Still opening" shows under the chest.', 'Anticipation'],
  windDownMs: ['Wind down', 'ms', 'A failed answer: how long the light and shake take to fade before the message.', 'Anticipation'],
  riseMs: ['Plate rise', 'ms', 'The nameplate rising out of the light (overshoot, settle).', 'Reveal'],
  gemDelayMs: ['Gem pop at', 'ms', 'From the reveal to the gem popping on the plate.', 'Reveal'],
  stampDelayMs: ['Name stamp at', 'ms', 'From the reveal to the name stamping in.', 'Reveal'],
  stampMs: ['Name stamp', 'ms', 'The name stamping in.', 'Reveal'],
  ribbonDelayMs: ['Ribbon at', 'ms', 'From the reveal to the rarity ribbon stamping (with a small shake).', 'Reveal'],
  shineDelayMs: ['Shine at', 'ms', 'From the reveal to the shine sweeping the plate.', 'Reveal'],
  shineMs: ['Shine', 'ms', 'The shine sweeping across the plate.', 'Reveal'],
  settleMs: ['Settle', 'ms', 'The light dimming to its lingering glow after the hold.', 'Reveal'],
  autoNextMs: ['Open all pause', 'ms', 'Open all: the pause after a reward settles before the next crate starts.', 'Reveal'],
  crateScale: ['Chest size', '×', 'The chest (body) size, on top of its fitted size.', 'Chest'],
  lidOffsetX: ['Lid x', '%', 'Nudge the lid sideways on the body (% of the chest width). 0 = the measured fit.', 'Chest'],
  lidOffsetY: ['Lid y', '%', 'Nudge the lid up or down on the body (% of the chest width). 0 = the measured fit.', 'Chest'],
  lidScale: ['Lid size', '×', 'The lid against the body. 1 = the measured fit.', 'Chest'],
  lidJump: ['Lid jump', '%', 'How far the lid jumps on each heartbeat (% of the chest width). It grows with the pressure.', 'Chest'],
  lidLaunchX: ['Lid launch sideways', undefined, 'The lid’s sideways speed at the burst (chest widths per second, random side).', 'Chest'],
  lidLaunchY: ['Lid launch up', undefined, 'The lid’s upward speed at the burst (chest widths per second).', 'Chest'],
  lidSpin: ['Lid spin', undefined, 'How fast the lid tumbles (turns per second).', 'Chest'],
  lidGravity: ['Lid gravity', undefined, 'How hard the lid falls back (chest widths per second squared).', 'Chest'],
  seamOffsetY: ['Seam light y', '%', 'Move the seam light up or down against the rim (% of the chest width).', 'Chest'],
  seamWidth: ['Seam light width', '×', 'The seam light’s length against the rim.', 'Chest'],
  seamGlow: ['Seam light', '×', 'How bright the light leaking from the seam is.', 'Chest'],
  keyholeGlow: ['Keyhole light', '×', 'How bright the light in and around the keyhole is.', 'Chest'],
  openGlow: ['Open chest glow', 'opacity', 'The light pouring out of the open body after the lid is gone.', 'Chest'],
  backdropBlur: ['Backdrop blur', 'px', 'The blur on the page behind the opening (applied once, never animated).', 'Stage'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the reward just fades in over this long.', 'Stage'],
};

/** Sound rows: [numeric key, label, unit, hint], grouped per cue with the cue's clip select first. */
const SOUND_GROUPS: [string, StrKey | null, [NumKey, string, TunerUnit | undefined, string][]][] = [
  ['Sound: hum', 'sfxHumClip', [['sfxHumGain', 'hum: gain', undefined, 'The hum that builds from the click. It cuts at the hitch (or the burst).']]],
  ['Sound: pulse', 'sfxPulseClip', [['sfxPulseGain', 'pulse: gain', undefined, 'A tick on every heartbeat, rising in pitch through the charge.']]],
  ['Sound: charge', 'sfxChargeClip', [['sfxChargeGain', 'charge: gain', undefined, 'The energy being pulled in as the gem ignites.']]],
  ['Sound: burst', 'sfxBurstClip', [['sfxBurstGain', 'burst: gain', undefined, 'The chest breaking. Kept a crack, not a boom.']]],
  ['Sound: crack', 'sfxCrackClip', [['sfxCrackGain', 'crack: gain', undefined, 'A glassy crack layered under Epic and Legendary bursts.']]],
  ['Sound: whoosh', 'sfxWhooshClip', [['sfxWhooshGain', 'whoosh: gain', undefined, 'Under the plate rising out of the light.']]],
  ['Sound: reveal', 'sfxRevealClip', [
    ['sfxRevealGain', 'reveal: gain', undefined, 'The sparkle as the plate rises.'],
    ['sfxRevealStartMs', 'reveal: clip start', 'ms', 'Start this far into the clip (the default skips the whoosh and plays the glitter).'],
    ['sfxRevealLenMs', 'reveal: clip length', 'ms', 'Play only this long (0 = to the end).'],
    ['sfxRevealFadeMs', 'reveal: fade-out', 'ms', 'Fade over the last N ms so the cut window rings out.'],
  ]],
  ['Sound: stamp', 'sfxStampClip', [['sfxStampGain', 'stamp: gain', undefined, 'The shine as the rarity ribbon stamps.']]],
  ['Sound: coins', 'sfxCoinClip', [['sfxCoinGain', 'coins: gain', undefined, 'Clinks under the coin shower (a few, at random pitches).']]],
  ['Sound: Legendary sting', 'sfxStingClip', [['sfxStingGain', 'sting: gain', undefined, 'The extra sting a Legendary or Ancient reveal plays.']]],
  ['Sound: tail', null, [
    ['reverbMix', 'Reverb mix', undefined, 'A light reverb tail under the cues. 0 = dry.'],
    ['reverbSec', 'Reverb length', 's', 'How long that tail rings.'],
  ]],
];

function clipOptions(): string[] {
  let names: string[] = [];
  try { names = clipNames(); } catch { /* no audio in this environment */ }
  return [NO_CLIP, ...names.filter((n) => n !== NO_CLIP)];
}

type Ctl = TunerControl<Extract<keyof CrateFxConfig, string>>;

function buildControls(): Ctl[] {
  const out: Ctl[] = [];
  for (const [key, spec] of Object.entries(GLOBAL_SPECS) as [NumKey, [string, TunerUnit | undefined, string, string]][]) {
    const [min, max, step] = CRATE_FX_RANGES[key];
    out.push({ key, label: spec[0], unit: spec[1], hint: spec[2], group: spec[3], min, max, step });
  }
  for (const r of CRATE_RARITIES) {
    const group = RARITY_LABEL[r];
    out.push({ key: `${r}Color`, label: 'Colour', hint: `The ${group} colour: the gem, the seam and crack light, the rings, the sparks, the rays.`, group, kind: 'color', min: 0, max: 0, step: 0 });
    for (const s of RARITY_NUM_SUFFIXES) {
      const [label, unit, hint] = RARITY_SPECS[s];
      const [min, max, step] = RARITY_RANGES[s];
      out.push(s === 'DoubleBurst'
        ? { key: `${r}${s}`, label, unit, hint, group, min, max, step, kind: 'toggle', onValue: 1, offValue: 0 }
        : { key: `${r}${s}`, label, unit, hint, group, min, max, step });
    }
  }
  const clips = clipOptions();
  for (const [group, clipKey, rows] of SOUND_GROUPS) {
    if (clipKey) {
      out.push({ key: clipKey, label: `${group.replace('Sound: ', '')}: clip`, hint: 'Which clip this cue plays. (none) = silent.', group, kind: 'select', options: clips, optionLabels: { [NO_CLIP]: '(none)' }, min: 0, max: 0, step: 0 });
    }
    for (const [key, label, unit, hint] of rows) {
      const [min, max, step] = CRATE_FX_RANGES[key];
      out.push({ key, label, unit, hint, group, min, max, step });
    }
  }
  out.push({ key: 'crateArt', label: 'One-picture override', hint: 'A single picture to use instead of the two-layer chest (for example /crates/crate.webp). Empty = the two-layer chest.', group: 'Art', kind: 'text', placeholder: 'empty = the two-layer chest', maxLength: 300, min: 0, max: 0, step: 0 });
  return out;
}

/** Window event the tuner's Play buttons fire; `CratePreview` listens for it in dev builds. */
export const CRATE_FX_PLAY_EVENT = 'ascent:cratefx-play';
export type CrateFxPlayMode = CrateRarity | 'replay' | 'fail' | 'slow' | 'all';
/** `speed` (optional) sets the preview speed first: lets a capture script drive slow motion without the panel. */
export interface CrateFxPlayDetail { mode: CrateFxPlayMode; speed?: CrateFxSpeed }

function play(mode: CrateFxPlayMode): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<CrateFxPlayDetail>(CRATE_FX_PLAY_EVENT, { detail: { mode } }));
}

/** The whole opening's length from the click to the buttons, for the panel header. */
export function crateTotalMs(r: CrateRarity, c: CrateFxConfig = cfg): number {
  const b = crateBeats(presetFor(r, c), c);
  return b.anticipationMs + b.settleAt;
}

export const SPEC: TunerSpec<CrateFxConfig> = {
  id: 'cratefx',                    // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Crate opening',
  note: () => {
    const c = getCrateFxConfig();
    const t = CRATE_RARITIES.map((r) => `${RARITY_LABEL[r][0]} ${(crateTotalMs(r, c) / 1000).toFixed(1)}`).join(' · ');
    return `dev · ${crateFxSpeed()}x · ${t} s`;
  },
  read: getCrateFxConfig,
  write: (key, value) => setCrateFxValue(key, value),
  writeColor: (key, value) => setCrateFxValue(key, value),
  reset: resetCrateFxConfig,
  defaults: CRATE_FX_DEFAULTS,
  controls: buildControls(),
  actions: [
    ...CRATE_RARITIES.map((r) => ({
      label: `▶ ${RARITY_LABEL[r]}`,
      hint: `Open a practice crate that always gives a ${RARITY_LABEL[r]} reward. Local only: it never calls the server and spends nothing.`,
      run: () => play(r),
    })),
    { label: '↻ Replay', hint: 'Play the last rarity again.', run: () => play('replay') },
    { label: '▶ Slow server', hint: 'The anticipation holds for 3 seconds before a Rare lands, as on a slow connection.', run: () => play('slow') },
    { label: '▶ Failure', hint: 'The server fails: the anticipation holds, winds down, and says so.', run: () => play('fail') },
    { label: `▶ Open all (${CRATE_RARITIES.length})`, hint: `Open ${CRATE_RARITIES.length} practice crates in a row (${CRATE_RARITIES.map((r) => RARITY_LABEL[r]).join(', ')}), as Open all does.`, run: () => play('all') },
    ...CRATE_FX_SPEEDS.map((s) => ({
      label: `Speed ${s}x`,
      hint: 'Slow motion for the next plays (the tuner only; never saved, never in production).',
      run: () => { setCrateFxSpeed(s); },
    })),
  ],
};
