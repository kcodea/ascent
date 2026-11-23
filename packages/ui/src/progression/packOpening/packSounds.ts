import { COSMETIC_RARITIES, type CrateRarity } from '@game/progression';
import { audioContext, fxBusTarget, playTailedClip } from '../../sfx';
import { CRATE_CUE_CATEGORY, crateCue, getCrateFxConfig, type CrateCue } from '../crateFx/crateFxConfig';
import { DEFAULT_PACK_FEEL, getPackFeel } from './packFxConfig';

/**
 * The pack opening's sound cues. Each cue is one slot in `PACK_CUES`: v1 synthesises the tactile ones (the
 * prototype's foil sounds, spec 8) and borrows the chest opener's recorded reveal cues for the reward beats, so a
 * recorded clip can replace any synthesised slot later without touching the scene.
 *
 * Nodes are built lazily on the first cue (browsers need a user gesture before audio); the shell makes one
 * `createPackSounds()` per opening and disposes it. The per-frame cues (`tear`, `slide`, `crackle`) only retarget
 * the standing loops, they never build nodes (a crackle one-shot excepted).
 */
export interface PackSounds {
  pop(): void;
  tear(speed: number): void;
  crackle(speed: number, dt: number): void;
  rip(): void;
  sleeveFree(): void;
  slide(speed: number): void;
  drop(): void;
  whoosh(): void;
  flip(rarity: CrateRarity, guaranteed: boolean): void;
  stamp(): void;
  aether(): void;
  summary(): void;
  silence(): void;
  dispose(): void;
}

/** One burst of band-passed noise: `ms` long at `hz` (optionally sweeping to `sweepTo`), at `gain`. */
interface Burst { ms: number; hz: number; gain: number; q?: number; sweepTo?: number }
/** A cue slot: bursts layered together, or a borrowed chest reveal cue. */
type CueSlot = { kind: 'bursts'; bursts: readonly Burst[] } | { kind: 'chest'; cue: CrateCue };

export const PACK_CUES = {
  pop: { kind: 'bursts', bursts: [{ ms: 70, hz: 1700, gain: 0.9, q: 1.2 }, { ms: 30, hz: 5200, gain: 0.6, q: 1.2 }] },
  rip: { kind: 'bursts', bursts: [{ ms: 380, hz: 4200, gain: 0.8, q: 0.9, sweepTo: 500 }, { ms: 80, hz: 900, gain: 0.7, q: 1 }] },
  sleeveFree: { kind: 'bursts', bursts: [{ ms: 50, hz: 700, gain: 0.7, q: 1 }, { ms: 20, hz: 3000, gain: 0.5, q: 1 }] },
  drop: { kind: 'bursts', bursts: [{ ms: 220, hz: 260, gain: 0.9, q: 1.4 }, { ms: 300, hz: 2200, gain: 0.45, q: 1, sweepTo: 400 }] },
  whoosh: { kind: 'bursts', bursts: [{ ms: 300, hz: 600, gain: 0.6, q: 0.9, sweepTo: 2400 }] },
  // Reward beats borrow the chest opener's recorded cues (same clips, same category buses).
  flip: { kind: 'chest', cue: 'reveal' },
  stamp: { kind: 'chest', cue: 'stamp' },
  aether: { kind: 'chest', cue: 'coin' },
  summary: { kind: 'chest', cue: 'sting' },
} as const satisfies Record<string, CueSlot>;

/** Seedless PRNG for the noise bed and crackle picks (one helper so it is swappable). */
const rand = (): number => Math.random();

const LOOP_Q = 0.9;

