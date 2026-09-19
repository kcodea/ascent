/**
 * The AUDIO Filter Lab — a per-`sound`-layer chain of native Web Audio filters, the audio twin of the visual
 * Filter Lab (`filterStack.ts`). Each filter is OFF by default (a toggle); the enabled ones splice, in a fixed
 * conventional channel-strip order, between the clip's source and its fader/bus, so an authored sound can be
 * EQ'd, compressed, distorted, echoed and panned without leaving the workbench — and, routed through the same
 * graph as every other sound, still obeys the master volume, mute and the mixing desk.
 *
 * OVER-TIME AUTOMATION (owner 2026-09-19): each effect's HEADLINE dial can ride a curve across the clip's play
 * window (0 = fires, 1 = clip ends) — EQ bands, compressor threshold, and each space effect's Mix, plus Pan.
 * Unlike the visual lab (which samples a curve per FRAME), audio uses Web Audio's own param automation
 * (`setValueCurveAtTime`), scheduled once at fire time and run sample-accurately on the audio thread. A flat
 * curve (the default) is a no-op — the param is set statically — so an un-automated sound is unchanged. The
 * dials that BAKE a buffer/waveshape at fire time (reverb size/damping, distortion drive, delay time) can't be
 * live-automated and stay static.
 *
 * Fixed chain order (EQ → Compressor → Distortion → Delay → Reverb → Pan). Reverb is algorithmic (a generated
 * decaying-noise impulse — no committed files). Native nodes + a synthetic IR only.
 *
 * Kept OUT of `sfx.ts` so the graph code is one small, testable module: `audioFilterSpecs()` generates the
 * `sound` primitive's filter params (folded into its SPECS), and `buildAudioFilterChain(ctx, params, fireCtx)`
 * builds the node chain `playFxSound` splices in. Every `build` takes the AudioContext by argument, so a fake
 * context unit-tests the wiring without real Web Audio.
 */
import type { FxParamSpec, FxParamSpecs } from './params';
import { bakeCurveLut, CURVE_PRESETS, type CurvePoint } from './curve';

type P = Record<string, unknown>;
const num = (p: P, k: string, d = 0): number => (typeof p[k] === 'number' ? (p[k] as number) : d);
const bool = (p: P, k: string): boolean => p[k] === true;

/** A filter's on-toggle key, a knob key, and a knob's over-time curve key — the param-key grammar the spec
 *  generator and the chain builder must agree on. */
const onKey = (id: string): string => `${id}On`;
const knobKey = (id: string, name: string): string => `${id}_${name}`;
const curveKey = (id: string, name: string): string => `${id}_${name}Curve`;

// --- OVER-TIME AUTOMATION -----------------------------------------------------------------------------------
/** The fire's timing window, so an automated param can be scheduled across the clip's play length. */
export interface FxFilterCtx {
  /** Audio-clock time the clip starts. */
  t0: number;
  /** Seconds the clip plays over — the domain the 0..1 curve maps onto. `0` disables automation (static). */
  durSec: number;
}
/** A ctx that disables automation — every param is set statically. The default for callers/tests with no
 *  timing window (a workbench-less unit test, or a fire with an unknown length). */
export const STATIC_CTX: FxFilterCtx = { t0: 0, durSec: 0 };

/** Points a curve param resolves to when unset — flat 1, i.e. the dial's value held constant (a no-op). */
const FLAT_CURVE: readonly CurvePoint[] = [[0, 1], [1, 1]];
/** LUT resolution for `setValueCurveAtTime` — enough for a smooth ramp over a short clip, cheap to bake. */
const AUTOMATION_LUT = 64;

/** Bake a curve param into a 0..1 LUT and report whether it actually varies (a flat curve → set statically). */
function bakeAmount(raw: unknown): { lut: Float32Array; varies: boolean } {
  const pts = Array.isArray(raw) && raw.length >= 2 ? (raw as CurvePoint[]) : FLAT_CURVE;
  const lut = new Float32Array(AUTOMATION_LUT);
  bakeCurveLut(pts, lut);
  let varies = false;
  for (let i = 1; i < AUTOMATION_LUT; i++) { if (Math.abs(lut[i] - lut[0]) > 1e-4) { varies = true; break; } }
  return { lut, varies };
}

