/**
 * PACK OPENING: the holographic / pearlescent sheen (owner 2026-11-23: "a holographic or pearlescent sheen on the
 * higher-rarity packs and cards", "almost holographic or pearlescent?"). Pure data + selection, shared by the Pixi pack
 * holo (packHoloMesh.ts, under each wrapper's greyscale shine mask) and the DOM face holo (packFaces.tsx), so both read
 * as one system.
 *
 * Common and Rare carry none; Epic and Legendary a soft pearl leaning toward their rarity hue; Ancient (and the Secret
 * pack) a full rainbow. The Pack Lab's `holo` knob (packFxConfig.ts, 0..2, default 1; 0 = off) scales every tier.
 */
import type { CrateRarity, PackLook } from '@game/progression';
import { SECRET_PACK_LOOK_ID } from './packArt';
import { packGlowRarity } from './packGlow';
import { PACK_RARITY_COLORS } from './packTextures';

/** The sealed pack's holo strength by its glow rarity (the Secret pack counts as top tier, `SECRET_PACK_HOLO`). */
export const PACK_HOLO_STRENGTH: Readonly<Record<CrateRarity, number>> = {
  common: 0, rare: 0, epic: 0.35, legendary: 0.55, ancient: 0.85,
};
export const SECRET_PACK_HOLO = 0.85;

/** A revealed card face's holo strength by the card's rarity. */
export const CARD_HOLO_STRENGTH: Readonly<Record<CrateRarity, number>> = {
  common: 0, rare: 0, epic: 0.3, legendary: 0.5, ancient: 0.8,
};

const master = (m: number): number => (Number.isFinite(m) ? Math.max(0, m) : 1);

const isSecret = (look: PackLook): boolean => look.kind === 'themed' && look.id === SECRET_PACK_LOOK_ID;

/** The pack's holo strength: its tier x the `holo` knob (0 = off). */
export function packHoloStrength(look: PackLook, holo: number): number {
  const base = isSecret(look) ? SECRET_PACK_HOLO : PACK_HOLO_STRENGTH[packGlowRarity(look)];
  return base * master(holo);
}

/** A card face's holo strength: its rarity's tier x the `holo` knob (0 = off). */
export function cardHoloStrength(r: CrateRarity, holo: number): number {
  return CARD_HOLO_STRENGTH[r] * master(holo);
}

/** The holo's colour: a hue bias (0..1 rgb) and how far it is a full rainbow (1) rather than a pearl on that hue (0). */
export interface HoloHue { rgb: readonly [number, number, number]; rainbow: number }

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** A rarity's holo colour: Ancient a full rainbow, the rest a pearl leaning toward their `PACK_RARITY_COLORS` hue. */
export function holoHueFor(r: CrateRarity): HoloHue {
  return { rgb: hexRgb(PACK_RARITY_COLORS[r]), rainbow: r === 'ancient' ? 1 : 0 };
}

/** The pack's holo colour (the Secret pack is a full rainbow, like Ancient). */
export function packHoloHue(look: PackLook): HoloHue {
  return isSecret(look) ? holoHueFor('ancient') : holoHueFor(packGlowRarity(look));
}

/**
 * Where the pack holo's static gradient is sampled this frame: a 2D offset (gradient units, about one colour cycle
 * per 1) from the eased cursor aim (`ax`, `ay`, -1..1), the sealed tilt (`rx`, `ry` degrees), the tear's progress
 * (`peel`, 0..1) and the sleeve's slide (`slide`, base units). Pure; writes `out`. A settled pack gives the same
 * offset every frame, so nothing moves.
 */
export function holoShiftInto(
  out: { x: number; y: number }, ax: number, ay: number, rx: number, ry: number, peel: number, slide: number,
): { x: number; y: number } {
  out.x = ax * 0.32 + ry * 0.03 + peel * 0.45;
  out.y = ay * 0.22 - rx * 0.025 + slide * 0.0025;
  return out;
}
