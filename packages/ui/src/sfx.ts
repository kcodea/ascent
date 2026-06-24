/**
 * Tiny synthesized sound bank (Web Audio) — no asset files, all generated on the
 * fly. Each effect is a short oscillator blip with a quick gain envelope. Muting
 * persists in localStorage. The context is created lazily and resumed on the
 * first call (which happens inside a user gesture, satisfying autoplay policy).
 */

let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem('ascent.muted') === '1';
  } catch {
    return false;
  }
})();
// Master volume (0–1) — a global multiplier on every sound, set by the Settings slider, persisted.
let masterVol = (() => {
  try {
    const v = parseFloat(localStorage.getItem('ascent.vol') ?? '1');
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  } catch {
    return 1;
  }
})();
export function getVolume(): number {
  return masterVol;
}
export function setVolume(v: number): void {
  masterVol = Math.min(1, Math.max(0, v));
  try {
    localStorage.setItem('ascent.vol', String(masterVol));
  } catch {
    /* ignore */
  }
}

function audio(): AudioContext | null {
  try {
    const isNew = !ctx;
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    if (isNew) prefetchSamples(); // decode the mp3 SFX once the context exists (first user gesture)
    return ctx;
  } catch {
    return null;
  }
}

// --- Sampled SFX (mp3 files in ./audio) — decoded into AudioBuffers and played through the same context, so
//     they overlap cleanly (each play is a fresh BufferSource) and sit alongside the synth blips. Decoded
//     lazily; the synth blip is the fallback until a sample's buffer is ready (or if decoding fails). ---
const SAMPLE_URLS = import.meta.glob('./audio/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const buffers = new Map<string, AudioBuffer>();
const loadingSamples = new Set<string>();
const sampleName = (path: string): string => path.split('/').pop()?.replace(/\.mp3$/, '') ?? '';

function loadSample(name: string): void {
  const a = audio();
  if (!a || buffers.has(name) || loadingSamples.has(name)) return;
  const entry = Object.entries(SAMPLE_URLS).find(([p]) => sampleName(p) === name);
  if (!entry) return;
  loadingSamples.add(name);
  fetch(entry[1])
    .then((r) => r.arrayBuffer())
    .then((ab) => a.decodeAudioData(ab))
    .then((buf) => { buffers.set(name, buf); loadingSamples.delete(name); })
    .catch(() => loadingSamples.delete(name));
}

function prefetchSamples(): void {
  for (const path of Object.keys(SAMPLE_URLS)) loadSample(sampleName(path));
}

/** Play a decoded sample (fresh BufferSource → overlaps fine). Returns false if its buffer isn't ready yet,
 *  so the caller can fall back to a synth blip while the sample finishes decoding. */
function playSample(name: string, vol = 0.6): boolean {
  const a = audio();
  if (!a || muted) return false;
  const buf = buffers.get(name);
  if (!buf) { loadSample(name); return false; }
  const src = a.createBufferSource();
  src.buffer = buf;
  const g = a.createGain();
  g.gain.value = vol * masterVol;
  src.connect(g).connect(a.destination);
  src.start();
  return true;
}

interface ToneOpts {
  freq: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
  slideTo?: number;
  delay?: number;
}

function tone({ freq, dur, type = 'sine', vol = 0.18, slideTo, delay = 0 }: ToneOpts): void {
  const a = audio();
  if (!a || muted) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, vol * masterVol), t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

const chord = (freqs: number[], opts: Omit<ToneOpts, 'freq' | 'delay'>, step = 0.06): void =>
  freqs.forEach((f, i) => tone({ ...opts, freq: f, delay: i * step }));

// Shared gain for the combat smack AND the card-landing clip, so "same level as smack" stays true if either
// is retuned. Smack was 0.39; −60% → 0.156.
const SMACK_VOL = 0.156;

export const sfx = {
  buy: () => {
    // One of the 2 sourced buy clips at random (buy1/buy2); synth blip until they decode / if absent.
    if (playSample(`buy${1 + Math.floor(Math.random() * 2)}`, 0.5)) return;
    tone({ freq: 540, dur: 0.07, type: 'square', vol: 0.1 });
    tone({ freq: 820, dur: 0.09, type: 'square', vol: 0.08, delay: 0.05 });
  },
  // Rejected action (can't afford, board/hand full, timer up) — a low, dissonant "wrong"
  // double-buzz that descends, so it reads as a clear no, not a success blip.
  deny: () => {
    tone({ freq: 200, dur: 0.12, type: 'square', vol: 0.13, slideTo: 150 });
    tone({ freq: 150, dur: 0.17, type: 'square', vol: 0.12, slideTo: 96, delay: 0.085 });
  },
  // A MINION lands on the board — the sourced "cardlanding" clip at the smack level; synth slide until it
  // decodes / if absent. Drop the clip at `packages/ui/src/audio/cardlanding.mp3`.
  play: () => {
    if (playSample('cardlanding', SMACK_VOL)) return;
    tone({ freq: 260, dur: 0.13, type: 'triangle', vol: 0.2, slideTo: 150 });
  },
  // A SPELL is cast — kept distinct from a minion landing (spells get per-spell sounds later). Synth for now.
  castSpell: () => tone({ freq: 300, dur: 0.13, type: 'triangle', vol: 0.18, slideTo: 170 }),
  sell: () => {
    // One of the 4 sourced sell clips at random (sell1–sell4); synth blip until they finish decoding.
    if (playSample(`sell${1 + Math.floor(Math.random() * 4)}`, 0.51)) return;
    tone({ freq: 700, dur: 0.07, type: 'square', vol: 0.09 });
    tone({ freq: 1040, dur: 0.11, type: 'square', vol: 0.07, delay: 0.06 });
  },
  roll: () => [0, 0.04, 0.08].forEach((d, i) => tone({ freq: 380 + i * 60, dur: 0.05, type: 'square', vol: 0.06, delay: d })),
  upgrade: () => chord([392, 523, 659], { dur: 0.14, type: 'triangle', vol: 0.12 }, 0.07),
  temper: () => {
    tone({ freq: 1200, dur: 0.06, type: 'square', vol: 0.1 });
    tone({ freq: 1600, dur: 0.12, type: 'sine', vol: 0.12, delay: 0.04 });
  },
  tick: () => tone({ freq: 1040, dur: 0.045, type: 'square', vol: 0.09 }),
  combatStart: () => tone({ freq: 200, dur: 0.45, type: 'sawtooth', vol: 0.16, slideTo: 90 }),
  attack: () => tone({ freq: 320, dur: 0.08, type: 'sawtooth', vol: 0.1, slideTo: 130 }),
  // Impact in combat — the sourced "Smack" clip (dialed down across passes); synth thud until it decodes.
  // Fired frame-accurately from the lunge's GSAP timeline (see playAttackLunge) so it lands on contact.
  hit: () => {
    if (playSample('smack', SMACK_VOL)) return;
    tone({ freq: 170, dur: 0.12, type: 'square', vol: 0.15, slideTo: 80 });
  },
  death: () => tone({ freq: 130, dur: 0.26, type: 'sine', vol: 0.2, slideTo: 48 }),
  shield: () => tone({ freq: 760, dur: 0.18, type: 'sine', vol: 0.11, slideTo: 1300 }),
  buff: () => {
    tone({ freq: 480, dur: 0.09, type: 'triangle', vol: 0.12 });
    tone({ freq: 720, dur: 0.12, type: 'triangle', vol: 0.1, delay: 0.06 });
  },
  // An End-of-Turn effect firing — a short shimmer so each proc is heard, not just seen.
  proc: () => {
    tone({ freq: 540, dur: 0.1, type: 'triangle', vol: 0.11, slideTo: 880 });
    tone({ freq: 1080, dur: 0.13, type: 'sine', vol: 0.07, delay: 0.05 });
  },
  triple: () => chord([523, 659, 784, 1046], { dur: 0.13, type: 'triangle', vol: 0.12 }, 0.06),
  win: () => chord([523, 659, 784, 1046], { dur: 0.2, type: 'triangle', vol: 0.14 }, 0.1),
  lose: () => chord([392, 311, 233], { dur: 0.24, type: 'sawtooth', vol: 0.13 }, 0.12),
} as const;

export function isMuted(): boolean {
  return muted;
}
export function toggleMute(): boolean {
  muted = !muted;
  try {
    localStorage.setItem('ascent.muted', muted ? '1' : '0');
  } catch {
    /* ignore */
  }
  return muted;
}