/** Set `param` to `base × curve(t)` across the fire window, or — when the curve is flat or there is no window
 *  — statically to `base × constant`. The curve is a MULTIPLIER on the dial's value (flat 1 = the dial as set). */
function setAuto(param: AudioParam, base: number, rawCurve: unknown, ctx: FxFilterCtx): void {
  const { lut, varies } = bakeAmount(rawCurve);
  if (varies && ctx.durSec > 0) {
    const v = new Float32Array(AUTOMATION_LUT);
    for (let i = 0; i < AUTOMATION_LUT; i++) v[i] = base * lut[i];
    param.setValueCurveAtTime(v, ctx.t0, ctx.durSec);
  } else {
    param.value = base * lut[0];
  }
}

/** The DRY side of a crossfade (distortion): `1 − wet(t)`, so as the wet Mix rides its curve the dry recedes. */
function setAutoDry(param: AudioParam, wetBase: number, rawCurve: unknown, ctx: FxFilterCtx): void {
  const { lut, varies } = bakeAmount(rawCurve);
  if (varies && ctx.durSec > 0) {
    const v = new Float32Array(AUTOMATION_LUT);
    for (let i = 0; i < AUTOMATION_LUT; i++) v[i] = 1 - wetBase * lut[i];
    param.setValueCurveAtTime(v, ctx.t0, ctx.durSec);
  } else {
    param.value = 1 - wetBase * lut[0];
  }
}

/** Does a curve param actually vary over time? A flat curve means the dial is held constant — the caller can
 *  skip allocating an automation node (the clip Level in `sfx.ts` uses this to stay on the plain fader path). */
export function curveVaries(rawCurve: unknown): boolean {
  return bakeAmount(rawCurve).varies;
}

/** Schedule `param = base × curve(t)` across the fire window (or static when the curve is flat / there is no
 *  window). Exported so the clip Level curve in `sfx.ts` rides the same automation path as the filter dials. */
export function applyAudioCurve(param: AudioParam, base: number, rawCurve: unknown, ctx: FxFilterCtx): void {
  setAuto(param, base, rawCurve, ctx);
}

/** One control on an audio filter — a plain numeric knob. `automatable` gives it an over-time curve companion. */
interface AudioKnob {
  /** param-key suffix (`${id}_${name}`) + label source. */
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** This dial rides an over-time curve (a `${id}_${name}Curve` param); see the automation notes above. */
  automatable?: boolean;
  help?: string;
}

/** One native-Web-Audio filter the lab can insert. `build` returns the sub-graph's single input and output
 *  nodes (they may be the same node); the chain builder wires each filter's output into the next's input. */
interface AudioFilterSpec {
  /** camelCase, unique — the param-key prefix + toggle stem (e.g. `eq` → `eqOn`, `eq_low`). */
  id: string;
  /** Human label + its param group in the inspector. */
  label: string;
  /** The on-toggle's help text. */
  help: string;
  knobs: AudioKnob[];
  build(a: BaseAudioContext, p: P, ctx: FxFilterCtx): { input: AudioNode; output: AudioNode };
}

