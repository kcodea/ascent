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

/** True while the tab is backgrounded — we suppress sound then, so a pile-up doesn't blast on tab-in. */
const isHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

// A master limiter every sound routes through, so overlapping clips (landing + voiceline + summon, etc.)
// can never sum past full scale and hard-clip the output. Configured limiter-style: catch anything above the
// threshold with a high ratio + fast attack, so peaks are tamed transparently for short SFX.
let master: DynamicsCompressorNode | null = null;
/** The node sounds connect to (the limiter if ready, else the raw destination). */
function out(a: AudioContext): AudioNode {
  return master ?? a.destination;
}

function audio(): AudioContext | null {
  try {
    const isNew = !ctx;
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    if (isNew) {
      master = ctx.createDynamicsCompressor();
      master.threshold.value = -6; // engage when stacked sounds sum past -6 dBFS (single clips at playback
                                   // gain sit well below this, so they pass untouched — only loud stacks limit)
      master.knee.value = 0;       // hard knee → behaves like a limiter
      master.ratio.value = 20;     // max ratio: anything above threshold is held down hard
      master.attack.value = 0.001; // 1ms — fast enough that even a torture-test sum stays under 0 dBFS
      master.release.value = 0.25;
      master.connect(ctx.destination);
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

/** Play a decoded sample (fresh BufferSource → overlaps fine). Returns false if its buffer isn't ready yet,
 *  so the caller can fall back to a synth blip while the sample finishes decoding. `delay` (s) schedules the
 *  start later on the audio clock (sample-accurate) — used to stagger a token's clip after the summon cue. */
function playSample(name: string, vol = 0.6, delay = 0): boolean {
  if (isHidden()) return false; // don't play while the tab is backgrounded (avoids a burst on tab-in)
  const a = audio();
  if (!a || muted) return false;
  const buf = buffers.get(name);
  if (!buf) { loadSample(name); return false; }
  const src = a.createBufferSource();
  src.buffer = buf;
  const g = a.createGain();
  g.gain.value = vol * masterVol;
  src.connect(g).connect(out(a));
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
}

function tone({ freq, dur, type = 'sine', vol = 0.18, slideTo, delay = 0 }: ToneOpts): void {
  if (isHidden()) return; // don't play while the tab is backgrounded (avoids a burst on tab-in)
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
  osc.connect(gain).connect(out(a));
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

const chord = (freqs: number[], opts: Omit<ToneOpts, 'freq' | 'delay'>, step = 0.06): void =>
  freqs.forEach((f, i) => tone({ ...opts, freq: f, delay: i * step }));

// Per-sourced-clip gain (0..1), keyed by logical sound name. Tunable LIVE via the dev SFX mixer (DEV only)
// + persisted, so audio levels can be dialed in by ear without a code change — set the value here as the
// shipped default. (Synth fallbacks keep their own inline gains.)
const SAMPLE_VOL_DEFAULTS: Record<string, number> = {
  // Whole-bank mix dialed in by ear via the DEV SFX mixer ("Copy values"), then pasted here as the shipped
  // defaults. cardVoice = shared gain for per-card voicelines; summon = the general summon cue.
  buy: 0.5,
  sell: 0.3,
  smack: 0.08,
  cardlanding: 0.4,
  discover: 0.5,
  taunt: 0.5,
  reorder: 0.225,
  deny: 0.5,
  freeze: 0.31,
  unfreeze: 0.36,
  pulse: 0.5,
  inspect: 0.5,
  upgrade: 0.5,
  roll: 0.61,
  combatStart: 0.5,
  cardVoice: 0.09,
  summon: 0.65,
};
let sampleVol: Record<string, number> = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('ascent.sfxvol') ?? '{}');
    return { ...SAMPLE_VOL_DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Record<string, number>) : {}) };
  } catch {
    return { ...SAMPLE_VOL_DEFAULTS };
  }
})();
/** The sourced-clip names, in mixer order. */
export const SFX_KEYS = Object.keys(SAMPLE_VOL_DEFAULTS);
export function getSampleVolumes(): Record<string, number> {
  return { ...sampleVol };
}
export function setSampleVolume(key: string, v: number): void {
  sampleVol = { ...sampleVol, [key]: Math.min(1, Math.max(0, v)) };
  try {
    localStorage.setItem('ascent.sfxvol', JSON.stringify(sampleVol));
  } catch {
    /* ignore */
  }
}

/** Seconds the summoned token's own voiceline waits after the general summon cue, so the summon SFX
 *  gets room to land first (a slight overlap is intended). Tune by ear. */
const SUMMON_VOICE_LEAD = 0.3;

