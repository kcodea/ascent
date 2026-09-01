/**
 * Tiny synthesized sound bank (Web Audio) — no asset files, all generated on the
 * fly. Each effect is a short oscillator blip with a quick gain envelope. Muting
 * persists in localStorage. The context is created lazily and resumed on the
 * first call (which happens inside a user gesture, satisfying autoplay policy).
 *
 * Routing: every sound flows through a CATEGORY bus (ui/combat/voice/hero) → an
 * optional per-bus compressor → the master limiter → a tunable master-gain node →
 * the mute bus → destination. Levels/buses/limiter dials all live in `audioConfig`
 * (see ./audio/config); this file just builds + tunes the graph from that config.
 */

import {
  DEFAULT_AUDIO_CONFIG,
  mergeConfig,
  effectiveGain,
  busOf,
  BUS_NAMES,
  equipmentClipCategory,
  type AudioConfig,
  type BusName,
  type CompConfig,
  type CategoryConfig,
} from './audio/config';
import { SCENES } from './audio/scenes';

export { SCENES };

let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem('ascent.muted') === '1';
  } catch {
    return false;
  }
})();

// --- Audio config (levels + buses + limiter) — the single source of truth, read to build/tune the graph.
// Loaded from localStorage (with a one-time migration of the old per-key gains + master volume) over defaults.
const cfg: AudioConfig = mergeConfig(DEFAULT_AUDIO_CONFIG, readSavedConfig());
const busNodes = new Map<BusName, { input: GainNode; comp: DynamicsCompressorNode | null }>();
let masterGain: GainNode | null = null;
// Passive AnalyserNode taps for the desk's meters — keyed 'master' + each bus name. Connecting an analyser
// doesn't alter the audio path (it's a read-only fork), so these are pure telemetry (see meterLevel).
const analysers = new Map<string, AnalyserNode>();

/** Read the saved config, migrating the legacy `ascent.sfxvol` (per-category gains) + `ascent.vol` (master) keys
 *  the first time (before `ascent.audiocfg` exists). Returns a partial config to merge over the defaults. */