/** Classic soft-clip waveshaper curve. `drive` 0..1 → a bend from identity (clean) to hard saturation. */
function distortionCurve(drive: number): Float32Array<ArrayBuffer> {
  const k = Math.max(0, drive) * 100;
  const n = 1024;
  // Over an explicit ArrayBuffer so the type is Float32Array<ArrayBuffer> — what WaveShaperNode.curve wants.
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // k=0 → identity (a true bypass); rising k bends the transfer curve toward a square.
    curve[i] = k === 0 ? x : ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

/** Cached synthetic impulse responses — a reverb fire reuses one instead of refilling a multi-second noise
 *  buffer every time (a fire must stay cheap; performance is the north star). Keyed by the knobs that shape
 *  it plus the context's sample rate. */
const impulseCache = new Map<string, AudioBuffer>();

/**
 * An ALGORITHMIC reverb impulse: exponentially-decaying noise, damped by a one-pole low-pass — a lush tail
 * with NO committed impulse file (the design's "algorithmic, no asset files" intent; a generated IR sidesteps
 * the asset-management reason convolution-with-files was deferred). `seconds` sets the tail length, `damping`
 * (0..1) how fast the highs die. Cached by (seconds, damping, rate) so repeated fires don't refill it.
 * `Math.random` is fine here — this is UI, not the seeded engine.
 */
function reverbImpulse(a: BaseAudioContext, seconds: number, damping: number): AudioBuffer {
  const rate = a.sampleRate;
  const secs = Math.min(8, Math.max(0.1, seconds));
  const damp = Math.min(1, Math.max(0, damping));
  const key = `${secs.toFixed(2)}|${damp.toFixed(2)}|${rate}`;
  const cached = impulseCache.get(key);
  if (cached) return cached;
  const len = Math.max(1, Math.floor(rate * secs));
  const ir = a.createBuffer(2, len, rate);
  const lp = damp * 0.95; // more damping = more low-pass memory = a darker tail (0 = bright white noise)
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = white * (1 - lp) + last * lp;
      d[i] = last * Math.pow(1 - i / len, 2.2); // decays smoothly to silence at the tail's end
    }
  }
  impulseCache.set(key, ir);
  return ir;
}

const EQ: AudioFilterSpec = {
  id: 'eq',
  label: 'EQ (3-band)',
  help: 'A three-band equaliser — cut or boost lows, mids and highs. Off costs nothing.',
  knobs: [
    { name: 'low', label: 'Low', min: -24, max: 24, step: 0.5, default: 0, automatable: true, help: 'Low shelf ~250 Hz, in dB. Negative thins the bottom, positive fattens it.' },
    { name: 'mid', label: 'Mid', min: -24, max: 24, step: 0.5, default: 0, automatable: true, help: 'Mid peak ~1.2 kHz, in dB — where most body and presence lives.' },
    { name: 'high', label: 'High', min: -24, max: 24, step: 0.5, default: 0, automatable: true, help: 'High shelf ~4 kHz, in dB. Positive adds air and edge.' },
  ],
  build(a, p, ctx) {
    const low = a.createBiquadFilter();
    low.type = 'lowshelf'; low.frequency.value = 250; setAuto(low.gain, num(p, knobKey('eq', 'low')), p[curveKey('eq', 'low')], ctx);
    const mid = a.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 1200; mid.Q.value = 1; setAuto(mid.gain, num(p, knobKey('eq', 'mid')), p[curveKey('eq', 'mid')], ctx);
    const high = a.createBiquadFilter();
    high.type = 'highshelf'; high.frequency.value = 4000; setAuto(high.gain, num(p, knobKey('eq', 'high')), p[curveKey('eq', 'high')], ctx);
    low.connect(mid); mid.connect(high);
    return { input: low, output: high };
  },
};

const COMP: AudioFilterSpec = {
  id: 'comp',
  label: 'Compressor',
  help: 'Evens out the level — clamps peaks so the clip sits more consistently in the mix. Off costs nothing.',
  knobs: [
    { name: 'threshold', label: 'Threshold', min: -60, max: 0, step: 1, default: -24, automatable: true, help: 'dB level above which it clamps. Lower = more of the clip gets compressed.' },
    { name: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, default: 4, help: 'How hard it clamps above the threshold (4 = 4:1). Higher = flatter.' },
    { name: 'attack', label: 'Attack', min: 0, max: 200, step: 1, default: 3, help: 'ms before it clamps after a peak. Fast catches transients; slow lets them punch through.' },
    { name: 'release', label: 'Release', min: 10, max: 1000, step: 10, default: 250, help: 'ms to let go again after the level drops.' },
  ],
  build(a, p, ctx) {
    const c = a.createDynamicsCompressor();
    setAuto(c.threshold, num(p, knobKey('comp', 'threshold'), -24), p[curveKey('comp', 'threshold')], ctx);
    c.ratio.value = num(p, knobKey('comp', 'ratio'), 4);
    c.attack.value = num(p, knobKey('comp', 'attack'), 3) / 1000;
    c.release.value = num(p, knobKey('comp', 'release'), 250) / 1000;
    c.knee.value = 24;
    return { input: c, output: c };
  },
};

