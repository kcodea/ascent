/**
 * THE KNOCKOUT VARIANT'S SHARED PIECES ("Tier V", owner ask 2026-10-02: "ancient tier animations should have a
 * separate tier of dmg specific for knockouts. they can just be small changes to the 'huge' tier ... slightly more
 * emphasis on the knockout animation").
 *
 * An Ancient attack's Knockout variant is its Huge (Tier IV) REMIXED, never a new animation: one extra beat (the
 * style's own), plus the same four accents every variant shares, which live here:
 *  - THE PRISM: the Ancient rarity's prismatic palette (cyan #8af5ff to magenta #ff7ae0) layered over the attack's own
 *    colours on the final blast.
 *  - A BIGGER SHAKE (`KO_SHAKE`).
 *  - A SLOW-MO DIP on the final blast: the one clock drops to `lo` and eases back to full speed over `ms`. It is a
 *    smooth ramp that never reaches 0: NEVER a freeze (owner 2026-09-28, R-PROG-ATTACK-10).
 *  - A short KO STING on the final impact: a bright two-note synth bell (no clip, so never the rune explosion or the
 *    turn explosion sounds, owner 2026-10-02).
 *
 * Presentation only. Each variant adds well under 500 ms over its Huge tier.
 */
import { playBellStrike } from '../sfx';
import type { AttackVoices } from './attackSound';

/** The Ancient prism: cyan, a lilac midpoint, magenta. */
export const KO_CYAN = 0x8af5ff;
export const KO_LILAC = 0xc4b8ff;
export const KO_MAGENTA = 0xff7ae0;
export const KO_PRISM: readonly number[] = [KO_CYAN, KO_LILAC, KO_MAGENTA];

/** How much harder a Knockout variant shakes than its Huge tier. */
export const KO_SHAKE = 1.3;

/** The slow-mo dip on the final blast (sequence ms; `lo` is the slowest speed, never 0). */
export interface KoDip { at: number; lo: number; ms: number }

/** The default dip: drops to 0.35x and recovers over 300 ms of attack time (~170 ms more real time). */
export const KO_DIP = { lo: 0.35, ms: 300 } as const;

/** The clock's speed at sequence time `t` under a dip (1 outside it; a smoothstep back up from `lo`). Pure. */
export function koTimeScale(d: KoDip | null, t: number): number {
  if (!d || d.ms <= 0 || t < d.at || t >= d.at + d.ms) return 1;
  const u = (t - d.at) / d.ms;
  const lo = Math.min(1, Math.max(0.1, d.lo));
  return lo + (1 - lo) * u * u * (3 - 2 * u);
}

/** The extra REAL ms a dip adds (for the safety timer and the length readout). Pure. */
export function koDipExtraMs(d: KoDip | null): number {
  if (!d || d.ms <= 0) return 0;
  let extra = 0;
  for (let t = d.at; t < d.at + d.ms; t += 5) extra += 5 / koTimeScale(d, t) - 5;
  return extra;
}

/** A frame source whose steps are scaled by `scale()` (the dip): the ONE clock still advances every frame. */
export function scaledFrames(
  base: (fn: (dtMs: number) => void) => () => void,
  scale: () => number,
): (fn: (dtMs: number) => void) => () => void {
  return (fn) => base((dt) => fn(dt * scale()));
}

/**
 * THE KO STING: a bright two-note bell (a high strike, then a fifth above it a beat later), layered on the final
 * impact. `real` turns attack ms into real ms (the playback speed).
 */
export function playKoSting(voices: AttackVoices, sound: boolean, real: (ms: number) => number, gain = 0.55): void {
  if (!sound || !(gain > 0)) return;
  voices.keep(playBellStrike('attack', { gain, hz: 1568, decayMs: real(700) }));
  voices.keep(playBellStrike('attack', { gain: gain * 0.85, hz: 2349, decayMs: real(900), delayMs: real(85) }));
}