function readSavedConfig(): Partial<AudioConfig> | null {
  try {
    const raw = localStorage.getItem('ascent.audiocfg');
    if (raw) return JSON.parse(raw) as Partial<AudioConfig>;
    const gains = JSON.parse(localStorage.getItem('ascent.sfxvol') ?? 'null');
    const vol = parseFloat(localStorage.getItem('ascent.vol') ?? '');
    const mig: Partial<AudioConfig> = {};
    if (gains && typeof gains === 'object')
      mig.categories = Object.fromEntries(
        Object.entries(gains).map(([k, g]) => [k, { bus: DEFAULT_AUDIO_CONFIG.categories[k]?.bus ?? 'ui', gain: Number(g) }]),
      );
    if (Number.isFinite(vol)) mig.masterGain = vol;
    return Object.keys(mig).length ? mig : null;
  } catch {
    return null;
  }
}
function persistConfig(): void {
  try {
    localStorage.setItem('ascent.audiocfg', JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

export function getVolume(): number {
  return cfg.masterGain;
}
export function setVolume(v: number): void {
  cfg.masterGain = Math.min(1, Math.max(0, v));
  const a = audio();
  if (a && masterGain) masterGain.gain.setTargetAtTime(cfg.masterGain, a.currentTime, 0.01);
  persistConfig();
}

/** True while the tab is backgrounded — we suppress sound then, so a pile-up doesn't blast on tab-in. */
const isHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

/** Timestamp (ms) of the last trigger-pulse sound — used to dedupe simultaneous pulses (see triggerPulse). */
let lastTriggerPulse = 0;
/** Timestamp (ms) of the last trigger-glow sound — dedupes simultaneous glows (see triggerGlow). */
let lastTriggerGlow = 0;
/** Timestamp (ms) of the last shield-break sound — dedupes shields breaking on the same beat. */
let lastGemApply = 0;
let lastShieldBreak = 0;
/** Timestamps (ms) of the last reborn shatter / summon sounds — dedupe simultaneous reborns on a beat. */
let lastRebornShatter = 0;
let lastRebornSummon = 0;
/** Timestamp (ms) of the last Deathrattle skull-burst sound — dedupes simultaneous shatters on a beat. */
let lastSkullBurst = 0;

// A master limiter every sound routes through, so overlapping clips (landing + voiceline + summon, etc.)
// can never sum past full scale and hard-clip the output. Configured limiter-style (from `cfg.master`): catch
// anything above the threshold with a high ratio + fast attack, so peaks are tamed transparently for short SFX.
let master: DynamicsCompressorNode | null = null;

// A master mute bus (masterGain → bus → destination) whose gain is snapped to 0 to kill ALL audio at once —
// used by the Skip-combat fade, which cuts the replay short and must silence everything instantly (a
// replacement one-shot will play in its place later). `audioSuspended` also gates NEW sounds from scheduling
// while suspended, so nothing sneaks in during the fade; `resumeAudio()` restores the bus for the next fight.
let bus: GainNode | null = null;
let audioSuspended = false;
/** Kill all audio immediately (Skip-combat): ramp the master bus to 0 and block new sounds until resumed. */
export function stopAllAudio(): void {
  audioSuspended = true;
  const a = audio();
  if (a && bus) { bus.gain.cancelScheduledValues(a.currentTime); bus.gain.setTargetAtTime(0, a.currentTime, 0.008); }
}
/** Un-mute the master bus + allow sounds again (called when the fight is left / a new fight begins). */
export function resumeAudio(): void {
  audioSuspended = false;
  const a = audio();
  if (a && bus) { bus.gain.cancelScheduledValues(a.currentTime); bus.gain.setTargetAtTime(1, a.currentTime, 0.008); }
}

/** Apply a limiter/compressor config's dials to a DynamicsCompressorNode. */
function applyComp(node: DynamicsCompressorNode, c: CompConfig): void {
  node.threshold.value = c.threshold;
  node.knee.value = c.knee;
  node.ratio.value = c.ratio;
  node.attack.value = c.attack;
  node.release.value = c.release;
}

/** The node a category's sounds connect to: its bus input (if built), else the master limiter, else destination. */
function busInput(a: AudioContext, category: string): AudioNode {
  const b = busNodes.get(busOf(cfg, category));
  return b ? b.input : (master ?? a.destination);
}

function audio(): AudioContext | null {
  try {
    const isNew = !ctx;
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    if (isNew) {
      master = ctx.createDynamicsCompressor();
      applyComp(master, cfg.master); // engage when stacked sounds sum past threshold — single clips at playback
                                     // gain sit well below, so they pass untouched; only loud stacks limit.
      bus = ctx.createGain();
      bus.gain.value = audioSuspended ? 0 : 1; // the master mute bus (see stopAllAudio) — silences the whole mix
      masterGain = ctx.createGain();
      masterGain.gain.value = cfg.masterGain;  // the Settings-slider master volume (was a per-play multiply)
      master.connect(masterGain);
      masterGain.connect(bus);
      bus.connect(ctx.destination);
      // Category buses: each an input gain → optional per-bus comp → master limiter. Sounds route in by category.
      for (const b of BUS_NAMES) {
        const input = ctx.createGain();
        input.gain.value = cfg.buses[b].gain;
        let comp: DynamicsCompressorNode | null = null;
        if (cfg.buses[b].comp) {
          comp = ctx.createDynamicsCompressor();
          applyComp(comp, cfg.buses[b].comp!);
          input.connect(comp);
          comp.connect(master);
        } else {
          input.connect(master);
        }
        busNodes.set(b, { input, comp });
      }
      // Meter taps: a passive analyser on the master limiter + on each bus input (read-only forks; they
      // don't touch the audio path). fftSize 256 → a small time-domain buffer, plenty for a peak meter.
      const tap = (key: string, node: AudioNode): void => {
        const an = ctx!.createAnalyser();
        an.fftSize = 256;
        node.connect(an);
        analysers.set(key, an);
      };
      tap('master', master);
      for (const b of BUS_NAMES) tap(b, busNodes.get(b)!.input);
      prefetchSamples(); // decode the mp3 SFX once the context exists (first user gesture)
    }
    return ctx;
  } catch {
    return null;
  }
}

// Warm the audio context + start decoding the mp3 SFX on the FIRST user gesture anywhere (a click/keypress),
// not lazily on the first SOUND. Without this, the first real sound (e.g. the first buy) was a silent/synth
// fallback while the context resumed + samples decoded — so sourced clips only "kicked in" after a later
// action (a hero power, etc.) happened to warm things up. Now they're ready by the first buy/play.
if (typeof window !== 'undefined') {
  const warm = (): void => {
    audio();
    window.removeEventListener('pointerdown', warm);
    window.removeEventListener('keydown', warm);
  };
  window.addEventListener('pointerdown', warm);
  window.addEventListener('keydown', warm);
}

// --- Sampled SFX (mp3 files in ./audio) — decoded into AudioBuffers and played through the same context, so
//     they overlap cleanly (each play is a fresh BufferSource) and sit alongside the synth blips. Decoded
//     lazily; the synth blip is the fallback until a sample's buffer is ready (or if decoding fails). ---
// Top-level clips (keyed by bare name, e.g. `roll`) + per-card clips in ./audio/cards/ (keyed `cards/<cardId>`,
// played by sfx.cardVoice on the `play` action — a unique voiceline/SFX layered over the general landing sound).
const SAMPLE_URLS = {
  ...import.meta.glob('./audio/*.mp3', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('./audio/*.wav', { eager: true, query: '?url', import: 'default' }), // wav decodes natively too
  ...import.meta.glob('./audio/cards/*.mp3', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('./audio/heroes/*.mp3', { eager: true, query: '?url', import: 'default' }),
  // .mp4 too (2026-08-21): some hero-line exports arrive as AAC-in-mp4 and Chromium's decodeAudioData handles
  // the container fine — re-exporting to mp3 is preferred but must not gate a voiceline shipping.
  ...import.meta.glob('./audio/heroes/*.mp4', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('./audio/ceremony/*.mp3', { eager: true, query: '?url', import: 'default' }), // hero-select ceremony stingers (🎭 tuner owns their timing/volume)
} as Record<string, string>;
const buffers = new Map<string, AudioBuffer>();
const loadingSamples = new Set<string>();
// Key = path under ./audio/ minus extension: `./audio/roll.mp3` → `roll`, `./audio/cards/karthus.mp3` → `cards/karthus`.
const sampleName = (path: string): string => path.replace(/^\.\/audio\//, '').replace(/\.(mp3|wav|mp4)$/, '');

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

// Variant families: a logical clip (e.g. `smack`) can be backed by N numbered files (`smack1.mp3`…`smackN.mp3`);
// one is picked at random per play so a repeated action doesn't sound identical (buy/sell do the same, hard-coded).
// Built once from the glob so dropping in another `smack5.mp3` — or removing one — needs no code change. Only
// bare `<letters><digits>` top-level names group (so `cards/…`, `heroes/…`, and digit-less names like
// `combatStart` are never treated as families).
const variantFamilies = (() => {
  const groups = new Map<string, string[]>();
  for (const path of Object.keys(SAMPLE_URLS)) {
    const m = /^([a-zA-Z]+)\d+$/.exec(sampleName(path));
    if (m) (groups.get(m[1]) ?? groups.set(m[1], []).get(m[1])!).push(m.input);
  }
  return groups;
})();
/** Pick a random variant of a clip family (`smack` → `smack2`), or the bare name if it has no numbered files. */
function pickVariant(base: string): string {
  const list = variantFamilies.get(base);
  return list && list.length ? list[Math.floor(Math.random() * list.length)] : base;
}

/** The first real card voiceline clip present (a `cards/*` sample, excluding `.effect`/`.death` variants), or
 *  undefined if none has been recorded yet. Used by playScene to fill a scene step's `arg: '__first__'`. */
function firstCardClip(): string | undefined {
  return Object.keys(SAMPLE_URLS).map(sampleName).find((n) => n.startsWith('cards/') && !n.endsWith('.effect') && !n.endsWith('.death'));
}

/** Play a decoded sample (fresh BufferSource → overlaps fine) at its CATEGORY's effective gain, routed into that
 *  category's bus. Returns false if its buffer isn't ready yet, so the caller can fall back to a synth blip while
 *  the sample finishes decoding. `delay` (s) schedules the start later on the audio clock (sample-accurate) —
 *  used to stagger a token's clip after the summon cue. `onNodes` hands back the live source+gain so the caller
 *  can later fade/stop a long clip (see `stopTurnCharge`) — Web Audio sources are otherwise fire-and-forget. */
function playSample(name: string, category: string, delay = 0, onNodes?: (nodes: PlayNodes) => void): boolean {
  if (isHidden() || audioSuspended) return false; // backgrounded, or hard-muted by a Skip-combat fade
  const a = audio();
  if (!a || muted) return false;
  const buf = buffers.get(name);
  if (!buf) { loadSample(name); return false; }
  const src = a.createBufferSource();
  src.buffer = buf;
  const g = a.createGain();
  g.gain.value = effectiveGain(cfg, category, name);
  src.connect(g).connect(busInput(a, category));
  src.start(a.currentTime + Math.max(0, delay));
  onNodes?.({ src, gain: g });
  return true;
}
interface PlayNodes { src: AudioBufferSourceNode; gain: GainNode; }

// The end-of-turn CHARGE build (`turncharge`) is a long (~25–40s) clip. Web Audio sources are fire-and-forget, so
// we keep a handle to the live nodes and ramp them down when the turn ends early (End Turn pressed / a new charge
// starts) — otherwise the build keeps playing under combat. See `stopTurnCharge` + `sfx.turnCharge`.
let turnChargeNodes: PlayNodes | null = null;
/** Fade out + stop the currently-playing turn-charge build (if any) over `ms`. No-op if none is playing. */
export function stopTurnCharge(ms = 300): void {
  const a = ctx;                    // never CREATE a context just to stop
  const nodes = turnChargeNodes;
  turnChargeNodes = null;
  if (!a || !nodes) return;
  try {
    const t = a.currentTime;
    nodes.gain.gain.cancelScheduledValues(t);
    nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, t);
    nodes.gain.gain.linearRampToValueAtTime(0.0001, t + ms / 1000);
    nodes.src.stop(t + ms / 1000 + 0.02);
  } catch { /* already ended / stopped */ }
}

interface ToneOpts {
  freq: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
  slideTo?: number;
  delay?: number;
  category?: string;
}

// The synth `vol` is the oscillator's OWN level (unaffected by category gain — those scale the sourced clips);
// only the ROUTING goes through the category's bus. The master-gain node applies the Settings-slider volume.
function tone({ freq, dur, type = 'sine', vol = 0.18, slideTo, delay = 0, category = 'ui' }: ToneOpts): void {
  if (isHidden() || audioSuspended) return; // backgrounded, or hard-muted by a Skip-combat fade
  const a = audio();
  if (!a || muted) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, vol), t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(busInput(a, category));
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

const chord = (freqs: number[], opts: Omit<ToneOpts, 'freq' | 'delay'>, step = 0.06): void =>
  freqs.forEach((f, i) => tone({ ...opts, freq: f, delay: i * step }));

/** Seconds the summoned token's own voiceline waits after the general summon cue, so the summon SFX
 *  gets room to land first (a slight overlap is intended). Tune by ear. */
const SUMMON_VOICE_LEAD = 0.3;

// The consume "eat" cue is de-duplicated across callers: several minions can be consumed on ONE beat (or one
// eater devours several fodder), each firing `playFodderEat` separately — the owner wants that to read as a
// SINGLE gulp, not a stack. A short cooldown collapses any consumes within one beat/frame into one play.
let lastConsumeAt = -Infinity;
const CONSUME_SFX_COOLDOWN_MS = 140;

export const sfx = {
  buy: () => {
    // One of the 2 sourced buy clips at random (buy1/buy2); synth blip until they decode / if absent.
    if (playSample(`buy${1 + Math.floor(Math.random() * 2)}`, 'buy')) return;
    tone({ freq: 540, dur: 0.07, type: 'square', vol: 0.1, category: 'buy' });
    tone({ freq: 820, dur: 0.09, type: 'square', vol: 0.08, delay: 0.05, category: 'buy' });
  },
  // Rejected action (can't afford, board/hand full, timer up) — the sourced "deny" clip; synth "wrong"
  // double-buzz fallback until it decodes / if absent.
  deny: () => {
    if (playSample('deny', 'deny')) return;
    tone({ freq: 200, dur: 0.12, type: 'square', vol: 0.13, slideTo: 150, category: 'deny' });
    tone({ freq: 150, dur: 0.17, type: 'square', vol: 0.12, slideTo: 96, delay: 0.085, category: 'deny' });
  },
  // Freeze the tavern — the sourced "freezetavern" clip; falls back to the roll sweep until it decodes.
  freeze: () => {
    if (playSample('freezetavern', 'freeze')) return;
    [0, 0.04, 0.08].forEach((d, i) => tone({ freq: 380 + i * 60, dur: 0.05, type: 'square', vol: 0.06, delay: d, category: 'freeze' }));
  },
  // Unfreeze the tavern — the sourced "unfreezetavern" clip; synth descending sweep fallback.
  unfreeze: () => {
    if (playSample('unfreezetavern', 'unfreeze')) return;
    [0, 0.04, 0.08].forEach((d, i) => tone({ freq: 560 - i * 60, dur: 0.05, type: 'square', vol: 0.06, delay: d, category: 'unfreeze' }));
  },
  // Inspect a card (right-click → enlarged overlay) — the sourced "inspect" clip; soft synth ping fallback.
  inspect: () => {
    if (playSample('inspect', 'inspect')) return;
    tone({ freq: 880, dur: 0.07, type: 'sine', vol: 0.08, slideTo: 1100, category: 'inspect' });
  },
  // A MINION lands on the board — the sourced "cardlanding" clip at the smack level; synth slide until it
  // decodes / if absent. Drop the clip at `packages/ui/src/audio/cardlanding.mp3`.
  play: () => {
    if (playSample('cardlanding', 'cardlanding')) return;
    tone({ freq: 260, dur: 0.13, type: 'triangle', vol: 0.2, slideTo: 150, category: 'cardlanding' });
  },
  // A SPELL is cast from hand — kept distinct from a minion landing. The sourced "castspell" clip; synth
  // slide fallback until it decodes / if absent.
  castSpell: () => {
    if (playSample('castspell', 'castspell')) return;
    tone({ freq: 300, dur: 0.13, type: 'triangle', vol: 0.18, slideTo: 170, category: 'castspell' });
  },
  sell: () => {
    // One of the 4 sourced sell clips at random (sell1–sell4); synth blip until they finish decoding.
    if (playSample(`sell${1 + Math.floor(Math.random() * 4)}`, 'sell')) return;
    tone({ freq: 700, dur: 0.07, type: 'square', vol: 0.09, category: 'sell' });
    tone({ freq: 1040, dur: 0.11, type: 'square', vol: 0.07, delay: 0.06, category: 'sell' });
  },
  // Refresh / reroll the tavern — the sourced "roll" clip; synth ascending blip fallback until it decodes.
  roll: () => {
    if (playSample('roll', 'roll')) return;
    [0, 0.04, 0.08].forEach((d, i) => tone({ freq: 380 + i * 60, dur: 0.05, type: 'square', vol: 0.06, delay: d, category: 'roll' }));
  },
  // HERO DUEL: the tally number travelling to the attack pill, and the moment it lands on the pill (owner ask
  // 2026-08-25). Volume is a ⚔️ Hero Duel tuner dial, applied on top of the `attack` mix via the node gain.
  tallyTravel: (vol = 1) => { playSample('TallyTravel', 'attack', 0, (n) => { n.gain.gain.value *= Math.max(0, vol); }); },
  attackPillAdd: (vol = 1) => { playSample('AttackPillAdd', 'attack', 0, (n) => { n.gain.gain.value *= Math.max(0, vol); }); },
  tallyImpact: (vol = 1) => { playSample('tallyimpact', 'attack', 0, (n) => { n.gain.gain.value *= Math.max(0, vol); }); },
  tallyCounter: (vol = 1) => { playSample('tallycounter', 'attack', 0, (n) => { n.gain.gain.value *= Math.max(0, vol); }); },
  // A shop minion (or Tavern Fodder) is CONSUMED — the sourced "consume" clip; low synth gulp fallback until it
  // decodes / if absent. Drop the clip at `packages/ui/src/audio/consume.mp3`. De-duped by a short cooldown so
  // several consumes on one beat play a SINGLE gulp (owner ask 2026-08-18) — see `CONSUME_SFX_COOLDOWN_MS`.
  consume: () => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now - lastConsumeAt < CONSUME_SFX_COOLDOWN_MS) return; // simultaneous consumes → one gulp
    lastConsumeAt = now;
    if (playSample('consume', 'consume')) return;
    tone({ freq: 200, dur: 0.16, type: 'triangle', vol: 0.13, slideTo: 80, category: 'consume' });
  },
  // The locked 3rd rune slot's chains SHATTER (a hero/rune enabled a 3rd rune). Sourced `rune-chain-break` clip;
  // SILENT until the owner drops `packages/ui/src/audio/rune-chain-break.mp3` (no synth fallback — a placeholder
  // tone under a shatter FX reads worse than nothing while the take is pending).
  runeChainBreak: () => { playSample('rune-chain-break', 'runeBreak'); },
  // A specific card's unique voiceline/SFX — drop `audio/cards/<cardId>.mp3` and it plays when that card is
  // played, LAYERED over the general landing/cast sound. Silent (no fallback) if the card has no clip.
  cardVoice: (cardId: string) => { playSample(`cards/${cardId}`, 'cardVoice'); },
  // A specific card's EFFECT proc SFX — drop `audio/cards/<cardId>.effect.mp3` and it plays when that card's
  // signature effect fires (its Battlecry landing in the shop today; combat procs later), LAYERED over the
  // action. Silent (no fallback) if the card has no effect clip.
  cardEffect: (cardId: string) => { playSample(`cards/${cardId}.effect`, 'cardEffect'); },
  // A specific card's DEATH SFX — drop `audio/cards/<cardId>.death.mp3` and it plays when that minion dies in
  // combat, LAYERED over the general death sound. Silent (no fallback) if the card has no death clip.
  cardDeath: (cardId: string) => { playSample(`cards/${cardId}.death`, 'cardDeath'); },
  // A hero is CHOSEN in Hero Select — drop `audio/heroes/<heroId>.mp3` and it plays, LAYERED over the generic
  // pulse. Silent (no fallback) if the hero has no clip.
  heroSelect: (heroId: string) => { playSample(`heroes/${heroId}`, 'heroSelect'); },
  // A HERO CEREMONY stinger (audio/ceremony/*). `vol` is the 🎭 tuner's per-sound slider — a literal multiplier
  // on top of the category gain, applied via the live gain node. Missing/undecoded clips stay silent (§15's
  // audio-never-blocks rule): the ceremony's timeline is visual-driven either way.
  ceremony: (name: string, vol = 1) => { playSample(`ceremony/${name}`, 'ceremony', 0, ({ gain }) => { gain.gain.value *= vol; }); },
  // A hero POWER activates — drop `audio/heroes/<heroId>.power.mp3` and it plays, LAYERED over the generic
  // pulse. Silent (no fallback) if the hero has no power clip.
  heroPower: (heroId: string) => { playSample(`heroes/${heroId}.power`, 'heroPower'); },
  // A token is summoned — a general "summon" pop (sourced `summon` clip; synth rising blip fallback) LAYERED
  // with the summoned token's own cards/<tokenId>.mp3 voiceline if present. Fires on battlecry summons
  // (recruit, from store.ts) and combat summons (deathrattles etc., from useCombatReplay.ts).
  summon: (tokenId?: string) => {
    if (!playSample('summon', 'summon')) tone({ freq: 300, dur: 0.12, type: 'triangle', vol: 0.1, slideTo: 520, category: 'summon' });
    // Let the summon cue land first, THEN the summoned token's own voiceline (slight overlap is fine).
    if (tokenId) playSample(`cards/${tokenId}`, 'cardVoice', SUMMON_VOICE_LEAD);
  },
  // A Discover choice opens — the sourced "discover" clip; synth shimmer until it decodes / if absent.
  discover: () => {
    if (playSample('discover', 'discover')) return;
    chord([523, 784, 1046], { dur: 0.16, type: 'triangle', vol: 0.1, category: 'discover' }, 0.05);
  },
  // A choice is COMMITTED from any offer — a Discover pick, a Rune bought, a Choose One option (owner ask
  // 2026-08-19). Sourced `discover-select` clip; a soft synth confirm chord falls back until it decodes.
  discoverSelect: () => {
    if (playSample('discover-select', 'discoverSelect')) return;
    chord([659, 988, 1319], { dur: 0.14, type: 'triangle', vol: 0.09, category: 'discoverSelect' }, 0.04);
  },
  // A friendly minion is GIVEN Taunt — the sourced "taunt" clip; synth thunk until it decodes / if absent.
  taunt: () => {
    if (playSample('taunt', 'taunt')) return;
    tone({ freq: 220, dur: 0.14, type: 'square', vol: 0.12, slideTo: 160, category: 'taunt' });
  },
  // A card is repositioned (warband / shop reorder) — the sourced "reordercard" clip; synth tick fallback.
  reorder: () => {
    if (playSample('reordercard', 'reorder')) return;
    tone({ freq: 440, dur: 0.05, type: 'square', vol: 0.07, category: 'reorder' });
  },
  // Tavern Up — the sourced "tavernupgrade" clip; synth rising triad fallback until it decodes / if absent.
  upgrade: () => {
    if (playSample('tavernupgrade', 'upgrade')) return;
    chord([392, 523, 659], { dur: 0.14, type: 'triangle', vol: 0.12, category: 'upgrade' }, 0.07);
  },
  /**
   * EQUIPPING — the metallic clang when a minion grants its Equipment (owner ask 2026-08-28).
   *
   * `delay` is passed straight to `playSample`, which schedules on the AUDIO clock rather than a timer — so
   * the clang stays locked to the visual it is timed against even when the main thread is busy. That is why
   * the tuner dials milliseconds here instead of the caller wrapping this in a `setTimeout`.
   *
   * Synth fallback is a short metallic ping, so the cue still reads if the clip has not decoded yet.
   */
  equipClang: (delay = 0) => {
    if (playSample('equipclang', 'eqEquipClang', delay / 1000)) return;
    tone({ freq: 2100, dur: 0.12, type: 'square', vol: 0.09, slideTo: 900, category: 'eqEquipClang' });
  },
  /**
   * USING an Equipment — the clip the Equipment itself names (`useSfxId`), so a new one brings its own sound
   * without touching this file. `delay` schedules on the audio clock, as `equipClang` does, so the cue stays
   * locked to the visual it is timed against.
   */
  /**
   * Picking a different Equipment from the selector rail (owner ask 2026-08-28). `vol` is the Equipment Slot
   * tuner's dial, applied ON TOP of the clip's category + per-clip gains rather than replacing them — so the
   * UI bus still governs it and the dial only decides how this one reads against the slot's other sounds.
   */
  equipmentSelect: (vol = 1) => {
    if (vol <= 0) return;
    if (playSample('equipmentselect', 'eqSelect', 0, ({ gain }) => { gain.gain.value *= vol; })) return;
    tone({ freq: 880, dur: 0.06, type: 'triangle', vol: 0.08 * vol, category: 'eqSelect' });
  },
  /**
   * The sheen sweeping the Equipment art when the slot's picture CHANGES (owner ask 2026-08-29). `vol` is the
   * Equipment Slot tuner's dial, multiplied on top of the clip's category + per-clip gains rather than
   * replacing them; `delay` schedules on the AUDIO clock so it cannot drift from the visual sweep.
   */
  equipmentSheen: (vol = 1, delay = 0) => {
    if (vol <= 0) return;
    if (playSample('equipmentsheen', 'eqSheen', Math.max(0, delay) / 1000, ({ gain }) => { gain.gain.value *= vol; })) return;
    tone({ freq: 1500, dur: 0.14, type: 'sine', vol: 0.06 * vol, slideTo: 2400, category: 'eqSheen' });
  },
  /**
   * The rune lock-in clang — the gold frame slamming shut on the chosen rune (owner ask 2026-08-29).
   *
   * `delay` schedules on the AUDIO clock rather than a `setTimeout`, so the clang cannot drift away from the
   * clamp it is supposed to be the sound of. That pairing is the whole point: this is not a generic
   * confirmation beep, it is the noise the frame makes on contact, and a sound that lands 40ms late reads as
   * a second event.
   */
  /**
   * THE ARRIVAL (owner ask 2026-08-31): the implosion that plays on the rune's BADGE once the ceremony has
   * faded and the board is back — the moment the rune becomes a thing you own rather than a thing you picked.
   *
   * Its own clip and its own fader, not a second use of `runeSelect`: that one is the clang of the frame
   * clamping shut mid-ceremony, and the two now play seconds apart on different parts of the screen.
   */
  runeSelectImplosion: (vol = 1, delay = 0) => {
    if (vol <= 0) return;
    if (playSample('runeselectimplosion', 'runeArrival', Math.max(0, delay) / 1000, ({ gain }) => { gain.gain.value *= vol; })) return;
    tone({ freq: 1180, dur: 0.22, type: 'sine', vol: 0.09 * vol, slideTo: 380, category: 'runeArrival' });
  },
  runeSelect: (vol = 1, delay = 0) => {
    if (vol <= 0) return;
    if (playSample('runeselect', 'ui', Math.max(0, delay) / 1000, ({ gain }) => { gain.gain.value *= vol; })) return;
    tone({ freq: 620, dur: 0.16, type: 'triangle', vol: 0.1 * vol, slideTo: 940, category: 'ui' });
  },
  /**
   * The Auctioneer's Pulse landing on the minion it calls back (owner-authored clip, 2026-08-30).
   *
   * Hero-power specific rather than the generic `pulse`: the Pulse is a bespoke moment with its own authored
   * FX (`auctioneer-hp`), and a sound is half of what makes a hero power feel like that hero's.
   */
  auctioneerPower: (vol = 1) => {
    if (vol <= 0) return;
    if (playSample('auctioneerhp', 'ui', 0, ({ gain }) => { gain.gain.value *= vol; })) return;
    tone({ freq: 480, dur: 0.2, type: 'triangle', vol: 0.1 * vol, slideTo: 760, category: 'ui' });
  },
  equipmentUse: (clipId: string, delay = 0) => {
    // PER-CLIP category (owner ask 2026-08-31), so the desk shows one named fader per Equipment rather than a
    // single `equip` lump — `equipmentClipCategory` is the map, and an unlisted clip lands on `eqUseOther`,
    // which reads as a prompt to name it.
    const cat = equipmentClipCategory(clipId);
    if (playSample(clipId, cat, delay / 1000)) return;
    tone({ freq: 520, dur: 0.18, type: 'sine', vol: 0.1, slideTo: 300, category: cat });
  },
  // Choosing a hero / pressing the hero-power button — the sourced "pulse" clip; synth ping fallback.
  pulse: () => {
    if (playSample('pulse', 'pulse')) return;
    tone({ freq: 1400, dur: 0.1, type: 'sine', vol: 0.12, slideTo: 1900, category: 'pulse' });
  },
  // A trigger medallion releases its energy pulse (an effect officially fired). DEDUPED: many units can
  // pulse on the same combat beat / EOT step — a short throttle collapses simultaneous calls into one
  // play so the audio never stacks. The sourced "triggerpulse" clip; soft synth swell fallback.
  triggerPulse: () => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now - lastTriggerPulse < 70) return; // one play per ~frame of simultaneous pulses
    lastTriggerPulse = now;
    if (playSample('triggerpulse', 'triggerpulse')) return;
    tone({ freq: 660, dur: 0.16, type: 'triangle', vol: 0.11, slideTo: 1180, category: 'triggerpulse' });
  },
  // A trigger medallion GLOWS (progress only — a multi-turn cadence card ticked toward firing but didn't
  // release, e.g. Frontdrake's per-turn countdown). DEDUPED like triggerPulse: many units can tick on the
  // same EOT step, so a short throttle collapses simultaneous calls into one play. Sourced "triggerglow"
  // clip; soft synth tick fallback.
  triggerGlow: () => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now - lastTriggerGlow < 70) return; // one play per ~frame of simultaneous glows
    lastTriggerGlow = now;
    if (playSample('triggerglow', 'triggerglow')) return;
    tone({ freq: 520, dur: 0.12, type: 'triangle', vol: 0.08, slideTo: 760, category: 'triggerglow' });
  },
  // A mouse click on the empty board (the table surface, not a card/control) — a short tactile "thock".
  // Sourced "clickthock" clip; soft synth tick fallback until it decodes / if absent.
  clickThock: () => {
    if (playSample('clickthock', 'clickthock')) return;
    tone({ freq: 180, dur: 0.05, type: 'square', vol: 0.07, slideTo: 120, category: 'clickthock' });
  },
  // Pressing any card — shop, hand, or board — a soft "card touch". Sourced "cardtouch" clip; soft synth
  // tick fallback until it decodes / if absent.
  cardTouch: () => {
    if (playSample('cardtouch', 'cardtouch')) return;
    tone({ freq: 330, dur: 0.05, type: 'sine', vol: 0.07, slideTo: 260, category: 'cardtouch' });
  },
  // Hovering an interactive UI element — menu buttons, hero-select cards, Discover options (wired via a single
  // delegated pointerover listener in Game.tsx, which excludes the in-game shop/combat HUD controls). Sourced
  // "uihover" clip; soft synth blip fallback until it decodes / if absent. NOT time-throttled — the listener's
  // per-target enter dedupe already collapses repeats on the same element, so each element you pass over ticks
  // exactly once (a fast sweep across a row fires each one, which is the responsive feel we want).
  uiHover: () => {
    if (playSample('uihover', 'uihover')) return;
    tone({ freq: 1250, dur: 0.035, type: 'sine', vol: 0.05, slideTo: 1600, category: 'uihover' });
  },
  // A Divine Shield is DESTROYED in combat (the bubble cracks + shatters) — the sourced clip; synth crash
  // fallback. DEDUPED: a single beat can break several shields (Cleave / simultaneous), so a short throttle
  // collapses them into one play.
  shieldBreak: () => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now - lastShieldBreak < 60) return;
    lastShieldBreak = now;
    if (playSample('divineshieldbreak', 'divineshieldbreak')) return;
    tone({ freq: 900, dur: 0.18, type: 'square', vol: 0.12, slideTo: 200, category: 'divineshieldbreak' });
  },
  /**
   * A RUBY lands on a minion — one play per gem, so the ear carries the same count the eye does. A gilded
   * Frenzied Excavator is a cascade of 2-stacks (see docs/fx-vocabulary.md) and must SOUND like two per unit.
   *
   * Throttled at 20ms, not the 60ms `shieldBreak` uses: 60 would swallow the second hit of a stack, since the
   * stack `beat` is itself 60. This floor only collapses gems that land in the SAME frame, which is never a
   * count the player could have heard anyway.
   */
  gemApply: () => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now - lastGemApply < 20) return;
    lastGemApply = now;
    if (playSample('gemapply', 'gemapply')) return;
    tone({ freq: 1180, dur: 0.1, type: 'triangle', vol: 0.09, slideTo: 1560, category: 'gemapply' });
  },
  // A Reborn aura SHATTERS in combat (the unit dies + its spirit releases). Deduped like shieldBreak.
  rebornShatter: () => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now - lastRebornShatter < 60) return;
    lastRebornShatter = now;
    if (playSample('rebornshatter', 'rebornshatter')) return;
    tone({ freq: 520, dur: 0.22, type: 'sine', vol: 0.11, slideTo: 160, category: 'rebornshatter' });
  },
  // A Reborn unit RE-FORMS (the rebirth/resummon). Its own clip, distinct from the generic summon. Deduped.
  rebornSummon: () => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now - lastRebornSummon < 60) return;
    lastRebornSummon = now;
    if (playSample('rebornsummon', 'rebornsummon')) return;
    tone({ freq: 300, dur: 0.26, type: 'sine', vol: 0.12, slideTo: 620, category: 'rebornsummon' });
  },
  // A Deathrattle skull SHATTERS into bone (the pixiFx.deathrattle burst) — the sourced "skullburst" clip;
  // synth magic-burst fallback until it decodes. DEDUPED: several Deathrattle units can burst near-together,
  // so a short throttle collapses simultaneous shatters into one play.
  skullBurst: () => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now - lastSkullBurst < 60) return;
    lastSkullBurst = now;
    if (playSample('skullburst', 'skullburst')) return;
    tone({ freq: 900, dur: 0.18, type: 'sawtooth', vol: 0.12, slideTo: 200, category: 'skullburst' });
    tone({ freq: 1400, dur: 0.14, type: 'triangle', vol: 0.07, delay: 0.02, slideTo: 500, category: 'skullburst' });
  },
  tick: () => tone({ freq: 1040, dur: 0.045, type: 'square', vol: 0.09, category: 'ui' }),
  // The end-of-turn CHARGE GLYPH starts charging (20s left, or turn start on short early waves) — fires once per
  // turn when the glyph lights. The sourced "turncharge" clip; synth rising-hum fallback until it decodes / if
  // absent. Drop the clip at `packages/ui/src/audio/turncharge.mp3`.
  turnCharge: () => {
    stopTurnCharge(80); // never stack: quickly cut any build still ringing from a prior turn before the new one
    if (playSample('turncharge', 'turncharge', 0, (n) => {
      turnChargeNodes = n;
      n.src.onended = () => { if (turnChargeNodes?.src === n.src) turnChargeNodes = null; }; // clear on natural end
    })) return;
    tone({ freq: 150, dur: 0.7, type: 'sawtooth', vol: 0.1, slideTo: 480, category: 'turncharge' });
  },
  // The turn timer hits ZERO — the last instant the shop is usable (actions lock); syncs with the charge glyph's
  // completion flash. A heavier "end-turn explosion" than the charge build. Sourced "turnexplosion" clip; synth
  // boom fallback until it decodes. Drop the clip at `packages/ui/src/audio/turnexplosion.mp3`.
  turnExplode: () => {
    if (playSample('turnexplosion', 'turnexplosion')) return;
    tone({ freq: 90, dur: 0.5, type: 'sawtooth', vol: 0.16, slideTo: 40, category: 'turnexplosion' });
  },
  // End Turn → Face the Omen — the sourced "combatStart" clip; synth low sawtooth down-slide fallback.
  combatStart: () => {
    if (playSample('combatStart', 'combatStart')) return;
    tone({ freq: 200, dur: 0.45, type: 'sawtooth', vol: 0.16, slideTo: 90, category: 'combatStart' });
  },
  // A unit begins its attack — the wind-up. Sourced "windup" clip; synth sawtooth blip fallback until it decodes
  // / if absent. Fired at the start of every attack event (see choreo/channels/sfx.ts).
  attack: () => {
    if (playSample('windup', 'attack')) return;
    tone({ freq: 320, dur: 0.08, type: 'sawtooth', vol: 0.1, slideTo: 130, category: 'attack' });
  },
  // A Start-of-Combat effect firing (Ember Whelp's scorch, Blaster, etc.) — a magic "zap", distinct from the
  // physical smack so SC damage doesn't read as a melee hit. REUSES the `pulse` sourced clip, but on its own
  // `cast` category (combat bus) so it can be leveled independently of the hero-power pulse; synth zap fallback
  // until it decodes / if absent.
  cast: () => {
    if (playSample('pulse', 'cast')) return;
    tone({ freq: 1040, dur: 0.14, type: 'sawtooth', vol: 0.085, slideTo: 360, category: 'cast' });
    tone({ freq: 1500, dur: 0.1, type: 'triangle', vol: 0.05, delay: 0.02, slideTo: 900, category: 'cast' });
  },
  // Impact in combat — one of the sourced strike clips (`smack1`…`smackN`) at random so repeated hits don't
  // sound identical; synth thud until they decode. Fired frame-accurately from the lunge's GSAP timeline
  // (see playAttackLunge) so it lands on contact.
  hit: () => {
    if (playSample(pickVariant('smack'), 'smack')) return;
    tone({ freq: 170, dur: 0.12, type: 'square', vol: 0.15, slideTo: 80, category: 'smack' });
  },
  // FLURRY (W) — a windfury attacker's wind cues, layered OVER the normal attack on EVERY swing (both hits):
  // `flurryLunge` fires just after the wind-up ends (the gust as the strike launches; from the lunge channel),
  // and `flurryHit` fires alongside the smack when a hit lands. Sourced clips (no synth fallback — they're
  // additive flavour, not load-bearing, so silence until decode is fine). Own categories on the combat bus.
  flurryLunge: () => { playSample('flurrylunge', 'flurrylunge'); },
  flurryHit: () => { playSample('flurryhit', 'flurryhit'); },
  // CLEAVE (C) — the rake landing. Layered OVER the smack (the hit is still a hit), fired from the impact
  // channel alongside the gash. Sourced clip, no synth fallback: it's flavour on top of a sound that
  // already plays, so silence until it decodes is fine. Own category on the combat bus.
  // NB the SAMPLE is `cleave2` while the CATEGORY stays `cleave` — the category is the mixer channel and is
  // referenced in audio/config.ts, so swapping the take must not rename it or the level/bus wiring is lost.
  cleave: () => { playSample('cleave2', 'cleave'); },
  // A CRITICAL STRIKE lands (Commander Impala's CR keyword — this swing dealt DOUBLE damage). REPLACES the smack
  // with its own clip so the doubled hit reads distinctly; sourced "crit" clip, synth crack fallback until it
  // decodes / if absent. Fired in place of `hit` from the impact channel when the attack event is a crit.
  critHit: () => {
    if (playSample('crit', 'crit')) return;
    tone({ freq: 240, dur: 0.16, type: 'square', vol: 0.18, slideTo: 90, category: 'crit' });
  },
  // A unit DIES in combat — the sourced "death" clip; synth low sine-drop fallback until it decodes / if absent.
  // Fired from the combat SFX channel on a real (non-Rise) death; the unit's own cards/<id>.death.mp3 voiceline
  // still layers over this.
  death: () => {
    if (playSample('death', 'death')) return;
    tone({ freq: 130, dur: 0.26, type: 'sine', vol: 0.2, slideTo: 48, category: 'death' });
  },
  // A unit GAINS a Ward / Divine Shield during combat (the protective bubble pops onto it) — the sourced
  // "shieldgain" clip; synth rising-sine chime fallback. Counterpart to shieldBreak. Fired on `shieldUp` events
  // (Start-of-Combat grants, Avenge shields, Ward transfers, Mech grants) from the combat SFX channel.
  shield: () => {
    if (playSample('shieldgain', 'shield')) return;
    tone({ freq: 760, dur: 0.18, type: 'sine', vol: 0.11, slideTo: 1300, category: 'shield' });
  },
  // Fel Spikes' Echo LAUNCHES its spike volley (the projectile pixi fires) — ONE cue per volley, however many
  // targets it sprays at once. Fired the instant the volley launches (see `scheduleEchoVolleys`). Sourced
  // "fel-spike-echo" clip; synth descending zap fallback until it decodes / if absent.
  felSpikeEcho: () => {
    if (playSample('fel-spike-echo', 'felSpikeEcho')) return;
    tone({ freq: 320, dur: 0.16, type: 'sawtooth', vol: 0.12, slideTo: 90, category: 'felSpikeEcho' });
  },
  // Fel Spikes' Echo volley CONNECTS — ONE cue per volley as its spikes land, played only when the volley
  // actually dealt damage (a number fired); see `scheduleEchoVolleys`. Sourced "fel-spike-echo-land" clip; synth
  // tick fallback.
  felSpikeEchoLand: () => {
    if (playSample('fel-spike-echo-land', 'felSpikeEchoLand')) return;
    tone({ freq: 200, dur: 0.09, type: 'square', vol: 0.08, slideTo: 70, category: 'felSpikeEchoLand' });
  },
  buff: () => {
    tone({ freq: 480, dur: 0.09, type: 'triangle', vol: 0.12, category: 'buff' });
    tone({ freq: 720, dur: 0.12, type: 'triangle', vol: 0.1, delay: 0.06, category: 'buff' });
  },
  // Soulsman's Avenge raises your max Gold — REUSES the sell clip (one of sell1–selN at random) per owner
  // request, on its own `maxgold` category (combat bus) so it levels independently of the shop sell; synth rising
  // coin-shimmer fallback until it decodes / if absent.
  maxGold: () => {
    if (playSample(pickVariant('sell'), 'maxgold')) return;
    chord([784, 1046, 1318, 1568], { dur: 0.11, type: 'triangle', vol: 0.1, category: 'maxgold' }, 0.045);
  },
  // You make a triple (3 copies → a golden) — the sourced "triplereward" clip; synth rising arpeggio fallback.
  triple: () => {
    if (playSample('triplereward', 'triple')) return;
    chord([523, 659, 784, 1046], { dur: 0.13, type: 'triangle', vol: 0.12, category: 'triple' }, 0.06);
  },
  win: () => chord([523, 659, 784, 1046], { dur: 0.2, type: 'triangle', vol: 0.14, category: 'ui' }, 0.1),
  lose: () => chord([392, 311, 233], { dur: 0.24, type: 'sawtooth', vol: 0.13, category: 'ui' }, 0.12),
} as const;

