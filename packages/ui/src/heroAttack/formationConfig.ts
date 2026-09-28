/**
 * THE DAMAGE FORMATION: its tuned values and its pure timeline. Every hero attack (Classic and every cosmetic) opens
 * with it, identically (owner ask 2026-09-28):
 *
 *   "we need to change the dmg numbers / should have the tier section pulse with the number showing up from left to
 *    right / have them all flow up and merge into a single numbere / then the hero tier dmg shows / and joins / or the
 *    minion tier dmg number joins the hero number / and then have the full dmg show / then a moment where it reduces
 *    to the cap / and said damage capped / and then the attack happens / purely a change in how the dmg formation
 *    happens/shows"
 *
 * THE BEATS (base ms before the playback speed):
 *  1. PULSE. Left to right, each surviving minion's tier badge pulses and its number pops up above it, each with a
 *     tick a step higher in pitch. The stagger compresses as the board fills, so a full board never drags.
 *  2. MERGE. The numbers flow UP on an arc into one minion number, which ticks up as each lands and slams on the last.
 *  3. HERO. The attacking hero's tier number pops in at the hero.
 *  4. JOIN. The minion number flies into the hero number (the default; `joinDir` 1 plays the hero into the minions).
 *  5. FULL. The full, uncapped total slams in, big and bold.
 *  6. CAP. Only when the blow was capped: the full number holds, a SLASH hits it (a flash and a jolt; the clock never
 *     stops, owner 2026-09-28) and it crunches down to the cap at once, and a "Damage capped" stamp slams on and holds.
 *  7. The style's attack takes over (`endAt`), carrying the final number to the target.
 *
 * Every number is the ENGINE's (`CombatResult.damageBreakdown` / `enemyDamageBreakdown`, `damageCap`,
 * `playerDamageUncapped`); this file only decides WHEN on screen they happen.
 *
 * Tuner convention (the crate's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. The preview keys are never shipped.
 */

export interface FormationConfig {
  // Timing: the pulses
  pulseStaggerMs: number;
  pulseSpanMs: number;
  pulseMs: number;
  popMs: number;
  popHoldMs: number;
  // Timing: the merge
  mergeFlyMs: number;
  mergeStaggerMs: number;
  mergeSpanMs: number;
  // Timing: the hero and the join
  heroDelayMs: number;
  heroHoldMs: number;
  joinFlyMs: number;
  // Timing: the full number and the cap
  fullHoldMs: number;
  cappedHoldMs: number;
  capMs: number;
  stampAt: number;
  capHoldMs: number;
  reducedFadeMs: number;
  // Look
  joinDir: number;
  pulseStrength: number;
  ringSize: number;
  chipSize: number;
  mergeSize: number;
  heroSize: number;
  fullSize: number;
  stampSize: number;
  stampTilt: number;
  stampPop: number;
  fullPop: number;
  slamMs: number;
  riseLift: number;
  mergeLift: number;
  mergeArc: number;
  joinArc: number;
  capShake: number;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxPulseClip: string; sfxPulseGain: number; sfxPulseRate: number; sfxPulseStep: number;
  sfxFlowClip: string; sfxFlowGain: number; sfxFlowRate: number;
  sfxLandClip: string; sfxLandGain: number; sfxLandRate: number; sfxLandStep: number;
  sfxMergeClip: string; sfxMergeGain: number; sfxMergeRate: number;
  sfxHeroClip: string; sfxHeroGain: number; sfxHeroRate: number;
  sfxJoinClip: string; sfxJoinGain: number; sfxJoinRate: number;
  sfxFullClip: string; sfxFullGain: number; sfxFullRate: number;
  sfxSlashClip: string; sfxSlashGain: number; sfxSlashRate: number;
  sfxCapClip: string; sfxCapGain: number; sfxCapRate: number;
  sfxStampClip: string; sfxStampGain: number; sfxStampRate: number;
  sfxTickLenMs: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewMinions: number;
  previewTierLo: number;
  previewTierHi: number;
  previewHeroTier: number;
  previewCap: number;
}