export function createPackSounds(): PackSounds {
  let a: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let tearBp: BiquadFilterNode | null = null;
  let tearGain: GainNode | null = null;
  let slideBp: BiquadFilterNode | null = null;
  let slideGain: GainNode | null = null;
  const sources: AudioBufferSourceNode[] = [];
  let disposed = false;

  /** Build the graph on first use. Null when there is no audio (or after dispose). Volume is read here, per cue. */
  const ready = (): AudioContext | null => {
    if (disposed) return null;
    if (a && master) {
      master.gain.setTargetAtTime(getPackFeel().volume, a.currentTime, 0.01);
      return a;
    }
    const ctx = audioContext();
    if (!ctx) return null;
    try {
      a = ctx;
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
      const m = ctx.createGain();
      master = m;
      m.gain.value = getPackFeel().volume;
      m.connect(fxBusTarget(ctx, 'ui'));
      const loop = (hz: number): { bp: BiquadFilterNode; gain: GainNode } => {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = LOOP_Q;
        bp.frequency.value = hz;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(bp);
        bp.connect(gain);
        gain.connect(m);
        src.start();
        sources.push(src);
        return { bp, gain };
      };
      const t = loop(1300);
      tearBp = t.bp; tearGain = t.gain;
      const s = loop(450);
      slideBp = s.bp; slideGain = s.gain;
      return ctx;
    } catch {
      // Stop any loop already started so a retry does not stack duplicate loops.
      for (const src of sources) { try { src.stop(); } catch { /* not started */ } try { src.disconnect(); } catch { /* gone */ } }
      sources.length = 0;
      a = null; master = null; noise = null; tearBp = null; tearGain = null; slideBp = null; slideGain = null;
      return null;
    }
  };

  const burst = (b: Burst, gainMul = 1): void => {
    const ctx = ready();
    if (!ctx || !master || !noise) return;
    const dur = b.ms / 1000;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = b.q ?? 1;
    f.frequency.setValueAtTime(b.hz, t);
    if (b.sweepTo) f.frequency.exponentialRampToValueAtTime(b.sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(b.gain * gainMul, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t, rand() * 1.5, dur + 0.05);
  };

  const play = (slot: CueSlot, o: { rate?: number; gain?: number } = {}): void => {
    if (slot.kind === 'bursts') {
      for (const b of slot.bursts) burst(b, o.gain ?? 1);
      return;
    }
    if (disposed || !audioContext()) return;
    const s = crateCue(getCrateFxConfig(), slot.cue);
    // The chest clips ride the game's own bus; scale them with the pack volume knob (the default volume plays them at chest level).
    playTailedClip(s.clip, CRATE_CUE_CATEGORY[slot.cue], {
      gain: s.gain * (o.gain ?? 1) * (getPackFeel().volume / DEFAULT_PACK_FEEL.volume),
      startMs: s.startMs, lenMs: s.lenMs, tail: s.tail, rate: o.rate ?? 1,
    });
  };

  const setLoop = (bp: BiquadFilterNode | null, g: GainNode | null, hz: number, gain: number): void => {
    if (!a || !bp || !g) return;
    const t = a.currentTime;
    bp.frequency.setTargetAtTime(hz, t, 0.03);
    g.gain.setTargetAtTime(gain, t, 0.03);
  };

  return {
    pop: () => play(PACK_CUES.pop),
    tear(speed) {
      if (!ready()) return;
      const v = Math.max(0, speed);
      setLoop(tearBp, tearGain, 1300 + v * 220, Math.min(1, v / 9) * 0.55);
    },
    crackle(speed, dt) {
      if (!ready() || !(speed > 0) || !(dt > 0)) return;
      // Rate speed*0.07 per unit dt; at most one crackle per call keeps allocation bounded.
      if (rand() < speed * 0.07 * dt) {
        burst({ ms: 10 + rand() * 25, hz: 2400 + rand() * 4500, gain: 0.35, q: 2 });
      }
    },
    rip() {
      play(PACK_CUES.rip);
      setLoop(tearBp, tearGain, 1300, 0);
    },
    sleeveFree: () => play(PACK_CUES.sleeveFree),
    slide(speed) {
      if (!ready()) return;
      const v = Math.max(0, speed);
      setLoop(slideBp, slideGain, 450 + v * 80, Math.min(1, v / 10) * 0.45);
    },
    drop: () => play(PACK_CUES.drop),
    whoosh: () => play(PACK_CUES.whoosh),
    flip(rarity, guaranteed) {
      const i = Math.max(0, COSMETIC_RARITIES.indexOf(rarity));
      play(PACK_CUES.flip, { rate: 0.9 + i * 0.06, gain: guaranteed ? 1.2 : 1 });
    },
    stamp: () => play(PACK_CUES.stamp),
    aether: () => play(PACK_CUES.aether),
    summary: () => play(PACK_CUES.summary),
    silence() {
      if (!a) return;
      const t = a.currentTime;
      for (const g of [tearGain, slideGain]) g?.gain.setTargetAtTime(0, t, 0.02);
    },
    dispose() {
      if (disposed) return;
      const t = a ? a.currentTime : 0;
      for (const g of [tearGain, slideGain]) g?.gain.setTargetAtTime(0, t, 0.02);
      disposed = true;
      for (const s of sources) { try { s.stop(t + 0.1); } catch { /* already stopped */ } }
      sources.length = 0;
      try { master?.disconnect(); } catch { /* already gone */ }
      a = null; master = null; noise = null; tearBp = null; tearGain = null; slideBp = null; slideGain = null;
    },
  };
}
