import { COSMETIC_RARITIES, type CosmeticRarity } from '@game/progression';
import type { TunerControl, TunerSpec, TunerUnit } from '../../tunerSchema';
import type { TailOpts } from '../../audio/tailFade';
import { clipNames } from '../../sfx';

/**
 * THE CRATE OPENING: its tunable numbers (owner ask 2026-09-28: "make the collection screen separate and build a
 * AAA animation for crate opening, with pixi and everything. put a tuner in for it to test it").
 *
 * Follows the tuner convention (the Good Luck intro's, the Discover entrance's): localStorage-persisted in DEV
 * only, production always plays `CRATE_FX_DEFAULTS`. Every value is read when an opening STARTS, so moving a
 * slider changes the next play, and the tuner's Play buttons show it at once without spending a real crate.
 * Shipping a feel = pasting the tuner's Copy JSON into `CRATE_FX_DEFAULTS`.
 *
 * THE SEQUENCE (one crate). The rarity is only known when the server answers, so the opening is split in two:
 *
 *   click  ->  ANTICIPATION (starts at once, while the request is in flight: the crate glows, a hum builds, a
 *              shake escalates; it lasts at least `anticipationMs`, and simply HOLDS if the server is slower)
 *   answer ->  CHARGE (rarity colour floods the crate, particles are pulled in, the shake climbs)
 *          ->  BURST  (the lid blows off, flash, shockwave rings, sparks + debris, a short screen shake)
 *          ->  REVEAL (the reward rises out of the light in its rarity aura, the title stamps in)
 *          ->  SETTLE (the aura dims to a lingering glow, then everything is idle and the ticker stops)
 *
 * Each rarity has its own charge, burst, hold, particle counts, shake, flash, rings and god rays, so a Legendary
 * is a longer build and a heavier burst than a Common. A failed answer winds the anticipation down and says
 * "Could not open the crate. Try again." Reduced motion skips all of it for a short fade.
 */

export type CrateRarity = CosmeticRarity;
export const CRATE_RARITIES: readonly CrateRarity[] = COSMETIC_RARITIES;

/** The per-rarity dials. Each one exists four times in the config, as `<rarity><Suffix>`. */
const RARITY_NUM_SUFFIXES = [
  'ChargeMs', 'BurstMs', 'RevealHoldMs', 'ChargeParticles', 'BurstSparks', 'Debris', 'Shake', 'ScreenShake', 'Flash', 'Rings', 'Rays',
] as const;
type RaritySuffix = (typeof RARITY_NUM_SUFFIXES)[number];
type RarityNumKey = `${CrateRarity}${RaritySuffix}`;
type RarityColorKey = `${CrateRarity}Color`;

interface CrateFxGlobals {
  // ── Anticipation (the click, while the server answers) ──
  /** The least time the anticipation plays before the charge can start, even when the server answers at once. */
  anticipationMs: number;
  /** The crate's shake at the end of the anticipation, in px (it escalates from still). */
  anticipationShake: number;
  /** How bright the glow behind the crate gets during the anticipation (0..1). */
  anticipationGlow: number;
  /** After this long without an answer, "Still opening" shows under the crate. */
  slowNoteMs: number;
  /** A failed (or empty) answer: how long the glow and shake take to die down before the message shows. */
  windDownMs: number;
  // ── Reveal ──
  /** The reward plate rising out of the light. */
  riseMs: number;
  /** From the reveal to the title stamping in. */
  stampDelayMs: number;
  /** The title's stamp (scale down + fade in). */
  stampMs: number;
  /** The aura dimming from the reveal to its lingering idle glow. */
  settleMs: number;
  /** Open all: the pause after one reward settles before the next crate starts. */
  autoNextMs: number;
  /** The screen shake's length at the burst (its strength is per rarity). */
  screenShakeMs: number;
  /** The crate's size, as a multiplier on its fitted size. */
  crateScale: number;
  /** Reduced motion: the reward's fade. */
  reducedFadeMs: number;
  // ── Sound ──
  sfxHumClip: string;
  sfxHumGain: number;
  sfxChargeClip: string;
  sfxChargeGain: number;
  sfxChargeOffsetMs: number;
  sfxBurstClip: string;
  sfxBurstGain: number;
  sfxBurstOffsetMs: number;
  sfxRevealClip: string;
  sfxRevealGain: number;
  sfxRevealStartMs: number;
  sfxRevealLenMs: number;
  sfxRevealFadeMs: number;
  sfxStampClip: string;
  sfxStampGain: number;
  sfxStingClip: string;
  sfxStingGain: number;
  reverbMix: number;
  reverbSec: number;
  // ── Art ──
  /** THE ONE ART KEY: a URL (e.g. `/crates/crate.webp`) for the crate picture. Empty = the procedural crate.
   *  With art, the whole picture shakes, charges and bursts as one piece (no separate lid). */
  crateArt: string;
}

