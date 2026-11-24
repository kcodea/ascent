/**
 * THE LOCATION REVEAL's sound: every cue laid on the audio clock at once, from the same times the picture uses. The
 * effects ride the game's own `ui` bus (its sliders, mute and limiter); the line rides the Announcer's channel. The clips
 * (ElevenLabs, 2026-11-24) are public files, fetched as the gate shuts and let go when the reveal ends. The gate's own
 * shatter, hit and grinding open are played by the gate (`sfx.gate`). Audio never blocks the picture.
 */
import { announcerOutput } from '../announcer';
import { audioContext, fxBusTarget, isMuted } from '../sfx';
import { locationSound, type LocationId } from './locations';
import { clamp, L, NAME, outroAt, posterRest, realOf, ROLL_STEP, simEnd, START, T0, washAt } from './revealTimeline';

type Curve = readonly (readonly [number, number])[];
interface Cue {
  clip: string;
  /** Wall seconds from the press. */
  at: number;
  gain: number;
  /** Played backwards (the charge is a decay, reversed into a rise). */
  reverse?: boolean;
  loop?: boolean;
  /** How long it sounds (a loop needs it; absent = the clip's own length). */
  len?: number;
  /** Gain, playback rate and pan over its own seconds. */
  env?: Curve;
  rate?: Curve;
  pan?: Curve;
  lowpass?: number;
  voice?: boolean;
}

/** The whole mix against the game's gate cues: 1 = the prototype's balance, where the shatter played 0.8 (here it plays 0.6). */
const LEVEL = 0.75;
/** The announcer's line, over his channel level. */
const VOICE = 1.2;
/** The line starts this long after the name does. */
export const LINE_DELAY = 0.18;
const POSTER_RATE = [0.76, 0.79, 0.82, 0.85, 0.88];

/** Every cue of a reveal with `n` parchments. Times are wall seconds from the press. */
export function revealCues(id: LocationId, n: number): Cue[] {
  const t = (s: number): number => realOf(s) - realOf(START);
  const t0 = t(T0);
  const land = t(L);
  const name = t(NAME);
  const end = t(simEnd(n));
  const ride = land - t0;
  const bright = id === 'outskirts';
  return [
    { clip: 'charge', at: t0 - 0.74, gain: 0.55, reverse: true },
    {
      clip: `ride-${id}`, at: t0 - 0.05, gain: bright ? 0.85 : 0.72, loop: true, len: ride + 0.3,
      env: [[0, 0], [0.55, 0.6], [ride - 0.35, 1], [ride - 0.04, 0.45], [ride + 0.3, 0]], rate: [[0, 0.86], [ride, 1.28]], pan: [[0, 0], [0.35, -0.45], [1.1, -0.15], [ride, 0.18]],
    },
    { clip: 'gather', at: land - 0.53, gain: 0.95 },
    { clip: 'impact', at: land - 0.005, gain: 0.95 },
    { clip: 'wave', at: land - 0.06, gain: 0.48 },
    { clip: 'weld', at: land + 0.06, gain: 0.85 },
    {
      clip: `ambience-${id}`, at: land + 0.1, gain: bright ? 1.9 : 0.75, loop: true, len: end - land - 0.1,
      env: [[0, 0], [0.75, 0.8], [name - land - 0.1, 0.8], [name - land + 0.15, 0.42], [name - land + 2, 0.42], [name - land + 2.7, 1], [end - land - 0.75, 1], [end - land - 0.1, 0]],
    },
    { clip: 'title', at: name - 0.12, gain: 0.62 },
    { clip: `vo-${id}`, at: name + LINE_DELAY, gain: VOICE, voice: true },
    ...Array.from({ length: n }, (_, i): Cue => ({
      clip: 'poster', at: t(posterRest(i, n).at) - 0.1, gain: 0.36, lowpass: 1900, env: [[0, 0.2], [0.1, 1], [0.8, 1], [1, 0]],
      rate: [[0, POSTER_RATE[i % POSTER_RATE.length]!]], pan: [[0, clamp((i - (n - 1) / 2) * 0.32, -1, 1)]],
    })),
    // Leaving: each rolls back up, then the wave, smaller and softer than the one that landed, with a little shimmer on it.
    ...Array.from({ length: n }, (_, i): Cue => ({
      clip: 'poster', at: t(outroAt(n) + i * ROLL_STEP) - 0.04, gain: 0.2, lowpass: 2300, env: [[0, 0.2], [0.08, 1], [0.5, 0.6], [0.8, 0]], rate: [[0, 1.02 + i * 0.03]], pan: [[0, clamp((i - (n - 1) / 2) * 0.32, -1, 1)]],
    })),
    { clip: 'wave', at: t(washAt(n)) - 0.2, gain: 0.34, rate: [[0, 1.08]], lowpass: 5200 },
    { clip: 'title', at: t(washAt(n)) + 0.1, gain: 0.26, rate: [[0, 1.22]] },
  ];
}

