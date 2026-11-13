/**
 * THE POWER CHORD HERO ATTACK: its tuned values, its pure timeline, the pure geometry (the staff, the speaker) and the
 * pure camera.
 *
 * Power Chord is an EPIC (2026-11-12; scaffolded from Storm Call by `npm run attack:new`, then rebuilt): one idea,
 * VISIBLE SOUND. A five-line musical STAFF is strung between the two heroes like plucked strings; music notes ride it to
 * the struck hero; and on the top look the striking hero ITSELF becomes the speaker and blows a bass wave down it. No
 * other attack draws a staff, a note or a sound wave. Everything is light: glowing strings, glowing notes, rings and
 * wave fronts. There is no drawn prop (the first pass's speaker stack was cut in the second pass).
 *
 * THE THREE VISUAL TIERS. Every hero attack reads its tier from the shared `attackTier` (the owner-approved thresholds I
 * 1-5 / II 6-11 / III 12-19 / IV 20+, and a knockout always plays IV). An Epic maps those four onto three looks here
 * (`chordLevel`, the way Storm Call maps them): I -> SMALL, II and III -> MEDIUM, IV -> BIG.
 *  - SMALL ("the note"). The staff strings itself from the striker to the struck portrait (five lines drawn in fast, one
 *    after another, each twanging as it pulls taut). The hero plucks, and ONE big glossy note rides the middle line to the
 *    target, the line shivering behind it, and bursts on the portrait in a ring of small notes. THE blow.
 *  - MEDIUM ("the chord"). The staff strings out and THREE notes, stacked on three different lines, travel together and
 *    land at once: a brighter burst, and every line of the staff thrums (a damped vibration along its whole length).
 *  - BIG ("the drop"). The staff strings out while the striking portrait POWERS UP as a speaker: rings of light settle
 *    round it. It pumps three times (the count-in: the portrait swells, rings punch out of it, each pump pops notes onto
 *    the staff, a kick drum each time, harder each time). Then a short INHALE (the rings pull in, the view holds its
 *    breath), and THE DROP: a train of thick BASS WAVE fronts rolls out of the portrait to the struck hero, bending the
 *    staff hard as it crosses, sweeping the waiting notes away and dragging streaks of air with it. The first front
 *    reaching the portrait is THE blow: a flash, the view thumped, the portrait blown back hard (a shove and a skew,
 *    like a hair dryer), pinned and fluttering while the next two fronts batter it again, then it springs upright.
 *
 * The damage formation (shared) opens every attack; this style starts where it ends. The consequence lands exactly
 * ONCE, on the impact beat. No hit-stop. Reduced motion: no staff, shake or zoom; the numbers fade and the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always plays
 * DEFAULTS.
 */