const DISTORT: AudioFilterSpec = {
  id: 'distort',
  label: 'Distortion',
  help: 'Adds grit and saturation by shaping the waveform. Off costs nothing.',
  knobs: [
    { name: 'drive', label: 'Drive', min: 0, max: 1, step: 0.01, default: 0.3, help: 'How hard the waveshaper bends the signal — 0 clean, 1 crushed. (Static — it bakes the waveshape at fire time.)' },
    { name: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, default: 1, automatable: true, help: 'Dry↔wet blend. 1 = fully distorted, 0 = bypass.' },
  ],
  build(a, p, ctx) {
    const drive = num(p, knobKey('distort', 'drive'), 0.3);
    const mixBase = num(p, knobKey('distort', 'mix'), 1);
    const mixCurve = p[curveKey('distort', 'mix')];
    const shaper = a.createWaveShaper();
    shaper.curve = distortionCurve(drive);
    shaper.oversample = '2x';
    const input = a.createGain();
    const output = a.createGain();
    const dry = a.createGain(); setAutoDry(dry.gain, mixBase, mixCurve, ctx);
    const wet = a.createGain(); setAuto(wet.gain, mixBase, mixCurve, ctx);
    input.connect(dry); dry.connect(output);
    input.connect(shaper); shaper.connect(wet); wet.connect(output);
    return { input, output };
  },
};

const DELAY: AudioFilterSpec = {
  id: 'delay',
  label: 'Delay / echo',
  help: 'Repeats the clip as fading echoes. Off costs nothing.',
  knobs: [
    { name: 'time', label: 'Time', min: 0, max: 1000, step: 10, default: 250, help: 'ms between echoes. (Static — automating it would pitch-warp the echoes.)' },
    { name: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.01, default: 0.35, help: 'How much each echo feeds the next — higher = more repeats (capped below runaway).' },
    { name: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.3, automatable: true, help: 'How loud the echoes are against the dry clip.' },
  ],
  build(a, p, ctx) {
    const time = num(p, knobKey('delay', 'time'), 250) / 1000;
    const fb = Math.min(0.9, Math.max(0, num(p, knobKey('delay', 'feedback'), 0.35)));
    const input = a.createGain();
    const output = a.createGain();
    const dry = a.createGain(); dry.gain.value = 1; // dry passes through; echoes are added on top
    const wet = a.createGain(); setAuto(wet.gain, num(p, knobKey('delay', 'mix'), 0.3), p[curveKey('delay', 'mix')], ctx);
    const d = a.createDelay(1.1);
    d.delayTime.value = Math.min(1.0, Math.max(0, time));
    const fbGain = a.createGain(); fbGain.gain.value = fb;
    input.connect(dry); dry.connect(output);
    input.connect(d);
    d.connect(fbGain); fbGain.connect(d); // feedback loop
    d.connect(wet); wet.connect(output);
    return { input, output };
  },
};

const REVERB: AudioFilterSpec = {
  id: 'reverb',
  label: 'Reverb',
  help: 'An algorithmic room/hall tail — a decaying-noise impulse, no sound files. Off costs nothing.',
  knobs: [
    { name: 'size', label: 'Size', min: 0.1, max: 8, step: 0.1, default: 1.8, help: 'Tail length in seconds — a tight room up to a long hall. (Static — it bakes the impulse at fire time.)' },
    { name: 'damping', label: 'Damping', min: 0, max: 1, step: 0.01, default: 0.35, help: 'How fast the highs fade in the tail — higher is darker. (Static — it bakes the impulse at fire time.)' },
    { name: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.3, automatable: true, help: 'Dry↔wet blend — how loud the tail sits under the dry clip.' },
  ],
  build(a, p, ctx) {
    const input = a.createGain();
    const output = a.createGain();
    const dry = a.createGain(); dry.gain.value = 1;
    const wet = a.createGain(); setAuto(wet.gain, num(p, knobKey('reverb', 'mix'), 0.3), p[curveKey('reverb', 'mix')], ctx);
    const conv = a.createConvolver();
    conv.normalize = true;
    conv.buffer = reverbImpulse(a, num(p, knobKey('reverb', 'size'), 1.8), num(p, knobKey('reverb', 'damping'), 0.35));
    input.connect(dry); dry.connect(output);
    input.connect(conv); conv.connect(wet); wet.connect(output);
    return { input, output };
  },
};

