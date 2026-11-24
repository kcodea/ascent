/**
 * PACK OPENING: THE BIG-PULL MOMENT (owner 2026-11-23: "A bigger moment for big pulls: when a Legendary or Ancient card
 * flips, a light burst, a short screen shake, and a beat of hold before it lands"). Pure data + math shared by the scene
 * (the Pixi light burst behind the landing face), the shell (the theatre shake, the hold before the next flip, the
 * sound) and the tests. Ancient is the bigger tier: a larger burst with more rays that lasts longer, and a stronger shake.
 *
 * Performance: the burst's textures are painted once; per frame only alpha / scale / rotation change (`burstPoseAt`
 * writes into a caller-owned object). The shake is a one-shot CSS transform keyframe.
 */
import type { CrateRarity } from '@game/progression';

export type BigPullTier = 'none' | 'legendary' | 'ancient';

/** Which big-pull moment a card gets: Legendary and Ancient only (guaranteed or not). */
export function bigPullTier(rarity: CrateRarity): BigPullTier {
  return rarity === 'ancient' ? 'ancient' : rarity === 'legendary' ? 'legendary' : 'none';
}

export interface BurstSpec {
  /** Scale-in time (ms). */
  inMs: number;
  /** Whole burst, scale-in to gone (ms). */
  totalMs: number;
  /** The soft bloom's diameter, in card heights. */
  bloomSize: number;
  /** The god-ray ring's diameter, in card heights. */
  raySize: number;
  /** Rays in the main ring (the textures are painted per count). */
  rays: number;
  /** Ray ring spin (radians per second; the second ring of Ancient spins the other way). */
  spin: number;
  /** Peak alpha at `bigPull` = 1 (the knob multiplies it; capped at 1). */
  peak: number;
}

export const BURST: Readonly<Record<Exclude<BigPullTier, 'none'>, BurstSpec>> = {
  legendary: { inMs: 120, totalMs: 900, bloomSize: 1.9, raySize: 2.6, rays: 12, spin: 0.35, peak: 0.85 },
  ancient: { inMs: 120, totalMs: 1300, bloomSize: 2.4, raySize: 3.3, rays: 18, spin: 0.3, peak: 0.95 },
};

/** Ancient shakes this much harder than Legendary (the `bigPullShake` knob is Legendary's amplitude). */
export const ANCIENT_SHAKE_MULT = 1.5;
/** The shake's length at speed 1 (ms); the CSS keyframe reads it through `--pk-slow`. */
export const BIG_PULL_SHAKE_MS = 260;

/** The theatre shake's amplitude in px for a tier at the knob's value (0 = no shake). */
export const bigPullShakePx = (tier: BigPullTier, knob: number): number =>
  tier === 'none' || !(knob > 0) ? 0 : knob * (tier === 'ancient' ? ANCIENT_SHAKE_MULT : 1);

export interface BurstPose {
  /** 0..1 envelope times the peak and the strength knob (capped at 1). */
  alpha: number;
  /** Multiplier on the tier's sizes (it scales in from 0.55, then keeps swelling a little). */
  scale: number;
  /** The ray ring's rotation (radians). */
  rotation: number;
  /** False once the burst is over. */
  live: boolean;
}

const easeOut = (p: number): number => 1 - (1 - p) * (1 - p) * (1 - p);

/**
 * The burst at `ms` since it started (already slow-mo scaled by the caller's clock), at strength `k` (the `bigPull`
 * knob). Fast scale-in over `inMs`, then a fade to nothing by `totalMs`. Writes into `out`; no allocation.
 */
export function burstPoseAt(spec: BurstSpec, ms: number, k: number, out: BurstPose): BurstPose {
  const t = Math.max(0, ms);
  const strength = Number.isFinite(k) ? Math.max(0, k) : 1;
  out.live = t < spec.totalMs && strength > 0;
  if (!out.live) { out.alpha = 0; out.scale = 1; out.rotation = (spec.spin * spec.totalMs) / 1000; return out; }
  const pin = Math.min(1, t / spec.inMs);
  const fadeP = t <= spec.inMs ? 0 : (t - spec.inMs) / (spec.totalMs - spec.inMs);
  const env = easeOut(pin) * (1 - fadeP) * (1 - fadeP);
  out.alpha = Math.min(1, spec.peak * strength * env);
  out.scale = 0.55 + 0.45 * easeOut(pin) + 0.12 * fadeP;
  out.rotation = (spec.spin * t) / 1000;
  return out;
}