export type CrateFxConfig = CrateFxGlobals & { [K in RarityNumKey]: number } & { [K in RarityColorKey]: string };

/** An empty clip = silent. */
export const NO_CLIP = '';
/** The owner's sparkle-whoosh clip; the reveal plays only its glitter tail (the Good Luck intro's window). */
export const SPARKLE_CLIP = 'fx/djartmusic-christmas-sparkle-whoosh-1-275404';

/** Shipped values. See `crateBeats` for the resulting timeline per rarity. */
export const CRATE_FX_DEFAULTS: CrateFxConfig = {
  anticipationMs: 700,
  anticipationShake: 1.4,
  anticipationGlow: 0.5,
  slowNoteMs: 2500,
  windDownMs: 420,
  riseMs: 520,
  stampDelayMs: 160,
  stampMs: 360,
  settleMs: 900,
  autoNextMs: 700,
  screenShakeMs: 320,
  crateScale: 1,
  reducedFadeMs: 240,

  commonColor: '#cfd8e3',
  commonChargeMs: 300,
  commonBurstMs: 450,
  commonRevealHoldMs: 500,
  commonChargeParticles: 10,
  commonBurstSparks: 24,
  commonDebris: 8,
  commonShake: 2,
  commonScreenShake: 0,
  commonFlash: 0.45,
  commonRings: 1,
  commonRays: 0,

  rareColor: '#6fb0ff',
  rareChargeMs: 550,
  rareBurstMs: 550,
  rareRevealHoldMs: 700,
  rareChargeParticles: 22,
  rareBurstSparks: 44,
  rareDebris: 12,
  rareShake: 3.5,
  rareScreenShake: 4,
  rareFlash: 0.6,
  rareRings: 1,
  rareRays: 0,

  epicColor: '#c98bff',
  epicChargeMs: 950,
  epicBurstMs: 700,
  epicRevealHoldMs: 900,
  epicChargeParticles: 40,
  epicBurstSparks: 70,
  epicDebris: 16,
  epicShake: 5,
  epicScreenShake: 7,
  epicFlash: 0.75,
  epicRings: 2,
  epicRays: 6,

  legendaryColor: '#ffbe5c',
  legendaryChargeMs: 1500,
  legendaryBurstMs: 900,
  legendaryRevealHoldMs: 1300,
  legendaryChargeParticles: 64,
  legendaryBurstSparks: 110,
  legendaryDebris: 22,
  legendaryShake: 7,
  legendaryScreenShake: 11,
  legendaryFlash: 0.95,
  legendaryRings: 3,
  legendaryRays: 12,

  // The hum is the End Turn charge build (a rising swell), faded out at the burst. The charge is the rune arrival's
  // implosion (energy pulled in). The burst is the Reborn shatter (a crack, not a boom). The reveal is the
  // sparkle's glitter tail, the stamp the Equipment sheen, and the Legendary sting the triple reward.
  sfxHumClip: 'turncharge',
  sfxHumGain: 0.5,
  sfxChargeClip: 'runeselectimplosion',
  sfxChargeGain: 0.8,
  sfxChargeOffsetMs: 0,
  sfxBurstClip: 'rebornshatter',
  sfxBurstGain: 1,
  sfxBurstOffsetMs: 0,
  sfxRevealClip: SPARKLE_CLIP,
  sfxRevealGain: 0.8,
  sfxRevealStartMs: 1100,
  sfxRevealLenMs: 900,
  sfxRevealFadeMs: 350,
  sfxStampClip: 'equipmentsheen',
  sfxStampGain: 0.6,
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
  BurstMs: [100, 2500, 10],
  RevealHoldMs: [0, 4000, 10],
  ChargeParticles: [0, 120, 1],
  BurstSparks: [0, 180, 1],
  Debris: [0, 40, 1],
  Shake: [0, 16, 0.1],
  ScreenShake: [0, 24, 0.5],
  Flash: [0, 1, 0.01],
  Rings: [0, 4, 1],
  Rays: [0, 24, 1],
};

