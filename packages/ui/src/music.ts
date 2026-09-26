/**
 * LOBBY BACKGROUND MUSIC (owner ask 2026-09-23): *"wire the bg music … this should start 3 seconds into turn 1
 * and play in the background, uninterrupted, on repeat/looping with 3s in between plays … it should chain through
 * bg-bg2 and repeat, again, with a short delay and small fade in/out … this music should ONLY play when a player
 * is in a lobby, and stop immediately if they leave a lobby run or practice etc."*
 *
 * THE CONTRACT (one tiny state machine, driven from the store, no React in here):
 *  · Plays ONLY while a LOBBY-mode run is on screen: `run.mode` 'lobby' or 'practice' (Practice is a lobby too),
 *    never the title / ladder pages / hero picker / Practice setup (`isPreRun`), never a `tutorial` run, never a
 *    Scene Builder / bug-scenario rig (`run.sandbox`), never a replay (`replaying`).
 *  · Starts MUSIC_START_DELAY_MS (3 s) after the run's shop is shown, for a fresh run AND a Continue.
 *  · Then runs UNINTERRUPTED: shop, combat, end of turn, the rail, the post-game screen. Nothing in the game
 *    pauses or ducks it (a Skip's `stopAllAudio` mutes the SFX bus, not this), and a hidden tab is not a stop.
 *  · The chain is bg → 3 s of silence → bg2 → 3 s → bg → … forever. Every play fades in (MUSIC_FADE_MS) and fades
 *    out over its last MUSIC_FADE_MS; the gap is measured from the end of one fade-out (the element's `ended`
 *    event, never a timer for the track length) to the start of the next fade-in. A track that fails to load is
 *    skipped for the other; when both fail the run stays silent (never throws, never blocks the game).
 *  · Stops IMMEDIATELY when the player leaves the run (Save & Quit, Play Again, the run cleared, a non-lobby run
 *    starting): a MUSIC_STOP_FADE_MS fade so it never clicks, then pause + rewind. Resumes only by the start rule.
 *
 * PLAYBACK: the two tracks are PUBLIC files (`apps/web/public/music/`), streamed through two `HTMLAudioElement`s
 * created ONCE (`preload: 'none'` until the first play) and never decoded into WebAudio buffers: 5.5 MB of music
 * must not sit decoded in memory nor inflate the bundle like the SFX clips under `./audio` do. When the game's
 * AudioContext exists (sfx.ts warms it on the first gesture) each element is routed through a
 * MediaElementAudioSourceNode → a FADE gain (the ramps, `linearRampToValueAtTime`: no per-frame work) → a LEVEL
 * gain (the Settings "Music" slider + mute) → the destination. This is deliberately NOT the SFX master / mute
 * bus, so the "Game sounds" slider, the sound mute and the Skip-combat silence leave the music alone. Without a
 * context the element's own `volume` carries fade × level, stepped by one ~50 ms interval that exists only
 * during a fade.
 *
 * SETTINGS: the Music slider + mute persist in localStorage (`ascent.musicvol.v2`, `ascent.musicmuted`) and apply
 * live; see EscMenu.tsx. `isMusicWanted` is the pure gate (tested with structural states), `syncMusic` the
 * transition; `Game.tsx` wires `syncMusic` to `useGame.subscribe`.
 */
import { isPreRun } from './store';
import { DEFAULT_SLIDER, sliderToGain } from './audio/volumeCurve';
import { masterLevel, masterOutput, onMasterChange } from './audio/master';

export const MUSIC_START_DELAY_MS = 3000;
export const MUSIC_GAP_MS = 3000;
export const MUSIC_FADE_MS = 600;
export const MUSIC_STOP_FADE_MS = 150;
/** The chain, in play order; the index wraps. Files live at `<BASE_URL>music/<name>.mp3`. */
export const MUSIC_TRACKS = ['bg', 'bg2'] as const;
export type MusicTrack = (typeof MUSIC_TRACKS)[number];
/** The Music slider's storage key. `.v2` since the default-mix curve (owner 2026-09-24): the stored value is a SLIDER
 *  position that `sliderToGain('music', …)` turns into the gain, so the old `ascent.musicvol` (a raw gain) is no
 *  longer read and every player starts once on the new default, the 50 mark (= the owner's 0.2 gain). */
