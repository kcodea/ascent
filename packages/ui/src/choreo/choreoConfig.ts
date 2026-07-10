import type { MomentKind } from './kinds';

/**
 * Tunable parameters for the combat-replay CHOREOGRAPHY TIMING — the beat clock in `useCombatReplay.ts`. The
 * replay plays the deterministic fight one "beat" at a time (an action + its result events); this config sets
 * how long the clock lingers on each beat type, so the fight's RHYTHM can be dialed by eye via the DEV
 * Choreography panel (`ChoreographyPanel.tsx`) without a code round-trip. The scheduler reads `getChoreoConfig()` at each beat, so
 * changes apply to the next beat. This module supersedes the old pacing-config module (choreographer phase 2
 * relocation) — same values, same behavior, new home under `choreo/`.
 *
 * Layering (all multiply/divide cleanly, so they don't fight):
 *   beat hold (ms) = delay[beatType] × `speed` ÷ combatSpeed
 * where `speed` is this dev baseline (was the hardcoded `SPEED = 1.5`) and `combatSpeed` is the player's
 * in-combat speed slider. The floats + final hold divide by combatSpeed only.
 *
 * NOTE — the `attack` (wind-up) beat's hold is NOT taken from `attack` here: it's overridden by the lunge's
 * connection time (windupDur + strikeDur − smackLead, from lungeConfig.ts) so the damage float always lands
 * ON contact however you dial pacing. The `attack` value below is only the extra breather ADDED before a NEW
 * swing that follows an impact (the "don't blur back-to-back attacks" gap). Everything else is a straight
 * linger. So retuning `speed`/the delays never desyncs the impact — that stays welded to the lunge.
 */
export interface ChoreoConfig {
  /** Global tempo baseline — scales every beat hold (higher = slower, more deliberate; was the fixed 1.5). */
  speed: number;
  // Action beats (the wind-up / cast held before its result shows).
  /** Breather added before a NEW swing that follows an impact (see NOTE — not the wind-up hold itself). */
  attack: number;
  /** Start-of-combat effect beat. */
  sc: number;
  /** Summon (a token/minion appears). */
  summon: number;
  /** Buff / stat-gain beat. */
  buff: number;
  /** Reborn (a unit returns). */
  reborn: number;
  /** Improve / ascend beat. */
  improve: number;
  /** Rally beat. */
  rally: number;
  /** Return-to-hand beat. */
  toHand: number;
  /** Max-gold beat. */
  maxGold: number;
  /** HP-grant beat (silent by default). */
  hpGrant: number;
  // Result beats (the impact — how long it reads before the next swing).
  /** Damage lands (recoil + HP drop) — the post-hit read. */
  dmg: number;
  /** Divine-shield absorb. */
  shield: number;
  /** Shield gained. */
  shieldUp: number;
  /** Poison tick. */
  poison: number;
  /** Venom consumed. */
  venomLost: number;
  /** A unit dies — the collapse read. */
  death: number;
  // Overlay lifetimes (divide by combatSpeed only, not by `speed`).
  /** How long a combat damage/heal float lingers before it clears (ms; keep ≥ the floatup CSS anim). */
  floatMs: number;
  /** A killing-blow float clears faster — a lone number over a vanished unit shouldn't hang (ms). */
  deathFloatMs: number;
  /** Hold on the LAST beat (death collapse + float) before the replay reports done (ms). */
  finalHold: number;
  /** Consequence-overlap (ms): a CONSEQUENCE beat (a summon appearing, a Reborn re-forming) starts this many
   *  ms after the preceding beat instead of waiting its full linger, so it rides on the preceding action's
   *  fire-and-forget FX — the death → summon → reborn chain plays NEARLY IN TANDEM. Scaled by combatSpeed only
   *  (not `speed`), like the overlay lifetimes. See `holdMs` (clock.ts). */
  overlapMs: number;
}

