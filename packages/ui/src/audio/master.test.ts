// @vitest-environment jsdom
/**
 * THE MASTER VOLUME (owner ask 2026-09-26): "add a master volume slider to the audio panel in game".
 *
 * Contract: one master stage in front of the speakers scales EVERY channel (Game sounds, Music, Announcer); the
 * curve is plain linear (100 = unity); default 100, unmuted; volume + mute persist; the master mute silences
 * everything while the channel mutes stay as they were; the no-Web-Audio element fallbacks follow it too.
 *
 * The graph checks run the real modules against a fake AudioContext that records every `connect`, then walk each
 * channel's output node to the destination multiplying the gains on the way: that product is the channel's
 * effective gain at the speakers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetMasterForTests, DEFAULT_MASTER, getMasterVolume, isMasterMuted, MASTER_MUTED_KEY, MASTER_VOLUME_KEY,
  masterLevel, masterOutput, masterSliderToGain, onMasterChange, setMasterVolume, toggleMasterMute,
} from './master';

// ── A recording fake AudioContext ──────────────────────────────────────────────────────────────────────────────
interface FakeNode { kind: string; outs: FakeNode[]; gain?: { value: number }; connect(n: FakeNode): FakeNode; disconnect(): void }
function param(v: number) {
  return {
    value: v,
    cancelScheduledValues() {},
    setValueAtTime(x: number) { this.value = x; },
    setTargetAtTime(x: number) { this.value = x; }, // the fake settles instantly
    linearRampToValueAtTime(x: number) { this.value = x; },
  };
}
function node(kind: string, extra: Record<string, unknown> = {}): FakeNode {
  const n: FakeNode = {
    kind, outs: [],
    connect(t: FakeNode) { n.outs.push(t); return t; },
    disconnect() { n.outs = []; },
    ...extra,
  };
  return n;
}
class FakeCtx {
  state = 'running';
  currentTime = 0;
  destination = node('destination');
  created: FakeNode[] = [];
  resume() { return Promise.resolve(); }
  private track<T extends FakeNode>(n: T): T { this.created.push(n); return n; }
  createGain() { return this.track(node('gain', { gain: param(1) })); }
  createDynamicsCompressor() {
    return this.track(node('comp', { threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0) }));
  }
  createAnalyser() { return this.track(node('analyser', { fftSize: 0 })); }
  createMediaElementSource() { return this.track(node('mediasrc')); }
  createBufferSource() { return this.track(node('buffersrc', { buffer: null, playbackRate: param(1), loop: false, start() {}, stop() {}, onended: null })); }
  decodeAudioData() { return Promise.resolve({ duration: 1, numberOfChannels: 1, length: 1, sampleRate: 44100, getChannelData: () => new Float32Array(1) }); }
}
const asCtx = (c: FakeCtx): AudioContext => c as unknown as AudioContext;

/** Every path from `from` to the destination, as the product of its gain nodes (analysers are dead-end taps). */
function effectiveGains(from: FakeNode, dest: FakeNode, acc = 1): number[] {
  if (from === dest) return [acc];
  const here = from.kind === 'gain' ? acc * from.gain!.value : acc;
  return from.outs.flatMap((o) => effectiveGains(o, dest, here));
}
const only = (xs: number[]): number => { expect(xs.length).toBe(1); return xs[0]!; };

