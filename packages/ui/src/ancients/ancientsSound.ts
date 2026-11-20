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

/** The six stone slides, one per Ancient in panel order (owner 2026-11-19: "use each one for each ancient sliding in").
 *  Literal ids so the phone pre-decode scan (`audio/codeClips.ts`) finds them. */
export const PANEL_SLIDE_CLIPS = [
  'fx/ancient-stone-slide-1', 'fx/ancient-stone-slide-2', 'fx/ancient-stone-slide-3',
  'fx/ancient-stone-slide-4', 'fx/ancient-stone-slide-5', 'fx/ancient-stone-slide-6',
] as const;

/** The opening's rise and where its peak is in the clip. `playOmenRise` starts it partway in (or late) so the peak
 *  lands on the explosion. A clip typed into the tuner instead plays from its start, fading in. */
export const OMEN_RISE = { clip: 'fx/ancient-opening-rise', peakMs: 2450 } as const;
export function playOmenRise(omenMs: number): { stop: (fadeMs?: number) => void } {
  const c = getAncientsConfig() as unknown as Record<string, string | number>;
  if (String(c.omenRumbleClip) !== OMEN_RISE.clip) return playCue('omenRumble', 0, { fadeInMs: Math.min(600, omenMs) });
  // A sped-up clip reaches its peak sooner.
  const peak = OMEN_RISE.peakMs / Math.max(0.1, Number(c.omenRumbleRate ?? 1));
  const lead = peak - omenMs; // > 0: skip this much of the rise; < 0: wait this long before starting
  return playCue('omenRumble', Math.max(0, -lead), { fadeInMs: lead > 0 ? 90 : 20, startOffsetMs: Math.max(0, lead) * Math.max(0.1, Number(c.omenRumbleRate ?? 1)) });
}

/** Decode every cue's clip ahead of the moment (a silent play kicks the decode), so the first awakening is not
 *  missing its first sounds. */
export function warmAncientCues(): void {
  const c = getAncientsConfig() as unknown as Record<string, string>;
  for (const cue of ANCIENT_CUES) {
    const clip = c[`${cue}Clip`];
    if (clip) playFxSound(clip, { gain: 0, bus: BUS })?.stop(0);
  }
  for (const clip of PANEL_SLIDE_CLIPS) playFxSound(clip, { gain: 0, bus: BUS })?.stop(0);
}

/** Play `cue` at its tuner offset (+ `extraDelayMs`). Retries once if the clip is still decoding. */
export function playCue(cue: AncientCue, extraDelayMs = 0, opts: { loop?: boolean; rateMul?: number; fadeInMs?: number; variant?: number; startOffsetMs?: number } = {}): { stop: (fadeMs?: number) => void } {
  const c = getAncientsConfig() as unknown as Record<string, string | number>;
  let clip = String(c[`${cue}Clip`] ?? '');
  // `variant` picks one of a cue's own set of clips (the stone slides, one per Ancient) while the slot's clip is the
  // shipped first of the set; a clip typed into the tuner replaces all of them.
  if (cue === 'panelSlide' && opts.variant !== undefined && clip === PANEL_SLIDE_CLIPS[0]) clip = PANEL_SLIDE_CLIPS[opts.variant % PANEL_SLIDE_CLIPS.length]!;
  const gain = Number(c[`${cue}Gain`] ?? 0);
  const rate = Number(c[`${cue}Rate`] ?? 1) * (opts.rateMul ?? 1);
  const delayMs = Math.max(0, Number(c[`${cue}Offset`] ?? 0) + extraDelayMs);
  let handle: FxSoundHandle | null = null;
  let stopped = false;
  const fire = (retry: boolean, delay: number): void => {
    if (stopped || !clip || !(gain > 0)) return;
    handle = playFxSound(clip, { gain, rate, delayMs: delay, bus: BUS, loop: opts.loop, startOffsetMs: opts.startOffsetMs, fadeInMs: opts.fadeInMs ?? 20, fadeOutMs: opts.loop ? 0 : 260 });
    if (!handle && retry) window.setTimeout(() => fire(false, Math.max(0, delay - 90)), 90);
  };
  fire(true, delayMs);
  return { stop: (fadeMs = 400) => { stopped = true; handle?.stop(fadeMs); } };
}

/** AUDITION a cue from the tuner (the ▶ beside its gain; owner 2026-11-19: "a play button next to every sound
currently in use"): the cue once, with its live clip, gain and pitch, never looped. A second press cuts the first. */
let audition: { stop: (fadeMs?: number) => void } | null = null;
let auditionN = 0;
export function auditionCue(cue: AncientCue): void {
  audition?.stop(60);
  audition = playCue(cue, 0, cue === 'panelSlide' ? { variant: auditionN++ } : {}); // each press steps through the six slides
}

/** Duck the music and every other sound bus for the awakening; `duck(false)` restores them. */
export function duckForAwakening(on: boolean): void {
  const c = getAncientsConfig();
  const k = on ? c.duckAmount : 1;
  setMusicDuck(k, c.duckRampMs / 3);
  duckSfxBuses(k, BUS, c.duckRampMs / 3);
}