export const sfx = {
  buy: () => {
    // One of the 2 sourced buy clips at random (buy1/buy2); synth blip until they decode / if absent.
    if (playSample(`buy${1 + Math.floor(Math.random() * 2)}`, sampleVol.buy)) return;
    tone({ freq: 540, dur: 0.07, type: 'square', vol: 0.1 });
    tone({ freq: 820, dur: 0.09, type: 'square', vol: 0.08, delay: 0.05 });
  },
  // Rejected action (can't afford, board/hand full, timer up) — the sourced "deny" clip; synth "wrong"
  // double-buzz fallback until it decodes / if absent.
  deny: () => {
    if (playSample('deny', sampleVol.deny)) return;
    tone({ freq: 200, dur: 0.12, type: 'square', vol: 0.13, slideTo: 150 });
    tone({ freq: 150, dur: 0.17, type: 'square', vol: 0.12, slideTo: 96, delay: 0.085 });
  },
  // Freeze the tavern — the sourced "freezetavern" clip; falls back to the roll sweep until it decodes.
  freeze: () => {
    if (playSample('freezetavern', sampleVol.freeze)) return;
    [0, 0.04, 0.08].forEach((d, i) => tone({ freq: 380 + i * 60, dur: 0.05, type: 'square', vol: 0.06, delay: d }));
  },
  // Unfreeze the tavern — the sourced "unfreezetavern" clip; synth descending sweep fallback.
  unfreeze: () => {
    if (playSample('unfreezetavern', sampleVol.unfreeze)) return;
    [0, 0.04, 0.08].forEach((d, i) => tone({ freq: 560 - i * 60, dur: 0.05, type: 'square', vol: 0.06, delay: d }));
  },
  // Inspect a card (right-click → enlarged overlay) — the sourced "inspect" clip; soft synth ping fallback.
  inspect: () => {
    if (playSample('inspect', sampleVol.inspect)) return;
    tone({ freq: 880, dur: 0.07, type: 'sine', vol: 0.08, slideTo: 1100 });
  },
  // A MINION lands on the board — the sourced "cardlanding" clip at the smack level; synth slide until it
  // decodes / if absent. Drop the clip at `packages/ui/src/audio/cardlanding.mp3`.
  play: () => {
    if (playSample('cardlanding', sampleVol.cardlanding)) return;
    tone({ freq: 260, dur: 0.13, type: 'triangle', vol: 0.2, slideTo: 150 });
  },
  // A SPELL is cast — kept distinct from a minion landing (spells get per-spell sounds later). Synth for now.
  castSpell: () => tone({ freq: 300, dur: 0.13, type: 'triangle', vol: 0.18, slideTo: 170 }),
  sell: () => {
    // One of the 4 sourced sell clips at random (sell1–sell4); synth blip until they finish decoding.
    if (playSample(`sell${1 + Math.floor(Math.random() * 4)}`, sampleVol.sell)) return;
    tone({ freq: 700, dur: 0.07, type: 'square', vol: 0.09 });
    tone({ freq: 1040, dur: 0.11, type: 'square', vol: 0.07, delay: 0.06 });
  },
  // Refresh / reroll the tavern — the sourced "roll" clip; synth ascending blip fallback until it decodes.
  roll: () => {
    if (playSample('roll', sampleVol.roll)) return;
    [0, 0.04, 0.08].forEach((d, i) => tone({ freq: 380 + i * 60, dur: 0.05, type: 'square', vol: 0.06, delay: d }));
  },
  // A specific card's unique voiceline/SFX — drop `audio/cards/<cardId>.mp3` and it plays when that card is
  // played, LAYERED over the general landing/cast sound. Silent (no fallback) if the card has no clip.
  cardVoice: (cardId: string) => { playSample(`cards/${cardId}`, sampleVol.cardVoice); },
  // A token is summoned — a general "summon" pop (sourced `summon` clip; synth rising blip fallback) LAYERED
  // with the summoned token's own cards/<tokenId>.mp3 voiceline if present. Fires on battlecry summons
  // (recruit, from store.ts) and combat summons (deathrattles etc., from useCombatReplay.ts).
  summon: (tokenId?: string) => {
    if (!playSample('summon', sampleVol.summon)) tone({ freq: 300, dur: 0.12, type: 'triangle', vol: 0.1, slideTo: 520 });
    // Let the summon cue land first, THEN the summoned token's own voiceline (slight overlap is fine).
    if (tokenId) playSample(`cards/${tokenId}`, sampleVol.cardVoice, SUMMON_VOICE_LEAD);
  },
  // A Discover choice opens — the sourced "discover" clip; synth shimmer until it decodes / if absent.
  discover: () => {
    if (playSample('discover', sampleVol.discover)) return;
    chord([523, 784, 1046], { dur: 0.16, type: 'triangle', vol: 0.1 }, 0.05);
  },
  // A friendly minion is GIVEN Taunt — the sourced "taunt" clip; synth thunk until it decodes / if absent.
  taunt: () => {
    if (playSample('taunt', sampleVol.taunt)) return;
    tone({ freq: 220, dur: 0.14, type: 'square', vol: 0.12, slideTo: 160 });
  },
  // A card is repositioned (warband / shop reorder) — the sourced "reordercard" clip; synth tick fallback.
  reorder: () => {
    if (playSample('reordercard', sampleVol.reorder)) return;
    tone({ freq: 440, dur: 0.05, type: 'square', vol: 0.07 });
  },
  // Tavern Up — the sourced "tavernupgrade" clip; synth rising triad fallback until it decodes / if absent.
  upgrade: () => {
    if (playSample('tavernupgrade', sampleVol.upgrade)) return;
    chord([392, 523, 659], { dur: 0.14, type: 'triangle', vol: 0.12 }, 0.07);
  },
  // Choosing a hero / pressing the hero-power button — the sourced "pulse" clip; synth ping fallback.
  pulse: () => {
    if (playSample('pulse', sampleVol.pulse)) return;
    tone({ freq: 1400, dur: 0.1, type: 'sine', vol: 0.12, slideTo: 1900 });
  },
  temper: () => {
    tone({ freq: 1200, dur: 0.06, type: 'square', vol: 0.1 });
    tone({ freq: 1600, dur: 0.12, type: 'sine', vol: 0.12, delay: 0.04 });
  },
  tick: () => tone({ freq: 1040, dur: 0.045, type: 'square', vol: 0.09 }),
  // End Turn → Face the Omen — the sourced "combatStart" clip; synth low sawtooth down-slide fallback.
  combatStart: () => {
    if (playSample('combatStart', sampleVol.combatStart)) return;
    tone({ freq: 200, dur: 0.45, type: 'sawtooth', vol: 0.16, slideTo: 90 });
  },
  attack: () => tone({ freq: 320, dur: 0.08, type: 'sawtooth', vol: 0.1, slideTo: 130 }),
  // A Start-of-Combat effect firing (Ember Whelp's scorch, Blaster, etc.) — a quick magic "zap", distinct
  // from the physical smack so SC damage doesn't read as a melee hit. Synth for now (gets its own clip later).
  cast: () => {
    tone({ freq: 1040, dur: 0.14, type: 'sawtooth', vol: 0.085, slideTo: 360 });
    tone({ freq: 1500, dur: 0.1, type: 'triangle', vol: 0.05, delay: 0.02, slideTo: 900 });
  },
  // Impact in combat — the sourced "Smack" clip (dialed down across passes); synth thud until it decodes.
  // Fired frame-accurately from the lunge's GSAP timeline (see playAttackLunge) so it lands on contact.
  hit: () => {
    if (playSample('smack', sampleVol.smack)) return;
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
  // Soulsman's Avenge raises your max Gold — a bright rising coin shimmer (synth; combat proc).
  maxGold: () => chord([784, 1046, 1318, 1568], { dur: 0.11, type: 'triangle', vol: 0.1 }, 0.045),
  triple: () => chord([523, 659, 784, 1046], { dur: 0.13, type: 'triangle', vol: 0.12 }, 0.06),
  win: () => chord([523, 659, 784, 1046], { dur: 0.2, type: 'triangle', vol: 0.14 }, 0.1),
  lose: () => chord([392, 311, 233], { dur: 0.24, type: 'sawtooth', vol: 0.13 }, 0.12),
} as const;

/** Play a sourced clip by its mixer key (for the dev SFX mixer's preview button). */
const SFX_PREVIEW: Record<string, () => void> = {
  buy: sfx.buy, sell: sfx.sell, smack: sfx.hit, cardlanding: sfx.play,
  discover: sfx.discover, taunt: sfx.taunt, reorder: sfx.reorder, deny: sfx.deny, freeze: sfx.freeze,
  unfreeze: sfx.unfreeze, pulse: sfx.pulse, inspect: sfx.inspect, upgrade: sfx.upgrade, roll: sfx.roll,
  combatStart: sfx.combatStart,
  // cardVoice is per-card; preview plays whichever card clip is present (first one found), or nothing.
  cardVoice: () => {
    const first = Object.keys(SAMPLE_URLS).map(sampleName).find((n) => n.startsWith('cards/'));
    if (first) playSample(first, sampleVol.cardVoice);
  },
  summon: () => sfx.summon(),
};
export function previewSfx(key: string): void {
  SFX_PREVIEW[key]?.();
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