beforeEach(() => {
  localStorage.clear();
  __resetMasterForTests();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('the master itself: curve, defaults, persistence, mute', () => {
  it('defaults to 100 (unity) and unmuted with nothing stored', () => {
    expect(DEFAULT_MASTER).toBe(1);
    expect(getMasterVolume()).toBe(1);
    expect(isMasterMuted()).toBe(false);
    expect(masterLevel()).toBe(1);
  });
  it('is a plain linear curve: 0 silent, 50 half, 100 unity, clamped', () => {
    expect(masterSliderToGain(0)).toBe(0);
    expect(masterSliderToGain(0.5)).toBe(0.5);
    expect(masterSliderToGain(1)).toBe(1);
    expect(masterSliderToGain(3)).toBe(1);
    expect(masterSliderToGain(-1)).toBe(0);
    expect(masterSliderToGain(NaN)).toBe(DEFAULT_MASTER);
  });
  it('persists the volume and the mute under their own keys and reads them back', () => {
    setMasterVolume(0.3);
    expect(localStorage.getItem(MASTER_VOLUME_KEY)).toBe('0.3');
    expect(toggleMasterMute()).toBe(true);
    expect(localStorage.getItem(MASTER_MUTED_KEY)).toBe('1');
    __resetMasterForTests(); // a reload
    expect(getMasterVolume()).toBe(0.3);
    expect(isMasterMuted()).toBe(true);
    expect(masterLevel()).toBe(0);
  });
  it('a junk stored value falls back to the default', () => {
    localStorage.setItem(MASTER_VOLUME_KEY, 'loud');
    __resetMasterForTests();
    expect(getMasterVolume()).toBe(DEFAULT_MASTER);
  });
  it('a blocked store never breaks it (defaults, and setting still works live)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    __resetMasterForTests();
    expect(getMasterVolume()).toBe(DEFAULT_MASTER);
    setMasterVolume(0.4);
    expect(masterLevel()).toBe(0.4);
    vi.restoreAllMocks();
  });
  it('mute zeroes the level and unmute restores the slider level', () => {
    setMasterVolume(0.6);
    toggleMasterMute();
    expect(masterLevel()).toBe(0);
    toggleMasterMute();
    expect(masterLevel()).toBe(0.6);
  });
  it('notifies listeners on every change', () => {
    const cb = vi.fn();
    const off = onMasterChange(cb);
    setMasterVolume(0.2);
    toggleMasterMute();
    off();
    setMasterVolume(0.9);
    expect(cb).toHaveBeenCalledTimes(2);
  });
  it('builds ONE gain node per context, feeding the destination, riding the level', () => {
    const ctx = new FakeCtx();
    const out = masterOutput(asCtx(ctx)) as unknown as FakeNode;
    expect(masterOutput(asCtx(ctx))).toBe(out as unknown as AudioNode);
    expect(out.outs).toEqual([ctx.destination]);
    expect(out.gain!.value).toBe(1);
    setMasterVolume(0.25);
    expect(out.gain!.value).toBe(0.25);
    toggleMasterMute();
    expect(out.gain!.value).toBe(0);
  });
});

describe('every channel runs through the master (Web Audio path)', () => {
  it('Music: its level gain feeds the master; effective gain = channel gain x master', async () => {
    const music = await import('../music');
    const ctx = new FakeCtx();
    const els: { volume: number }[] = [];
    music.__setMusicDepsForTests({
      createElement: (src) => {
        const el = { src, volume: 1, currentTime: 0, duration: NaN, paused: true, preload: 'none', play: () => Promise.resolve(), pause() {}, addEventListener() {} };
        els.push(el);
        return el;
      },
      audioContext: () => asCtx(ctx),
      setTimeout: (cb, ms) => window.setTimeout(cb, ms),
      clearTimeout: (id) => window.clearTimeout(id),
      setInterval: (cb, ms) => window.setInterval(cb, ms),
      clearInterval: (id) => window.clearInterval(id),
      onNextGesture: () => () => {},
    });
    vi.useFakeTimers();
    try {
      music.setMusicVolume(1); // channel gain 1 at 100
      music.syncMusic({ showTitle: false, heroChoices: null, practiceSetupOpen: false, replaying: false, run: { mode: 'lobby', seed: 1 } });
      await vi.advanceTimersByTimeAsync(music.MUSIC_START_DELAY_MS + music.MUSIC_FADE_MS + 50);
      const src = ctx.created.find((n) => n.kind === 'mediasrc')!;
      expect(src).toBeTruthy();
      const master = masterOutput(asCtx(ctx)) as unknown as FakeNode;
      // The music's final gain connects to the master node, never straight to the destination.
      expect(ctx.created.some((n) => n.outs.includes(master))).toBe(true);
      expect(ctx.created.filter((n) => n !== master && n.outs.includes(ctx.destination))).toEqual([]);
      expect(only(effectiveGains(src, ctx.destination))).toBeCloseTo(1, 5);
      setMasterVolume(0.5);
      expect(only(effectiveGains(src, ctx.destination))).toBeCloseTo(0.5, 5);
      // The duck (Ancients awakening) still multiplies in, upstream of the master.
      music.setMusicDuck(0.3);
      expect(only(effectiveGains(src, ctx.destination))).toBeCloseTo(0.15, 5);
      music.setMusicDuck(1);
      toggleMasterMute();
      expect(only(effectiveGains(src, ctx.destination))).toBe(0);
      expect(music.isMusicMuted()).toBe(false); // the channel mute is untouched
    } finally {
      music.__setMusicDepsForTests(null);
      vi.useRealTimers();
    }
  });

  it('Announcer: its level gain feeds the master; effective gain = line x channel x master', async () => {
    const ann = await import('../announcer');
    const ctx = new FakeCtx();
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
    ann.setAnnouncerAudioContextProvider(() => asCtx(ctx));
    ann.setAnnouncerVolume(1); // channel gain 1 at 100
    const event = Object.keys(ann.ANNOUNCER_LINES)[0] as Parameters<typeof ann.previewAnnouncerEvent>[0];
    ann.previewAnnouncerEvent(event);
    await vi.waitFor(() => expect(ctx.created.some((n) => n.kind === 'buffersrc')).toBe(true));
    const src = ctx.created.find((n) => n.kind === 'buffersrc')!;
    const master = masterOutput(asCtx(ctx)) as unknown as FakeNode;
    expect(ctx.created.filter((n) => n !== master && n.outs.includes(ctx.destination))).toEqual([]);
    const full = only(effectiveGains(src, ctx.destination));
    expect(full).toBeGreaterThan(0);
    setMasterVolume(0.4);
    expect(only(effectiveGains(src, ctx.destination))).toBeCloseTo(full * 0.4, 5);
    toggleMasterMute();
    expect(only(effectiveGains(src, ctx.destination))).toBe(0);
    expect(ann.isAnnouncerMuted()).toBe(false);
    ann.setAnnouncerAudioContextProvider(() => null);
  });

  it('Game sounds: every category bus reaches the speakers only through the master', async () => {
    const ctx = new FakeCtx();
    vi.stubGlobal('fetch', () => new Promise(() => {})); // sample prefetch: never resolves, never matters here
    vi.stubGlobal('AudioContext', function FakeAudioContext() { return ctx; });
    const sfx = await import('../sfx');
    expect(sfx.audioContext()).toBe(ctx as unknown as AudioContext);
    const master = masterOutput(asCtx(ctx)) as unknown as FakeNode;
    // Only the master node touches the destination: the SFX mute bus now feeds the master.
    expect(ctx.created.filter((n) => n !== master && n.outs.includes(ctx.destination))).toEqual([]);
    // A bus input is a gain whose output is a compressor or the limiter (i.e. not an analyser tap / the master).
    const busInputs = ctx.created.filter((n) => n.kind === 'gain' && n !== master && n.outs.some((o) => o.kind === 'comp'));
    expect(busInputs.length).toBeGreaterThan(1);
    const before = busInputs.map((b) => only(effectiveGains(b, ctx.destination)));
    setMasterVolume(0.5);
    busInputs.forEach((b, i) => expect(only(effectiveGains(b, ctx.destination))).toBeCloseTo(before[i]! * 0.5, 5));
    toggleMasterMute();
    busInputs.forEach((b) => expect(only(effectiveGains(b, ctx.destination))).toBe(0));
    expect(sfx.isMuted()).toBe(false);
  });
});

describe('the no-Web-Audio fallbacks follow the master', () => {
  it('Announcer: a sounding HTMLAudioElement carries the master in its volume, live', async () => {
    const ann = await import('../announcer');
    ann.setAnnouncerAudioContextProvider(() => null);
    ann.setAnnouncerVolume(1);
    const made: { volume: number }[] = [];
    vi.stubGlobal('Audio', function FakeAudio(this: { volume: number }) {
      const el = { volume: 1, play: () => Promise.resolve(), pause() {}, addEventListener() {} };
      made.push(el);
      return el;
    });
    const event = Object.keys(ann.ANNOUNCER_LINES)[0] as Parameters<typeof ann.previewAnnouncerEvent>[0];
    setMasterVolume(0.5);
    ann.previewAnnouncerEvent(event);
    await vi.waitFor(() => expect(made.length).toBe(1));
    const atHalf = made[0]!.volume;
    expect(atHalf).toBeGreaterThan(0);
    setMasterVolume(1);
    expect(made[0]!.volume).toBeCloseTo(atHalf * 2, 5);
    toggleMasterMute();
    expect(made[0]!.volume).toBe(0);
  });
});
