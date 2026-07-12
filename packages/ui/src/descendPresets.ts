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

/** The owner-tuned default descend landing pulse (2026-07-11, tuned live on buff-descend-preview.html) — a
 *  double amber shockwave + a warm-gold core flash + a wide golden spark burst, normal-blend for the cream board. */
const DEFAULT_PULSE: PulsePresetCfg = {
  style: 'ring', blend: 'normal',
  ringCount: 2, ringSize: 90, ringWidth: 6, ringSpeed: 1.7, ringMs: 500, ringStaggerMs: 50,
  coreFlashSize: 115, coreFlashMs: 470,
  sparkCount: 60, sparkSpeed: 410, sparkLife: 850, sparkSize: 7,
  holdMs: 140,
  colorRing: '#ffac38', colorCore: '#ffec1f', colorSpark: '#ffd22e',
};

/** The owner-tuned default descend (2026-07-11) — a fat, near-transparent amber drop (the read is carried by the
 *  landing pulse) that rains onto every Deathrattle-buffed ally. Applied to all applicable effects (DESCEND_ASSIGN
 *  empty → all resolve here); per-tribe looks are a follow-up. Values baked straight from the rig's JSON. */
const DEFAULT: DescendPresetCfg = {
  blend: 'normal',
  startHeight: 71, dropMs: 340, curve: 0, wobbleAmp: 0, wobbleFreq: 0, retractMs: 180,
  baseWidth: 81.5, tipWidth: 38.5, coreAlpha: 0.05, glowWidth: 0, glowAlpha: 0,
  colorCore: '#ffbb00', colorGlow: '#fe9620',
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