/** [min, max, step] for every numeric key. Values outside are clamped on write AND on load. */
export const CRATE_FX_RANGES: Record<NumKey, [number, number, number]> = {
  anticipationMs: [0, 3000, 10],
  anticipationShake: [0, 8, 0.1],
  anticipationGlow: [0, 1, 0.01],
  slowNoteMs: [500, 10000, 100],
  windDownMs: [0, 1500, 10],
  riseMs: [100, 1500, 10],
  stampDelayMs: [0, 1000, 10],
  stampMs: [80, 1200, 10],
  settleMs: [0, 3000, 10],
  autoNextMs: [0, 3000, 10],
  screenShakeMs: [0, 1000, 10],
  crateScale: [0.5, 2, 0.01],
  reducedFadeMs: [0, 800, 10],
  sfxHumGain: [0, 2, 0.01],
  sfxChargeGain: [0, 2, 0.01],
  sfxChargeOffsetMs: [-500, 500, 5],
  sfxBurstGain: [0, 2, 0.01],
  sfxBurstOffsetMs: [-300, 300, 5],
  sfxRevealGain: [0, 2, 0.01],
  sfxRevealStartMs: [0, 4000, 10],
  sfxRevealLenMs: [0, 4000, 10],
  sfxRevealFadeMs: [0, 1000, 10],
  sfxStampGain: [0, 2, 0.01],
  sfxStingGain: [0, 2, 0.01],
  reverbMix: [0, 0.6, 0.01],
  reverbSec: [0.2, 2, 0.05],
  ...(Object.fromEntries(
    CRATE_RARITIES.flatMap((r) => RARITY_NUM_SUFFIXES.map((s) => [`${r}${s}`, RARITY_RANGES[s]] as const)),
  ) as Record<RarityNumKey, [number, number, number]>),
};

const STR_KEYS: readonly StrKey[] = [
  'sfxHumClip', 'sfxChargeClip', 'sfxBurstClip', 'sfxRevealClip', 'sfxStampClip', 'sfxStingClip', 'crateArt',
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
  burstMs: number;
  revealHoldMs: number;
  chargeParticles: number;
  burstSparks: number;
  debris: number;
  shake: number;
  screenShake: number;
  flash: number;
  rings: number;
  rays: number;
  /** The Legendary sting plays. */
  sting: boolean;
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
  return {
    rarity: r,
    color: hexNum(colorCss, CRATE_FX_DEFAULTS[`${r}Color`]),
    colorCss,
    chargeMs: n('ChargeMs'),
    burstMs: n('BurstMs'),
    revealHoldMs: n('RevealHoldMs'),
    chargeParticles: Math.round(n('ChargeParticles')),
    burstSparks: Math.round(n('BurstSparks')),
    debris: Math.round(n('Debris')),
    shake: n('Shake'),
    screenShake: n('ScreenShake'),
    flash: n('Flash'),
    rings: Math.round(n('Rings')),
    rays: Math.round(n('Rays')),
    sting: r === 'legendary',
  };
}

// ─── the beats (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/** One opening's beats in ms, counted from the BRANCH (the answer is in and the anticipation's minimum is over).
 *  Already divided by the playback speed. */
