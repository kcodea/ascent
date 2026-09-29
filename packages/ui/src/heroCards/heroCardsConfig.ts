/**
 * THE CARD SHARK HERO ATTACK: its tuned values, its pure timeline, the pure card paths, the hand fan and the pure
 * camera.
 *
 * Owner 2026-09-29: "build 5 animations that range from rare -> epic. all of the animations we have done so far are
 * legendary. rare and epics should only have 2 or 3 tiers to them and generally be less exciting, but still extremely
 * clean and fun. get creative". Card Shark is an EPIC: one strong idea (the hero deals playing cards with a snap), three
 * visual tiers, short to medium, no giant cinematic.
 *
 * THE THREE VISUAL TIERS. Every hero attack reads its tier from the shared `attackTier` (the owner-approved damage
 * thresholds I 1-5 / II 6-11 / III 12-19 / IV 20+, and a knockout always plays IV). An Epic maps those four onto its
 * three looks here (`cardsLevel`, local to this style): I -> SMALL, II and III -> MEDIUM, IV -> BIG. It reads like a
 * poker hand climbing the ranks:
 *  - SMALL (high card). One card, the Ace of spades, is drawn and flicked spinning into the struck hero, where it sticks
 *    edge first with a little flash. That card is THE impact.
 *  - MEDIUM (three of a kind). Three Aces are thrown in quick sequence, thunk thunk thunk, each sticking at its own
 *    angle round the face. The first two are TICKS (FX and sound only); the third is THE impact.
 *  - BIG (a royal flush). Five cards are dealt face down into a hand fanned out in front of the hero. They flip over one
 *    by one (10, J, Q, K, A of spades), the faces turn to GOLD with a shine sweeping across, then all five fire together
 *    and burst into card confetti on the struck hero. The burst is THE impact.
 *
 * The damage formation (shared, `../heroAttack/damageFormation.ts`) opens every attack; this style starts where it ends.
 * The consequence (the damage, Armor, Resolve) lands exactly ONCE, on the impact beat. No hit-stop anywhere. Reduced
 * motion: no cards, shake or zoom; the numbers fade and the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always plays
 * DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { clamp, hexToNum, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { hexToNum, type TierNum };

/** Card Shark's three looks. */
export const CARD_LEVELS = [1, 2, 3] as const;
export type CardLevel = (typeof CARD_LEVELS)[number];
export const CARD_LEVEL_NAMES: Record<CardLevel, string> = { 1: 'Small', 2: 'Medium', 3: 'Big' };

/** The shared four damage tiers mapped onto Card Shark's three looks: I small, II and III medium, IV (and a knockout) big. */
export function cardsLevel(tier: TierNum): CardLevel {
  return tier <= 1 ? 1 : tier >= 4 ? 3 : 2;
}

