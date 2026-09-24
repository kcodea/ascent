/** THE DEFAULT MIX (owner ask 2026-09-24): "bake these audio values as the default volumes, but all at the 50 mark
 *  for volume." The owner's tuned mix was Game sounds 50, Music 20, Announcer 70 on the Settings Audio sliders. Every
 *  slider now DEFAULTS to 50, and 50 plays at the owner's level for that channel.
 *
 *  So a slider position is no longer the gain itself: each channel maps its slider (0..1) through a piecewise-linear
 *  curve anchored on its REFERENCE gain (the owner's mix):
 *    · 0 .. 0.5  →  0 .. ref        (0 is silent)
 *    · 0.5 .. 1  →  ref .. max      (100 is the channel's full gain, exactly what 100 played before)
 *  Nothing ever exceeds the gain the slider reached at 100 before this change. Game sounds keeps its identity
 *  mapping (ref 0.5, max 1 is the straight line), so its slider value still IS the SFX master gain.
 *
 *  The slider value (what storage holds and the Settings row shows) stays 0..1; this curve runs at the ONE place
 *  each channel turns it into a gain (`level()` in music.ts and announcer.ts). */

/** Where every channel's slider starts (the "50 mark"). */
export const DEFAULT_SLIDER = 0.5;

export type AudioChannelId = 'sfx' | 'music' | 'announcer';

/** The owner's 2026-09-23 mix: the gain each channel plays at slider 50. */
export const CHANNEL_REF_GAIN: Readonly<Record<AudioChannelId, number>> = { sfx: 0.5, music: 0.2, announcer: 0.7 };
/** The gain each channel plays at slider 100 (unchanged from before the curve: full scale). */
export const CHANNEL_MAX_GAIN: Readonly<Record<AudioChannelId, number>> = { sfx: 1, music: 1, announcer: 1 };

/** Slider position (0..1, clamped) → the channel's gain. */
export function sliderToGain(channel: AudioChannelId, slider: number): number {
  const s = Number.isFinite(slider) ? Math.min(1, Math.max(0, slider)) : DEFAULT_SLIDER;
  const ref = CHANNEL_REF_GAIN[channel];
  const max = CHANNEL_MAX_GAIN[channel];
  if (s <= DEFAULT_SLIDER) return (s / DEFAULT_SLIDER) * ref;
  return ref + ((s - DEFAULT_SLIDER) / (1 - DEFAULT_SLIDER)) * (max - ref);
}
