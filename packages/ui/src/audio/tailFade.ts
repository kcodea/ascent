/**
 * A ONE-SHOT CLIP WITH A SOFT TAIL (owner 2026-09-24: "the good luck sfx ends abruptly. can you give it a tiny
 * bit of reverb and/or fade it out a bit so it isnt an abrupt end").
 *
 * The voice graph, per play:
 *
 *   src → level → env ─┬──────────────→ out → bus
 *                      └→ send → conv ─┘
 *
 * `env` carries the natural-end fade (a ramp to silence over the clip's last `fadeOutMs`), so a trimmed clip no
 * longer stops mid-note. `send → conv` is a light, short convolution tail fed from the faded signal, so it rings
 * on for `reverbSec` after the source ends. `out` is the skip fader: a skip ramps it (dry AND tail) to silence in
 * `SKIP_FADE_S` instead of hard-stopping. Every node is disconnected once the tail has rung out (or after a skip's
 * fade), so repeated plays never pile up.
 *
 * The scheduling is split out as small functions over a minimal AudioParam shape so it is unit-testable without a
 * real AudioContext.
 */

/** A skip (Esc / click / leaving) fades the whole voice out over this long rather than cutting it. */
export const SKIP_FADE_S = 0.12;
/** Exponential ramps cannot reach 0; ramp to this (-60 dB) and then pin 0. */
const FLOOR = 0.001;

/** The dials a tailed play takes (all from the Good Luck tuner). */
export interface TailOpts {
  /** The fade over the clip's last N ms (0 = no fade, the clip's own end). */
  fadeOutMs: number;
  /** The reverb tail's wet level (0 = dry only, no convolver is built). */
  reverbMix: number;
  /** The reverb tail's length in seconds. */
  reverbSec: number;
}

/** The slice of AudioParam the schedulers touch (so tests can pass a recorder). */
export interface ParamLike {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  exponentialRampToValueAtTime(v: number, t: number): unknown;
  cancelScheduledValues(t: number): unknown;
}

/**
 * The natural-end fade: hold full level until `fadeSec` before the clip ends, then an exponential ramp to
 * silence landing exactly on the end. A fade longer than the clip is clamped to the clip. Returns the end time.
 */
export function scheduleTailFade(param: ParamLike, startAt: number, playDur: number, fadeSec: number): number {
  const end = startAt + Math.max(0, playDur);
  const fade = Math.min(Math.max(0, fadeSec), Math.max(0, playDur));
  if (fade <= 0) return end;
  param.setValueAtTime(1, end - fade);
  param.exponentialRampToValueAtTime(FLOOR, end);
  param.setValueAtTime(0, end);
  return end;
}

/**
 * The skip fade: drop whatever was scheduled, hold the current level, and ramp linearly to 0 over `fadeSec`.
 * Returns the time the ramp lands (the moment the source can be stopped).
 */
export function scheduleSkipFade(param: ParamLike, now: number, fadeSec = SKIP_FADE_S): number {
  const end = now + Math.max(0, fadeSec);
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(0, end);
  return end;
}
