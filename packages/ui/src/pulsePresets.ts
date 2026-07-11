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

/** A neutral starter look (owner tunes the real values on the rig; per-tribe presets are added AFTER tuning,
 *  same as the tendril tribe presets — do NOT invent tuned numbers here). */
const DEFAULT: PulsePresetCfg = {
  style: 'ring', blend: 'normal',
  ringCount: 2, ringSize: 90, ringWidth: 6, ringSpeed: 1, ringMs: 460, ringStaggerMs: 70,
  coreFlashSize: 70, coreFlashMs: 320,
  sparkCount: 14, sparkSpeed: 420, sparkLife: 620, sparkSize: 10,
  holdMs: 100,
  colorRing: '#ffd24a', colorCore: '#fff0d0', colorSpark: '#ffb054',
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