import { clamp, hexToNum, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { hexToNum, type TierNum };

export const CHORD_LEVELS = [1, 2, 3] as const;
export type ChordLevel = (typeof CHORD_LEVELS)[number];
export const CHORD_LEVEL_NAMES: Record<ChordLevel, string> = { 1: 'Small', 2: 'Medium', 3: 'Big' };

/** The shared four damage tiers mapped onto Power Chord's three looks: I small, II and III medium, IV (and a knockout) big. */
export function chordLevel(tier: TierNum): ChordLevel {
  return tier <= 1 ? 1 : tier >= 4 ? 3 : 2;
}

/** A staff has five lines. */
export const STAFF_LINES = 5;

/** The per-look dials. A config key is `v1..v3` + one of these. */
export const CHORD_LEVEL_SUFFIXES = [
  'ChargeMs', 'FlyMs', 'NoteSize', 'Notes', 'Sparks', 'HoldMs',
  'Shake', 'Zoom', 'Punch', 'Burst', 'SettleMs', 'Dim',
] as const;
export type ChordLevelSuffix = (typeof CHORD_LEVEL_SUFFIXES)[number];
type LevelKey = `v${ChordLevel}${ChordLevelSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  // Ready
  absorbMs: number;
  heroCoilPx: number;
  heroThrustPx: number;
  // The staff
  staffGap: number;
  staffSag: number;
  staffWidth: number;
  staffGlow: number;
  stringMs: number;
  stringStaggerMs: number;
  pluckPx: number;
  thrumPx: number;
  vibHz: number;
  vibMs: number;
  slackMs: number;
  // The chord (Medium)
  chordSpread: number;
  // The speaker (Big): the striking portrait itself
  beatMs: number;
  inhaleMs: number;
  pumpScale: number;
  echoes: number;
  echoGapMs: number;
  waveBands: number;
  waveSize: number;
  bendPx: number;
  blowSkew: number;
  blowPx: number;
  // Camera and portraits
  flashAlpha: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorStaff: string;
  colorNoteA: string;
  colorNoteB: string;
  colorNoteC: string;
  colorWave: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound
  sfxStringClip: string; sfxStringGain: number; sfxStringRate: number;
  sfxPluckClip: string; sfxPluckGain: number; sfxPluckRate: number;
  sfxStrumClip: string; sfxStrumGain: number; sfxStrumRate: number;
  sfxBassClip: string; sfxBassGain: number; sfxBassRate: number;
  sfxThudClip: string; sfxThudGain: number; sfxThudRate: number;
  sfxPumpClip: string; sfxPumpGain: number; sfxPumpRate: number;
  sfxRiserClip: string; sfxRiserGain: number; sfxRiserRate: number;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only
  previewDamage: number;
  previewParts: number;
}
export type HeroChordConfig = GlobalConfig & Record<LevelKey, number>;

export const HERO_CHORD_COLOR_KEYS = ['colorStaff', 'colorNoteA', 'colorNoteB', 'colorNoteC', 'colorWave', 'colorPlayer', 'colorFoe'] as const;
export const HERO_CHORD_CLIP_KEYS = [
  'sfxStringClip', 'sfxPluckClip', 'sfxStrumClip', 'sfxBassClip', 'sfxThudClip', 'sfxPumpClip', 'sfxRiserClip', 'sfxWhooshClip', 'sfxImpactClip',
] as const;
type ColorKey = (typeof HERO_CHORD_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_CHORD_CLIP_KEYS)[number];
export type HeroChordStrKey = ColorKey | ClipKey;
export type HeroChordNumKey = Exclude<keyof HeroChordConfig, HeroChordStrKey>;

/** Small, Medium, Big per suffix: the escalation ladder. (Big's ChargeMs is the beat before the speaker powers up.) */
const LEVEL_DEFAULTS: Record<ChordLevelSuffix, [number, number, number]> = {
  ChargeMs: [400, 420, 120],
  FlyMs: [300, 320, 400],
  NoteSize: [1.8, 1.35, 0.7],
  Notes: [8, 14, 18],
  Sparks: [10, 16, 26],
  HoldMs: [240, 480, 900],
  Shake: [6, 11, 30],
  Zoom: [0.02, 0.035, 0.055],
  Punch: [0.018, 0.03, 0.085],
  Burst: [1, 1.2, 1.7],
  SettleMs: [240, 280, 300],
  Dim: [0.22, 0.34, 0.56],
};

export const CHORD_LEVEL_RANGES: Record<ChordLevelSuffix, [number, number, number]> = {
  ChargeMs: [60, 1500, 10],
  FlyMs: [80, 1200, 10],
  NoteSize: [0.3, 2.5, 0.01],
  Notes: [0, 30, 1],
  Sparks: [0, 50, 1],
  HoldMs: [0, 1500, 10],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.12, 0.002],
  Punch: [0, 0.1, 0.001],
  Burst: [0.3, 3, 0.05],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const levelDefaults = Object.fromEntries(CHORD_LEVELS.flatMap((v) => CHORD_LEVEL_SUFFIXES.map((s) => [`v${v}${s}`, LEVEL_DEFAULTS[s][v - 1]]))) as Record<LevelKey, number>;

export const HERO_CHORD_DEFAULTS: HeroChordConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroCoilPx: 7,
  heroThrustPx: 12,
  staffGap: 24,
  staffSag: 0.035,
  staffWidth: 9,
  staffGlow: 5,
  stringMs: 170,
  stringStaggerMs: 34,
  pluckPx: 10,
  thrumPx: 20,
  vibHz: 15,
  vibMs: 210,
  slackMs: 260,
  chordSpread: 0.045,
  beatMs: 270,
  inhaleMs: 140,
  pumpScale: 0.06,
  echoes: 2,
  echoGapMs: 250,
  waveBands: 3,
  waveSize: 1.45,
  bendPx: 64,
  blowSkew: 26,
  blowPx: 58,
  flashAlpha: 0.9,
  knockPx: 18,
  squash: 0.09,
  shakeMs: 460,
  zoomOutMs: 460,
  reducedFadeMs: 260,
  colorStaff: '#fff3d1',
  colorNoteA: '#ffd24a',
  colorNoteB: '#ff6fae',
  colorNoteC: '#66dcff',
  colorWave: '#cfeaff',
  colorPlayer: '#ffc94a',
  colorFoe: '#ff6a5c',
  // The staff stringing itself: the pluck clip, quiet, once per line, walking up a scale (see the runner).
  sfxStringClip: 'fx/chord-pluck', sfxStringGain: 0.3, sfxStringRate: 1.5,
  sfxPluckClip: 'fx/chord-pluck', sfxPluckGain: 0.85, sfxPluckRate: 1,
  // The power chord: full and distorted, with its sustain.
  sfxStrumClip: 'fx/chord-strum', sfxStrumGain: 0.8, sfxStrumRate: 1,
  // The sub-bass drop (it falls from about 110 Hz to 30 Hz), with an octave above it so small speakers carry it too.
  sfxBassClip: 'fx/chord-bass', sfxBassGain: 1.1, sfxBassRate: 1,
  sfxThudClip: 'fx/heavy-rock-impact', sfxThudGain: 0.6, sfxThudRate: 0.8,
  // The count-in: a kick drum on every pump (and a soft one under every landing).
  sfxPumpClip: 'fx/chord-kick', sfxPumpGain: 1.1, sfxPumpRate: 1,
  // The amp's feedback swelling through the count-in; it peaks on the drop.
  sfxRiserClip: 'fx/chord-feedback', sfxRiserGain: 0.28, sfxRiserRate: 0.75,
  // The air the wave pushes.
  sfxWhooshClip: 'fx/whoosh-03', sfxWhooshGain: 0.7, sfxWhooshRate: 0.8,
  sfxImpactClip: 'flurryhit', sfxImpactGain: 0.8, sfxImpactRate: 1.05,
  sfxImpactLenMs: 700,
  sfxTailMix: 0.12,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...levelDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroChordStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroCoilPx: [0, 40, 1],
  heroThrustPx: [0, 50, 1],
  staffGap: [6, 48, 0.5],
  staffSag: [0, 0.15, 0.005],
  staffWidth: [1, 16, 0.1],
  staffGlow: [1, 10, 0.1],
  stringMs: [40, 800, 10],
  stringStaggerMs: [0, 150, 1],
  pluckPx: [0, 30, 0.5],
  thrumPx: [0, 40, 0.5],
  vibHz: [4, 40, 0.5],
  vibMs: [40, 900, 10],
  slackMs: [60, 1200, 10],
  chordSpread: [0, 0.15, 0.005],
  beatMs: [120, 600, 5],
  inhaleMs: [0, 600, 10],
  pumpScale: [0, 0.2, 0.005],
  echoes: [0, 3, 1],
  echoGapMs: [120, 600, 10],
  waveBands: [1, 4, 1],
  waveSize: [0.4, 2, 0.05],
  bendPx: [0, 120, 1],
  blowSkew: [0, 40, 0.5],
  blowPx: [0, 120, 1],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxStringGain: [0, 2, 0.01], sfxStringRate: [0.5, 2.5, 0.01],
  sfxPluckGain: [0, 2, 0.01], sfxPluckRate: [0.5, 2.5, 0.01],
  sfxStrumGain: [0, 2, 0.01], sfxStrumRate: [0.5, 2.5, 0.01],
  sfxBassGain: [0, 2, 0.01], sfxBassRate: [0.3, 2.5, 0.01],
  sfxThudGain: [0, 2, 0.01], sfxThudRate: [0.3, 2.5, 0.01],
  sfxPumpGain: [0, 2, 0.01], sfxPumpRate: [0.3, 2.5, 0.01],
  sfxRiserGain: [0, 2, 0.01], sfxRiserRate: [0.3, 2.5, 0.01],
  sfxWhooshGain: [0, 2, 0.01], sfxWhooshRate: [0.3, 2.5, 0.01],
  sfxImpactGain: [0, 2, 0.01], sfxImpactRate: [0.5, 2.5, 0.01],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_CHORD_RANGES: Record<HeroChordNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(CHORD_LEVELS.flatMap((v) => CHORD_LEVEL_SUFFIXES.map((s) => [`v${v}${s}`, CHORD_LEVEL_RANGES[s]]))) as Record<LevelKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say. */
export const CHORD_CAPS = { notes: 30, sparks: 50, bands: 4, shakePx: 40, zoom: 0.12, echoes: 3 } as const;

/** Big's count-in: how many times the speaker pumps before the drop, and the beat between powering up and the first. */
export const COUNT_IN = 3;
export const AMP_LEAD_MS = 240;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_CHORD_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_CHORD_CLIP_KEYS as readonly string[]).includes(k);

export function clampHeroChordValue<K extends keyof HeroChordConfig>(key: K, value: unknown): HeroChordConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_CHORD_DEFAULTS, key)) return undefined;
  const def = HERO_CHORD_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroChordConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroChordConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_CHORD_RANGES[key as HeroChordNumKey];
  return Math.min(max, Math.max(min, n)) as HeroChordConfig[K];
}

export function sanitizeHeroChordConfig(saved: unknown): HeroChordConfig {
  const out: HeroChordConfig = { ...HERO_CHORD_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroChordValue(k as keyof HeroChordConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

// v2: the keys changed when the scaffold (a copy of Storm Call) became Power Chord. v3: the second pass (no speaker stack).
const KEY = 'ascent.herochord.v3';

let cfg: HeroChordConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_CHORD_DEFAULTS };
  try { return sanitizeHeroChordConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_CHORD_DEFAULTS }; }
})();

export function getHeroChordConfig(): HeroChordConfig { return cfg; }

export function setHeroChordValue(key: keyof HeroChordConfig, value: number | string): void {
  const safe = clampHeroChordValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroChordConfig(): void {
  cfg = { ...HERO_CHORD_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function heroChordConfigJson(c: HeroChordConfig = cfg): string {
  const ship: Partial<HeroChordConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

/** The preview speed. Previews always play at 1x (owner 2026-09-29: no Speed buttons on the attack tuners). */
export function heroChordPreviewSpeed(): number { return 1; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export function chordLevelDials(level: ChordLevel, c: HeroChordConfig = cfg): Record<ChordLevelSuffix, number> {
  return Object.fromEntries(CHORD_LEVEL_SUFFIXES.map((s) => [s, c[`v${level}${s}`]])) as Record<ChordLevelSuffix, number>;
}

/** A note that rides the staff to the struck hero. */
export interface RiderPlan {
  /** Which staff line it rides (0 = the first, 4 = the last). */
  line: number;
  /** It leaves the striker's end of the staff. */
  at: number;
  /** How long the ride takes. */
  flyMs: number;
  /** How far behind the lead note it sits along the staff (0..1 of the staff's length). */
  lag: number;
  /** Which of the three note colours it wears (0..2). */
  hue: number;
}

export interface ChordPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export interface ChordPlan {
  reduced: boolean;
  /** The SHARED damage tier (1..4; a knockout is 4). */
  tier: TierNum;
  /** Power Chord's look: 1 small (the note), 2 medium (the chord), 3 big (the drop). */
  level: ChordLevel;
  k: number;
  total: number;
  /** The staff starts stringing itself. */
  chargeAt: number;
  absorbEnd: number;
  /** The last staff line is pulled taut. */
  stringEnd: number;
  /** The hero plays: the notes leave (Small, Medium) or the bass wave leaves the speakers (Big). */
  releaseAt: number;
  /** The notes riding the staff (Small one, Medium three, Big none: the wave carries its own). */
  riders: RiderPlan[];
  /** How long the ride (or the wave's crossing) takes. */
  flyMs: number;
  /**
   * Big: the striking portrait is the SPEAKER. It powers up at `ampAt` (rings of light settle round it), pumps on each of
   * `pumps` (the count-in), pulls in for the inhale from `inhaleAt`, and the wave leaves at `releaseAt`.
   */
  speaker: boolean;
  ampAt: number;
  pumps: number[];
  inhaleAt: number;
  /** THE consequence beat: the note or the chord lands, or the bass wave reaches the struck portrait. */
  impactAt: number;
  /** Big: when each LATER front of the wave train reaches the struck portrait (FX only; it left `flyMs` earlier). */
  echoes: number[];
  /** The staff goes slack and fades from here (the speaker's rings fade with it). */
  slackAt: number;
  endAt: number;
  noteSize: number;
  /** Small notes thrown by the burst. */
  notes: number;
  sparks: number;
  shakePx: number;
  zoom: number;
  punch: number;
  burst: number;
  dim: number;
}

/** The whole Power Chord, in base ms. Pure and deterministic. */
export function chordPlan(input: ChordPlanInput, c: HeroChordConfig = cfg): ChordPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays Tier IV (heroAttack/tiers.ts), so Big
  const level = chordLevel(tier);
  const V = chordLevelDials(level, c);
  const k = (level - 1) / 2;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, level, k, total, chargeAt: impactAt, absorbEnd: impactAt, stringEnd: impactAt, releaseAt: impactAt, riders: [],
      flyMs: 0, speaker: false, ampAt: impactAt, pumps: [], inhaleAt: impactAt, impactAt, echoes: [], slackAt: impactAt, endAt: r.endAt,
      noteSize: 0, notes: 0, sparks: 0, shakePx: 0, zoom: 0, punch: 0, burst: 0, dim: 0,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const stringEnd = chargeAt + c.stringMs + c.stringStaggerMs * (STAFF_LINES - 1);
  const speaker = level === 3;
  const flyMs = V.FlyMs;
  let releaseAt: number;
  let ampAt = chargeAt, inhaleAt = chargeAt;
  let pumps: number[] = [];
  let riders: RiderPlan[] = [];

  if (!speaker) {
    // The staff is taut before the hero plays, whatever the sliders say.
    releaseAt = Math.max(chargeAt + V.ChargeMs, stringEnd + 40, absorbEnd);
    riders = level === 1
      ? [{ line: 2, at: releaseAt, flyMs, lag: 0, hue: 0 }]
      // A chord: three heads stacked on three lines, fanned a touch along the staff so each one reads.
      : [0, 2, 4].map((line, i) => ({ line, at: releaseAt, flyMs, lag: c.chordSpread * (2 - i), hue: i }));
  } else {
    // The count-in: power up, then pump, pump, pump one beat apart; the next beat is held a little longer (the
    // inhale), and then THE DROP.
    ampAt = chargeAt + V.ChargeMs;
    pumps = Array.from({ length: COUNT_IN }, (_, i) => ampAt + AMP_LEAD_MS + i * c.beatMs);
    inhaleAt = pumps[COUNT_IN - 1]! + c.beatMs;
    releaseAt = inhaleAt + c.inhaleMs;
  }
  const impactAt = releaseAt + flyMs;
  // The wave is a TRAIN of fronts: the later ones reach the struck portrait a steady gap after the first.
  const echoes = speaker ? Array.from({ length: Math.round(clamp(c.echoes, 0, CHORD_CAPS.echoes)) }, (_, i) => impactAt + (i + 1) * c.echoGapMs) : [];
  const slackAt = Math.max(impactAt + V.HoldMs, (echoes[echoes.length - 1] ?? impactAt) + 200);
  const lastBeat = Math.max(impactAt + 160, impactAt + c.zoomOutMs * 0.8, slackAt + c.slackMs * 0.7);
  const endAt = lastBeat + V.SettleMs;

  return {
    reduced: false, tier, level, k, total, chargeAt, absorbEnd, stringEnd, releaseAt, riders, flyMs, speaker, ampAt, pumps, inhaleAt,
    impactAt, echoes, slackAt, endAt,
    noteSize: V.NoteSize,
    notes: Math.round(clamp(V.Notes, 0, CHORD_CAPS.notes)),
    sparks: Math.round(clamp(V.Sparks, 0, CHORD_CAPS.sparks)),
    shakePx: clamp(V.Shake, 0, CHORD_CAPS.shakePx),
    zoom: clamp(V.Zoom, 0, CHORD_CAPS.zoom),
    punch: V.Punch,
    burst: V.Burst,
    dim: V.Dim,
  };
}

/** `echo` fires when a later front of the wave train LEAVES the speaker (it arrives `flyMs` later, at `plan.echoes[i]`). */
export type ChordCueKind = 'charge' | 'amp' | 'pump' | 'inhale' | 'release' | 'echo' | 'impact' | 'slack' | 'end';
export interface ChordCue { at: number; kind: ChordCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order). */
export function chordCues(p: ChordPlan): ChordCue[] {
  const out: ChordCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    if (p.speaker) {
      out.push({ at: p.ampAt, kind: 'amp', i: 0 });
      p.pumps.forEach((at, i) => out.push({ at, kind: 'pump', i }));
      out.push({ at: p.inhaleAt, kind: 'inhale', i: 0 });
    }
    out.push({ at: p.releaseAt, kind: 'release', i: 0 });
    p.echoes.forEach((at, i) => out.push({ at: at - p.flyMs, kind: 'echo', i }));
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  if (!p.reduced) out.push({ at: p.slackAt, kind: 'slack', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<ChordCueKind, number> = { charge: 0, amp: 1, pump: 2, inhale: 3, release: 4, echo: 5, impact: 6, slack: 7, end: 8 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the geometry (pure) ─────────────────────────────────────────────────────────────────────────────────────

/** The view (the impact's flash covers it). */
export interface ViewBox { w: number; h: number }

/** The speaker: the striking portrait itself (its centre and its radius, px). */
export interface SpeakerGeo { x: number; y: number; r: number }

export interface ChordGeo {
  /** The staff's two ends: the striker's rim and a point inside the struck face. Null under reduced motion. */
  from: Pt | null;
  to: Pt | null;
  /** The unit vector across the staff (its lines are spaced along it), chosen to point DOWN the screen: the sag's way. */
  across: Pt;
  /** The gap between two staff lines (px). */
  gap: number;
  /** Where THE blow lands on the struck portrait (the burst, the hit flash). */
  hit: Pt;
  /** Big: the speaker (the striking portrait), and the point its bass wave rolls out from (its centre). */
  speaker: SpeakerGeo | null;
  waveFrom: Pt | null;
}

/**
 * The staff and the speaker, from the plan and the two heroes. The staff runs from the striker's rim to a point inside
 * the struck face (so a note lands ON the portrait); its lines are spaced `staffGap` apart across it. On Big the
 * striking portrait itself is the speaker: the bass wave rolls out from its centre. Pure: a replay strings the same staff.
 */
export function chordGeometry(p: ChordPlan, a: Pt, d: Pt, radius: number, aRadius: number, c: Pick<HeroChordConfig, 'staffGap'>, scale = 1): ChordGeo {
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  let across = { x: -u.y, y: u.x };
  if (across.y < 0 || (across.y === 0 && across.x < 0)) across = { x: -across.x, y: -across.y };
  const hit = { x: d.x - u.x * radius * 0.3, y: d.y - u.y * radius * 0.3 };
  if (p.reduced) return { from: null, to: null, across, gap: 0, hit: { x: d.x, y: d.y }, speaker: null, waveFrom: null };
  const from = { x: a.x + u.x * aRadius * 0.9, y: a.y + u.y * aRadius * 0.9 };
  const gap = c.staffGap * scale;
  const speaker: SpeakerGeo | null = p.speaker ? { x: a.x, y: a.y, r: aRadius } : null;
  const waveFrom: Pt | null = p.speaker ? { x: a.x, y: a.y } : null;
  return { from, to: hit, across, gap, hit, speaker, waveFrom };
}

/** The direction THE blow arrives along (down the staff; on Big the wave takes the same line): the shake and the knockback follow it. Unit. */
export function chordArrivalDir(g: ChordGeo, a: Pt, d: Pt): Pt {
  const from = g.waveFrom ?? a;
  const L = Math.hypot(d.x - from.x, d.y - from.y) || 1;
  return { x: (d.x - from.x) / L, y: (d.y - from.y) / L };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const DOWN: Pt = { x: 0, y: 1 };
const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The camera at sequence time `t`: a small push in while the staff strings out (Big: through the count-in, with a thump
 * straight down on each pump, harder each time, and the push eased OFF through the inhale so the drop punches back in);
 * on THE impact a punch in and a shake along the blow (Big: slower and longer, and a smaller thump as each later front
 * of the wave train arrives). Deterministic. Pure.
 */
export function chordCameraAt(p: ChordPlan, c: HeroChordConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    if (p.speaker) {
      // Pushed in through the count-in, let go through the inhale (the view holds its breath), thrown in with the wave.
      z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.inhaleAt - p.chargeAt)) * (1 - 0.7 * sine((t - p.inhaleAt) / Math.max(1, p.releaseAt - p.inhaleAt)));
      if (t >= p.releaseAt) z += p.zoom * 1.1 * sine((t - p.releaseAt) / Math.max(1, p.impactAt - p.releaseAt));
    } else z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.releaseAt - p.chargeAt));
  } else if (t >= p.impactAt) {
    z += (p.zoom * (p.speaker ? 1.4 : 1) + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
    for (const at of p.echoes) if (t >= at) z += p.punch * 0.35 * Math.exp(-(t - at) / 90);
  }
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number, v: Pt): void => {
    const age = t - at;
    if (age < 0) return;
    const s = springAt(age, hz, tau);
    const across = amp * 0.25 * Math.sin(age * 0.11) * Math.exp(-age / tau);
    x += v.x * amp * s - v.y * across;
    y += v.y * amp * s + v.x * across;
  };
  if (p.speaker) {
    for (let i = 0; i < p.pumps.length; i++) kick(p.pumps[i]!, p.shakePx * (0.14 + 0.06 * i), 55, 13, DOWN);
    kick(p.releaseAt, p.shakePx * 0.3, 60, 13, { x: -dir.x, y: -dir.y }); // the recoil of the drop
    for (const at of p.echoes) kick(at, p.shakePx * 0.38, 70, 13, dir);
  }
  // Big's blow is a bass hit: slower, and it rolls on for longer.
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / (p.speaker ? 3 : 4)), p.speaker ? 12 : 16, dir);
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** Where the camera anchors: the ATTACKER while the staff strings out (Big: through the count-in), the struck hero once the hero plays. Pure. */
export function chordCameraFocus(p: ChordPlan, t: number, a: Pt, d: Pt): Pt {
  const from = p.speaker ? p.inhaleAt : p.chargeAt + (p.releaseAt - p.chargeAt) * 0.4;
  const to = p.speaker ? p.releaseAt + p.flyMs * 0.6 : p.releaseAt;
  if (t <= from) return a;
  if (t >= to) return d;
  const e = sine((t - from) / Math.max(1, to - from));
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
