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
  ...import.meta.glob('./audio/cards/*.mp3', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('./audio/heroes/*.mp3', { eager: true, query: '?url', import: 'default' }),
} as Record<string, string>;
const buffers = new Map<string, AudioBuffer>();
const loadingSamples = new Set<string>();
// Key = path under ./audio/ minus extension: `./audio/roll.mp3` → `roll`, `./audio/cards/karthus.mp3` → `cards/karthus`.
const sampleName = (path: string): string => path.replace(/^\.\/audio\//, '').replace(/\.mp3$/, '');

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
 *  used to stagger a token's clip after the summon cue. */
function playSample(name: string, category: string, delay = 0): boolean {
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
  return true;
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
  discover: sfx.discover, taunt: sfx.taunt, reorder: sfx.reorder, deny: sfx.deny, freeze: sfx.freeze,
  unfreeze: sfx.unfreeze, pulse: sfx.pulse, triggerpulse: sfx.triggerPulse, triggerglow: sfx.triggerGlow, clickthock: sfx.clickThock, cardtouch: sfx.cardTouch, divineshieldbreak: sfx.shieldBreak, rebornshatter: sfx.rebornShatter, rebornsummon: sfx.rebornSummon, skullburst: sfx.skullBurst, inspect: sfx.inspect, upgrade: sfx.upgrade, roll: sfx.roll,
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
  cfg.categories[cat] = { bus: 'ui', gain: 0.6, ...(cfg.categories[cat] ?? {}), ...patch };
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
  return master ? -master.reduction.value / 20 : 0;
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
