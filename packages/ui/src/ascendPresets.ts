// packages/ui/src/ascendPresets.ts
import type { Tribe } from '@game/core';

/** One transform "morph" look — the FX when a unit ASCENDS into another (Tara→Taragosa, Spirit Pup→Worgen).
 *  Owner-tuned on `apps/web/public/fx/transform-morph-preview.html`. Only the `flash` style is built (a bright
 *  bloom that masks the card swap, then the new card pops in); `dissolve`/`shatter`/`wipe`/`vortex` are reserved
 *  rig styles. Sizes are px (1:1 with the rig — `flashSize` ÷ the glow-texture radius gives the sprite scale).
 *  `colorSpark`/`swapAt` are carried for round-trip fidelity + the reserved styles; the flash renderer reads
 *  `flashSize`/`flashAlpha`/`flashMs`/`colorGlow` (the bloom) and `overshoot` (the CSS new-card pop). */
export interface AscendPresetCfg {
  style: 'flash' | 'dissolve' | 'shatter' | 'wipe' | 'vortex';
  durationMs: number;
  flashSize: number; flashAlpha: number; flashMs: number;
  colorGlow: string; colorSpark: string;
  swapAt: number; overshoot: number;
}

/** The owner-tuned default transform morph (2026-07-13, baked from the rig's JSON) — a bright lime-white flash
 *  bloom that masks the swap, then the new card pops in. */
const DEFAULT: AscendPresetCfg = {
  style: 'flash',
  durationMs: 1080,
  flashSize: 190, flashAlpha: 1, flashMs: 660,
  colorGlow: '#cdffa3', colorSpark: '#c79bff',
  swapAt: 0.55, overshoot: 0.32,
};

export const ASCEND_PRESETS: Record<string, AscendPresetCfg> = { default: { ...DEFAULT } };

const ASCEND_ASSIGN: { byCard: Record<string, string>; byTribe: Partial<Record<Tribe, string>> } = {
  byCard: {}, byTribe: {},
};

/** Resolve the morph preset for an ascending unit: per-card → per-tribe → 'default' (only a name present in
 *  ASCEND_PRESETS is returned). Mirror of `pulsePreset`/`descendPreset`. */
export function ascendPreset(cardId: string, tribe: Tribe): string {
  const byCard = ASCEND_ASSIGN.byCard[cardId];
  if (byCard && ASCEND_PRESETS[byCard]) return byCard;
  const byTribe = ASCEND_ASSIGN.byTribe[tribe];
  if (byTribe && ASCEND_PRESETS[byTribe]) return byTribe;
  return 'default';
}
