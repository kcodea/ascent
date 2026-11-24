/**
 * PACK OPENING: the rarity glows (owner 2026-11-23: "i want each pack rarity to have its own glow around it too. same
 * with card rarity"). Pure data + selection, shared by the Pixi scene (the sealed pack's aura, the card backs' glow) and
 * the DOM faces (the revealed face's aura), so the two read as one system.
 *
 * Strength climbs with rarity: Common and Rare are subtle and STATIC (they never keep the scene's ticker awake), Epic
 * breathes gently, Legendary and Ancient breathe strongly. The per-tier numbers are fixed here; the Pack Lab's two
 * master knobs (`packGlow`, `cardGlow` in packFxConfig.ts, 0..2, default 1) scale them.
 *
 * Performance: every glow is a pre-rendered blurred texture (Pixi) or a STATIC box-shadow (DOM); only alpha / opacity
 * animates (the kwglow rule).
 */
import { COSMETIC_RARITIES, type CrateRarity, type PackLook } from '@game/progression';

/** How a tier breathes: not at all, gently (Epic), or strongly (Legendary / Ancient). */
export type GlowPulse = 'none' | 'gentle' | 'strong';

export interface GlowTier {
  /** Resting alpha of the Pixi glow sprite (before the master knob). */
  alpha: number;
  /** The glow sprite's scale about its centre: how far the halo reaches past the edge (1 = the painted halo). */
  size: number;
  /** The breathing kind. */
  pulse: GlowPulse;
  /** Alpha swing either side of `alpha` while breathing (0 when static). */
  amp: number;
  /** Breathing speed in radians per 60 Hz frame (0 when static). */
  rate: number;
}

/** The card glow (backs in the scene) by rarity. Legendary / Ancient keep the original strong pulse (0.22 at 0.09). */
export const CARD_GLOW_TIERS: Readonly<Record<CrateRarity, GlowTier>> = {
  common: { alpha: 0.2, size: 0.97, pulse: 'none', amp: 0, rate: 0 },
  rare: { alpha: 0.3, size: 1, pulse: 'none', amp: 0, rate: 0 },
  epic: { alpha: 0.4, size: 1.03, pulse: 'gentle', amp: 0.1, rate: 0.05 },
  legendary: { alpha: 0.5, size: 1.06, pulse: 'strong', amp: 0.22, rate: 0.09 },
  ancient: { alpha: 0.55, size: 1.06, pulse: 'strong', amp: 0.22, rate: 0.09 },
};

/** The sealed pack's aura by rarity: Common faint and tight, Rare a bit more, Epic and up larger, brighter, breathing slowly. */
export const PACK_GLOW_TIERS: Readonly<Record<CrateRarity, GlowTier>> = {
  common: { alpha: 0.22, size: 0.96, pulse: 'none', amp: 0, rate: 0 },
  rare: { alpha: 0.32, size: 1, pulse: 'none', amp: 0, rate: 0 },
  epic: { alpha: 0.46, size: 1.05, pulse: 'gentle', amp: 0.1, rate: 0.035 },
  legendary: { alpha: 0.56, size: 1.08, pulse: 'strong', amp: 0.16, rate: 0.045 },
  ancient: { alpha: 0.6, size: 1.08, pulse: 'strong', amp: 0.16, rate: 0.045 },
};

/**
 * The DOM face aura's resting opacity by rarity (before the `cardGlow` knob; the product is capped at 1). Its pulse is
 * `CARD_GLOW_TIERS[r].pulse`, played by CSS (`pkf-aura-gentle` / `pkf-aura-strong`).
 */
export const FACE_GLOW_OPACITY: Readonly<Record<CrateRarity, number>> = {
  common: 0.4, rare: 0.5, epic: 0.6, legendary: 0.7, ancient: 0.72,
};

/** Which rarity a pack glows: a rarity pack its own rarity (its id, e.g. `rare` / `rarity-rare`), any other its floor. */
export function packGlowRarity(look: PackLook): CrateRarity {
  if (look.kind === 'rarity') {
    const id = look.id.replace(/^rarity-/, '');
    if ((COSMETIC_RARITIES as readonly string[]).includes(id)) return id as CrateRarity;
  }
  return look.guaranteedFloor;
}

/** A tier's alpha at `time` (60 Hz frames), times the master knob; never negative. Static tiers ignore `time`. */
export function glowAlphaAt(tier: GlowTier, time: number, master: number): number {
  const a = tier.amp > 0 ? tier.alpha + tier.amp * Math.sin(time * tier.rate) : tier.alpha;
  return Math.max(0, a * master);
}

/** The face aura's static opacity: the tier's opacity times the `cardGlow` knob, capped at 1. */
export const faceGlowOpacity = (r: CrateRarity, master: number): number =>
  Math.min(1, Math.max(0, FACE_GLOW_OPACITY[r] * (Number.isFinite(master) ? master : 1)));
