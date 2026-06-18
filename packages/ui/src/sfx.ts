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

function audio(): AudioContext | null {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
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
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

const chord = (freqs: number[], opts: Omit<ToneOpts, 'freq' | 'delay'>, step = 0.06): void =>
  freqs.forEach((f, i) => tone({ ...opts, freq: f, delay: i * step }));

export const sfx = {
  buy: () => {
    tone({ freq: 540, dur: 0.07, type: 'square', vol: 0.1 });
    tone({ freq: 820, dur: 0.09, type: 'square', vol: 0.08, delay: 0.05 });
  },
  // Rejected action (can't afford, board/hand full, timer up) — a low, dissonant "wrong"
  // double-buzz that descends, so it reads as a clear no, not a success blip.
  deny: () => {
    tone({ freq: 200, dur: 0.12, type: 'square', vol: 0.13, slideTo: 150 });
    tone({ freq: 150, dur: 0.17, type: 'square', vol: 0.12, slideTo: 96, delay: 0.085 });
  },
  play: () => tone({ freq: 260, dur: 0.13, type: 'triangle', vol: 0.2, slideTo: 150 }),
  sell: () => {
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
  hit: () => tone({ freq: 170, dur: 0.12, type: 'square', vol: 0.15, slideTo: 80 }),
  death: () => tone({ freq: 130, dur: 0.26, type: 'sine', vol: 0.2, slideTo: 48 }),
  shield: () => tone({ freq: 760, dur: 0.18, type: 'sine', vol: 0.11, slideTo: 1300 }),
  buff: () => {
    tone({ freq: 480, dur: 0.09, type: 'triangle', vol: 0.12 });
    tone({ freq: 720, dur: 0.12, type: 'triangle', vol: 0.1, delay: 0.06 });
  },
  triple: () => chord([523, 659, 784, 1046], { dur: 0.13, type: 'triangle', vol: 0.12 }, 0.06),
  win: () => chord([523, 659, 784, 1046], { dur: 0.2, type: 'triangle', vol: 0.14 }, 0.1),
  lose: () => chord([392, 311, 233], { dur: 0.24, type: 'sawtooth', vol: 0.13 }, 0.12),
} as const;

export type SfxName = keyof typeof sfx;

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
