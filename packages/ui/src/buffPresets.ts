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

/** Per-tribe tendril looks, owner-tuned on the preview rig (2026-07-10, normal blend / cream-accurate).
 *  `flashSize`/`pulseSize` are PX RADII (1:1 with the preview — the engine divides by the glow basis);
 *  widths/alphas/durations/colors transfer directly. `default` is the fallback for neutral + any unmapped
 *  buffer (no dedicated neutral look yet, so it reuses the beast green). `imp-tribe` is the Demon tribe's
 *  look (imps = demons). Values generated straight from the owner's bake JSON to avoid transcription drift. */
const BEAST_TRIBE: BuffPresetCfg = { style: 'tendril', blend: 'normal',
  curve: 0.68, wobbleAmp: 11, wobbleFreq: 3.5, travelMs: 430, retractMs: 150,
  baseWidth: 8, tipWidth: 1.5, coreAlpha: 0.7, glowWidth: 34, glowAlpha: 0.22,
  flashSize: 99, flashMs: 430, moteCount: 34, moteSpeed: 590, moteLife: 700,
  pulseSize: 98, pulseAlpha: 0.68, pulseMs: 630,
  colorCore: '#00cc03', colorGlow: '#8bfe7c', colorFlash: '#71fe34', colorMote: '#3ebd0f' };

export const BUFF_PRESETS: Record<string, BuffPresetCfg> = {
  "beast-tribe": BEAST_TRIBE,
  "mech-tribe": { style: 'tendril', blend: 'normal',
    curve: 0.35, wobbleAmp: 33, wobbleFreq: 6, travelMs: 350, retractMs: 150,
    baseWidth: 3, tipWidth: 1.5, coreAlpha: 0.7, glowWidth: 34, glowAlpha: 0.22,
    flashSize: 110, flashMs: 430, moteCount: 40, moteSpeed: 590, moteLife: 870,
    pulseSize: 98, pulseAlpha: 1, pulseMs: 630,
    colorCore: '#fffca3', colorGlow: '#ffeb8a', colorFlash: '#fdffe0', colorMote: '#feec76' },
  "dragon-tribe": { style: 'tendril', blend: 'normal',
    curve: 0.29, wobbleAmp: 0, wobbleFreq: 0, travelMs: 620, retractMs: 50,
    baseWidth: 20.5, tipWidth: 1.5, coreAlpha: 1, glowWidth: 34, glowAlpha: 0.1,
    flashSize: 110, flashMs: 430, moteCount: 40, moteSpeed: 590, moteLife: 870,
    pulseSize: 98, pulseAlpha: 1, pulseMs: 630,
    colorCore: '#fe7c7c', colorGlow: '#ff9494', colorFlash: '#fe6262', colorMote: '#ff0000' },
  "imp-tribe": { style: 'tendril', blend: 'normal',
    curve: 0.29, wobbleAmp: 40, wobbleFreq: 1.4, travelMs: 780, retractMs: 160,
    baseWidth: 20.5, tipWidth: 6.5, coreAlpha: 1, glowWidth: 61, glowAlpha: 0.08,
    flashSize: 81, flashMs: 700, moteCount: 28, moteSpeed: 270, moteLife: 1180,
    pulseSize: 98, pulseAlpha: 1, pulseMs: 630,
    colorCore: '#54006b', colorGlow: '#a271fe', colorFlash: '#8e06fe', colorMote: '#460075' },
  "undead-tribe": { style: 'tendril', blend: 'normal',
    curve: 0.14, wobbleAmp: 39, wobbleFreq: 3.2, travelMs: 780, retractMs: 70,
    baseWidth: 2.5, tipWidth: 16, coreAlpha: 1, glowWidth: 7, glowAlpha: 0.14,
    flashSize: 81, flashMs: 700, moteCount: 32, moteSpeed: 600, moteLife: 510,
    pulseSize: 98, pulseAlpha: 1, pulseMs: 630,
    colorCore: '#d6e8ff', colorGlow: '#39bcfe', colorFlash: '#3ddfff', colorMote: '#00aed1' },
  default: { ...BEAST_TRIBE }, // neutral + unmapped fallback (no dedicated look yet — reuses the beast green)
};

/** Card-id / tribe → preset-name assignment. Most-specific wins (see `buffPreset`). Each tribe gets its own
 *  tendril look (owner ruling 2026-07-10); `imp-tribe` = Demon. Neutral has no entry → falls to `default`. */
const BUFF_ASSIGN: { byCard: Record<string, string>; byTribe: Partial<Record<Tribe, string>> } = {
  byCard: {},
  byTribe: { beast: 'beast-tribe', mech: 'mech-tribe', dragon: 'dragon-tribe', demon: 'imp-tribe', undead: 'undead-tribe' },
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

/**
 * Aura-WAVE colours per tribe — deliberately separate from the tendril presets above.
 *
 * The tendril presets are authored for `blend: 'normal'`, where a deep colour like the Demon core
 * (`#54006b`) reads as rich. The aura wave draws with **`blend: 'add'`**, where the visible contribution is
 * the colour's LUMINANCE — so those same values nearly vanish. Measured against the beast palette the wave
 * borrowed from before this existed:
 *
 * ```
 *            core    glow    mote
 * demon      0.207   0.524   0.091   ← motes 6.4x dimmer than beast, core 4x
 * beast      0.821   0.863   0.586
 * ```
 *
 * The motes are the CONTINUOUS element that rides the expanding front; the wake puffs are dropped at
 * discrete `glowSpacing` intervals. So when the motes don't render, all that's left is the stepped wake —
 * which reads as a stuttering, frame-bound animation even though the wave is purely time-based (owner
 * report 2026-07-19: "the demon aura wash isn't as smooth as the others"). It was a luminance problem, not
 * a timing one.
 *
 * Rule for adding a tribe here: keep every channel above ~0.45 relative luminance. Hue carries the tribe;
 * brightness carries the motion.
 */
export interface WavePaletteCfg { colorCore: string; colorGlow: string; colorMote: string }

export const WAVE_PALETTES: Record<string, WavePaletteCfg> = {
  // Demon — the same violet identity, lifted into the range additive blending can actually show.
  'imp-tribe': { colorCore: '#c98bff', colorGlow: '#b78dff', colorMote: '#9d6bff' },
  'beast-tribe': { colorCore: '#71fe34', colorGlow: '#8bfe7c', colorMote: '#3ebd0f' },
};

/** The wave palette for a tribe — its dedicated entry if one exists, else the tendril preset's colours
 *  (fine for the already-bright tribes; see WAVE_PALETTES for why Demon needed its own). */
export function wavePalette(presetName: string): WavePaletteCfg {
  const p = WAVE_PALETTES[presetName];
  if (p) return p;
  const t = BUFF_PRESETS[presetName] ?? BUFF_PRESETS.default!;
  return { colorCore: t.colorFlash, colorGlow: t.colorGlow, colorMote: t.colorMote };
}