export interface CrateBeats {
  /** The least anticipation before the branch (from the click). */
  anticipationMs: number;
  chargeAt: number;
  burstAt: number;
  /** The reward starts rising out of the light (a third of the way into the burst). */
  revealAt: number;
  stampAt: number;
  /** The aura starts dimming; the Open next / Done buttons are live from here. */
  settleAt: number;
  /** Everything idle. */
  endAt: number;
  riseMs: number;
  stampMs: number;
  screenShakeMs: number;
}

/** Where in the burst the reward begins to rise. */
export const REVEAL_IN_BURST = 0.35;

export function crateBeats(p: CratePreset, c: CrateFxConfig = cfg, opts: { reduced?: boolean; speed?: number } = {}): CrateBeats {
  const k = 1 / Math.max(0.05, opts.speed ?? 1);
  const pos = (v: number): number => Math.max(0, Number.isFinite(v) ? v : 0);
  if (opts.reduced) {
    const fade = pos(c.reducedFadeMs) * k;
    return { anticipationMs: 0, chargeAt: 0, burstAt: 0, revealAt: 0, stampAt: 0, settleAt: fade, endAt: fade, riseMs: fade, stampMs: 0, screenShakeMs: 0 };
  }
  const chargeAt = 0;
  const burstAt = chargeAt + pos(p.chargeMs);
  const revealAt = burstAt + pos(p.burstMs) * REVEAL_IN_BURST;
  const stampAt = revealAt + pos(c.stampDelayMs);
  const landed = Math.max(pos(c.riseMs), pos(c.stampDelayMs) + pos(c.stampMs));
  const settleAt = revealAt + landed + pos(p.revealHoldMs);
  const endAt = settleAt + pos(c.settleMs);
  return {
    anticipationMs: pos(c.anticipationMs) * k,
    chargeAt: chargeAt * k,
    burstAt: burstAt * k,
    revealAt: revealAt * k,
    stampAt: stampAt * k,
    settleAt: settleAt * k,
    endAt: endAt * k,
    riseMs: pos(c.riseMs) * k,
    stampMs: pos(c.stampMs) * k,
    screenShakeMs: pos(c.screenShakeMs) * k,
  };
}

// ─── sound cues ───────────────────────────────────────────────────────────────────────────────────────────────

export type CrateCue = 'hum' | 'charge' | 'burst' | 'reveal' | 'stamp' | 'sting';
/** Each cue's own mixer fader (see audio/config.ts). */
export const CRATE_CUE_CATEGORY: Record<CrateCue, string> = {
  hum: 'crateHum', charge: 'crateCharge', burst: 'crateBurst', reveal: 'crateReveal', stamp: 'crateStamp', sting: 'crateSting',
};

export interface CrateCueSetting { clip: string; gain: number; offsetMs: number; startMs: number; lenMs: number; tail: TailOpts }

export function crateCue(c: CrateFxConfig, cue: CrateCue): CrateCueSetting {
  const tail = (fadeOutMs: number): TailOpts => ({ fadeOutMs, reverbMix: c.reverbMix, reverbSec: c.reverbSec });
  switch (cue) {
    case 'hum': return { clip: c.sfxHumClip, gain: c.sfxHumGain, offsetMs: 0, startMs: 0, lenMs: 0, tail: { fadeOutMs: 0, reverbMix: 0, reverbSec: 0 } };
    case 'charge': return { clip: c.sfxChargeClip, gain: c.sfxChargeGain, offsetMs: c.sfxChargeOffsetMs, startMs: 0, lenMs: 0, tail: tail(200) };
    case 'burst': return { clip: c.sfxBurstClip, gain: c.sfxBurstGain, offsetMs: c.sfxBurstOffsetMs, startMs: 0, lenMs: 0, tail: tail(200) };
    case 'reveal': return { clip: c.sfxRevealClip, gain: c.sfxRevealGain, offsetMs: 0, startMs: c.sfxRevealStartMs, lenMs: c.sfxRevealLenMs, tail: tail(c.sfxRevealFadeMs) };
    case 'stamp': return { clip: c.sfxStampClip, gain: c.sfxStampGain, offsetMs: 0, startMs: 0, lenMs: 0, tail: tail(250) };
    case 'sting': return { clip: c.sfxStingClip, gain: c.sfxStingGain, offsetMs: 0, startMs: 0, lenMs: 0, tail: tail(300) };
  }
}

