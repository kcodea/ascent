/**
 * `sound` — a NON-DRAWING audio layer. At its `at` on the def timeline it plays a chosen clip through the
 * game's existing Web Audio graph (→ the chosen bus → per-bus comp → master limiter → master volume → mute →
 * out), so an authored sound automatically obeys the master volume, mute, the skip-combat fade, and the mixing
 * desk's per-bus fader. The audio sibling of `screen`/`react`: it draws nothing (its Pixi container stays
 * empty) and reaches out of Pixi directly — here, into `sfx.ts`'s `playFxSound`.
 *
 * It fires ONCE, retrying each tick until the clip's buffer has decoded (`playFxSound` returns null until
 * then), and gives up after a few seconds so a missing/mistyped clip can't retry forever. `destroy()` fades
 * the sound out, so a scrubbed/cancelled cue — or a looped clip — leaves nothing ringing.
 *
 * This layer covers PLAYBACK (clip, level, pitch, fades, reverse, loop, per-fire jitter, delay, bus) PLUS the
 * core-native audio Filter Lab (EQ / compressor / distortion / delay / pan) — its params are folded in from
 * `audioFilters.ts` and the whole param bag is handed to `playFxSound`, which builds the filter node chain.
 * Reverb (algorithmic) and modulation land in later PRs; that audio-graph code also lives outside this file.
 */
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import type { ParamsOf, FxParamSpecs } from '../params';
import { registerPrimitive } from '../registry';
import { playFxSound, type FxSoundHandle } from '../../sfx';
import { audioFilterSpecs } from '../audioFilters';
import { CURVE_PRESETS } from '../curve';
import { BUS_NAMES, type BusName } from '../../audio/config';

const PLAYBACK_SPECS = {
  clip: {
    kind: 'sound', label: 'Clip', group: 'Clip', default: '',
    help: 'The sound to play. Pick from the game\'s committed clips (imported clips join the list once that pipeline lands). Empty = silent.',
  },
  gain: {
    kind: 'slider', label: 'Level', group: 'Clip', min: 0, max: 2, step: 0.01, default: 1, essential: true,
    help: 'Playback level — 1 is the clip\'s own level, above 1 boosts it. Still scaled by the bus and master volume, so this only sets how loud it reads against the mix.',
  },
  gainCurve: {
    kind: 'curve', label: 'Level / time', group: 'Clip', default: [[0, 1], [1, 1]], vMax: 1, presets: CURVE_PRESETS,
    help: 'How the Level rides over the sound (0 = it fires, 1 = the clip ends). Flat = constant; e.g. ramp down for a fade-out, up for a swell. Multiplies the Level above.',
  },
  pitch: {
    kind: 'slider', label: 'Pitch', group: 'Clip', min: 0.25, max: 4, step: 0.01, default: 1,
    help: 'Playback rate — pitch AND speed together. 1 = original; below 1 is slower & lower, above is faster & higher.',
  },
  reverse: {
    kind: 'toggle', label: 'Reverse', group: 'Clip', default: false,
    help: 'Play the clip backwards.',
  },
  loop: {
    kind: 'toggle', label: 'Loop', group: 'Clip', default: false,
    help: 'Repeat the clip until the layer ends (e.g. a sound that holds while a targeting line is up). Fades out on end.',
  },
  startOffset: {
    kind: 'slider', label: 'Start offset', group: 'Timing', min: 0, max: 2000, step: 10, default: 0,
    help: 'Skip this many ms into the clip before it starts. Drag the green line on the waveform to set it.',
  },
  endOffset: {
    kind: 'slider', label: 'End offset', group: 'Timing', min: 0, max: 2000, step: 10, default: 0,
    help: 'Stop this many ms before the clip\'s end (0 = play to the end). The clip plays the window between the '
      + 'Start and End lines on the waveform — drag the red line to set it.',
  },
  delay: {
    kind: 'slider', label: 'Delay', group: 'Timing', min: 0, max: 2000, step: 10, default: 0,
    help: 'Wait this many ms after the layer fires before the clip starts (on the audio clock, so it stays locked to the beat).',
  },
  fadeIn: {
    kind: 'slider', label: 'Fade in', group: 'Timing', min: 0, max: 2000, step: 10, default: 0,
    help: 'Ramp the level up over this many ms at the start.',
  },
  fadeOut: {
    kind: 'slider', label: 'Fade out', group: 'Timing', min: 0, max: 2000, step: 10, default: 0,
    help: 'Ramp the level down over this many ms at the end (and when the layer is torn down).',
  },
  gainVar: {
    kind: 'slider', label: 'Level jitter', group: 'Variance', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Randomly drop the level by up to this fraction each time it fires, so a repeated sound isn\'t identical.',
  },
  pitchVar: {
    kind: 'slider', label: 'Pitch jitter', group: 'Variance', min: 0, max: 1, step: 0.01, default: 0,
    help: 'Randomly shift the pitch by up to ±this fraction each fire.',
  },
  bus: {
    kind: 'enum', label: 'Bus', group: 'Routing', options: BUS_NAMES, default: 'combat', essential: true,
    help: 'Which mixing-desk bus this plays through, so the desk still governs its level alongside the rest of the mix.',
  },
} satisfies FxParamSpecs;

