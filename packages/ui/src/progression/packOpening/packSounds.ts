import { COSMETIC_RARITIES, type CrateRarity } from '@game/progression';
import { audioContext, fxBusTarget, getFxClipBuffer, playTailedClip } from '../../sfx';
import { CRATE_CUE_CATEGORY, crateCue, getCrateFxConfig, type CrateCue } from '../crateFx/crateFxConfig';
import { DEFAULT_PACK_FEEL, getPackFeel } from './packFxConfig';
import type { BigPullTier } from './bigPull';

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
  /** A press on the sealed wrapper: one foil crunch. */
  squeeze(): void;
  /** The wrapper worked under the hand (a hover, a squeeze, the tear's front, the sleeve grip): `amount` ~0..1 per call. */
  handle(amount: number): void;
  /** A press on the pile's top card. */
  press(): void;
  /** One step of the rarity tease landed (packTease.ts): `stage` 0 = Common's colour ... 4 = Ancient's. Each step rings higher and a little louder. */
  tease(stage: number): void;
  /** A heartbeat of a held Legendary / Ancient tease. */
  heartbeat(stage: number): void;
  /** A face came to rest on the revealed pile. */
  land(rarity: CrateRarity): void;
  flip(rarity: CrateRarity, guaranteed: boolean): void;
  /** A Legendary / Ancient card landed (bigPull.ts): the chest's tier burst; Ancient a touch louder and brighter. */
  bigPull(tier: BigPullTier): void;
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
  bigPull: { kind: 'chest', cue: 'tierBurst' },
} as const satisfies Record<string, CueSlot>;

/**
 * THE CARD BEATS use RECORDED clips from the game's library (owner 2026-11-24: "i want the sound effects to sound real,
 * satisfying, and fun"), never synthesised tones: a card under a thumb, a glass that sings higher on each tease step, a
 * low pulse for the heartbeat, a card swish and a wind-up on the turn, a card landing, and layered impacts for a big
 * pull. One table, so a clip can be swapped in one place. `rate` is the playback rate (pitch).
 */
interface ClipCue { clip: string; cat: string; gain: number; rate?: number; delayMs?: number }
/** The tease's pitch ladder: one step per rarity colour (a rising arpeggio). */
export const TEASE_RATES: readonly number[] = [0.8, 0.9, 1, 1.19, 1.5];
export const CARD_CUES = {
  press: [{ clip: 'cardtouch', cat: 'crateStamp', gain: 0.5 }],
  tease: [{ clip: 'fx/glass-sing', cat: 'crateTierShimmer', gain: 0.34 }, { clip: 'fx/glass-tick', cat: 'crateTierShimmer', gain: 0.3 }],
  heartbeat: [{ clip: 'pulse', cat: 'cratePulse', gain: 0.5 }],
  turn: [{ clip: 'reordercard', cat: 'crateWhoosh', gain: 0.5 }, { clip: 'fx/pack-card-flip', cat: 'crateWhoosh', gain: 0.5 }],
  turnBig: [{ clip: 'windup', cat: 'crateCharge', gain: 0.45 }],
  land: [{ clip: 'cardlanding', cat: 'crateStamp', gain: 0.5 }],
  landEpic: [{ clip: 'prismaticpick', cat: 'crateTierShimmer', gain: 0.4, delayMs: 40 }],
  bigLegendary: [
    { clip: 'fx/reveal-impact-1', cat: 'crateBurst', gain: 0.7 },
    { clip: 'fx/reveal-shimmer', cat: 'crateTierShimmer', gain: 0.6, delayMs: 120 },
  ],
  bigAncient: [
    // (owner 2026-11-24: "change the sound for the ancient reveal impact": a heavy slam under an explosive swoosh, in
    // place of the first pass's reveal-impact + cinematic swoosh)
    { clip: 'fx/ancient-slam', cat: 'crateBurst', gain: 0.85 },
    { clip: 'fx/ancient-explosion-swoosh', cat: 'crateBurst', gain: 0.55 },
    { clip: 'fx/reveal-shimmer', cat: 'crateTierShimmer', gain: 0.7, delayMs: 120, rate: 1.12 },
  ],
} as const satisfies Record<string, readonly ClipCue[]>;

/**
 * THE WRAPPER'S SOUNDS are RECORDED foil (owner 2026-11-24: "sound, crinkling of the card wrapper, tearing the wrapper":
 * they must sound real), generated for this opening and played GRANULARLY so they follow the hand: the tear and the
 * sleeve are loops of real foil ripping and cards sliding whose level and pitch ride the speed, with short grains of the
 * same recordings fired as the foil catches; the crinkle is grains of a real wrapper crinkle fired as the foil is worked.
 * `gain` levels each recording (they were not recorded at one level); `from` / `to` (seconds) is the part that is sound,
 * not lead-in silence. Until a clip has decoded (or with no audio), the old synthesised cue plays in its place.
 */
