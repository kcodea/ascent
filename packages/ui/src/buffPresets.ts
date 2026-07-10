// packages/ui/src/buffPresets.ts
import type { Tribe } from '@game/core';

/** One buff-cast look. Every dial the renderer reads is a field here (no hardcoded constants), so a preset is
 *  a complete, self-contained config. `style` selects the renderer (only 'tendril' is built; 'lightning' /
 *  'beam' are reserved). Colors are hex strings; the renderer converts to Pixi tints. */
export interface BuffPresetCfg {
  style: 'tendril' | 'lightning' | 'beam';
  /** How the tendril + glow/flash/mote layers composite. 'add' = additive bloom (pops on dark bg, washes on the
   *  light board); 'normal' = paints the actual color (reads on cream); 'screen' = lighten. */
  blend: 'add' | 'normal' | 'screen';
  // path
  curve: number; wobbleAmp: number; wobbleFreq: number; travelMs: number; retractMs: number;
  // ribbon
  baseWidth: number; tipWidth: number; coreAlpha: number; glowWidth: number; glowAlpha: number;
  // strike (flashSize is a px radius — 1:1 with the preview rig, no bake conversion)
  flashSize: number; flashMs: number; moteCount: number; moteSpeed: number; moteLife: number;
  // caster (pulseSize is a px radius — 1:1 with the preview rig, no bake conversion)
  pulseSize: number; pulseAlpha: number; pulseMs: number;
  // colors
  colorCore: string; colorGlow: string; colorFlash: string; colorMote: string;
}

/** Owner-tuned on the preview rig (2026-07-10, the "newdefault" preset). `flashSize`/`pulseSize` are PX RADII
 *  (1:1 with the preview — the engine divides by the glow basis). Widths/alphas/durations transfer directly.
 *  `default` shares these values until it gets its own tuned look; only the Kennelmaster card fires in the
 *  iteration-1 slice, so `default` is not yet exercised live. */
const BASE: BuffPresetCfg = {
  style: 'tendril', blend: 'normal',
  curve: 1, wobbleAmp: 29.5, wobbleFreq: 1.4, travelMs: 570, retractMs: 150,
  baseWidth: 8, tipWidth: 1.5, coreAlpha: 0.3, glowWidth: 26, glowAlpha: 0.44,
  flashSize: 99, flashMs: 430, moteCount: 34, moteSpeed: 590, moteLife: 700,
  pulseSize: 98, pulseAlpha: 0.68, pulseMs: 630,
  colorCore: '#ffffff', colorGlow: '#17c200', colorFlash: '#71fe34', colorMote: '#3ebd0f',
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