/** Playback params + the core-native audio Filter Lab (EQ/comp/distortion/delay/pan), each a toggle-gated
 *  group. The filter values ride along in the param bag and are read by `playFxSound` → `buildAudioFilterChain`. */
const SPECS = { ...PLAYBACK_SPECS, ...audioFilterSpecs() } satisfies FxParamSpecs;

type SoundParams = ParamsOf<typeof SPECS>;

/** After this long unfired, stop retrying — a missing/mistyped clip never decodes, and retrying forever would
 *  keep re-kicking its (no-op) load. Comfortably longer than any real decode. */
const GIVE_UP_MS = 4000;

class SoundInstance implements FxInstance<SoundParams> {
  private params: SoundParams;
  private handle: FxSoundHandle | null = null;
  private started = false;
  private elapsed = 0;
  private readonly oneShot: boolean;

  constructor(ctx: FxContext, params: SoundParams) {
    this.params = params;
    this.oneShot = ctx.oneShot === true;
  }

  update(dtMs: number): void {
    this.elapsed += dtMs;
    if (this.started || !this.params.clip) return;
    if (this.elapsed > GIVE_UP_MS) { this.started = true; return; } // clip never decoded — stop retrying
    const p = this.params;
    const h = playFxSound(p.clip, {
      gain: p.gain, rate: p.pitch, fadeInMs: p.fadeIn, fadeOutMs: p.fadeOut,
      loop: p.loop, startOffsetMs: p.startOffset, endOffsetMs: p.endOffset, reverse: p.reverse, delayMs: p.delay,
      bus: p.bus as BusName, gainVar: p.gainVar, pitchVar: p.pitchVar,
      // The whole param bag carries the Filter Lab knobs too; playFxSound reads the filter keys off it.
      filterParams: this.params as Record<string, unknown>,
    });
    if (h) { this.handle = h; this.started = true; }
  }

  setParams(next: SoundParams): void { this.params = next; }

  isComplete(): boolean {
    // A continuous instance never self-completes. A one-shot is done once its clip has ended — never for a
    // loop (only `destroy` stops that), and it also releases if the clip never decoded (gave up).
    if (!this.oneShot) return false;
    if (this.params.loop) return false;
    return this.started && (this.handle?.ended() ?? this.elapsed > GIVE_UP_MS);
  }

  destroy(): void {
    this.handle?.stop(this.params.fadeOut || 60);
    this.handle = null;
  }
}

export const soundPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'sound',
  params: SPECS,
  spawn: (ctx, params) => new SoundInstance(ctx, params),
};

registerPrimitive(soundPrimitive as FxPrimitive);