interface FoilClip { clip: string; gain: number; from?: number; to?: number }
export const FOIL = {
  crinkle: [{ clip: 'fx/pack-crinkle-1', gain: 2.6, from: 0, to: 0.55 }, { clip: 'fx/pack-crinkle-2', gain: 2.4, from: 0.05, to: 0.55 }],
  squeeze: { clip: 'fx/pack-squeeze', gain: 1.5 },
  pinch: { clip: 'fx/pack-pinch', gain: 0.6 },
  tear: { clip: 'fx/pack-tear', gain: 0.55, from: 1.05, to: 2.3 },
  rip: { clip: 'fx/pack-rip', gain: 2 },
  slide: { clip: 'fx/pack-slide', gain: 0.9, from: 0.7, to: 2.2 },
  release: { clip: 'fx/pack-release', gain: 1.6 },
  drop: { clip: 'fx/pack-drop', gain: 5 },
  cards: { clip: 'fx/pack-cards', gain: 4 },
} as const satisfies Record<string, FoilClip | readonly FoilClip[]>;
/** The shortest gap between two grains (seconds): keeps the node count bounded however fast the hand moves. */
export const GRAIN_GAP_S = 0.03;

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

  /** A recorded clip's buffer once decoded (asking kicks the decode); null until then, or with no audio. */
  const bufOf = (c: FoilClip): AudioBuffer | null => (disposed ? null : getFxClipBuffer(c.clip));

  /** Play a recorded clip once. False when it is not decoded yet (the caller plays the synth instead). */
  const shot = (c: FoilClip, gainMul = 1, rate = 1): boolean => {
    const ctx = ready(), b = bufOf(c);
    if (!ctx || !master || !b) return false;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = c.gain * gainMul;
    src.connect(g); g.connect(master);
    src.start(ctx.currentTime, c.from ?? 0);
    return true;
  };

  /** One short grain out of a recorded clip's sounding part, with a click-free envelope. False when not decoded yet. */
  let lastGrain = -1;
  const grain = (c: FoilClip, ms: number, gainMul: number, rate: number): boolean => {
    const ctx = ready(), b = bufOf(c);
    if (!ctx || !master || !b) return false;
    const t = ctx.currentTime;
    if (t - lastGrain < GRAIN_GAP_S) return true; // heard, just not this frame
    lastGrain = t;
    const from = c.from ?? 0, to = Math.min(c.to ?? b.duration, b.duration), dur = ms / 1000;
    const off = from + rand() * Math.max(0, to - from - dur);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(c.gain * gainMul, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(g); g.connect(master);
    src.start(t, off, dur + 0.02);
    return true;
  };

  /** A standing loop of a recorded clip's sounding part (built once, when it has decoded); its level and pitch are set per frame. */
  const recLoops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode } | null>();
  const recLoop = (c: FoilClip): { src: AudioBufferSourceNode; gain: GainNode } | null => {
    const have = recLoops.get(c.clip);
    if (have) return have;
    const ctx = ready(), b = bufOf(c);
    if (!ctx || !master || !b) return null;
    try {
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      src.loopStart = c.from ?? 0;
      src.loopEnd = Math.min(c.to ?? b.duration, b.duration);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain); gain.connect(master);
      src.start(ctx.currentTime, c.from ?? 0);
      sources.push(src);
      const node = { src, gain };
      recLoops.set(c.clip, node);
      return node;
    } catch { return null; }
  };
  const setRec = (c: FoilClip, level: number, rate: number): boolean => {
    const n = recLoop(c);
    if (!n || !a) return false;
    const t = a.currentTime;
    n.gain.gain.setTargetAtTime(c.gain * level, t, 0.03);
    n.src.playbackRate.setTargetAtTime(rate, t, 0.05);
    return true;
  };

  /** Play a card beat's recorded clips (`rateMul` / `gainMul` on top of each cue's own), scaled by the pack volume knob. */
  const cues = (list: readonly ClipCue[], rateMul = 1, gainMul = 1): void => {
    if (disposed || !audioContext()) return;
    const vol = getPackFeel().volume / DEFAULT_PACK_FEEL.volume;
    for (const c of list) {
      playTailedClip(c.clip, c.cat, { gain: c.gain * gainMul * vol, rate: (c.rate ?? 1) * rateMul, delayMs: c.delayMs ?? 0 });
    }
  };

  const setLoop = (bp: BiquadFilterNode | null, g: GainNode | null, hz: number, gain: number): void => {
    if (!a || !bp || !g) return;
    const t = a.currentTime;
    bp.frequency.setTargetAtTime(hz, t, 0.03);
    g.gain.setTargetAtTime(gain, t, 0.03);
  };

  return {
    pop() { if (!shot(FOIL.pinch)) play(PACK_CUES.pop); },
    tear(speed) {
      if (!ready()) return;
      const v = Math.max(0, speed);
      // the recorded tear's level and pitch ride the speed; the synth bed only until it has decoded
      if (setRec(FOIL.tear, Math.min(1, v / 8), 0.82 + Math.min(1, v / 14) * 0.5)) setLoop(tearBp, tearGain, 1300, 0);
      else setLoop(tearBp, tearGain, 1300 + v * 220, Math.min(1, v / 9) * 0.55);
    },
    crackle(speed, dt) {
      if (!ready() || !(speed > 0) || !(dt > 0)) return;
      // Rate speed*0.07 per unit dt; at most one crackle per call keeps allocation bounded.
      if (rand() < speed * 0.07 * dt) {
        // the foil catching: a grain of the real tear, pitched a little differently each time
        if (!grain(FOIL.tear, 50 + rand() * 70, 0.9, 0.9 + rand() * 0.5)) burst({ ms: 10 + rand() * 25, hz: 2400 + rand() * 4500, gain: 0.35, q: 2 });
      }
    },
    rip() {
      if (!shot(FOIL.rip)) play(PACK_CUES.rip);
      setLoop(tearBp, tearGain, 1300, 0);
      setRec(FOIL.tear, 0, 1);
    },
    sleeveFree() { if (!shot(FOIL.release)) play(PACK_CUES.sleeveFree); },
    slide(speed) {
      if (!ready()) return;
      const v = Math.max(0, speed);
      if (setRec(FOIL.slide, Math.min(1, v / 9), 0.8 + Math.min(1, v / 14) * 0.45)) setLoop(slideBp, slideGain, 450, 0);
      else setLoop(slideBp, slideGain, 450 + v * 80, Math.min(1, v / 10) * 0.45);
    },
    drop() { if (!shot(FOIL.drop)) play(PACK_CUES.drop); setRec(FOIL.slide, 0, 1); },
    whoosh() { if (!shot(FOIL.cards)) play(PACK_CUES.whoosh); },
    squeeze() {
      if (!shot(FOIL.squeeze, 1, 0.92 + rand() * 0.16)) burst({ ms: 60, hz: 3200, gain: 0.4, q: 1.5 });
    },
    handle(amount) {
      if (!ready() || !(amount > 0)) return;
      // at most one crinkle grain per call, more likely the harder the foil is worked
      const k = Math.min(1, amount);
      if (rand() >= k) return;
      const c = FOIL.crinkle[rand() < 0.5 ? 0 : 1]!;
      if (!grain(c, 70 + rand() * 110, 0.55 + 0.45 * k, 0.88 + rand() * 0.34)) {
        burst({ ms: 14 + rand() * 30, hz: 2600 + rand() * 5200, gain: 0.16 + 0.2 * k, q: 2.5 });
      }
    },
    press: () => cues(CARD_CUES.press),
    tease(stage) {
      const s = Math.max(0, Math.min(TEASE_RATES.length - 1, Math.floor(stage)));
      cues(CARD_CUES.tease, TEASE_RATES[s]!, 1 + 0.16 * s);
    },
    heartbeat: (stage) => cues(CARD_CUES.heartbeat, stage >= 4 ? 1.1 : 0.9),
    land(rarity) {
      const i = Math.max(0, COSMETIC_RARITIES.indexOf(rarity));
      cues(CARD_CUES.land, 1.06 - i * 0.05, 1 + 0.14 * i);
      if (i === 2) cues(CARD_CUES.landEpic);
    },
    flip(rarity, guaranteed) {
      const i = Math.max(0, COSMETIC_RARITIES.indexOf(rarity));
      play(PACK_CUES.flip, { rate: 0.9 + i * 0.06, gain: guaranteed ? 1.2 : 1 });
      // the card itself: a swish, lower for a heavier card; a wind-up under a Legendary / Ancient turn
      cues(CARD_CUES.turn, 1.12 - i * 0.07);
      if (i >= 3) cues(CARD_CUES.turnBig, i >= 4 ? 0.85 : 1);
    },
    bigPull(tier) {
      if (tier === 'none') return;
      play(PACK_CUES.bigPull, tier === 'ancient' ? { rate: 1.08, gain: 1.25 } : {});
      cues(tier === 'ancient' ? CARD_CUES.bigAncient : CARD_CUES.bigLegendary);
    },
    stamp: () => play(PACK_CUES.stamp),
    aether: () => play(PACK_CUES.aether),
    summary: () => play(PACK_CUES.summary),
    silence() {
      if (!a) return;
      const t = a.currentTime;
      for (const g of [tearGain, slideGain]) g?.gain.setTargetAtTime(0, t, 0.02);
      for (const n of recLoops.values()) n?.gain.gain.setTargetAtTime(0, t, 0.02);
    },
    dispose() {
      if (disposed) return;
      const t = a ? a.currentTime : 0;
      for (const g of [tearGain, slideGain]) g?.gain.setTargetAtTime(0, t, 0.02);
      for (const n of recLoops.values()) n?.gain.gain.setTargetAtTime(0, t, 0.02);
      recLoops.clear();
      disposed = true;
      for (const s of sources) { try { s.stop(t + 0.1); } catch { /* already stopped */ } }
      sources.length = 0;
      try { master?.disconnect(); } catch { /* already gone */ }
      a = null; master = null; noise = null; tearBp = null; tearGain = null; slideBp = null; slideGain = null;
    },
  };
}