const MUSIC_VOLUME_KEY = 'ascent.musicvol.v2';

export type MusicPhase =
  | 'idle'     // not inside a lobby run (or stopped); nothing scheduled
  | 'armed'    // inside a lobby run, counting down the 3 s to the first play
  | 'playing'  // a track is playing (fade-in at its start, fade-out over its last MUSIC_FADE_MS)
  | 'gap'      // between two tracks: the 3 s of silence
  | 'silent';  // both tracks failed to load this run: stay quiet until the next lobby run

/** The store slice the gate reads. Structural, so tests need no real store. */
export interface MusicStateLike {
  showTitle: boolean;
  heroChoices: string[] | null;
  practiceSetupOpen: boolean;
  replaying: boolean;
  run: { mode?: string | undefined; sandbox?: boolean | undefined; seed: number };
}

/** The pure gate: true exactly while a lobby-mode run is on screen (see the header). */
export function isMusicWanted(s: MusicStateLike): boolean {
  if (isPreRun(s) || s.replaying) return false;
  const run = s.run;
  if (run.sandbox) return false;
  return run.mode === 'lobby' || run.mode === 'practice';
}

/** The minimum of HTMLMediaElement the machine touches (so a test can hand in a stub). */
export interface MusicElement {
  src: string;
  preload: string;
  volume: number;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: string, cb: () => void): void;
}