const DEFAULTS: ChoreoConfig = {
  speed: 1.5,
  // action beats (ms) — mirror the former DELAY table exactly, so defaults = current behaviour.
  attack: 353, sc: 720, summon: 440, buff: 140, reborn: 640, improve: 520, rally: 720, toHand: 820,
  maxGold: 560, hpGrant: 0,
  // result beats (ms)
  dmg: 460, shield: 460, shieldUp: 460, poison: 500, venomLost: 500, death: 400,
  // overlay lifetimes (ms)
  floatMs: 1500, deathFloatMs: 1000, finalHold: 900,
  // consequence-overlap: a summon/reborn rides on the preceding FX after this short gap (nearly in tandem) —
  // long enough that a Deathrattle's skull/burst reads before its summons pop in.
  overlapMs: 240,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const CHOREO_RANGES: Record<keyof ChoreoConfig, [number, number, number]> = {
  speed: [0.5, 3, 0.05],
  attack: [0, 1200, 10], sc: [0, 1200, 10], summon: [0, 1200, 10], buff: [0, 1200, 10],
  reborn: [0, 1200, 10], improve: [0, 1200, 10], rally: [0, 1200, 10], toHand: [0, 1200, 10],
  maxGold: [0, 1200, 10], hpGrant: [0, 1200, 10],
  dmg: [0, 1200, 10], shield: [0, 1200, 10], shieldUp: [0, 1200, 10], poison: [0, 1200, 10],
  venomLost: [0, 1200, 10], death: [0, 1200, 10],
  floatMs: [400, 3000, 50], deathFloatMs: [300, 2000, 50], finalHold: [200, 2000, 50],
  overlapMs: [0, 600, 10],
};
export const CHOREO_KEYS = Object.keys(DEFAULTS) as (keyof ChoreoConfig)[];

const KEY = 'ascent.pacing';
let cfg: ChoreoConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<ChoreoConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getChoreoConfig(): ChoreoConfig {
  return cfg;
}
/** The per-beat hold (ms) BEFORE the global `speed`/combatSpeed scaling — a typed lookup by beat type
 *  that falls back to 300 for any unlisted type (matches the former `DELAY[type] ?? 300`). */
export function beatDelay(type: string): number {
  const v = (cfg as unknown as Record<string, number>)[type];
  return typeof v === 'number' ? v : 300;
}
export function setChoreoValue(key: keyof ChoreoConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
export function resetChoreoConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** The pre-scale hold (ms) a moment KIND should reproduce — phase 2 mirrors the representative pacing key so
 *  on-screen timing is byte-identical (the clock actually keys by primary event type; this is the kind-facing
 *  view the score will use from phase 4). damage→dmg, shieldPop→shield, poisonTick→poison, death/rise→death;
 *  ascend/keyword
 *  have no own pacing key today (they fell through beatDelay's 300 default) so they map to a related key with
 *  an intentional value rather than the bare fallback. */
// `keyof ChoreoConfig` (not `string`) so a typo'd/non-existent key is a compile error, not a silent fall to
// the 300 default. NOTE: this and `momentKind` (kinds.ts) encode the kind↔event-type relationship in OPPOSITE
// directions (classify-forward vs hold-lookup-backward) — adding a `MomentKind` variant requires updating both
// (the `Record<MomentKind, …>` here forces this side exhaustively).
const KIND_TO_KEY: Record<MomentKind, keyof ChoreoConfig> = {
  attackExchange: 'attack', damage: 'dmg', shieldPop: 'shield', poisonTick: 'poison',
  death: 'death', riseDeath: 'death', scCast: 'sc',
  summon: 'summon', buffWave: 'buff', reborn: 'reborn', ascend: 'improve', rally: 'rally',
  toHand: 'toHand', maxGold: 'maxGold', improve: 'improve', keyword: 'buff', hpGrant: 'hpGrant', reveal: 'summon',
};
export function holdMsForKind(kind: MomentKind): number {
  return beatDelay(KIND_TO_KEY[kind]);
}
