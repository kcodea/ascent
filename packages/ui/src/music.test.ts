// @vitest-environment jsdom
/**
 * LOBBY BACKGROUND MUSIC — the state machine in `music.ts` against the owner's contract (2026-09-23):
 * "start 3 seconds into turn 1 … uninterrupted … on repeat/looping with 3s in between plays … chain through
 * bg-bg2 and repeat … with a short delay and small fade in/out … ONLY play when a player is in a lobby, and stop
 * immediately if they leave a lobby run or practice etc." Plus: a track that fails is skipped, both failing
 * stays silent, autoplay rejection retries on the next gesture, and the Settings mute + volume persist.
 *
 * Driven with fake timers and a stub HTMLAudioElement through the module's injected seams (no AudioContext, so
 * the element-volume fade path is what the assertions read); the gate itself is pure and fed structural states.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setMusicDepsForTests, getMusicVolume, isMusicMuted, isMusicWanted, musicDebug, MUSIC_FADE_MS, MUSIC_GAP_MS,
  MUSIC_START_DELAY_MS, MUSIC_STOP_FADE_MS, setMusicVolume, syncMusic, toggleMusicMute, type MusicElement,
  type MusicStateLike,
} from './music';

class StubAudio implements MusicElement {
  preload = 'none';
  volume = 1;
  currentTime = 0;
  duration = NaN;
  paused = true;
  playCalls = 0;
  /** Set to make the next `play()` reject with an error of this name. */
  rejectWith: string | null = null;
  private listeners = new Map<string, Array<() => void>>();
  constructor(public src: string) {}
  play(): Promise<void> {
    this.playCalls++;
    if (this.rejectWith) {
      const name = this.rejectWith;
      this.rejectWith = null;
      const err = new Error(name);
      err.name = name;
      return Promise.reject(err);
    }
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void { this.paused = true; }
  addEventListener(type: string, cb: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }
  emit(type: string): void { for (const cb of this.listeners.get(type) ?? []) cb(); }
}

let els: StubAudio[] = [];
let gesture: (() => void) | null = null;
/** When set, the bg element's FIRST play() rejects with an error of this name (autoplay policy). */
let rejectBg: string | null = null;

const state = (patch: Partial<MusicStateLike> & { mode?: string; sandbox?: boolean; seed?: number } = {}): MusicStateLike => ({
  showTitle: false,
  heroChoices: null,
  practiceSetupOpen: false,
  replaying: false,
  run: { mode: patch.mode ?? 'practice', sandbox: patch.sandbox, seed: patch.seed ?? 1 },
  ...(patch.showTitle !== undefined ? { showTitle: patch.showTitle } : {}),
  ...(patch.heroChoices !== undefined ? { heroChoices: patch.heroChoices } : {}),
  ...(patch.practiceSetupOpen !== undefined ? { practiceSetupOpen: patch.practiceSetupOpen } : {}),
  ...(patch.replaying !== undefined ? { replaying: patch.replaying } : {}),
});

const bg = (): StubAudio => els.find((e) => e.src.endsWith('music/bg.mp3'))!;
const bg2 = (): StubAudio => els.find((e) => e.src.endsWith('music/bg2.mp3'))!;
const tick = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); };