/** Injected seams (defaults are the real browser APIs; tests replace them). */
export interface MusicDeps {
  createElement: (src: string) => MusicElement | null;
  /** The game's AudioContext, or null to fall back to `element.volume` fades. Called lazily at first play. */
  audioContext: () => AudioContext | null;
  setTimeout: (cb: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  setInterval: (cb: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  /** Register a ONE-SHOT retry on the next user gesture (autoplay policy); returns the un-register. */
  onNextGesture: (cb: () => void) => () => void;
}

const defaultDeps: MusicDeps = {
  createElement: (src) => {
    try {
      if (typeof Audio === 'undefined') return null;
      const el = new Audio();
      el.preload = 'none';
      el.src = src;
      return el;
    } catch {
      return null;
    }
  },
  audioContext: () => null,
  setTimeout: (cb, ms) => window.setTimeout(cb, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  setInterval: (cb, ms) => window.setInterval(cb, ms),
  clearInterval: (id) => window.clearInterval(id),
  onNextGesture: (cb) => {
    const fire = (): void => { off(); cb(); };
    const off = (): void => {
      window.removeEventListener('pointerdown', fire);
      window.removeEventListener('keydown', fire);
    };
    window.addEventListener('pointerdown', fire);
    window.addEventListener('keydown', fire);
    return off;
  },
};
let deps: MusicDeps = defaultDeps;
/** Tests only: swap the browser seams. Resets the machine. */
export function __setMusicDepsForTests(patch: Partial<MusicDeps> | null): void {
  resetMusicForTests();
  deps = patch ? { ...defaultDeps, ...patch } : defaultDeps;
}
/** sfx.ts hands its (lazily created) AudioContext in through here, so this module never builds a second one. */
export function setMusicAudioContextProvider(provider: () => AudioContext | null): void {
  deps = { ...deps, audioContext: provider };
}

// ── Level (the Settings slider + mute), persisted ────────────────────────────────────────────────────────────
let volume = (() => {
  try {
    const v = parseFloat(localStorage.getItem(MUSIC_VOLUME_KEY) ?? '');
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_SLIDER;
  } catch {
    return DEFAULT_SLIDER;
  }
})();
let muted = (() => {
  try {
    return localStorage.getItem('ascent.musicmuted') === '1';
  } catch {
    return false;
  }
})();
/** The ONE place the Music slider becomes a gain (the default-mix curve: 50 plays the owner's 0.2, 100 plays 1). */
/** A temporary DUCK multiplier (1 = none), for a presentation beat that wants the music to hold its breath (the
 *  Ancients awakening). Never persisted. */
let duck = 1;
const level = (): number => (muted ? 0 : sliderToGain('music', volume) * duck);

/** Duck the music to `factor` × its level for a moment, ramping with time constant `tauMs`; `setMusicDuck(1)` restores. */
export function setMusicDuck(factor: number, tauMs = 120): void {
  duck = Math.min(1, Math.max(0, factor));
  if (graph) {
    const now = graph.ctx.currentTime;
    graph.level.gain.cancelScheduledValues(now);
    graph.level.gain.setTargetAtTime(level(), now, Math.max(0.005, tauMs / 1000));
  }
  applyElementVolume();
}

export function getMusicVolume(): number {
  return volume;
}
export function setMusicVolume(v: number): void {
  volume = Math.min(1, Math.max(0, v));
  try { localStorage.setItem(MUSIC_VOLUME_KEY, String(volume)); } catch { /* ignore */ }
  applyLevel();
}
export function isMusicMuted(): boolean {
  return muted;
}
export function toggleMusicMute(): boolean {
  muted = !muted;
  try { localStorage.setItem('ascent.musicmuted', muted ? '1' : '0'); } catch { /* ignore */ }
  applyLevel();
  return muted;
}

// ── The graph / the elements (built once, on the first play) ─────────────────────────────────────────────────
interface Slot { track: MusicTrack; el: MusicElement; wired: boolean }
let slots: Slot[] | null = null;
let graph: { ctx: AudioContext; fade: GainNode; level: GainNode } | null = null;
/** The current fade multiplier (0..1) — mirrored into `element.volume` on the no-context path. */
let fadeLevel = 0;
let fadeInterval: number | null = null;

function trackUrl(name: MusicTrack): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return `${base}music/${name}.mp3`;
}

function ensureSlots(): Slot[] | null {
  if (slots) return slots;
  const built: Slot[] = [];
  for (const track of MUSIC_TRACKS) {
    const el = deps.createElement(trackUrl(track));
    if (!el) continue;
    el.addEventListener('ended', () => onEnded(track));
    el.addEventListener('error', () => onFailed(track));
    // `timeupdate` fires a few times a second (never per frame): it is how the fade-out finds the tail.
    el.addEventListener('timeupdate', () => onTimeUpdate(track));
    built.push({ track, el, wired: false });
  }
  if (!built.length) return null;
  slots = built;
  return slots;
}

/** Wire an element into the context graph the first time it plays. Idempotent; silently element-only on failure. */
function wire(slot: Slot): void {
  if (slot.wired) return;
  slot.wired = true;
  try {
    if (!graph) {
      const ctx = deps.audioContext();
      if (!ctx) return;
      const fade = ctx.createGain();
      fade.gain.value = 0;
      const lvl = ctx.createGain();
      lvl.gain.value = level();
      fade.connect(lvl);
      lvl.connect(masterOutput(ctx)); // → the Settings MASTER volume (audio/master.ts) → destination
      graph = { ctx, fade, level: lvl };
    }
    const src = graph.ctx.createMediaElementSource(slot.el as unknown as HTMLMediaElement);
    src.connect(graph.fade);
    slot.el.volume = 1; // the graph carries fade × level from here on
  } catch {
    /* no context or a refused source: the element's own volume carries the mix (see applyElementVolume) */
  }
}

function applyLevel(): void {
  if (graph) {
    const now = graph.ctx.currentTime;
    graph.level.gain.cancelScheduledValues(now);
    graph.level.gain.setTargetAtTime(level(), now, 0.01);
  }
  applyElementVolume();
}
/** No-context path: each playing element's volume is fade × level. (With a graph the elements sit at 1.) */
function applyElementVolume(): void {
  if (graph || !slots) return;
  const v = Math.min(1, Math.max(0, fadeLevel * level() * masterLevel()));
  for (const s of slots) s.el.volume = v;
}
// The element path has no graph to hold the master stage, so a master change re-applies the element volumes.
onMasterChange(applyElementVolume);

/** Ramp the fade multiplier to `to` over `ms`, then `done`. Compositor-cheap on the graph path (a scheduled
 *  AudioParam ramp); one ~50 ms interval on the element path, alive only while the fade runs. */
function ramp(to: number, ms: number, done?: () => void): void {
  cancelRamp();
  const from = fadeLevel;
  if (ms <= 0) {
    fadeLevel = to;
    if (graph) graph.fade.gain.setValueAtTime(to, graph.ctx.currentTime);
    applyElementVolume();
    done?.();
    return;
  }
  if (graph) {
    // Graph path: ONE scheduled AudioParam ramp does the whole fade; a single timeout marks its end.
    const now = graph.ctx.currentTime;
    graph.fade.gain.cancelScheduledValues(now);
    graph.fade.gain.setValueAtTime(from, now);
    graph.fade.gain.linearRampToValueAtTime(to, now + ms / 1000);
    fadeTimer = deps.setTimeout(() => { fadeTimer = null; fadeLevel = to; done?.(); }, ms);
    return;
  }
  // Element path: step `element.volume` on a ~50 ms interval that lives only for this fade.
  const started = Date.now();
  const step = (): void => {
    const t = Math.min(1, (Date.now() - started) / ms);
    fadeLevel = from + (to - from) * t;
    applyElementVolume();
    if (t >= 1) {
      cancelRamp();
      done?.();
    }
  };
  fadeInterval = deps.setInterval(step, 50);
}
let fadeTimer: number | null = null;
function cancelRamp(): void {
  if (fadeInterval !== null) {
    deps.clearInterval(fadeInterval);
    fadeInterval = null;
  }
  if (fadeTimer !== null) {
    deps.clearTimeout(fadeTimer);
    fadeTimer = null;
  }
}

// ── The state machine ────────────────────────────────────────────────────────────────────────────────────────
let phase: MusicPhase = 'idle';
let wanted = false;
let runKey: number | null = null;
let timer: number | null = null;
let cur: MusicTrack | null = null;
/** Whether the current play's tail fade-out has been scheduled (set once per play by `onTimeUpdate`). */
let fadingOut = false;
/** Tracks that failed this run; cleared when one plays. Both failed → 'silent'. */
const failed = new Set<MusicTrack>();
let gestureOff: (() => void) | null = null;
/** The count of plays this run (for the debug surface + tests: the chain order). */
const played: MusicTrack[] = [];

function clearTimer(): void {
  if (timer !== null) {
    deps.clearTimeout(timer);
    timer = null;
  }
}

/** Drive the machine from a store snapshot. Cheap enough for the store's subscriber (a handful of reads). */
export function syncMusic(s: MusicStateLike): void {
  const want = isMusicWanted(s);
  const key = want ? s.run.seed : null;
  if (want === wanted && key === runKey) return;
  wanted = want;
  runKey = key;
  if (!want) {
    stop();
    return;
  }
  // A new lobby run while one was already sounding (no title in between) restarts the chain for the new run.
  if (phase !== 'idle') stop();
  arm();
}

function arm(): void {
  phase = 'armed';
  failed.clear();
  played.length = 0;
  clearTimer();
  timer = deps.setTimeout(() => { timer = null; if (phase === 'armed') play(MUSIC_TRACKS[0]); }, MUSIC_START_DELAY_MS);
}

function play(track: MusicTrack): void {
  const list = ensureSlots();
  const slot = list?.find((x) => x.track === track);
  if (!slot) {
    // No element at all (no Audio API): stay silent, never throw.
    phase = 'silent';
    return;
  }
  clearTimer();
  phase = 'playing';
  cur = track;
  fadingOut = false;
  wire(slot);
  try { slot.el.preload = 'auto'; } catch { /* ignore */ }
  try { slot.el.currentTime = 0; } catch { /* not loaded yet: it starts at 0 anyway */ }
  fadeLevel = 0;
  applyElementVolume();
  let p: Promise<void> | void;
  try {
    p = slot.el.play();
  } catch (e) {
    onPlayRejected(track, e);
    return;
  }
  // The fade-in starts with the play call; a rejected play cancels it in `onPlayRejected`.
  ramp(1, MUSIC_FADE_MS);
  if (p && typeof (p as Promise<void>).then === 'function') {
    (p as Promise<void>).then(() => { if (phase === 'playing' && cur === track) { failed.delete(track); played.push(track); } },
      (e: unknown) => onPlayRejected(track, e));
  } else {
    failed.delete(track);
    played.push(track);
  }
}

function onPlayRejected(track: MusicTrack, e: unknown): void {
  if (phase !== 'playing' || cur !== track) return;
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError') {
    // Autoplay policy: the context / element is blocked until a gesture. Retry ONCE on the next one.
    cancelRamp();
    fadeLevel = 0;
    applyElementVolume();
    gestureOff?.();
    gestureOff = deps.onNextGesture(() => { gestureOff = null; if (phase === 'playing' && cur === track) play(track); });
    return;
  }
  onFailed(track);
}

/** A track failed to load / play: skip to the other; when both have failed this run, stay silent. */
function onFailed(track: MusicTrack): void {
  if (phase !== 'playing' || cur !== track) return;
  failed.add(track);
  cancelRamp();
  fadeLevel = 0;
  applyElementVolume();
  try { slotOf(track)?.el.pause(); } catch { /* ignore */ }
  if (failed.size >= MUSIC_TRACKS.length) {
    phase = 'silent';
    cur = null;
    return;
  }
  play(nextOf(track));
}

function onTimeUpdate(track: MusicTrack): void {
  if (phase !== 'playing' || cur !== track || fadingOut) return;
  const el = slotOf(track)?.el;
  if (!el) return;
  const remaining = el.duration - el.currentTime;
  if (!Number.isFinite(remaining) || remaining > MUSIC_FADE_MS / 1000) return;
  // The tail: fade out over what is left (at most MUSIC_FADE_MS), so silence lands exactly on `ended`.
  fadingOut = true;
  ramp(0, Math.max(0, remaining * 1000));
}

function onEnded(track: MusicTrack): void {
  if (phase !== 'playing' || cur !== track) return;
  cancelRamp();
  fadeLevel = 0;
  applyElementVolume();
  phase = 'gap';
  cur = null;
  clearTimer();
  const next = nextOf(track);
  timer = deps.setTimeout(() => { timer = null; if (phase === 'gap') play(next); }, MUSIC_GAP_MS);
}

/** Leave the run: a short fade so it never clicks, then pause + rewind. Idempotent. */
function stop(): void {
  clearTimer();
  gestureOff?.();
  gestureOff = null;
  const was = phase;
  const track = cur;
  phase = 'idle';
  cur = null;
  fadingOut = false;
  if (was !== 'playing' || !track) {
    cancelRamp();
    fadeLevel = 0;
    applyElementVolume();
    return;
  }
  const el = slotOf(track)?.el;
  ramp(0, MUSIC_STOP_FADE_MS, () => {
    try { el?.pause(); } catch { /* ignore */ }
    try { if (el) el.currentTime = 0; } catch { /* ignore */ }
  });
}

const slotOf = (t: MusicTrack): Slot | undefined => slots?.find((x) => x.track === t);
const nextOf = (t: MusicTrack): MusicTrack => MUSIC_TRACKS[(MUSIC_TRACKS.indexOf(t) + 1) % MUSIC_TRACKS.length];

/** Read-only view for the DEV surface (`window.__music`) and the tests. */
export function musicDebug(): { phase: MusicPhase; track: MusicTrack | null; played: readonly MusicTrack[]; fade: number; gain: number; level: number; graph: boolean; elements: readonly MusicElement[] } {
  // `gain` is the LIVE fade multiplier: the AudioParam's current automation value on the graph path.
  return {
    phase, track: cur, played, fade: fadeLevel, gain: graph ? graph.fade.gain.value : fadeLevel, level: level(),
    graph: !!graph, elements: slots?.map((s) => s.el) ?? [],
  };
}

/** Tests only: back to a cold module (elements dropped, timers cleared, level untouched). */
export function resetMusicForTests(): void {
  clearTimer();
  cancelRamp();
  gestureOff?.();
  gestureOff = null;
  phase = 'idle';
  wanted = false;
  runKey = null;
  cur = null;
  fadingOut = false;
  failed.clear();
  played.length = 0;
  fadeLevel = 0;
  slots = null;
  graph = null;
}

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (window as unknown as { __music?: typeof musicDebug }).__music = musicDebug;
}
