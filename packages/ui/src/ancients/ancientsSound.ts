import { duckSfxBuses, playFxSound, type FxSoundHandle } from '../sfx';
import { setMusicDuck } from '../music';
import { ANCIENT_CUES, getAncientsConfig, type AncientCue } from './ancientsConfig';

/**
 * THE AWAKENING'S SOUND (owner 2026-09-25: "i can help source sounds if you set up a tuner with timing cues"). Every
 * cue is a NAMED slot in the ✦ Ancients tuner (clip id, gain, offset from its beat, rate), played through the shared
 * FX sound path (`playFxSound`: bus routing, pitch, fade-in/out, loop, so nothing ends abruptly) on the `hero` bus,
 * which is the one bus the duck leaves alone. Presentation only.
 */
const BUS = 'hero' as const;

/** Decode every cue's clip ahead of the moment (a silent play kicks the decode), so the first awakening is not
 *  missing its first sounds. */
export function warmAncientCues(): void {
  const c = getAncientsConfig() as unknown as Record<string, string>;
  for (const cue of ANCIENT_CUES) {
    const clip = c[`${cue}Clip`];
    if (clip) playFxSound(clip, { gain: 0, bus: BUS })?.stop(0);
  }
}

/** Play `cue` at its tuner offset (+ `extraDelayMs`). Retries once if the clip is still decoding. */
export function playCue(cue: AncientCue, extraDelayMs = 0, opts: { loop?: boolean; rateMul?: number; fadeInMs?: number } = {}): { stop: (fadeMs?: number) => void } {
  const c = getAncientsConfig() as unknown as Record<string, string | number>;
  const clip = String(c[`${cue}Clip`] ?? '');
  const gain = Number(c[`${cue}Gain`] ?? 0);
  const rate = Number(c[`${cue}Rate`] ?? 1) * (opts.rateMul ?? 1);
  const delayMs = Math.max(0, Number(c[`${cue}Offset`] ?? 0) + extraDelayMs);
  let handle: FxSoundHandle | null = null;
  let stopped = false;
  const fire = (retry: boolean, delay: number): void => {
    if (stopped || !clip || !(gain > 0)) return;
    handle = playFxSound(clip, { gain, rate, delayMs: delay, bus: BUS, loop: opts.loop, fadeInMs: opts.fadeInMs ?? 20, fadeOutMs: opts.loop ? 0 : 260 });
    if (!handle && retry) window.setTimeout(() => fire(false, Math.max(0, delay - 90)), 90);
  };
  fire(true, delayMs);
  return { stop: (fadeMs = 400) => { stopped = true; handle?.stop(fadeMs); } };
}

/** Duck the music and every other sound bus for the awakening; `duck(false)` restores them. */
export function duckForAwakening(on: boolean): void {
  const c = getAncientsConfig();
  const k = on ? c.duckAmount : 1;
  setMusicDuck(k, c.duckRampMs / 3);
  duckSfxBuses(k, BUS, c.duckRampMs / 3);
}