export const FORMATION_CLIP_KEYS = [
  'sfxPulseClip', 'sfxFlowClip', 'sfxLandClip', 'sfxMergeClip', 'sfxHeroClip', 'sfxJoinClip', 'sfxFullClip', 'sfxSlashClip', 'sfxCapClip', 'sfxStampClip',
] as const;
type ClipKey = (typeof FORMATION_CLIP_KEYS)[number];
export type FormationNumKey = Exclude<keyof FormationConfig, ClipKey>;

const PREVIEW_KEYS = ['previewMinions', 'previewTierLo', 'previewTierHi', 'previewHeroTier', 'previewCap'] as const;

export const FORMATION_DEFAULTS: FormationConfig = {
  // Paced by the owner's first look (2026-09-28): "it needs to slow down between steps slightly so it's a bit more
  // obvious what's happening ... a bit slower and oomphier in general". A clear hold between every stage.
  pulseStaggerMs: 130,
  pulseSpanMs: 450,
  pulseMs: 380,
  popMs: 200,
  popHoldMs: 220,
  mergeFlyMs: 300,
  mergeStaggerMs: 36,
  mergeSpanMs: 140,
  heroDelayMs: 140,
  heroHoldMs: 260,
  // Second review (2026-09-28): "slightly slowing down the combination -> capped speed so it's a bit more readable in
  // general is important too": a longer join, more hold on the full total, a longer count-down, a longer stamp hold.
  joinFlyMs: 320,
  fullHoldMs: 460,
  cappedHoldMs: 520,
  capMs: 520,
  stampAt: 1,
  capHoldMs: 620,
  reducedFadeMs: 220,
  joinDir: 0,
  pulseStrength: 0.5,
  ringSize: 1.15,
  chipSize: 54,
  mergeSize: 88,
  heroSize: 78,
  fullSize: 148,
  stampSize: 32,
  stampTilt: -9,
  stampPop: 2.6,
  fullPop: 2.1,
  slamMs: 380,
  riseLift: 48,
  mergeLift: 150,
  mergeArc: 0.16,
  joinArc: 0.2,
  capShake: 12,
  sfxPulseClip: 'triggerpulse', sfxPulseGain: 0.6, sfxPulseRate: 0.95, sfxPulseStep: 0.08,
  sfxFlowClip: 'TallyTravel', sfxFlowGain: 0.45, sfxFlowRate: 1.05,
  sfxLandClip: 'AttackPillAdd', sfxLandGain: 0.45, sfxLandRate: 1.05, sfxLandStep: 0.05,
  sfxMergeClip: 'tallyimpact', sfxMergeGain: 0.9, sfxMergeRate: 1.1,
  sfxHeroClip: 'AttackPillAdd', sfxHeroGain: 0.7, sfxHeroRate: 0.85,
  sfxJoinClip: 'tallyimpact', sfxJoinGain: 1.15, sfxJoinRate: 0.92,
  sfxFullClip: 'smack2', sfxFullGain: 0.65, sfxFullRate: 0.78,
  sfxSlashClip: 'crit', sfxSlashGain: 0.85, sfxSlashRate: 0.78,
  sfxCapClip: 'smack3', sfxCapGain: 0.6, sfxCapRate: 0.7,
  sfxStampClip: 'equipclang', sfxStampGain: 0.8, sfxStampRate: 0.85,
  sfxTickLenMs: 420,
  previewMinions: 4,
  previewTierLo: 2,
  previewTierHi: 5,
  previewHeroTier: 4,
  previewCap: 10,
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const FORMATION_RANGES: Record<FormationNumKey, [number, number, number]> = {
  pulseStaggerMs: [0, 400, 5],
  pulseSpanMs: [0, 1500, 10],
  pulseMs: [60, 900, 10],
  popMs: [40, 600, 10],
  popHoldMs: [0, 800, 10],
  mergeFlyMs: [80, 900, 10],
  mergeStaggerMs: [0, 200, 2],
  mergeSpanMs: [0, 600, 10],
  heroDelayMs: [-300, 600, 10],
  heroHoldMs: [0, 900, 10],
  joinFlyMs: [80, 900, 10],
  fullHoldMs: [0, 1200, 10],
  cappedHoldMs: [0, 1200, 10],
  capMs: [80, 1500, 10],
  stampAt: [0, 1, 0.05],
  capHoldMs: [0, 1200, 10],
  reducedFadeMs: [60, 1000, 10],
  joinDir: [0, 1, 1],
  pulseStrength: [0, 1.2, 0.01],
  ringSize: [0, 3, 0.05],
  chipSize: [20, 110, 1],
  mergeSize: [30, 160, 1],
  heroSize: [30, 160, 1],
  fullSize: [50, 240, 1],
  stampSize: [12, 70, 1],
  stampTilt: [-30, 30, 1],
  stampPop: [1, 4, 0.05],
  fullPop: [1, 3, 0.01],
  slamMs: [80, 900, 10],
  riseLift: [0, 140, 1],
  mergeLift: [0, 400, 5],
  mergeArc: [0, 0.5, 0.01],
  joinArc: [0, 0.5, 0.01],
  capShake: [0, 30, 0.5],
  sfxPulseGain: [0, 2, 0.05], sfxPulseRate: [0.5, 2, 0.01], sfxPulseStep: [0, 0.3, 0.005],
  sfxFlowGain: [0, 2, 0.05], sfxFlowRate: [0.5, 2, 0.01],
  sfxLandGain: [0, 2, 0.05], sfxLandRate: [0.5, 2, 0.01], sfxLandStep: [0, 0.3, 0.005],
  sfxMergeGain: [0, 2, 0.05], sfxMergeRate: [0.5, 2, 0.01],
  sfxHeroGain: [0, 2, 0.05], sfxHeroRate: [0.5, 2, 0.01],
  sfxJoinGain: [0, 2, 0.05], sfxJoinRate: [0.5, 2, 0.01],
  sfxFullGain: [0, 2, 0.05], sfxFullRate: [0.5, 2, 0.01],
  sfxSlashGain: [0, 2, 0.05], sfxSlashRate: [0.5, 2, 0.01],
  sfxCapGain: [0, 2, 0.05], sfxCapRate: [0.5, 2, 0.01],
  sfxStampGain: [0, 2, 0.05], sfxStampRate: [0.5, 2, 0.01],
  sfxTickLenMs: [80, 2000, 10],
  previewMinions: [0, 7, 1],
  previewTierLo: [1, 7, 1],
  previewTierHi: [1, 7, 1],
  previewHeroTier: [1, 7, 1],
  previewCap: [0, 40, 1],
};

const isClipKey = (k: string): k is ClipKey => (FORMATION_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), clips a short string. */
export function clampFormationValue<K extends keyof FormationConfig>(key: K, value: unknown): FormationConfig[K] | undefined {
  if (!(key in FORMATION_DEFAULTS)) return undefined;
  const def = FORMATION_DEFAULTS[key];
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as FormationConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max, step] = FORMATION_RANGES[key as FormationNumKey];
  const v = Math.min(max, Math.max(min, n));
  // Whole-number dials (counts, direction, tiers) stay whole.
  return (step >= 1 ? Math.round(v) : v) as FormationConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeFormationConfig(saved: unknown): FormationConfig {
  const out: FormationConfig = { ...FORMATION_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampFormationValue(k as keyof FormationConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.dmgformation.v1';

let cfg: FormationConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...FORMATION_DEFAULTS };
  try { return sanitizeFormationConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...FORMATION_DEFAULTS }; }
})();