// --- Dev SFX mixer bridge (DEV only). SfxMixer.tsx still edits per-CATEGORY gains through these until it's
//     rewritten (T4) to drive the full audioConfig (buses + limiter). Bridged onto `cfg.categories` here so the
//     existing mixer keeps working; changes persist the whole config. ---
/** The category keys, in mixer order. */
export const SFX_KEYS = Object.keys(DEFAULT_AUDIO_CONFIG.categories);
export function getSampleVolumes(): Record<string, number> {
  return Object.fromEntries(Object.entries(cfg.categories).map(([k, c]) => [k, c.gain]));
}
export function setSampleVolume(key: string, v: number): void {
  const prev = cfg.categories[key] ?? { bus: 'ui' as BusName, gain: 0.6 };
  cfg.categories[key] = { ...prev, gain: Math.min(1, Math.max(0, v)) };
  persistConfig();
}

/** Play a sourced clip by its category key (for the dev SFX mixer's preview button). */
const SFX_PREVIEW: Record<string, () => void> = {
  buy: sfx.buy, sell: sfx.sell, smack: sfx.hit, crit: sfx.critHit, attack: sfx.attack, death: sfx.death, shield: sfx.shield, triple: sfx.triple, cast: sfx.cast, maxgold: sfx.maxGold, cardlanding: sfx.play, castspell: sfx.castSpell,
  discover: sfx.discover, discoverSelect: sfx.discoverSelect, taunt: sfx.taunt, reorder: sfx.reorder, deny: sfx.deny, freeze: sfx.freeze,
  unfreeze: sfx.unfreeze, pulse: sfx.pulse, triggerpulse: sfx.triggerPulse, triggerglow: sfx.triggerGlow, clickthock: sfx.clickThock, cardtouch: sfx.cardTouch, gemapply: sfx.gemApply, divineshieldbreak: sfx.shieldBreak, rebornshatter: sfx.rebornShatter, rebornsummon: sfx.rebornSummon, skullburst: sfx.skullBurst, inspect: sfx.inspect, upgrade: sfx.upgrade, roll: sfx.roll,
  uihover: sfx.uiHover,
  // Equipment — each preview plays the clip its fader actually governs.
  eqEquipClang: () => sfx.equipClang(),
  eqSelect: () => sfx.equipmentSelect(),
  eqSheen: () => sfx.equipmentSheen(),
  eqUseBloodpot: () => sfx.equipmentUse('bloodpot'),
  eqUseTitanHammer: () => sfx.equipmentUse('titanhammer'),
  eqUseBlastPump: () => sfx.equipmentUse('blastpump'),
  eqUsePrismaticPick: () => sfx.equipmentUse('prismaticpick'),
  eqUseDuelingRubettas: () => sfx.equipmentUse('duelingrubettas'),
  runeArrival: () => sfx.runeSelectImplosion(),
  felSpikeEcho: sfx.felSpikeEcho, felSpikeEchoLand: sfx.felSpikeEchoLand,
  combatStart: sfx.combatStart,
  // cardVoice is per-card; preview plays whichever card clip is present (first one found), or nothing.
  cardVoice: () => {
    const first = Object.keys(SAMPLE_URLS).map(sampleName).find((n) => n.startsWith('cards/') && !n.endsWith('.effect') && !n.endsWith('.death'));
    if (first) playSample(first, 'cardVoice');
  },
  // The per-card / per-hero categories are keyed by id at call time; the mixer preview plays whichever clip of
  // that category is present in the tree (first found), or nothing if none has been recorded yet.
  cardEffect: () => {
    const first = Object.keys(SAMPLE_URLS).map(sampleName).find((n) => n.startsWith('cards/') && n.endsWith('.effect'));
    if (first) playSample(first, 'cardEffect');
  },
  cardDeath: () => {
    const first = Object.keys(SAMPLE_URLS).map(sampleName).find((n) => n.startsWith('cards/') && n.endsWith('.death'));
    if (first) playSample(first, 'cardDeath');
  },
  heroSelect: () => {
    const first = Object.keys(SAMPLE_URLS).map(sampleName).find((n) => n.startsWith('heroes/') && !n.endsWith('.power'));
    if (first) playSample(first, 'heroSelect');
  },
  heroPower: () => {
    const first = Object.keys(SAMPLE_URLS).map(sampleName).find((n) => n.startsWith('heroes/') && n.endsWith('.power'));
    if (first) playSample(first, 'heroPower');
  },
  summon: () => sfx.summon(),
};
export function previewSfx(key: string): void {
  SFX_PREVIEW[key]?.();
}

