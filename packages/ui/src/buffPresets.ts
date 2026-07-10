// packages/ui/src/buffPresets.ts
import type { Tribe } from '@game/core';

/** One buff-cast look. Every dial the renderer reads is a field here (no hardcoded constants), so a preset is
 *  a complete, self-contained config. `style` selects the renderer (only 'tendril' is built; 'lightning' /
 *  'beam' are reserved). Colors are hex strings; the renderer converts to Pixi tints. */
export interface BuffPresetCfg {
  style: 'tendril' | 'lightning' | 'beam';
  // path
  curve: number; wobbleAmp: number; wobbleFreq: number; travelMs: number; retractMs: number;
  // ribbon
  baseWidth: number; tipWidth: number; coreAlpha: number; glowWidth: number; glowAlpha: number;
  // strike
  flashSize: number; flashMs: number; moteCount: number; moteSpeed: number; moteLife: number;
  // caster
  pulseSize: number; pulseAlpha: number; pulseMs: number;
  // colors
  colorCore: string; colorGlow: string; colorFlash: string; colorMote: string;
}

/** Starter dials — replaced by the owner's tuned values (Phase 2). Complete + typed so logic/tests are honest. */
const BASE: BuffPresetCfg = {
  style: 'tendril',
  curve: 0.3, wobbleAmp: 10, wobbleFreq: 2.5, travelMs: 200, retractMs: 140,
  baseWidth: 10, tipWidth: 1.5, coreAlpha: 1, glowWidth: 22, glowAlpha: 0.5,
  flashSize: 1.6, flashMs: 200, moteCount: 12, moteSpeed: 260, moteLife: 420,
  pulseSize: 1.4, pulseAlpha: 0.5, pulseMs: 180,
  colorCore: '#eaffb0', colorGlow: '#c8e070', colorFlash: '#dfffa0', colorMote: '#c8e070',
};

export const BUFF_PRESETS: Record<string, BuffPresetCfg> = {
  default: { ...BASE },
  kennelmaster: { ...BASE },
};

/** Card-id / tribe → preset-name assignment. Most-specific wins (see `buffPreset`). */
const BUFF_ASSIGN: { byCard: Record<string, string>; byTribe: Partial<Record<Tribe, string>> } = {
  byCard: { kennel: 'kennelmaster' },
  byTribe: {},
};

/** Resolve the preset name for a buff source: per-card → per-tribe → 'default'. A name is only returned if it
 *  exists in BUFF_PRESETS (a stale mapping falls through to 'default'). */
export function buffPreset(cardId: string, tribe: Tribe): string {
  const byCard = BUFF_ASSIGN.byCard[cardId];
  if (byCard && BUFF_PRESETS[byCard]) return byCard;
  const byTribe = BUFF_ASSIGN.byTribe[tribe];
  if (byTribe && BUFF_PRESETS[byTribe]) return byTribe;
  return 'default';
}