export interface RevealSound {
  /** Lay every cue of a reveal with `n` parchments, from now. */
  play: (n: number) => void;
  stop: (fadeMs?: number) => void;
}

/** Fetch and decode a location's clips now. Never throws; a clip that fails is simply silent. */
export function loadRevealSound(id: LocationId): RevealSound {
  const buffers = new Map<string, AudioBuffer>();
  let live: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
  let stopped = false;
  const ctx = audioContext();
  if (ctx) {
    for (const clip of new Set(revealCues(id, 1).map((c) => c.clip))) {
      void fetch(locationSound(clip))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => { if (!stopped) buffers.set(clip, buf); })
        .catch(() => undefined);
    }
  }
  const reversed = (buf: AudioBuffer): AudioBuffer => {
    const r = ctx!.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) r.copyToChannel(Float32Array.from(buf.getChannelData(c)).reverse(), c);
    return r;
  };
  /** A curve written onto a parameter from `skip` seconds in, starting at clock time `when`. */
  const write = (param: AudioParam, pts: Curve, mul: number, skip: number, when: number): void => {
    let i = 0;
    while (i < pts.length - 1 && pts[i + 1]![0] <= skip) i++;
    const a = pts[i]!;
    const b = pts[Math.min(i + 1, pts.length - 1)]!;
    const now = b[0] === a[0] ? a[1] : a[1] + (b[1] - a[1]) * clamp((skip - a[0]) / (b[0] - a[0]));
    param.setValueAtTime(now * mul, when);
    for (const [x, y] of pts) if (x > skip) param.linearRampToValueAtTime(y * mul, when + x - skip);
  };
  const start = (c: Cue, from: number): void => {
    const raw = buffers.get(c.clip);
    if (!ctx || !raw) return;
    const buf = c.reverse ? reversed(raw) : raw;
    const len = c.len ?? buf.duration;
    const skip = Math.max(0, -c.at); // a cue that would have begun before the press starts part way in
    if (skip >= len) return;
    const when = from + Math.max(0, c.at);
    const out = c.voice ? announcerOutput() : fxBusTarget(ctx, 'ui');
    if (!out || (!c.voice && isMuted())) return;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    src.buffer = buf;
    src.loop = !!c.loop;
    write(gain.gain, c.env ?? [[0, 1]], c.voice ? c.gain : c.gain * LEVEL, skip, when);
    write(src.playbackRate, c.rate ?? [[0, 1]], 1, skip, when);
    write(pan.pan, c.pan ?? [[0, 0]], 1, skip, when);
    let tail: AudioNode = gain;
    if (c.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = c.lowpass;
      f.Q.value = 0.4;
      gain.connect(f);
      tail = f;
    }
    src.connect(gain);
    tail.connect(pan).connect(out);
    src.start(when, c.loop ? skip % buf.duration : skip);
    if (c.len) src.stop(when + len - skip);
    live.push({ src, gain });
  };
  return {
    play(n) {
      if (!ctx || stopped) return;
      try { for (const c of revealCues(id, n)) start(c, ctx.currentTime + 0.02); } catch (e) { console.warn('[locationReveal] sound', e); }
    },
    stop(fadeMs = 120) {
      stopped = true;
      buffers.clear();
      for (const { src, gain } of live) {
        try {
          const at = ctx!.currentTime;
          gain.gain.cancelScheduledValues(at);
          gain.gain.setTargetAtTime(0, at, fadeMs / 3000);
          src.stop(at + fadeMs / 1000 + 0.05);
        } catch { /* already over */ }
      }
      live = [];
    },
  };
}
