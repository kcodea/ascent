// packages/ui/src/descendPresets.ts
import type { Tribe } from '@game/core';
import type { PulsePresetCfg } from './pulsePresets';

/** One Deathrattle-buff "descend" look: a short ribbon dropping from above a card into its center, then a pulse
 *  on landing. Every dial the renderer reads is a field here. The landing blast reuses the full PulsePresetCfg.
 *  Sizes are px (1:1 with the preview rig). */
export interface DescendPresetCfg {
  blend: 'add' | 'normal' | 'screen';
  // drop (the descending ribbon)
  startHeight: number; dropMs: number; curve: number; wobbleAmp: number; wobbleFreq: number; retractMs: number;
  baseWidth: number; tipWidth: number; coreAlpha: number; glowWidth: number; glowAlpha: number;
  colorCore: string; colorGlow: string;
  // landing blast — the tuned gold self-buff pulse by default (fully tunable per descend preset)
  pulse: PulsePresetCfg;
}

/** The default landing pulse mirrors the shipped self-buff pulse (white shockwave + gold core + spark burst). */
const DEFAULT_PULSE: PulsePresetCfg = {
  style: 'ring', blend: 'add',
  ringCount: 1, ringSize: 173, ringWidth: 16, ringSpeed: 2.45, ringMs: 280, ringStaggerMs: 200,
  coreFlashSize: 200, coreFlashMs: 950,
  sparkCount: 60, sparkSpeed: 390, sparkLife: 1400, sparkSize: 7,
  holdMs: 60,
  colorRing: '#ffffff', colorCore: '#fff694', colorSpark: '#fef962',
};

/** Starter descend look (owner tunes on the rig; per-tribe presets are a follow-up — do NOT invent tuned dials). */
const DEFAULT: DescendPresetCfg = {
  blend: 'add',
  startHeight: 120, dropMs: 300, curve: 0.1, wobbleAmp: 8, wobbleFreq: 2, retractMs: 120,
  baseWidth: 9, tipWidth: 2, coreAlpha: 0.9, glowWidth: 34, glowAlpha: 0.25,
  colorCore: '#ffffff', colorGlow: '#fff694',
  pulse: { ...DEFAULT_PULSE },
};

export const DESCEND_PRESETS: Record<string, DescendPresetCfg> = { default: { ...DEFAULT } };

const DESCEND_ASSIGN: { byCard: Record<string, string>; byTribe: Partial<Record<Tribe, string>> } = {
  byCard: {}, byTribe: {},
};

/** Resolve the descend preset for a source: per-card → per-tribe → 'default' (only a name present in
 *  DESCEND_PRESETS is returned). Mirror of `pulsePreset`/`buffPreset`. */
export function descendPreset(cardId: string, tribe: Tribe): string {
  const byCard = DESCEND_ASSIGN.byCard[cardId];
  if (byCard && DESCEND_PRESETS[byCard]) return byCard;
  const byTribe = DESCEND_ASSIGN.byTribe[tribe];
  if (byTribe && DESCEND_PRESETS[byTribe]) return byTribe;
  return 'default';
}