export function getFormationConfig(): FormationConfig { return cfg; }

export function setFormationValue(key: keyof FormationConfig, value: number | string): void {
  const safe = clampFormationValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetFormationConfig(): void {
  cfg = { ...FORMATION_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function formationConfigJson(c: FormationConfig = cfg): string {
  const ship: Partial<FormationConfig> = { ...c };
  for (const k of PREVIEW_KEYS) delete ship[k];
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const FORMATION_SPEEDS = [1, 0.5, 0.25] as const;
export type FormationSpeed = (typeof FORMATION_SPEEDS)[number];
let speed: FormationSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function formationPreviewSpeed(): FormationSpeed { return import.meta.env.DEV ? speed : 1; }
export function setFormationPreviewSpeed(s: FormationSpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export interface FormationPlanInput {
  /** Surviving minions that add their tier (0..7), left to right. */
  minions: number;
  /** Whether the hero's tier term is known (a result from before 2026-09-28 may carry no breakdown). */
  hero: boolean;
  /** The full blow was reduced to the round cap: plays the cap beat. */
  capped: boolean;
  reduced?: boolean;
}

/** One formation beat, fired by the sequence clock (sound, a badge pulse, a ring). */
export type FormationBeatKind = 'pulse' | 'flow' | 'land' | 'merge' | 'hero' | 'join' | 'full' | 'cap' | 'crunch' | 'stamp';
export interface FormationBeat { at: number; kind: FormationBeatKind; i: number }

export interface FormationPlan {
  reduced: boolean;
  n: number;
  hero: boolean;
  capped: boolean;
  /** The gap between one minion's pulse and the next (compressed as the board fills). */
  stagger: number;
  /** Minion i: its badge pulses and its number pops up. */
  pulses: number[];
  /** Minion i: its number leaves for the merge. */
  flights: number[];
  /** Minion i: its number lands in the minion total. */
  lands: number[];
  /** The last minion lands: the minion total slams. (0 with no minions.) */
  mergeAt: number;
  /** The hero's tier number pops in. */
  heroAt: number;
  /** The join flight: from, and the full number slamming in. */
  joinFrom: number;
  joinAt: number;
  /** The cap: the SLASH lands (`capFrom`) and the count-down starts with it (`crunchAt`, the same beat) and runs to
   *  `capTo`), the stamp slams (all equal to `capTo` when not capped). */
  capFrom: number;
  crunchAt: number;
  capTo: number;
  stampAt: number;
  /** The formation is over: the style's own attack starts here. */
  endAt: number;
  beats: FormationBeat[];
}

const clampN = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The formation for a board. Pure and deterministic. With no minions the pulse and merge beats are skipped (the hero
 * number is the whole blow); with no hero term (an old result) the hero beat is skipped and the minions ARE the total;
 * with neither, the full number simply slams in. Reduced motion keeps every stage but as quick fades, no flight.
 */
export function formationPlan(input: FormationPlanInput, c: FormationConfig = cfg): FormationPlan {
  const n = clampN(Math.round(input.minions) || 0, 0, 7);
  const hero = input.hero;
  const capped = input.capped;
  const beats: FormationBeat[] = [];
  const push = (at: number, kind: FormationBeatKind, i = 0): void => { beats.push({ at: Math.round(at), kind, i }); };

  if (input.reduced) {
    // The same stages, as fades: the minion numbers, then the minion total and the hero, then the full, then the cap.
    const f = c.reducedFadeMs;
    const step = f + 220;
    const pulses = Array.from({ length: n }, () => 0);
    const t1 = n ? step : 0;
    const lands = Array.from({ length: n }, () => t1);
    const heroAt = t1;
    const joinAt = n || hero ? t1 + step : 0;
    const capTo = capped ? joinAt + step : joinAt;
    if (n) { push(0, 'pulse', 0); push(t1, 'merge'); }
    if (hero) push(heroAt, 'hero');
    push(joinAt, 'full');
    if (capped) { push(joinAt + f, 'cap'); push(capTo, 'stamp'); }
    return {
      reduced: true, n, hero, capped, stagger: 0, pulses, flights: lands.slice(), lands, mergeAt: t1, heroAt,
      joinFrom: joinAt, joinAt, capFrom: capped ? joinAt + f : capTo, crunchAt: capped ? joinAt + f : capTo, capTo, stampAt: capTo, endAt: capTo + step, beats: beats.sort((x, y) => x.at - y.at),
    };
  }

  // 1. PULSE: left to right, the stagger compressing so the whole row fits inside `pulseSpanMs`.
  const stagger = n > 1 ? Math.min(c.pulseStaggerMs, c.pulseSpanMs / (n - 1)) : 0;
  const pulses = Array.from({ length: n }, (_, i) => i * stagger);
  // 2. MERGE: they leave together after the last one has popped and held, a hair apart, and land in order.
  const lastPop = n ? pulses[n - 1]! + c.popMs : 0;
  const mStagger = n > 1 ? Math.min(c.mergeStaggerMs, c.mergeSpanMs / (n - 1)) : 0;
  const mergeFrom = n ? lastPop + c.popHoldMs : 0;
  const flights = Array.from({ length: n }, (_, i) => mergeFrom + i * mStagger);
  const lands = flights.map((f) => f + c.mergeFlyMs);
  const mergeAt = n ? lands[n - 1]! : 0;
  // 3. HERO: pops in as the minion total settles (a negative delay overlaps the last landing).
  const heroAt = hero ? Math.max(0, mergeAt + (n ? c.heroDelayMs : 0)) : mergeAt;
  // 4. JOIN: after the hero number has been read. With only one term there is nothing to join: it becomes the full.
  const both = n > 0 && hero;
  const settle = hero ? heroAt + c.popMs + c.heroHoldMs : mergeAt + c.heroHoldMs;
  const joinFrom = both ? Math.max(settle, mergeAt + 60) : settle;
  const joinAt = both ? joinFrom + c.joinFlyMs : joinFrom;
  // 5-6. FULL, then the CAP (only when capped).
  const capFrom = capped ? joinAt + c.cappedHoldMs : joinAt + c.fullHoldMs;
  const crunchAt = capFrom; // the count-down starts on the slash: nothing ever freezes
  const capTo = capped ? crunchAt + c.capMs : capFrom;
  const stampAt = capped ? crunchAt + c.capMs * c.stampAt : capTo;
  const endAt = capped ? capTo + c.capHoldMs : capFrom;

  pulses.forEach((at, i) => push(at, 'pulse', i));
  if (n) push(mergeFrom, 'flow');
  lands.forEach((at, i) => { if (i < n - 1) push(at, 'land', i); });
  if (n) push(mergeAt, 'merge');
  if (hero) push(heroAt, 'hero');
  if (both) push(joinAt, 'join');
  push(joinAt, 'full');
  if (capped) { push(capFrom, 'cap'); push(crunchAt, 'crunch'); push(stampAt, 'stamp'); }
  return {
    reduced: false, n, hero, capped, stagger, pulses, flights, lands, mergeAt, heroAt, joinFrom, joinAt, capFrom, crunchAt, capTo, stampAt,
    endAt, beats: beats.sort((x, y) => x.at - y.at),
  };
}

/** A formation beat as a sequence cue: `i` indexes `FormationPlan.beats`. */
export interface FormationCue { at: number; kind: 'form'; i: number }

/** The formation's beats as sequence cues, for a style to merge in. */
export function formationCues(p: FormationPlan): FormationCue[] {
  return p.beats.map((b, i) => ({ at: b.at, kind: 'form' as const, i }));
}

/**
 * Merge the formation's cues in front of a style's own (stable: on a tie, formation beats first, then the style's in
 * its own order). Every style runs ONE clock for both.
 */
export function withFormation<Q extends { at: number; kind: string; i: number }>(p: FormationPlan, style: readonly Q[]): (Q | FormationCue)[] {
  const form = formationCues(p);
  const out: (Q | FormationCue)[] = [];
  let a = 0, b = 0;
  while (a < form.length || b < style.length) {
    if (b >= style.length || (a < form.length && form[a]!.at <= style[b]!.at)) out.push(form[a++]!);
    else out.push(style[b++]!);
  }
  return out;
}
