// packages/ui/src/pulsePresets.ts
import type { Tribe } from '@game/core';

/** One self-buff pulse look. Every dial the renderer reads is a field here (no hardcoded constants), so a
 *  preset is a complete, self-contained config. `style` selects the renderer (only 'ring' is built; 'shard' /
 *  'nova' are reserved). Colors are hex strings; the renderer converts to Pixi tints. Sizes (`ringSize`,
 *  `coreFlashSize`, `sparkSize`) are PX RADII — 1:1 with the preview rig; the engine divides by the texture
 *  radius to get the sprite scale, so preview values transfer with no bake conversion. */
export interface PulsePresetCfg {
  style: 'ring' | 'shard' | 'nova';
  blend: 'add' | 'normal' | 'screen';
  ringCount: number; ringSize: number; ringWidth: number; ringSpeed: number; ringMs: number; ringStaggerMs: number;
  coreFlashSize: number; coreFlashMs: number;
  sparkCount: number; sparkSpeed: number; sparkLife: number; sparkSize: number;
  holdMs: number;
  colorRing: string; colorCore: string; colorSpark: string;
}

/** The owner-tuned default self-buff pulse (2026-07-11, tuned live on buff-pulse-preview.html) — a single fast
 *  white shockwave ring + a big warm-gold core flash + a wide golden spark burst, additive. Applied to EVERY
 *  eligible self-buff (PULSE_ASSIGN is empty, so all resolve here). Values baked straight from the rig's JSON. */
const DEFAULT: PulsePresetCfg = {
  style: 'ring', blend: 'add',
  ringCount: 1, ringSize: 259.5, ringWidth: 16, ringSpeed: 2.45, ringMs: 280, ringStaggerMs: 200,
  coreFlashSize: 300, coreFlashMs: 950,
  sparkCount: 60, sparkSpeed: 585, sparkLife: 1400, sparkSize: 10.5,
  holdMs: 60,
  colorRing: '#ffffff', colorCore: '#fff694', colorSpark: '#fef962',
};

export const PULSE_PRESETS: Record<string, PulsePresetCfg> = {
  default: { ...DEFAULT },
};

/** Card-id / tribe → preset-name assignment. Most-specific wins (see `pulsePreset`). Empty to start; per-tribe
 *  mappings are added alongside the tuned presets in the bake task. */
const PULSE_ASSIGN: { byCard: Record<string, string>; byTribe: Partial<Record<Tribe, string>> } = {
  byCard: {},
  byTribe: {},
};

/** Resolve the preset name for a self-buff source: per-card → per-tribe → 'default'. A name is only returned if
 *  it exists in PULSE_PRESETS (a stale mapping falls through to 'default'). Mirror of `buffPreset`. */
export function pulsePreset(cardId: string, tribe: Tribe): string {
  const byCard = PULSE_ASSIGN.byCard[cardId];
  if (byCard && PULSE_PRESETS[byCard]) return byCard;
  const byTribe = PULSE_ASSIGN.byTribe[tribe];
  if (byTribe && PULSE_PRESETS[byTribe]) return byTribe;
  return 'default';
}
