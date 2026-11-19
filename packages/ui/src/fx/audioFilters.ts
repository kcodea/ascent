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
import { LITE_ART } from '../phoneArt';
import { crumbOnce } from '../crashLog';

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
  /** The play ENDS (a one-shot, not a loop) at `t0 + durSec`, so heavy nodes it builds (the reverb's convolver)
   *  may be returned to a pool once its tail has died out. Absent = never pooled. */
  oneShot?: boolean;
  /** Set by a one-shot play that may route its reverb through the SHARED convolver for its impulse (see
   *  `SharedReverbSend`, R-PERF-SHARED-FX-REVERB-01). Absent = the play builds / pools its own node. */
  shared?: SharedReverbSend;
}
/**
 * What a one-shot play hands the reverb so its wet can ride the ONE shared convolver for its impulse instead of a
 * node of its own (R-PERF-SHARED-FX-REVERB-01). The wet then no longer passes the play's fader, so the send carries
 * the fader's level, and the fader's fades are applied after the shared convolver, on its gate (see `sharedFxReverb`).
 */
export interface SharedReverbSend {
  /** The STABLE bus node the shared convolvers are keyed by (they outlive hard-stop epochs)... */
  bus: AudioNode;
  /** ...and the node they ring into right now: that bus's current hard-stop epoch input. */
  out: AudioNode;
  /** The play's fader level (gain x jitter) and its fades, in seconds. */
  level: number;
  fadeInSec: number;
  fadeOutSec: number;
  /** Receives the send gain: the caller's `stop()` closes it and the clip's end disconnects it. */
  onSend(send: GainNode): void;
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
export function reverbImpulse(a: BaseAudioContext, seconds: number, damping: number): AudioBuffer {
  const s = impulseShape(a, seconds, damping);
  const cached = impulseCache.get(s.key);
  if (cached) return cached;
  const ir = a.createBuffer(2, s.len, s.rate);
  for (let ch = 0; ch < 2; ch++) fillImpulse(ir.getChannelData(ch), s.len, s.lp, 0, s.len, 0);
  impulseCache.set(s.key, ir);
  return ir;
}
/** The clamped knobs of one impulse: its cache key, its length in samples and its low-pass memory. */
function impulseShape(a: BaseAudioContext, seconds: number, damping: number): { key: string; rate: number; len: number; lp: number } {
  const rate = a.sampleRate;
  const secs = Math.min(8, Math.max(0.1, seconds));
  const damp = Math.min(1, Math.max(0, damping));
  // more damping = more low-pass memory = a darker tail (0 = bright white noise)
  return { key: `${secs.toFixed(2)}|${damp.toFixed(2)}|${rate}`, rate, len: Math.max(1, Math.floor(rate * secs)), lp: damp * 0.95 };
}
/** Samples `from`..`to` of one channel of an impulse of `len` samples; `last` is the low-pass's memory coming in, and
 *  the return is its memory going out (so a channel can be filled in several goes and come out the same). */
function fillImpulse(d: Float32Array, len: number, lp: number, from: number, to: number, last: number): number {
  for (let i = from; i < to; i++) {
    const white = Math.random() * 2 - 1;
    last = white * (1 - lp) + last * lp;
    d[i] = last * Math.pow(1 - i / len, 2.2); // decays smoothly to silence at the tail's end
  }
  return last;
}
/** Samples filled between two looks at the clock while an impulse is built in slices. */
const IMPULSE_SLICE_SAMPLES = 8192;
/**
 * `reverbImpulse` IN SLICES, for the idle pre-warm (perf, the Duos audit of 2026-11-09): a 4 s stereo tail is some
 * 400,000 noise samples, 10 ms and more of main thread in one go. The returned step fills for about `budgetMs` and
 * returns true once the impulse is in the cache (the same cache, the same maths, sample for sample the same process).
 * A fire that needs the impulse before the slices finish builds it whole, as before, and the step then just ends.
 */
export function reverbImpulseSteps(a: BaseAudioContext, seconds: number, damping: number, budgetMs = 2.5, now: () => number = () => performance.now()): () => boolean {
  const s = impulseShape(a, seconds, damping);
  let ir: AudioBuffer | null = null;
  let ch = 0, i = 0, last = 0;
  return () => {
    if (impulseCache.has(s.key)) return true;
    ir ??= a.createBuffer(2, s.len, s.rate);
    const t0 = now();
    while (ch < 2) {
      const to = Math.min(s.len, i + IMPULSE_SLICE_SAMPLES);
      last = fillImpulse(ir.getChannelData(ch), s.len, s.lp, i, to, last);
      i = to;
      if (i >= s.len) { ch++; i = 0; last = 0; }
      if (now() - t0 >= budgetMs) break;
    }
    if (ch < 2) return false;
    impulseCache.set(s.key, ir);
    return true;
  };
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

/**
 * POOLED CONVOLVERS (gameplay perf pass 2026-10-10). Assigning `ConvolverNode.buffer` makes the browser partition
 * and FFT the whole impulse synchronously on the MAIN thread: ~6 ms for the default 1.8 s tail at 96 kHz, paid on
 * every reverb'd fire. The Shout icon's sound layer is reverb'd, so every Shout (and every End of Turn Shout replay)
 * cost a 6 ms+ frame (`fx:def:shout-icon-effect`, worst 13-16 ms in the owner's 2026-10-10 capture).
 *
 * A one-shot play hands its convolver back once its tail has decayed (clip length + impulse length + a pad); the
 * next play with the same impulse reuses it, with its buffer already set. By then its internal state has rung out
 * to silence, so a reused node sounds exactly like a fresh one. Loops and untimed plays never pool.
 */
const CONVOLVER_RELEASE_PAD_S = 0.5;
/** PHONES (mobile memory pass 2026-10-18): one ConvolverNode holds its partitioned impulse plus FFT and accumulation
 *  buffers, measured at ~70 MB of renderer memory per node for these 1.5-4.2 s tails (the six pre-warmed nodes were
 *  ~440 MB in mobile-emulated Chrome). A phone keeps at most ONE idle node per impulse and pre-warms none: its first
 *  reverb'd fire of each impulse builds one (the ~6 ms main-thread cost this pool exists to hide). Desktop unchanged. */
/** DESKTOP (perf degradation hunt 2026-10-30, R-PERF-SHARED-TAIL-REVERB-01): the idle pool per impulse was 8, and every
 *  burst of overlapping reverb'd fires that outran it built a node (~60 MB each at a 96 kHz context) that then STAYED in
 *  the pool: the renderer grew in ~60 MB steps over a game (rounds 5, 7 and 11 of the seed-424242 bench). Two idle nodes
 *  per impulse (what `prewarmConvolvers` builds) cover the common overlap; a node built past that is let go once its
 *  tail has rung out, so the pool never grows over a game (A/B 2026-10-30: renderer 488 MB lower by round 14, combat
 *  and End Turn main-thread work no worse). Exported for its test. */
export const CONVOLVER_POOL_MAX = LITE_ART ? 1 : 2;
const convolverPools = new WeakMap<BaseAudioContext, Map<string, ConvolverNode[]>>();
const pooledConvolvers = new WeakSet<ConvolverNode>();
function impulseKeyOf(a: BaseAudioContext, size: number, damping: number): string {
  return `${Math.min(8, Math.max(0.1, size)).toFixed(2)}|${Math.min(1, Math.max(0, damping)).toFixed(2)}|${a.sampleRate}`;
}
function acquireConvolver(a: BaseAudioContext, size: number, damping: number, ctx: FxFilterCtx): ConvolverNode {
  const key = impulseKeyOf(a, size, damping);
  const free = ctx.oneShot ? convolverPools.get(a)?.get(key) : undefined;
  const reused = free?.pop();
  if (reused) { pooledConvolvers.delete(reused); return reused; }
  const conv = a.createConvolver();
  conv.normalize = true;
  conv.buffer = reverbImpulse(a, size, damping);
  if (LITE_ART) crumbOnce('reverb built');
  (conv as ConvolverNode & { __irKey?: string }).__irKey = key;
  return conv;
}
function releaseConvolver(a: BaseAudioContext, conv: ConvolverNode, feed: AudioNode): void {
  try { feed.disconnect(conv); } catch { /* already gone */ }
  try { conv.disconnect(); } catch { /* already gone */ }
  if (pooledConvolvers.has(conv)) return; // idempotent
  const key = (conv as ConvolverNode & { __irKey?: string }).__irKey;
  if (!key) return;
  let byKey = convolverPools.get(a);
  if (!byKey) { byKey = new Map(); convolverPools.set(a, byKey); }
  const list = byKey.get(key) ?? [];
  if (list.length >= CONVOLVER_POOL_MAX) return; // let the GC have it
  list.push(conv);
  pooledConvolvers.add(conv);
  byKey.set(key, list);
}

/**
 * ONE SHARED CONVOLVER PER (bus, impulse) FOR THE EFFECT LAYERS' REVERB (R-PERF-SHARED-FX-REVERB-01, perf pass
 * 2026-11-18). The pool above covers two overlapping plays of an impulse; a third builds a node: ~6 ms of main
 * thread at a 96 kHz context (and ~60 MB until its tail ends). A 500+ Attack hit plays `strike-impact-*`, whose
 * reverb'd layers each hold a node for 3 to 5 s, and late-game swings land well inside that, so nearly every big hit
 * built one or two nodes mid-fight. `rune-buff-trail` (every hero power / Ancient / rune grant) did the same in a
 * burst of grants.
 *
 * Convolution is linear and time-invariant, so the sum of every play's send through ONE convolver is exactly the sum
 * of their separate wets: the same argument `sharedTailReverb` (sfx.ts) made for the soft-tail voice. Each play keeps
 * its own send gain (its level x mix); the shared node, built once per (bus, impulse), rings into the bus the play's
 * dry signal goes to. What the per-play node did AFTER the convolver has to be reproduced: the wet used to pass the
 * play's FADER, so it carried the fader's level (now on the send) and the fader's fades. The fades are a gain that
 * changes over time, which cannot move in front of the convolver without changing the sound (a faded-in attack would
 * feed the tail less), so they stay behind it, on ONE gate gain per shared node:
 *   - a play with no fades needs no gate: its node rings straight into the bus;
 *   - FADE-IN: plays with the same fade-in share a node (the fade-in is part of its key), and its gate rides that
 *     fade-in whenever a play starts on a node that has rung out. A play that starts while an earlier tail is still
 *     ringing leaves the gate open (ducking the tail would be the audible change), so only that play's own wet onset
 *     goes un-faded, under the ringing tail;
 *   - FADE-OUT (the wet used to be faded with the dry at the clip's end, cutting the tail): the gate closes over the
 *     play's fade-out. Fading plays get up to `FADING_NODES` nodes per key (two on desktop: what the pool kept idle
 *     per impulse before, so no more memory), and a new play takes a node no play is still fading on, so two
 *     overlapping plays each keep their own gate. Only a third overlapping play shares one: the gate then follows
 *     the play that ends LAST, and the earlier play's tail rings under the later one until that one fades.
 * So a play on its own, and layers that fire together with the same fades, sound exactly as before (an offline render
 * of the old graph against this one differs by floating-point noise, about -140 dB); the differences above exist only
 * while plays of one impulse overlap. A play is routed here only when nothing else sat after its convolver: no Pan
 * filter, a flat reverb-mix curve and a flat level curve (`sharedReverbEligible`). Anything else keeps its own pooled
 * node, as before.
 *
 * A hard stop (R-COMBAT-HARDSTOP-01) leaves the node ringing into the silenced old epoch, so a stopped fight's tails
 * are cut with everything else; the next play re-points it at the live epoch. A single play stopped early
 * (`FxSoundHandle.stop`) closes its send: what it already fed the convolver rings out.
 */
interface SharedFxReverb {
  conv: ConvolverNode; gate: GainNode | null; out: AudioNode | null;
  /** When the last scheduled fade-out lands (-Infinity = none scheduled), and until when the node still rings. */
  gateEnd: number; ringUntil: number;
}
const sharedFxReverbs = new WeakMap<AudioNode, Map<string, SharedFxReverb[]>>();
/** How many shared nodes a FADING-OUT class may hold per (bus, impulse): see the header. A phone holds one. */
export const FADING_NODES = LITE_ART ? 1 : 2;
/** The gate re-opens over this long when a new play arrives mid-fade (no click). */
const GATE_REOPEN_S = 0.005;
/** The class a play's fades put it in: plays share a node only with plays of the same fade-in, and fading-out plays
 *  never share with ringing ones. */
function fadeClassOf(fadeInSec: number, fadeOutSec: number): string {
  return `${Math.round(Math.max(0, fadeInSec) * 1000)}|${fadeOutSec > 0 ? 'gated' : 'ring'}`;
}
function buildSharedFxReverb(a: BaseAudioContext, size: number, damping: number, gated: boolean): SharedFxReverb {
  const conv = a.createConvolver();
  conv.normalize = true;
  conv.buffer = reverbImpulse(a, size, damping); // cached per (length, damping, rate)
  if (LITE_ART) crumbOnce('reverb built');
  let gate: GainNode | null = null;
  if (gated) { gate = a.createGain(); gate.gain.value = 1; conv.connect(gate); }
  return { conv, gate, out: null, gateEnd: -Infinity, ringUntil: -Infinity };
}
/** The shared node a play starting at `t0` sends into (built on first use). `all` = build every node the class may
 *  hold now (the prewarm), so no play builds one mid-game. */
function sharedFxReverb(a: BaseAudioContext, bus: AudioNode, size: number, damping: number, fadeInSec: number, fadeOutSec: number, t0 = 0, all = false): SharedFxReverb {
  let byKey = sharedFxReverbs.get(bus);
  if (!byKey) { byKey = new Map(); sharedFxReverbs.set(bus, byKey); }
  const gated = fadeInSec > 0 || fadeOutSec > 0;
  const key = `${impulseKeyOf(a, size, damping)}|${fadeClassOf(fadeInSec, fadeOutSec)}`;
  let list = byKey.get(key);
  if (!list) { list = [buildSharedFxReverb(a, size, damping, gated)]; byKey.set(key, list); }
  const max = fadeOutSec > 0 ? FADING_NODES : 1;
  if (all) while (list.length < max) list.push(buildSharedFxReverb(a, size, damping, gated));
  if (max === 1) return list[0]!;
  // A fading class: a node no play is still fading on (the one that has rung longest), else a new one while the
  // class has room, else the one whose fade lands first.
  let free: SharedFxReverb | null = null;
  let soonest = list[0]!;
  for (const e of list) {
    if (e.gateEnd <= t0 && (!free || e.ringUntil < free.ringUntil)) free = e;
    if (e.gateEnd < soonest.gateEnd) soonest = e;
  }
  if (free) return free;
  if (list.length < max) { const e = buildSharedFxReverb(a, size, damping, gated); list.push(e); return e; }
  return soonest;
}
/** Point the shared node at the bus's current epoch (a hard stop swaps it). */
function pointSharedFxReverb(e: SharedFxReverb, out: AudioNode): void {
  if (e.out === out) return;
  const tail: AudioNode = e.gate ?? e.conv;
  if (e.out) { try { tail.disconnect(); } catch { /* already */ } }
  tail.connect(out);
  e.out = out;
}
/** Tests: how many shared effect reverbs exist for a bus. */
export const sharedFxReverbCount = (bus: AudioNode): number => { let n = 0; for (const l of sharedFxReverbs.get(bus)?.values() ?? []) n += l.length; return n; };

/** May this `sound` layer's reverb ride the shared convolver? Only when nothing but the fader sat after its own:
 *  the reverb is on, no Pan filter follows it, and neither the reverb mix nor the clip level is automated. */
export function sharedReverbEligible(p: P | undefined): boolean {
  if (!p || !bool(p, onKey('reverb'))) return false;
  if (bool(p, onKey('pan'))) return false;
  if (curveVaries(p[curveKey('reverb', 'mix')])) return false;
  if (curveVaries(p.gainCurve)) return false;
  return true;
}

/** Build the shared (bus, impulse) nodes the committed defs will use, one per idle callback, so no fire builds one
 *  mid-frame. `busOf` resolves a layer's bus name to its stable node. Phones build each on first use, as before. */
export function prewarmSharedFxReverbs(
  a: BaseAudioContext,
  defs: ReadonlyArray<{ layers?: ReadonlyArray<{ primitive?: string; params?: unknown }> }>,
  busOf: (name: string) => AudioNode | null,
): void {
  if (LITE_ART) return;
  const jobs: Array<() => void> = [];
  const seen = new Set<string>();
  for (const d of defs) {
    for (const l of d.layers ?? []) {
      const p = (l.params ?? {}) as P;
      if (l.primitive !== 'sound' || bool(p, 'loop') || !sharedReverbEligible(p)) continue;
      const size = num(p, knobKey('reverb', 'size'), 1.8);
      const damping = num(p, knobKey('reverb', 'damping'), 0.35);
      const fadeInSec = Math.max(0, num(p, 'fadeIn', 0)) / 1000;
      const fadeOutSec = Math.max(0, num(p, 'fadeOut', 0)) / 1000;
      const busName = typeof p.bus === 'string' ? p.bus : 'combat';
      const id = `${busName}|${impulseKeyOf(a, size, damping)}|${fadeClassOf(fadeInSec, fadeOutSec)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const step = reverbImpulseSteps(a, size, damping);
      const fill = (): void => { if (!step()) jobs.unshift(fill); };
      jobs.push(fill);
      jobs.push(() => { const bus = busOf(busName); if (bus) sharedFxReverb(a, bus, size, damping, fadeInSec, fadeOutSec, 0, true); });
    }
  }
  const idle = (cb: () => void): void => {
    const ric = (globalThis as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') ric(cb, { timeout: 4000 }); else setTimeout(cb, 50);
  };
  const next = (): void => { const job = jobs.shift(); if (!job) return; try { job(); } catch { /* best-effort */ } idle(next); };
  idle(next);
}

/**
 * Pre-build `perKey` pooled convolvers for each reverb impulse the committed defs use, ONE per idle callback (each is
 * ~6 ms of main thread), so the first reverb'd fires of a session reuse a ready node instead of building one
 * mid-frame. Called once the AudioContext exists (`sound` primitive → `onAudioContextReady`).
 */
export function prewarmConvolvers(a: BaseAudioContext, specs: ReadonlyArray<{ size: number; damping: number }>, perKey = 2): void {
  if (LITE_ART) return; // a phone builds each on first use (see CONVOLVER_POOL_MAX)
  const seen = new Set<string>();
  const jobs: Array<() => void> = [];
  for (const sp of specs) {
    const key = impulseKeyOf(a, sp.size, sp.damping);
    if (seen.has(key)) continue;
    seen.add(key);
    // The impulse first, a few ms per idle callback (`reverbImpulseSteps`), so no one callback fills a whole multi-second
    // tail; the nodes below then find it in the cache.
    const step = reverbImpulseSteps(a, sp.size, sp.damping);
    const fill = (): void => { if (!step()) jobs.unshift(fill); };
    jobs.push(fill);
    for (let i = 0; i < perKey; i++) {
      jobs.push(() => {
        const conv = acquireConvolver(a, sp.size, sp.damping, { t0: 0, durSec: 0 }); // always a fresh node here
        releaseConvolver(a, conv, conv);
      });
    }
  }
  const idle = (cb: () => void): void => {
    const ric = (globalThis as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') ric(cb, { timeout: 4000 }); else setTimeout(cb, 50);
  };
  const next = (): void => { const job = jobs.shift(); if (!job) return; try { job(); } catch { /* best-effort */ } idle(next); };
  idle(next);
}

/** The reverb impulses (size, damping) that committed `sound` layers enable, for `prewarmConvolvers`. */
export function reverbSpecsOf(defs: ReadonlyArray<{ layers?: ReadonlyArray<{ primitive?: string; params?: unknown }> }>): Array<{ size: number; damping: number }> {
  const out: Array<{ size: number; damping: number }> = [];
  for (const d of defs) {
    for (const l of d.layers ?? []) {
      const p = (l.params ?? {}) as P;
      if (l.primitive !== 'sound' || !bool(p, onKey('reverb'))) continue;
      // A one-shot layer that rides the shared convolver never takes a pooled node (R-PERF-SHARED-FX-REVERB-01).
      if (!bool(p, 'loop') && sharedReverbEligible(p)) continue;
      out.push({ size: num(p, knobKey('reverb', 'size'), 1.8), damping: num(p, knobKey('reverb', 'damping'), 0.35) });
    }
  }
  return out;
}

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
    const size = num(p, knobKey('reverb', 'size'), 1.8);
    const sh = ctx.shared;
    if (sh && ctx.oneShot && ctx.durSec > 0 && sharedReverbEligible(p)) {
      // THE SHARED PATH (R-PERF-SHARED-FX-REVERB-01): dry through this play's chain as before; wet = this play's send
      // (fader level x mix) into the one convolver for (bus, impulse, fades), whose gate carries the fades.
      const e = sharedFxReverb(a, sh.bus, size, num(p, knobKey('reverb', 'damping'), 0.35), sh.fadeInSec, sh.fadeOutSec, ctx.t0);
      pointSharedFxReverb(e, sh.out);
      const send = a.createGain();
      // The fader held max(0.0001, level) and the wet was mix x that: the send is the same product.
      const lvl = Math.max(0.0001, sh.level);
      send.gain.setValueAtTime(lvl * num(p, knobKey('reverb', 'mix'), 0.3), ctx.t0);
      if (e.gate) {
        const now = a.currentTime;
        const end = ctx.t0 + ctx.durSec;
        const g = e.gate.gain;
        // The fader's floor (0.0001) as a fraction of its level: send x gate then traces the fader's own curve.
        const floor = Math.min(1, 0.0001 / lvl);
        let reopened = false;
        if (sh.fadeInSec > 0 && ctx.t0 >= e.ringUntil) {
          // The node has rung out: the gate rides this play's fade-in, exactly as its fader did.
          g.cancelScheduledValues(now);
          g.setValueAtTime(floor, ctx.t0);
          g.exponentialRampToValueAtTime(1, ctx.t0 + sh.fadeInSec);
        } else if (e.gateEnd > -Infinity && e.gateEnd <= ctx.t0) {
          // The last play on this node has finished fading: the gate opens exactly as this play starts.
          g.cancelScheduledValues(now);
          g.setValueAtTime(1, Math.max(now, ctx.t0));
        } else if (e.gateEnd > -Infinity && end > e.gateEnd) {
          // An earlier play's fade-out is closing the gate and this play outlasts it (a burst past the class's nodes):
          // re-open, over a few ms so the tail still in the node does not click.
          g.cancelScheduledValues(now);
          g.setValueAtTime(Math.max(0.0001, g.value), now);
          g.linearRampToValueAtTime(1, now + GATE_REOPEN_S);
          reopened = true;
        }
        if (sh.fadeOutSec > 0 && end > e.gateEnd) {
          // The gate follows the fade-out of the play that ends LAST.
          const at = ctx.t0 + Math.max(sh.fadeInSec, ctx.durSec - sh.fadeOutSec); // where the fader's own fade-out began
          const outStart = reopened ? Math.max(now + GATE_REOPEN_S, at) : at;
          g.setValueAtTime(1, outStart);
          g.exponentialRampToValueAtTime(floor, outStart + sh.fadeOutSec);
          e.gateEnd = end;
        }
        e.ringUntil = Math.max(e.ringUntil, end + size);
      }
      input.connect(dry); dry.connect(output);
      input.connect(send); send.connect(e.conv);
      sh.onSend(send);
      return { input, output };
    }
    const conv = acquireConvolver(a, size, num(p, knobKey('reverb', 'damping'), 0.35), ctx);
    input.connect(dry); dry.connect(output);
    input.connect(conv); conv.connect(wet); wet.connect(output);
    if (ctx.oneShot && ctx.durSec > 0) {
      // Back to the pool once this play's tail has fully decayed: the impulse runs `size` seconds past the clip.
      const releaseIn = Math.max(0, ctx.t0 - a.currentTime) + ctx.durSec + size + CONVOLVER_RELEASE_PAD_S;
      setTimeout(() => releaseConvolver(a, conv, input), releaseIn * 1000);
    }
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