// ─── the tuner ────────────────────────────────────────────────────────────────────────────────────────────────

const RARITY_LABEL: Record<CrateRarity, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

/** [label, unit, hint] per rarity suffix. */
const RARITY_SPECS: Record<RaritySuffix, [string, TunerUnit | undefined, string]> = {
  ChargeMs: ['Charge', 'ms', 'The build after the server answers: the rarity colour floods in, particles are pulled into the crate.'],
  BurstMs: ['Burst', 'ms', 'The lid blowing off: flash, rings, sparks and debris. The reward starts rising a third of the way in.'],
  RevealHoldMs: ['Reveal hold', 'ms', 'How long the reveal stays at full glow before it settles.'],
  ChargeParticles: ['Charge particles', undefined, 'How many particles are pulled into the crate during the charge.'],
  BurstSparks: ['Burst sparks', undefined, 'How many sparks the burst throws.'],
  Debris: ['Debris', undefined, 'How many wood and metal chips fly off at the burst.'],
  Shake: ['Crate shake', 'px', 'How hard the crate shakes at the peak of the charge.'],
  ScreenShake: ['Screen shake', 'px', 'How hard the whole view shakes at the burst. 0 = none.'],
  Flash: ['Flash', 'opacity', 'How bright the burst flash is.'],
  Rings: ['Shockwave rings', undefined, 'How many shockwave rings the burst sends out.'],
  Rays: ['God rays', undefined, 'Light rays behind the reward. 0 = none.'],
};