beforeEach(() => {
  vi.useFakeTimers();
  els = [];
  gesture = null;
  rejectBg = null;
  localStorage.clear();
  __setMusicDepsForTests({
    createElement: (src) => {
      const el = new StubAudio(src);
      if (rejectBg && src.endsWith('/bg.mp3')) el.rejectWith = rejectBg;
      els.push(el);
      return el;
    },
    audioContext: () => null,
    setTimeout: (cb, ms) => window.setTimeout(cb, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    setInterval: (cb, ms) => window.setInterval(cb, ms),
    clearInterval: (id) => window.clearInterval(id),
    onNextGesture: (cb) => { gesture = cb; return () => { if (gesture === cb) gesture = null; }; },
  });
  setMusicVolume(1);
  if (isMusicMuted()) toggleMusicMute();
});
afterEach(() => {
  __setMusicDepsForTests(null);
  vi.useRealTimers();
});

describe('the gate: only a lobby-mode run on screen', () => {
  it('wants music for a lobby run and a Practice run', () => {
    expect(isMusicWanted(state({ mode: 'lobby' }))).toBe(true);
    expect(isMusicWanted(state({ mode: 'practice' }))).toBe(true);
  });
  it('never on the title, the hero picker, the Practice setup, a replay, a tutorial, a sandbox rig or a non-lobby mode', () => {
    expect(isMusicWanted(state({ showTitle: true }))).toBe(false);
    expect(isMusicWanted(state({ heroChoices: ['a', 'b', 'c'] }))).toBe(false);
    expect(isMusicWanted(state({ practiceSetupOpen: true }))).toBe(false);
    expect(isMusicWanted(state({ replaying: true }))).toBe(false);
    expect(isMusicWanted(state({ mode: 'tutorial' }))).toBe(false);
    expect(isMusicWanted(state({ mode: 'practice', sandbox: true }))).toBe(false);
    expect(isMusicWanted(state({ mode: 'ascent' }))).toBe(false);
    expect(isMusicWanted(state({ mode: 'rift' }))).toBe(false);
  });
});

describe('start: 3 seconds after the run is on screen', () => {
  it('arms on entry and plays bg exactly MUSIC_START_DELAY_MS later, fading in over MUSIC_FADE_MS', async () => {
    syncMusic(state({ mode: 'practice' }));
    expect(musicDebug().phase).toBe('armed');
    expect(els.length).toBe(0); // nothing is even created, let alone fetched, before the delay
    await tick(MUSIC_START_DELAY_MS - 1);
    expect(els.length).toBe(0);
    await tick(1);
    expect(musicDebug().phase).toBe('playing');
    expect(musicDebug().track).toBe('bg');
    expect(bg().paused).toBe(false);
    expect(bg().preload).toBe('auto');
    expect(bg2().paused).toBe(true);
    expect(bg().volume).toBe(0); // the fade-in starts from silence
    await tick(MUSIC_FADE_MS / 2);
    expect(bg().volume).toBeGreaterThan(0.3);
    expect(bg().volume).toBeLessThan(0.7);
    await tick(MUSIC_FADE_MS / 2 + 50);
    expect(bg().volume).toBe(1);
    expect(musicDebug().played).toEqual(['bg']);
  });
  it('a Continue at a later wave starts the same way (the run is simply on screen)', async () => {
    syncMusic(state({ mode: 'lobby', seed: 77 }));
    await tick(MUSIC_START_DELAY_MS);
    expect(musicDebug().track).toBe('bg');
  });
  it('a tutorial run never starts it; nor does the title', async () => {
    syncMusic(state({ mode: 'tutorial' }));
    await tick(MUSIC_START_DELAY_MS * 3);
    expect(els.length).toBe(0);
    expect(musicDebug().phase).toBe('idle');
    syncMusic(state({ showTitle: true }));
    await tick(MUSIC_START_DELAY_MS * 3);
    expect(els.length).toBe(0);
  });
  it('the elements are created once and never replaced across the chain', async () => {
    syncMusic(state());
    await tick(MUSIC_START_DELAY_MS);
    bg().emit('ended');
    await tick(MUSIC_GAP_MS);
    bg2().emit('ended');
    await tick(MUSIC_GAP_MS);
    expect(els.length).toBe(2);
  });
});

describe('the chain: bg, 3 s of silence, bg2, 3 s, bg, ... with a fade-out on each tail', () => {
  it('advances on the element\'s `ended`, waits MUSIC_GAP_MS, and wraps', async () => {
    syncMusic(state());
    await tick(MUSIC_START_DELAY_MS + MUSIC_FADE_MS + 50);
    bg().emit('ended');
    expect(musicDebug().phase).toBe('gap');
    expect(bg2().paused).toBe(true);
    await tick(MUSIC_GAP_MS - 1);
    expect(bg2().paused).toBe(true);
    await tick(1);
    expect(musicDebug().track).toBe('bg2');
    expect(bg2().paused).toBe(false);
    await tick(MUSIC_FADE_MS + 50);
    bg2().emit('ended');
    await tick(MUSIC_GAP_MS);
    expect(musicDebug().track).toBe('bg');
    expect(musicDebug().played).toEqual(['bg', 'bg2', 'bg']);
  });
  it('fades out over the last MUSIC_FADE_MS of a track (found by timeupdate, not a timer for its length)', async () => {
    syncMusic(state());
    await tick(MUSIC_START_DELAY_MS + MUSIC_FADE_MS + 50);
    expect(bg().volume).toBe(1);
    bg().duration = 120;
    bg().currentTime = 100;
    bg().emit('timeupdate'); // far from the end: nothing
    await tick(100);
    expect(bg().volume).toBe(1);
    bg().currentTime = 120 - MUSIC_FADE_MS / 1000 + 0.1; // 0.5 s left
    bg().emit('timeupdate');
    await tick(250);
    expect(bg().volume).toBeGreaterThan(0.2);
    expect(bg().volume).toBeLessThan(0.8);
    await tick(300);
    expect(bg().volume).toBe(0);
    bg().emit('ended');
    expect(musicDebug().phase).toBe('gap');
  });
  it('the whole run is uninterrupted: store churn inside the run never touches playback', async () => {
    syncMusic(state({ mode: 'lobby', seed: 5 }));
    await tick(MUSIC_START_DELAY_MS + MUSIC_FADE_MS);
    for (let i = 0; i < 50; i++) syncMusic(state({ mode: 'lobby', seed: 5 }));
    expect(musicDebug().phase).toBe('playing');
    expect(bg().playCalls).toBe(1);
    expect(bg().paused).toBe(false);
  });
});

describe('stop: immediately on leaving the run', () => {
  it('a MUSIC_STOP_FADE_MS fade, then pause + rewind; a return re-arms the 3 s start', async () => {
    syncMusic(state());
    await tick(MUSIC_START_DELAY_MS + MUSIC_FADE_MS + 50);
    bg().currentTime = 42;
    syncMusic(state({ showTitle: true }));
    expect(musicDebug().phase).toBe('idle');
    expect(bg().paused).toBe(false); // the click-guard fade is still running
    await tick(MUSIC_STOP_FADE_MS + 60);
    expect(bg().paused).toBe(true);
    expect(bg().currentTime).toBe(0);
    expect(bg().volume).toBe(0);
    syncMusic(state({ seed: 2 }));
    expect(musicDebug().phase).toBe('armed');
    await tick(MUSIC_START_DELAY_MS);
    expect(musicDebug().track).toBe('bg');
    expect(bg().paused).toBe(false);
  });
  it('leaving during the gap cancels the next track', async () => {
    syncMusic(state());
    await tick(MUSIC_START_DELAY_MS);
    bg().emit('ended');
    syncMusic(state({ showTitle: true }));
    await tick(MUSIC_GAP_MS * 2);
    expect(bg2().paused).toBe(true);
    expect(bg2().playCalls).toBe(0);
  });
  it('leaving during the 3 s countdown cancels the start', async () => {
    syncMusic(state());
    syncMusic(state({ showTitle: true }));
    await tick(MUSIC_START_DELAY_MS * 2);
    expect(els.length).toBe(0);
  });
  it('a non-lobby run replacing the lobby run stops it', async () => {
    syncMusic(state({ mode: 'lobby' }));
    await tick(MUSIC_START_DELAY_MS);
    syncMusic(state({ mode: 'tutorial' }));
    await tick(MUSIC_STOP_FADE_MS + 60);
    expect(bg().paused).toBe(true);
  });
});

describe('failure: skip the broken track; both broken stays silent; autoplay retries once on a gesture', () => {
  it('a load error skips to the other track; the second error goes silent without throwing', async () => {
    syncMusic(state());
    await tick(MUSIC_START_DELAY_MS);
    bg().emit('error');
    expect(musicDebug().track).toBe('bg2');
    expect(bg2().paused).toBe(false);
    bg2().emit('error');
    expect(musicDebug().phase).toBe('silent');
    await tick(MUSIC_GAP_MS * 3);
    expect(bg().playCalls).toBe(1);
    expect(bg2().playCalls).toBe(1);
    expect(bg().paused).toBe(true);
    expect(bg2().paused).toBe(true);
  });
  it('a play() rejected by the autoplay policy retries on the next gesture', async () => {
    rejectBg = 'NotAllowedError';
    syncMusic(state({ seed: 9 }));
    await tick(MUSIC_START_DELAY_MS);
    expect(bg().playCalls).toBe(1);
    expect(musicDebug().played).toEqual([]);
    expect(musicDebug().phase).toBe('playing'); // waiting on the gesture, not failed over to bg2
    expect(bg2().playCalls).toBe(0);
    expect(gesture).not.toBeNull();
    gesture!();
    await tick(10);
    expect(bg().playCalls).toBe(2);
    expect(bg().paused).toBe(false);
    expect(musicDebug().played).toEqual(['bg']);
  });
});

describe('settings: the music mute + volume persist and apply live', () => {
  it('volume persists to ascent.musicvol and scales the playing element', async () => {
    setMusicVolume(0.4);
    expect(localStorage.getItem('ascent.musicvol')).toBe('0.4');
    expect(getMusicVolume()).toBe(0.4);
    syncMusic(state());
    await tick(MUSIC_START_DELAY_MS + MUSIC_FADE_MS + 50);
    expect(bg().volume).toBeCloseTo(0.4, 5);
    setMusicVolume(0.8);
    expect(bg().volume).toBeCloseTo(0.8, 5);
  });
  it('mute persists to ascent.musicmuted, silences live and restores on unmute', async () => {
    syncMusic(state());
    await tick(MUSIC_START_DELAY_MS + MUSIC_FADE_MS + 50);
    expect(toggleMusicMute()).toBe(true);
    expect(localStorage.getItem('ascent.musicmuted')).toBe('1');
    expect(bg().volume).toBe(0);
    expect(bg().paused).toBe(false); // muted, not stopped: the chain keeps its place
    expect(toggleMusicMute()).toBe(false);
    expect(localStorage.getItem('ascent.musicmuted')).toBe('0');
    expect(bg().volume).toBe(1);
  });
  it('clamps the volume to 0..1', () => {
    setMusicVolume(4);
    expect(getMusicVolume()).toBe(1);
    setMusicVolume(-1);
    expect(getMusicVolume()).toBe(0);
  });
});