const PAN: AudioFilterSpec = {
  id: 'pan',
  label: 'Pan',
  help: 'Places the clip in the stereo field. Off = centred.',
  knobs: [
    { name: 'pan', label: 'Pan', min: -1, max: 1, step: 0.01, default: 0, automatable: true, help: '-1 hard left, 0 centre, +1 hard right.' },
  ],
  build(a, p, ctx) {
    const sp = a.createStereoPanner();
    setAuto(sp.pan, Math.max(-1, Math.min(1, num(p, knobKey('pan', 'pan'), 0))), p[curveKey('pan', 'pan')], ctx);
    return { input: sp, output: sp };
  },
};

/** The core-native filters, in their FIXED application order (channel-strip convention). Authored reorder is a
 *  planned follow-up; today the order a signal passes through is exactly this array. */
export const AUDIO_FILTERS: readonly AudioFilterSpec[] = [EQ, COMP, DISTORT, DELAY, REVERB, PAN];

/**
 * Flat param specs for the audio filter registry — a toggle per filter, each knob (a slider grouped under the
 * filter's label and gated on that toggle), and, for an automatable knob, an over-time curve companion
 * (`${id}_${name}Curve`). Spread into the `sound` primitive's SPECS, so the inspector renders each filter as
 * its own toggle-gated group.
 */
export function audioFilterSpecs(registry: readonly AudioFilterSpec[] = AUDIO_FILTERS): FxParamSpecs {
  const out: Record<string, FxParamSpec> = {};
  for (const f of registry) {
    const group = f.label;
    const gate = { param: onKey(f.id), is: true } as const;
    out[onKey(f.id)] = { kind: 'toggle', label: f.label, group, default: false, help: f.help };
    for (const k of f.knobs) {
      out[knobKey(f.id, k.name)] = {
        kind: 'slider', label: k.label, group, min: k.min, max: k.max, step: k.step, default: k.default,
        enabledWhen: gate, help: k.help ?? `${k.label} — a ${f.label} control.`,
      };
      if (k.automatable) {
        out[curveKey(f.id, k.name)] = {
          kind: 'curve', label: `${k.label} / time`, group, default: [[0, 1], [1, 1]], vMax: 1,
          presets: CURVE_PRESETS, enabledWhen: gate,
          help: `How ${k.label} rides over the sound (0 = it fires, 1 = the clip ends). Flat = held constant; ` +
            `the curve multiplies the dial above.`,
        };
      }
    }
  }
  return out;
}

/** A built filter chain's single entry and exit node — splice `entry.input` after the source and route
 *  `exit.output` onward. */
export interface AudioChain {
  input: AudioNode;
  output: AudioNode;
}

/**
 * Build the Web Audio node chain for whichever filters are enabled in `params`, in `registry` (fixed) order:
 * each enabled filter's output feeds the next's input. Returns `null` when none are enabled (the caller then
 * wires the source straight through, allocating nothing). `params` is the `sound` layer's full param bag — the
 * builder only reads the filter keys. `fireCtx` carries the play window for over-time automation (default
 * `STATIC_CTX` = no automation).
 */
export function buildAudioFilterChain(
  a: BaseAudioContext,
  params: P | undefined,
  fireCtx: FxFilterCtx = STATIC_CTX,
  registry: readonly AudioFilterSpec[] = AUDIO_FILTERS,
): AudioChain | null {
  if (!params) return null;
  let head: AudioNode | null = null;
  let tail: AudioNode | null = null;
  for (const f of registry) {
    if (!bool(params, onKey(f.id))) continue;
    const { input, output } = f.build(a, params, fireCtx);
    if (tail) tail.connect(input);
    else head = input;
    tail = output;
  }
  if (!head || !tail) return null;
  return { input: head, output: tail };
}