/** [label, unit, hint, group] for the global numeric keys. Declaration order is render order. */
const GLOBAL_SPECS: Partial<Record<NumKey, [string, TunerUnit | undefined, string, string]>> = {
  anticipationMs: ['Anticipation', 'ms', 'The least time the crate glows and shakes after the click, even if the server answers at once. It holds longer if the server is slow.', 'Anticipation'],
  anticipationShake: ['Anticipation shake', 'px', 'The shake the anticipation escalates to.', 'Anticipation'],
  anticipationGlow: ['Anticipation glow', 'opacity', 'How bright the glow behind the crate gets while it waits.', 'Anticipation'],
  slowNoteMs: ['Slow note after', 'ms', 'Without an answer by then, "Still opening" shows under the crate.', 'Anticipation'],
  windDownMs: ['Wind down', 'ms', 'A failed answer: how long the glow and shake take to fade before the message.', 'Anticipation'],
  riseMs: ['Reward rise', 'ms', 'The reward plate rising out of the light.', 'Reveal'],
  stampDelayMs: ['Stamp delay', 'ms', 'From the reveal to the title stamping in.', 'Reveal'],
  stampMs: ['Stamp', 'ms', 'The title stamping in (shrinks onto the plate as it fades in).', 'Reveal'],
  settleMs: ['Settle', 'ms', 'The aura dimming to its lingering glow after the hold.', 'Reveal'],
  autoNextMs: ['Open all pause', 'ms', 'Open all: the pause after a reward settles before the next crate starts.', 'Reveal'],
  screenShakeMs: ['Screen shake length', 'ms', 'How long the burst screen shake lasts (its strength is per rarity).', 'Reveal'],
  crateScale: ['Crate size', '×', 'The crate size, on top of its fitted size.', 'Reveal'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the reward just fades in over this long.', 'Reveal'],
};

/** Sound rows: [numeric key, label, unit, hint], grouped per cue with the cue's clip select first. */
const SOUND_GROUPS: [string, StrKey, [NumKey, string, TunerUnit | undefined, string][]][] = [
  ['Sound: hum', 'sfxHumClip', [
    ['sfxHumGain', 'hum: gain', undefined, 'The hum that builds from the click (on top of its mixer fader). It fades out quickly at the burst.'],
  ]],
  ['Sound: charge', 'sfxChargeClip', [
    ['sfxChargeGain', 'charge: gain', undefined, 'The energy being pulled in as the charge starts.'],
    ['sfxChargeOffsetMs', 'charge: offset', 'ms', 'Shift the charge cue from the charge start. Negative = earlier (it cannot go before the answer).'],
  ]],
  ['Sound: burst', 'sfxBurstClip', [
    ['sfxBurstGain', 'burst: gain', undefined, 'The lid breaking. Kept a crack, not a boom.'],
    ['sfxBurstOffsetMs', 'burst: offset', 'ms', 'Shift the burst cue from the burst. Negative = earlier.'],
  ]],
  ['Sound: reveal', 'sfxRevealClip', [
    ['sfxRevealGain', 'reveal: gain', undefined, 'The sparkle as the reward rises.'],
    ['sfxRevealStartMs', 'reveal: clip start', 'ms', 'Start this far into the clip (the default skips the whoosh and plays the glitter).'],
    ['sfxRevealLenMs', 'reveal: clip length', 'ms', 'Play only this long (0 = to the end).'],
    ['sfxRevealFadeMs', 'reveal: fade-out', 'ms', 'Fade over the last N ms so the cut window rings out.'],
  ]],
  ['Sound: stamp', 'sfxStampClip', [
    ['sfxStampGain', 'stamp: gain', undefined, 'The shine as the title stamps in.'],
  ]],
  ['Sound: Legendary sting', 'sfxStingClip', [
    ['sfxStingGain', 'sting: gain', undefined, 'The extra sting a Legendary reveal plays.'],
  ]],
  ['Sound: tail', 'sfxHumClip', [
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
    out.push({ key: `${r}Color`, label: 'Colour', hint: `The ${group} colour: the charge, the aura, the rings and the sparks.`, group, kind: 'color', min: 0, max: 0, step: 0 });
    for (const s of RARITY_NUM_SUFFIXES) {
      const [label, unit, hint] = RARITY_SPECS[s];
      const [min, max, step] = RARITY_RANGES[s];
      out.push({ key: `${r}${s}`, label, unit, hint, group, min, max, step });
    }
  }
  const clips = clipOptions();
  for (const [group, clipKey, rows] of SOUND_GROUPS) {
    if (group !== 'Sound: tail') {
      out.push({ key: clipKey, label: `${group.replace('Sound: ', '')}: clip`, hint: 'Which clip this cue plays. (none) = silent.', group, kind: 'select', options: clips, optionLabels: { [NO_CLIP]: '(none)' }, min: 0, max: 0, step: 0 });
    }
    for (const [key, label, unit, hint] of rows) {
      const [min, max, step] = CRATE_FX_RANGES[key];
      out.push({ key, label, unit, hint, group, min, max, step });
    }
  }
  out.push({ key: 'crateArt', label: 'Crate art URL', hint: 'A picture for the crate (for example /crates/crate.webp). Empty = the drawn crate.', group: 'Art', kind: 'text', placeholder: 'empty = drawn crate', maxLength: 300, min: 0, max: 0, step: 0 });
  return out;
}

/** Window event the tuner's Play buttons fire; `CratePreview` listens for it in dev builds. */
export const CRATE_FX_PLAY_EVENT = 'ascent:cratefx-play';
export type CrateFxPlayMode = CrateRarity | 'replay' | 'fail' | 'slow' | 'all';
export interface CrateFxPlayDetail { mode: CrateFxPlayMode }

function play(mode: CrateFxPlayMode): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<CrateFxPlayDetail>(CRATE_FX_PLAY_EVENT, { detail: { mode } }));
}

/** The whole opening's length from the click, for the panel header. */
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
    { label: '▶ Open all (4)', hint: 'Open four practice crates in a row (Common, Rare, Epic, Legendary), as Open all does.', run: () => play('all') },
    ...CRATE_FX_SPEEDS.map((s) => ({
      label: `Speed ${s}x`,
      hint: 'Slow motion for the next plays (the tuner only; never saved, never in production).',
      run: () => { setCrateFxSpeed(s); },
    })),
  ],
};