// --- Mixing-desk API — the full audioConfig surface (buses + master limiter + categories) the rebuilt SfxMixer
//     drives, plus live meters/gain-reduction telemetry off the analyser taps and the test-scene player. ---
export function getAudioConfig(): AudioConfig {
  return cfg;
}
/** Set a bus's fader gain — live-ramps the running node + persists. */
export function setBusGain(b: BusName, v: number): void {
  cfg.buses[b].gain = v;
  const a = audio();
  busNodes.get(b)?.input.gain.setTargetAtTime(v, a?.currentTime ?? 0, 0.01);
  persistConfig();
}
/** Set one master-limiter dial (threshold/knee/ratio/attack/release) — live on the node + persists. */
export function setMasterComp(k: keyof CompConfig, v: number): void {
  cfg.master[k] = v;
  if (master) master[k].value = v; // keyof CompConfig ⊂ the node's AudioParam keys, so master[k] is an AudioParam
  persistConfig();
}
/** Patch a category's routing/gain (creating it with sane defaults if new) — persists. */
export function setCategory(cat: string, patch: Partial<CategoryConfig>): void {
  const prev: CategoryConfig = cfg.categories[cat] ?? { bus: 'ui', gain: 0.6 };
  cfg.categories[cat] = { ...prev, ...patch };
  persistConfig();
}
/** Peak level 0..1 for a meter key ('master' | bus name). */
export function meterLevel(key: string): number {
  const an = analysers.get(key);
  if (!an) return 0;
  const buf = new Uint8Array(an.fftSize);
  an.getByteTimeDomainData(buf);
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
  return peak;
}
/** Master limiter gain-reduction as a 0..~1 bar value. */
export function gainReduction(): number {
  // `reduction` is a plain readonly number (dB, ≤ 0) on the modern node — NOT an AudioParam.
  return master ? -master.reduction / 20 : 0;
}
/** The current config serialized (for the desk's export/copy button). */
export function exportConfig(): string {
  return JSON.stringify(cfg, null, 2);
}
/** Fire a named test scene's steps on the wall clock, filling `arg: '__first__'` with the first card clip. */
export function playScene(id: string): void {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) return;
  const first = firstCardClip();
  for (const step of scene.steps) {
    window.setTimeout(() => {
      const fn = (sfx as unknown as Record<string, (arg?: string) => void>)[step.cue];
      if (fn) fn(step.arg === '__first__' ? first : step.arg);
    }, step.delay);
  }
}

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