/** The per-look dials. A config key is `v1..v3` + one of these. */
export const CARDS_LEVEL_SUFFIXES = [
  'ChargeMs', 'Cards', 'StaggerMs', 'FlightMs', 'Arc', 'Fan', 'Spins', 'CardSize',
  'Shake', 'Zoom', 'Punch', 'Sparks', 'Burst', 'SettleMs', 'Dim',
] as const;
export type CardsLevelSuffix = (typeof CARDS_LEVEL_SUFFIXES)[number];
type LevelKey = `v${CardLevel}${CardsLevelSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  // Ready
  absorbMs: number;
  heroCoilPx: number;
  heroFlickPx: number;
  // Cards
  cardLength: number;
  cardGlow: number;
  ghostAlpha: number;
  embed: number;
  quiver: number;
  stickHoldMs: number;
  // The royal flush (Big)
  dealMs: number;
  dealStaggerMs: number;
  flipMs: number;
  flipStaggerMs: number;
  goldMs: number;
  holdMs: number;
  fanSize: number;
  fanReach: number;
  fanSpread: number;
  confetti: number;
  confettiGravity: number;
  // Camera and portraits
  flashAlpha: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorIvory: string;
  colorRed: string;
  colorGold: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxDrawClip: string; sfxDrawGain: number; sfxDrawRate: number;
  sfxFlickClip: string; sfxFlickGain: number; sfxFlickRate: number;
  sfxSnapClip: string; sfxSnapGain: number; sfxSnapRate: number;
  sfxThunkClip: string; sfxThunkGain: number; sfxThunkRate: number;
  sfxPunchClip: string; sfxPunchGain: number; sfxPunchRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxDealClip: string; sfxDealGain: number; sfxDealRate: number;
  sfxFlipClip: string; sfxFlipGain: number; sfxFlipRate: number;
  sfxRevealClip: string; sfxRevealGain: number; sfxRevealRate: number;
  sfxBurstClip: string; sfxBurstGain: number; sfxBurstRate: number;
  sfxSparkleClip: string; sfxSparkleGain: number; sfxSparkleRate: number;
  sfxFlickLenMs: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroCardsConfig = GlobalConfig & Record<LevelKey, number>;

export const HERO_CARDS_COLOR_KEYS = ['colorIvory', 'colorRed', 'colorGold', 'colorPlayer', 'colorFoe'] as const;
export const HERO_CARDS_CLIP_KEYS = [
  'sfxDrawClip', 'sfxFlickClip', 'sfxSnapClip', 'sfxThunkClip', 'sfxPunchClip', 'sfxImpactClip', 'sfxBigClip',
  'sfxDealClip', 'sfxFlipClip', 'sfxRevealClip', 'sfxBurstClip', 'sfxSparkleClip',
] as const;
type ColorKey = (typeof HERO_CARDS_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_CARDS_CLIP_KEYS)[number];
export type HeroCardsStrKey = ColorKey | ClipKey;
export type HeroCardsNumKey = Exclude<keyof HeroCardsConfig, HeroCardsStrKey>;

/** Small, Medium, Big per suffix: the escalation ladder. */
const LEVEL_DEFAULTS: Record<CardsLevelSuffix, [number, number, number]> = {
  ChargeMs: [320, 360, 380],
  Cards: [1, 3, 5],
  StaggerMs: [0, 130, 0],
  FlightMs: [260, 270, 300],
  Arc: [0.07, 0.08, 0.05],
  Fan: [0, 0.06, 0.08],
  Spins: [2.5, 2, 1.25],
  CardSize: [1.1, 1, 1],
  Shake: [5, 8, 15],
  Zoom: [0.02, 0.035, 0.055],
  Punch: [0.015, 0.025, 0.05],
  Sparks: [10, 14, 26],
  Burst: [1, 1.15, 1.7],
  SettleMs: [260, 300, 320],
  Dim: [0, 0.18, 0.4],
};

export const CARDS_LEVEL_RANGES: Record<CardsLevelSuffix, [number, number, number]> = {
  ChargeMs: [80, 1500, 10],
  Cards: [1, 7, 1],
  StaggerMs: [0, 400, 5],
  FlightMs: [120, 1200, 10],
  Arc: [0, 0.4, 0.01],
  Fan: [0, 0.3, 0.01],
  Spins: [0, 6, 0.25],
  CardSize: [0.4, 2.5, 0.05],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.12, 0.002],
  Punch: [0, 0.1, 0.001],
  Sparks: [0, 60, 1],
  Burst: [0.3, 3, 0.05],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const levelDefaults = Object.fromEntries(CARD_LEVELS.flatMap((v) => CARDS_LEVEL_SUFFIXES.map((s) => [`v${v}${s}`, LEVEL_DEFAULTS[s][v - 1]]))) as Record<LevelKey, number>;

export const HERO_CARDS_DEFAULTS: HeroCardsConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps Card Shark up where every style steps up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroCoilPx: 8,
  heroFlickPx: 12,
  cardLength: 104,
  cardGlow: 0.55,
  ghostAlpha: 0.26,
  embed: 0.28,
  quiver: 0.14,
  stickHoldMs: 420,
  dealMs: 180,
  dealStaggerMs: 60,
  flipMs: 150,
  flipStaggerMs: 55,
  goldMs: 260,
  holdMs: 140,
  fanSize: 1.3,
  fanReach: 2.1,
  fanSpread: 15,
  confetti: 14,
  confettiGravity: 700,
  flashAlpha: 0.85,
  knockPx: 14,
  squash: 0.08,
  shakeMs: 300,
  zoomOutMs: 340,
  reducedFadeMs: 260,
  colorIvory: '#fff6e3',
  colorRed: '#c8203a',
  colorGold: '#ffc83a',
  colorPlayer: '#ffd76a',
  colorFoe: '#ff5a6e',
  sfxDrawClip: 'cardtouch', sfxDrawGain: 0.5, sfxDrawRate: 1,
  sfxFlickClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxFlickGain: 0.42, sfxFlickRate: 1.8,
  sfxSnapClip: 'fx/universfield-whip-snap-242215', sfxSnapGain: 0.22, sfxSnapRate: 1.8,
  sfxThunkClip: 'fel-spike-echo-land', sfxThunkGain: 0.5, sfxThunkRate: 1.25,
  sfxPunchClip: 'smack1', sfxPunchGain: 0.28, sfxPunchRate: 1.3,
  sfxImpactClip: 'flurryhit', sfxImpactGain: 0.55, sfxImpactRate: 1,
  sfxBigClip: 'crit', sfxBigGain: 0.34, sfxBigRate: 1.1,
  sfxDealClip: 'cardlanding', sfxDealGain: 0.45, sfxDealRate: 1.25,
  sfxFlipClip: 'reordercard', sfxFlipGain: 0.4, sfxFlipRate: 1.3,
  sfxRevealClip: 'triplereward', sfxRevealGain: 0.42, sfxRevealRate: 1,
  sfxBurstClip: 'turnexplosion', sfxBurstGain: 0.4, sfxBurstRate: 1.45,
  sfxSparkleClip: 'fx/djartmusic-christmas-sparkle-whoosh-1-275404', sfxSparkleGain: 0.34, sfxSparkleRate: 1.1,
  sfxFlickLenMs: 260,
  sfxImpactLenMs: 800,
  sfxTailMix: 0.1,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...levelDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroCardsStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroCoilPx: [0, 40, 1],
  heroFlickPx: [0, 50, 1],
  cardLength: [40, 240, 1],
  cardGlow: [0, 1.5, 0.05],
  ghostAlpha: [0, 0.8, 0.01],
  embed: [0, 0.5, 0.01],
  quiver: [0, 0.6, 0.01],
  stickHoldMs: [100, 2000, 10],
  dealMs: [60, 800, 10],
  dealStaggerMs: [0, 300, 5],
  flipMs: [60, 600, 10],
  flipStaggerMs: [0, 300, 5],
  goldMs: [60, 1200, 10],
  holdMs: [0, 1000, 10],
  fanSize: [0.5, 2.5, 0.05],
  fanReach: [0.8, 4, 0.05],
  fanSpread: [2, 25, 0.5],
  confetti: [0, 30, 1],
  confettiGravity: [0, 3000, 20],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxDrawGain: [0, 2, 0.05], sfxDrawRate: [0.5, 2.5, 0.01],
  sfxFlickGain: [0, 2, 0.05], sfxFlickRate: [0.5, 2.5, 0.01],
  sfxSnapGain: [0, 2, 0.05], sfxSnapRate: [0.5, 2.5, 0.01],
  sfxThunkGain: [0, 2, 0.05], sfxThunkRate: [0.5, 2.5, 0.01],
  sfxPunchGain: [0, 2, 0.05], sfxPunchRate: [0.5, 2.5, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2.5, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2.5, 0.01],
  sfxDealGain: [0, 2, 0.05], sfxDealRate: [0.5, 2.5, 0.01],
  sfxFlipGain: [0, 2, 0.05], sfxFlipRate: [0.5, 2.5, 0.01],
  sfxRevealGain: [0, 2, 0.05], sfxRevealRate: [0.5, 2.5, 0.01],
  sfxBurstGain: [0, 2, 0.05], sfxBurstRate: [0.5, 2.5, 0.01],
  sfxSparkleGain: [0, 2, 0.05], sfxSparkleRate: [0.5, 2.5, 0.01],
  sfxFlickLenMs: [80, 1500, 10],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_CARDS_RANGES: Record<HeroCardsNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(CARD_LEVELS.flatMap((v) => CARDS_LEVEL_SUFFIXES.map((s) => [`v${v}${s}`, CARDS_LEVEL_RANGES[s]]))) as Record<LevelKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays clean, not cluttered). */
export const CARDS_CAPS = { cards: 7, sparks: 60, confetti: 30, shakePx: 40, zoom: 0.12 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_CARDS_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_CARDS_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroCardsValue<K extends keyof HeroCardsConfig>(key: K, value: unknown): HeroCardsConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_CARDS_DEFAULTS, key)) return undefined;
  const def = HERO_CARDS_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroCardsConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroCardsConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_CARDS_RANGES[key as HeroCardsNumKey];
  return Math.min(max, Math.max(min, n)) as HeroCardsConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroCardsConfig(saved: unknown): HeroCardsConfig {
  const out: HeroCardsConfig = { ...HERO_CARDS_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroCardsValue(k as keyof HeroCardsConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.herocards.v1';

let cfg: HeroCardsConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_CARDS_DEFAULTS };
  try { return sanitizeHeroCardsConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_CARDS_DEFAULTS }; }
})();

export function getHeroCardsConfig(): HeroCardsConfig { return cfg; }

export function setHeroCardsValue(key: keyof HeroCardsConfig, value: number | string): void {
  const safe = clampHeroCardsValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroCardsConfig(): void {
  cfg = { ...HERO_CARDS_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroCardsConfigJson(c: HeroCardsConfig = cfg): string {
  const ship: Partial<HeroCardsConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

/** The preview speed. Previews always play at 1x (owner 2026-09-29: no Speed buttons on the attack tuners). */
export function heroCardsPreviewSpeed(): number { return 1; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One look's dials, read out of the config. */
export function cardsLevelDials(level: CardLevel, c: HeroCardsConfig = cfg): Record<CardsLevelSuffix, number> {
  return Object.fromEntries(CARDS_LEVEL_SUFFIXES.map((s) => [s, c[`v${level}${s}`]])) as Record<CardsLevelSuffix, number>;
}

/** The reference distance the flight times are tuned at (a 1080p board, corner to corner). */
export const CARDS_REF_DISTANCE = 1600;

/** Card flight for a distance: the look's time, scaled gently by the distance (a sandbox box stays readable). */
export function cardsFlightMs(distance: number, levelMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : CARDS_REF_DISTANCE;
  return Math.round(levelMs * clamp(Math.sqrt(d / CARDS_REF_DISTANCE), 0.62, 1.15));
}

/** The throw order of a fan of `n`: outer cards first, the centre one last (the last to land, THE impact, flies straightest). */
export function fanSlots(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [-1, 1];
  const out: number[] = [];
  const half = Math.floor(n / 2);
  for (let k = half; k >= 1; k--) { out.push(-k); out.push(k); }
  if (n % 2 === 1) out.push(0);
  return out.slice(0, n);
}

/** The faces drawn (spades unless said): A = Ace, K / Q / J, T = the 10. */
export const CARD_FACES = ['AS', 'AH', 'AD', 'TS', 'JS', 'QS', 'KS'] as const;
export type CardFace = (typeof CARD_FACES)[number];

/** Which faces a look throws: high card (the Ace of spades), three of a kind (three Aces), the royal flush. */
export function facesFor(level: CardLevel, n: number): CardFace[] {
  const set: readonly CardFace[] = level === 1 ? ['AS'] : level === 2 ? ['AH', 'AD', 'AS'] : ['TS', 'JS', 'QS', 'KS', 'AS'];
  // The last card thrown always shows the set's last face (the Ace of spades lands the blow).
  return Array.from({ length: n }, (_, i) => set[(set.length - n + i + set.length * 8) % set.length]!);
}

export interface CardPlan {
  throwAt: number;
  flightMs: number;
  arriveAt: number;
  /** How high the arc rises (a fraction of the distance, toward the top of the screen). */
  lift: number;
  /** How far the arc swings to one side of the line (a fraction of the distance; signed). */
  side: number;
  /** The fan slot (signed; 0 = the centre line). */
  slot: number;
  /** Whole turns the card spins in flight. */
  spins: number;
  /** Size multiplier (the last is a touch bigger). */
  size: number;
  face: CardFace;
}

export interface CardsPlanInput extends AttackTierContext {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** Screen px between the attacker's and the defender's centres. */
  distance: number;
  reduced?: boolean;
}

export interface CardsPlan {
  reduced: boolean;
  /** The SHARED damage tier (1..4; a knockout is 4). */
  tier: TierNum;
  /** Card Shark's look: 1 small, 2 medium, 3 big. */
  level: CardLevel;
  /** 0..1 across the looks (small 0, big 1). */
  k: number;
  total: number;
  /** The ready starts: the total sinks into the hero, a card is drawn. */
  chargeAt: number;
  absorbEnd: number;
  /** The first card leaves the hand (Big: all five fire together). */
  throwAt: number;
  cards: CardPlan[];
  /** Big: the royal flush is dealt, revealed and gilded before it fires. */
  flush: boolean;
  /** Big: each card is dealt into the fan (it leaves the hero), and lands there `dealMs` later. */
  deals: number[];
  /** Big: each card starts to flip face up. */
  flips: number[];
  /** Big: the faces turn to gold (the shine sweeps). */
  goldAt: number;
  /** Cards that land BEFORE the impact: the rhythm ticks (Medium only). */
  hits: number[];
  /** THE consequence beat: the last card sticks (Small, Medium) or the flush bursts (Big). */
  impactAt: number;
  /** Small, Medium: the stuck cards fall away. */
  dissolveAt: number;
  endAt: number;
  size: number;
  shakePx: number;
  zoom: number;
  punch: number;
  sparks: number;
  burst: number;
  dim: number;
}

/** The whole Card Shark, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function cardsPlan(input: CardsPlanInput, c: HeroCardsConfig = cfg): CardsPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays Tier IV (heroAttack/tiers.ts), so Big
  const level = cardsLevel(tier);
  const V = cardsLevelDials(level, c);
  const k = (level - 1) / 2;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, level, k, total, chargeAt: impactAt, absorbEnd: impactAt, throwAt: impactAt, cards: [], flush: false,
      deals: [], flips: [], goldAt: impactAt, hits: [], impactAt, dissolveAt: impactAt, endAt: r.endAt,
      size: 0, shakePx: 0, zoom: 0, punch: 0, sparks: 0, burst: 0, dim: 0,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const flush = level === 3;
  const count = clamp(Math.round(V.Cards), 1, CARDS_CAPS.cards);
  const faces = facesFor(level, count);
  const slots = fanSlots(count);
  const maxSlot = Math.max(1, ...slots.map((s) => Math.abs(s)));
  let throwAt: number;
  let deals: number[] = [];
  let flips: number[] = [];
  let goldAt: number;
  let cards: CardPlan[];

  if (!flush) {
    throwAt = chargeAt + Math.max(V.ChargeMs, c.absorbMs);
    goldAt = throwAt;
    const flight = cardsFlightMs(input.distance, V.FlightMs);
    cards = slots.map((slot, i) => {
      const at = throwAt + i * V.StaggerMs;
      const lift = V.Arc * (1 - 0.2 * (Math.abs(slot) / maxSlot));
      const side = (slot / maxSlot) * V.Fan;
      const fl = Math.round(flight * (1 + 0.04 * Math.abs(slot)));
      return { throwAt: at, flightMs: fl, arriveAt: at + fl, lift, side, slot, spins: V.Spins, size: i === count - 1 && count > 1 ? 1.08 : 1, face: faces[i]! };
    });
    // Keep the throw order's rhythm on arrival (thunk, thunk, thunk): each lands at least `gap` after the one before.
    const gap = count > 1 ? Math.max(70, V.StaggerMs * 0.85) : 0;
    for (let i = 1; i < cards.length; i++) {
      const d = cards[i]!, prev = cards[i - 1]!;
      if (gap && d.arriveAt < prev.arriveAt + gap) { d.flightMs += prev.arriveAt + gap - d.arriveAt; d.arriveAt = d.throwAt + d.flightMs; }
    }
  } else {
    // THE ROYAL FLUSH: dealt face down into a fan, flipped one by one, gilded, held a beat, then fired together.
    const dealStart = chargeAt + Math.max(V.ChargeMs * 0.6, c.absorbMs);
    deals = Array.from({ length: count }, (_, i) => dealStart + i * c.dealStaggerMs);
    const flipStart = deals[deals.length - 1]! + c.dealMs + 60;
    flips = Array.from({ length: count }, (_, i) => flipStart + i * c.flipStaggerMs);
    goldAt = flips[flips.length - 1]! + c.flipMs + 40;
    throwAt = goldAt + c.goldMs + c.holdMs;
    // From the fan (about a third of the way over) the volley flies the rest; all five land TOGETHER.
    const flight = cardsFlightMs(input.distance * 0.75, V.FlightMs);
    cards = Array.from({ length: count }, (_, i) => {
      const slot = i - (count - 1) / 2;
      return {
        throwAt, flightMs: flight, arriveAt: throwAt + flight, lift: V.Arc, side: (slot / Math.max(1, (count - 1) / 2)) * V.Fan, slot,
        spins: V.Spins, size: 1, face: faces[i]!,
      };
    });
  }

  const lastIn = Math.max(...cards.map((d) => d.arriveAt));
  const impactAt = lastIn;
  const hits = flush ? [] : cards.slice(0, -1).map((d) => d.arriveAt).sort((a, b) => a - b);
  const dissolveAt = flush ? impactAt : impactAt + c.stickHoldMs;
  // The stuck cards fall away and the confetti settles AFTER the end (the scene drains on its own), so the fight never
  // waits on a falling card.
  const lastBeat = Math.max(impactAt + 160, impactAt + c.zoomOutMs * 0.8, flush ? impactAt + 420 : dissolveAt);
  const endAt = lastBeat + V.SettleMs;

  return {
    reduced: false, tier, level, k, total, chargeAt, absorbEnd, throwAt, cards, flush, deals, flips, goldAt, hits, impactAt,
    dissolveAt, endAt,
    size: V.CardSize,
    shakePx: clamp(V.Shake, 0, CARDS_CAPS.shakePx),
    zoom: clamp(V.Zoom, 0, CARDS_CAPS.zoom),
    punch: V.Punch,
    sparks: Math.round(clamp(V.Sparks, 0, CARDS_CAPS.sparks)),
    burst: V.Burst,
    dim: V.Dim,
  };
}

export type CardsCueKind = 'charge' | 'deal' | 'flip' | 'gold' | 'throw' | 'hit' | 'impact' | 'dissolve' | 'end';
export interface CardsCue { at: number; kind: CardsCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a hit precedes the impact). */
export function cardsCues(p: CardsPlan): CardsCue[] {
  const out: CardsCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.deals.forEach((at, i) => out.push({ at, kind: 'deal', i }));
    p.flips.forEach((at, i) => out.push({ at, kind: 'flip', i }));
    if (p.flush) out.push({ at: p.goldAt, kind: 'gold', i: 0 });
    p.cards.forEach((d, i) => out.push({ at: d.throwAt, kind: 'throw', i }));
    if (!p.flush) {
      p.cards.forEach((d, i) => { if (i < p.cards.length - 1) out.push({ at: d.arriveAt, kind: 'hit', i }); });
      out.push({ at: p.dissolveAt, kind: 'dissolve', i: 0 });
    }
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<CardsCueKind, number> = { charge: 0, deal: 1, flip: 2, gold: 3, throw: 4, hit: 5, impact: 6, dissolve: 7, end: 8 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the hand fan (pure) ──────────────────────────────────────────────────────────────────────────────────────

/** One card's pose in the fanned hand: its centre and its screen rotation (radians; 0 = upright). */
export interface FanPose { x: number; y: number; rot: number }

/** The view the fan must stay inside (the screen, or the sandbox box). */
export interface ViewBox { w: number; h: number }

/**
 * Where the Big hand fans out: in front of the striking hero, toward the target, UPRIGHT on screen like a hand held up
 * to show, fanned round a pivot below it. `cardH` is a card's height in px. The whole fan is shifted to stay inside the
 * view (a hero in a corner still shows every card). Pure.
 */
export function fanPoses(n: number, a: Pt, d: Pt, aRadius: number, cardH: number, c: Pick<HeroCardsConfig, 'fanReach' | 'fanSpread'>, view: ViewBox | null = null): FanPose[] {
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const reach = Math.min(aRadius * c.fanReach, L * 0.45);
  const F = { x: a.x + u.x * reach, y: a.y + u.y * reach };
  const R = cardH * 2;
  const spread = (c.fanSpread * Math.PI) / 180;
  const poses: FanPose[] = [];
  for (let i = 0; i < n; i++) {
    const th = (i - (n - 1) / 2) * spread;
    // The pivot sits R below the fan's centre card, so the centre card's centre is F.
    poses.push({ x: F.x + Math.sin(th) * R, y: F.y + R - Math.cos(th) * R, rot: th });
  }
  if (view && view.w > 0 && view.h > 0) {
    const m = cardH * 0.62;
    const xs = poses.map((p) => p.x), ys = poses.map((p) => p.y);
    let dx = 0, dy = 0;
    const lo = Math.min(...xs) - m, hi = Math.max(...xs) + m;
    if (lo < 0) dx = -lo; else if (hi > view.w) dx = view.w - hi;
    const top = Math.min(...ys) - m, bot = Math.max(...ys) + m;
    if (top < 0) dy = -top; else if (bot > view.h) dy = view.h - bot;
    if (dx || dy) for (const p of poses) { p.x += dx; p.y += dy; }
  }
  return poses;
}

/**
 * Small and Medium: where the drawn cards are held before they are flicked, just off the striker's rim toward the
 * target, fanned a little by slot and held upright (tilted a touch per slot). Pure.
 */
export function heldPoses(p: CardsPlan, a: Pt, d: Pt, aRadius: number): FanPose[] {
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const nrm = sideNormal(a, d);
  return p.cards.map((cp) => ({
    x: a.x + u.x * aRadius * 0.8 + nrm.x * cp.slot * aRadius * 0.16,
    y: a.y + u.y * aRadius * 0.8 + nrm.y * cp.slot * aRadius * 0.16,
    rot: cp.slot * 0.2 + (u.x >= 0 ? 0.12 : -0.12),
  }));
}

// ─── the card paths (pure) ────────────────────────────────────────────────────────────────────────────────────

/**
 * A card's whole flight. `a` its centre as it leaves (the hand, or its fan pose), `c` the arc's control point, `b` its
 * centre when it has stuck, `aim` the contact point on the struck face, `h` the heading it sticks along. It spins
 * `spin` radians in flight and ends at `rot` (its leading short edge buried along `h`); `rot0` is how it starts.
 */
export interface CardMotion { a: Pt; c: Pt; b: Pt; aim: Pt; h: number; flightMs: number; rot0: number; rot: number; spin: number }

/** A flick: fast out of the hand and still quick into the target (it thunks). */
export const cardEase = (u: number): number => { const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0)); return 0.84 * t + 0.16 * t * t; };

function quad(a: Pt, c: Pt, b: Pt, e: number): Pt {
  const m = 1 - e;
  return { x: m * m * a.x + 2 * m * e * c.x + e * e * b.x, y: m * m * a.y + 2 * m * e * c.y + e * e * b.y };
}

const wrap = (x: number): number => Math.atan2(Math.sin(x), Math.cos(x));

/** Where a card's centre is `t` ms after it leaves, and its rotation. Pure: the scene samples it back in time for ghosts. */
export function cardPos(m: CardMotion, t: number): { x: number; y: number; rot: number } {
  if (t <= 0) return { x: m.a.x, y: m.a.y, rot: m.rot0 };
  if (t >= m.flightMs) return { x: m.b.x, y: m.b.y, rot: m.rot };
  const e = cardEase(t / m.flightMs);
  const p = quad(m.a, m.c, m.b, e);
  // Spin at a steady rate (in the eased progress) and finish exactly on the stick rotation.
  const delta = wrap(m.rot0 - m.rot) - m.spin;
  return { x: p.x, y: p.y, rot: m.rot + delta * (1 - e) };
}

/** The side normal of a line (a fixed turn of its direction), so a signed `side` always swings the same way. */
export function sideNormal(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: -dy / d, y: dx / d };
}

/** A small fixed pseudo-random per index (no state): the same hand sticks the same way. */
const jitter = (i: number, salt: number): number => { const s = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453; return s - Math.floor(s) - 0.5; };

/**
 * Where each card hits the struck portrait (offsets from its centre, in portrait radii). Small and Medium stick on the
 * side of the face that looks back at the thrower, fanned by slot and swung clear of the big `-N`; the Big flush
 * converges on a tight ring round the middle, where it bursts. Pure.
 */
export function cardStickOffset(p: CardsPlan, i: number, a: Pt, d: Pt, avoid: Pt | null = null): Pt {
  const n = p.cards.length;
  if (p.flush) {
    const ang = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
    return { x: Math.cos(ang) * 0.26, y: Math.sin(ang) * 0.26 };
  }
  let back = Math.atan2(a.y - d.y, a.x - d.x);
  if (avoid && Math.hypot(avoid.x - d.x, avoid.y - d.y) > 1) {
    const av = Math.atan2(avoid.y - d.y, avoid.x - d.x);
    let diff = wrap(back - av);
    // A card is big and its body trails back along its flight, so it needs a wide berth from the -N (it pops on the
    // side the cards come from).
    const need = 1.85 + (n > 1 ? 0.45 : 0);
    if (Math.abs(diff) < need) { const sgn = diff === 0 ? 1 : Math.sign(diff); diff = sgn * need; back = av + diff; }
  }
  const slot = p.cards[i]?.slot ?? 0;
  const maxSlot = Math.max(1, ...p.cards.map((x) => Math.abs(x.slot)));
  const ang = back + (n === 1 ? 0.2 : (slot / maxSlot) * 0.7) + jitter(i, 1) * 0.12;
  const r = 0.5 + 0.1 * jitter(i, 2);
  return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
}

/**
 * Every card's whole flight, from the plan and the two heroes. `cardH` is a thrown card's height in px (the look's size
 * folded in by the caller). `fan` is the Big hand's poses (each card leaves from its own). The arc never rises above
 * `ceilY`. `avoid` is where the big -N pops. Pure, so a replay flies the same paths.
 */
export function cardMotions(
  p: CardsPlan, a: Pt, d: Pt, radius: number, aRadius: number, cardH: number, c: Pick<HeroCardsConfig, 'embed'>,
  ceilY = Number.NEGATIVE_INFINITY, avoid: Pt | null = null, fan: readonly FanPose[] | null = null,
): CardMotion[] {
  if (p.reduced) return [];
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const nrm = sideNormal(a, d);
  const spinSign = u.x >= 0 ? 1 : -1;
  return p.cards.map((cp, i) => {
    const off = cardStickOffset(p, i, a, d, avoid);
    const aim = { x: d.x + off.x * radius, y: d.y + off.y * radius };
    const pose = fan?.[i];
    const rel = pose ? { x: pose.x, y: pose.y } : { x: a.x + u.x * aRadius * 0.8 + nrm.x * cp.slot * aRadius * 0.14, y: a.y + u.y * aRadius * 0.8 + nrm.y * cp.slot * aRadius * 0.14 };
    const ex = aim.x - rel.x, ey = aim.y - rel.y;
    const D = Math.hypot(ex, ey) || 1;
    const mid = { x: (rel.x + aim.x) / 2, y: (rel.y + aim.y) / 2 };
    const ctrl = { x: mid.x + nrm.x * cp.side * D, y: Math.max(ceilY, mid.y - cp.lift * D + nrm.y * cp.side * D) };
    // The heading it sticks along, with a little per-card wobble (never parallel), and none on the converging flush.
    const h = Math.atan2(aim.y - ctrl.y, aim.x - ctrl.x) + (p.flush ? 0 : jitter(i, 5) * (p.cards.length > 1 ? 0.55 : 0.3));
    const H = cardH * cp.size;
    // The leading short edge is buried `embed` of the card past the contact point, so the centre sits a little short of it.
    const back = H * (0.5 - c.embed);
    const b = { x: aim.x - Math.cos(h) * back, y: aim.y - Math.sin(h) * back };
    const rot = h + Math.PI / 2;
    const rot0 = pose ? pose.rot : rot + jitter(i, 7) * 0.8;
    return { a: rel, c: ctrl, b, aim, h, flightMs: cp.flightMs, rot0, rot, spin: spinSign * cp.spins * Math.PI * 2 };
  });
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The camera at sequence time `t`: a small push in through the ready (Big: through the deal and the reveal, with a
 * little bump when the faces turn gold); a tiny recoil on each throw; a kick ALONG the card on each tick; on THE impact
 * a punch in and a directional shake. Deterministic. Pure.
 */
export function cardsCameraAt(p: CardsPlan, c: HeroCardsConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.throwAt - p.chargeAt));
    if (p.flush && t >= p.goldAt) z += p.zoom * 0.5 * Math.max(0, springAt(t - p.goldAt, 3, 160));
  } else if (t >= p.impactAt) {
    z += (p.zoom * (p.flush ? 1.6 : 1) + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  }
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number, v: Pt): void => {
    const age = t - at;
    if (age < 0) return;
    const s = springAt(age, hz, tau);
    const across = amp * 0.2 * Math.sin(age * 0.09) * Math.exp(-age / tau);
    x += v.x * amp * s - v.y * across;
    y += v.y * amp * s + v.x * across;
  };
  p.cards.forEach((d, i) => { if (!p.flush || i === 0) kick(d.throwAt, -p.shakePx * 0.1, 40, 14, dir); });
  p.hits.forEach((at, i) => kick(at, p.shakePx * (0.3 + 0.05 * i), 40, 18, dir));
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, dir);
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER through the ready (Big: the fanned hand through the reveal), following the
 * cards in flight, and the DEFENDER from the first landing on. A zoom anchored on a point keeps that point still. Pure.
 */
export function cardsCameraFocus(p: CardsPlan, t: number, a: Pt, d: Pt, hand: Pt | null = null): Pt {
  const from = p.flush && hand ? hand : a;
  const settle = p.cards.length ? Math.min(...p.cards.map((x) => x.arriveAt)) : p.impactAt;
  if (p.flush && hand && t < p.throwAt) {
    const first = p.deals[0] ?? p.throwAt;
    if (t <= first) return a;
    const e = sine((t - first) / Math.max(1, (p.flips[0] ?? p.throwAt) - first));
    return { x: a.x + (hand.x - a.x) * e, y: a.y + (hand.y - a.y) * e };
  }
  if (t <= p.throwAt) return from;
  if (t >= settle) return d;
  const e = sine((t - p.throwAt) / Math.max(1, settle - p.throwAt));
  return { x: from.x + (d.x - from.x) * e, y: from.y + (d.y - from.y) * e };
}

/** The direction the LAST card is travelling as it lands (the impact's shake and splash follow it). Unit. */
export function cardArrivalDir(m: CardMotion | undefined, a: Pt, d: Pt): Pt {
  if (m) return { x: Math.cos(m.h), y: Math.sin(m.h) };
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  return { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
}
