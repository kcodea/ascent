/**
 * THE GRABBY CLAW HERO ATTACK (an Epic): its tuned values, its pure timeline, the pure geometry, the pure pose of the
 * claw and of the struck portrait, and the pure camera.
 *
 * ONE IDEA: an arcade claw machine. A three-pronged chrome claw on a cable comes down from the top of the screen and
 * physically GRABS THE STRUCK PORTRAIT. No other attack grabs and carries its target.
 *
 * THE THREE LOOKS. Every hero attack reads its tier from the shared `attackTier` (the owner-approved damage thresholds
 * I 1-5 / II 6-11 / III 12-19 / IV 20+, and a knockout always plays IV). An Epic maps those four onto its three looks
 * here (`clawLevel`, the same mapping Card Shark uses): I -> FUMBLE, II and III -> SHAKE, IV -> PRIZE.
 *  - FUMBLE. The claw slides in over the struck portrait with a servo jitter, drops, clamps on it (the portrait squeezes
 *    a little), lifts it a short way, loses its grip and DROPS it: the portrait falls back into its socket and bounces.
 *    The landing is THE impact.
 *  - SHAKE. The claw lifts the portrait higher and SHAKES it side to side, three hard shakes, coins falling out of it,
 *    then drops it from height with a bigger bounce. The landing is THE impact.
 *  - PRIZE. A prize chute slides up beside the play area. The claw lifts the portrait, CARRIES it across, holds it over
 *    the chute for a beat and lets go: the portrait drops in and vanishes with a clatter (THE impact), the prize light
 *    blinks and "WINNER" flashes, then the portrait pops back up in its own socket and settles exactly.
 *
 * NO HEADROOM (`clawCramped`). The opponent's portrait sits against the TOP of the screen: a claw clamped on it there
 * has its hub off the screen and nowhere to lift to. So for a struck portrait with no room above it the claw first
 * comes down whole in the open beside it (so it is seen as a claw on a cable), goes up and over, drops its prongs round
 * the portrait from the top edge, and PULLS IT OUT of its socket, down and toward the middle, where the whole claw
 * shows. Fumble and Shake then end with the claw snatching it back up, the grip slipping, and the socket catching the
 * portrait as the claw runs on off the top: it SLAMS home (THE impact) and rebounds. Prize carries on from the open to
 * the chute as usual. With room above (your own portrait) it is the plain lift and drop.
 *
 * The damage formation (shared, `../heroAttack/damageFormation.ts`) opens every attack; this style starts where it ends.
 * The consequence (the damage, Armor, Resolve) lands exactly ONCE, on the impact beat. No hit-stop anywhere. Reduced
 * motion: no claw, no portrait movement, no shake or zoom; the numbers fade and the blow lands.
 *
 * Everything here is PURE (time in, pose out), so a replay plays the same grab and the tests sample any instant.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always plays
 * DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { clamp, clamp01, easeInBack, easeInOutSine, easeOutBack, easeOutCubic, hexToNum, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { hexToNum, type TierNum };

/** The Grabby Claw's three looks. */
export const CLAW_LEVELS = [1, 2, 3] as const;
export type ClawLevel = (typeof CLAW_LEVELS)[number];
export const CLAW_LEVEL_NAMES: Record<ClawLevel, string> = { 1: 'Fumble', 2: 'Shake', 3: 'Prize' };

/** The shared four damage tiers mapped onto the three looks: I fumble, II and III shake, IV (and a knockout) prize. */
export function clawLevel(tier: TierNum): ClawLevel {
  return tier <= 1 ? 1 : tier >= 4 ? 3 : 2;
}

/** The per-look dials. A config key is `v1..v3` + one of these. */
export const CLAW_LEVEL_SUFFIXES = [
  'SlideMs', 'LiftMs', 'Lift', 'FallMs', 'Bounce', 'Shake', 'Zoom', 'Punch', 'Sparks', 'SettleMs', 'Dim',
] as const;
export type ClawLevelSuffix = (typeof CLAW_LEVEL_SUFFIXES)[number];
type LevelKey = `v${ClawLevel}${ClawLevelSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  // The operator (the striking hero)
  absorbMs: number;
  heroLeanPx: number;
  // The claw
  clawSize: number;
  hubOff: number;
  hoverGap: number;
  hoverMs: number;
  dropMs: number;
  clampMs: number;
  squeeze: number;
  leaveMs: number;
  // No headroom: the pull out
  peekMs: number;
  pullOut: number;
  // Fumble
  fumbleMs: number;
  // Shake
  shakes: number;
  shakeMs: number;
  shakeAmp: number;
  coins: number;
  // Prize
  carryReach: number;
  carryMs: number;
  holdMs: number;
  returnMs: number;
  popMs: number;
  chuteSize: number;
  // Camera and the landing
  flashAlpha: number;
  squash: number;
  bounceMs: number;
  shakeDecayMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorChrome: string;
  colorLamp: string;
  colorCoin: string;
  colorDust: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxServoClip: string; sfxServoGain: number; sfxServoRate: number;
  sfxClampClip: string; sfxClampGain: number; sfxClampRate: number;
  sfxCoinClip: string; sfxCoinGain: number; sfxCoinRate: number;
  sfxThudClip: string; sfxThudGain: number; sfxThudRate: number;
  sfxChuteClip: string; sfxChuteGain: number; sfxChuteRate: number;
  sfxWinClip: string; sfxWinGain: number; sfxWinRate: number;
  sfxPopClip: string; sfxPopGain: number; sfxPopRate: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroClawConfig = GlobalConfig & Record<LevelKey, number>;

export const HERO_CLAW_COLOR_KEYS = ['colorChrome', 'colorLamp', 'colorCoin', 'colorDust', 'colorPlayer', 'colorFoe'] as const;
export const HERO_CLAW_CLIP_KEYS = [
  'sfxServoClip', 'sfxClampClip', 'sfxCoinClip', 'sfxThudClip', 'sfxChuteClip', 'sfxWinClip', 'sfxPopClip',
] as const;
type ColorKey = (typeof HERO_CLAW_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_CLAW_CLIP_KEYS)[number];
export type HeroClawStrKey = ColorKey | ClipKey;
export type HeroClawNumKey = Exclude<keyof HeroClawConfig, HeroClawStrKey>;

/** Fumble, Shake, Prize per suffix: the escalation ladder. */
const LEVEL_DEFAULTS: Record<ClawLevelSuffix, [number, number, number]> = {
  SlideMs: [280, 280, 300],
  LiftMs: [250, 300, 320],
  Lift: [0.5, 1.15, 1.05],
  FallMs: [150, 200, 240],
  Bounce: [12, 24, 0],
  Shake: [5, 10, 13],
  Zoom: [0.02, 0.03, 0.04],
  Punch: [0.012, 0.024, 0.034],
  Sparks: [8, 14, 22],
  SettleMs: [160, 200, 220],
  Dim: [0, 0.16, 0.32],
};

export const CLAW_LEVEL_RANGES: Record<ClawLevelSuffix, [number, number, number]> = {
  SlideMs: [100, 1200, 10],
  LiftMs: [80, 1200, 10],
  Lift: [0.1, 3, 0.05],
  FallMs: [60, 800, 10],
  Bounce: [0, 80, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.12, 0.002],
  Punch: [0, 0.1, 0.001],
  Sparks: [0, 60, 1],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const levelDefaults = Object.fromEntries(CLAW_LEVELS.flatMap((v) => CLAW_LEVEL_SUFFIXES.map((s) => [`v${v}${s}`, LEVEL_DEFAULTS[s][v - 1]]))) as Record<LevelKey, number>;

export const HERO_CLAW_DEFAULTS: HeroClawConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps the claw up where every style steps up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroLeanPx: 9,
  clawSize: 1,
  hubOff: 1.5,
  hoverGap: 0.85,
  hoverMs: 70,
  dropMs: 150,
  clampMs: 90,
  squeeze: 0.07,
  leaveMs: 300,
  peekMs: 170,
  pullOut: 1,
  fumbleMs: 150,
  shakes: 3,
  shakeMs: 150,
  shakeAmp: 0.46,
  coins: 5,
  carryReach: 3.6,
  carryMs: 480,
  holdMs: 190,
  returnMs: 460,
  popMs: 260,
  chuteSize: 1,
  flashAlpha: 0.7,
  squash: 0.1,
  bounceMs: 340,
  shakeDecayMs: 280,
  zoomOutMs: 340,
  reducedFadeMs: 260,
  colorChrome: '#e9eef5',
  colorLamp: '#ff4a5c',
  colorCoin: '#ffc83a',
  colorDust: '#e8dcc4',
  colorPlayer: '#ffd76a',
  colorFoe: '#ff5a6e',
  sfxServoClip: 'fx/claw-servo', sfxServoGain: 0.5, sfxServoRate: 1,
  sfxClampClip: 'fx/claw-clamp', sfxClampGain: 0.55, sfxClampRate: 1,
  sfxCoinClip: 'sell2', sfxCoinGain: 0.26, sfxCoinRate: 1.5,
  sfxThudClip: 'wipethudwood', sfxThudGain: 0.5, sfxThudRate: 1.1,
  sfxChuteClip: 'fx/claw-chute', sfxChuteGain: 0.7, sfxChuteRate: 1,
  sfxWinClip: 'triplereward', sfxWinGain: 0.32, sfxWinRate: 1.15,
  sfxPopClip: 'cardlanding', sfxPopGain: 0.4, sfxPopRate: 1.2,
  sfxTailMix: 0.08,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...levelDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroClawStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroLeanPx: [0, 40, 1],
  clawSize: [0.6, 1.6, 0.02],
  hubOff: [1.2, 2, 0.02],
  hoverGap: [0.2, 2, 0.05],
  hoverMs: [0, 600, 10],
  dropMs: [60, 800, 10],
  clampMs: [40, 500, 10],
  squeeze: [0, 0.25, 0.01],
  leaveMs: [100, 1200, 10],
  peekMs: [0, 800, 10],
  pullOut: [0, 3, 0.05],
  fumbleMs: [40, 800, 10],
  shakes: [1, 6, 1],
  shakeMs: [80, 500, 10],
  shakeAmp: [0.1, 1.2, 0.02],
  coins: [0, 14, 1],
  carryReach: [2, 7, 0.1],
  carryMs: [200, 1500, 10],
  holdMs: [0, 1000, 10],
  returnMs: [200, 1500, 10],
  popMs: [80, 800, 10],
  chuteSize: [0.6, 1.6, 0.02],
  flashAlpha: [0, 1, 0.01],
  squash: [0, 0.3, 0.01],
  bounceMs: [120, 1000, 10],
  shakeDecayMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxServoGain: [0, 2, 0.05], sfxServoRate: [0.5, 2.5, 0.01],
  sfxClampGain: [0, 2, 0.05], sfxClampRate: [0.5, 2.5, 0.01],
  sfxCoinGain: [0, 2, 0.05], sfxCoinRate: [0.5, 2.5, 0.01],
  sfxThudGain: [0, 2, 0.05], sfxThudRate: [0.5, 2.5, 0.01],
  sfxChuteGain: [0, 2, 0.05], sfxChuteRate: [0.5, 2.5, 0.01],
  sfxWinGain: [0, 2, 0.05], sfxWinRate: [0.5, 2.5, 0.01],
  sfxPopGain: [0, 2, 0.05], sfxPopRate: [0.5, 2.5, 0.01],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_CLAW_RANGES: Record<HeroClawNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(CLAW_LEVELS.flatMap((v) => CLAW_LEVEL_SUFFIXES.map((s) => [`v${v}${s}`, CLAW_LEVEL_RANGES[s]]))) as Record<LevelKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say. */
export const CLAW_CAPS = { shakes: 6, coins: 14, sparks: 60, shakePx: 40, zoom: 0.12 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_CLAW_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_CLAW_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroClawValue<K extends keyof HeroClawConfig>(key: K, value: unknown): HeroClawConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_CLAW_DEFAULTS, key)) return undefined;
  const def = HERO_CLAW_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroClawConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroClawConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_CLAW_RANGES[key as HeroClawNumKey];
  return Math.min(max, Math.max(min, n)) as HeroClawConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroClawConfig(saved: unknown): HeroClawConfig {
  const out: HeroClawConfig = { ...HERO_CLAW_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroClawValue(k as keyof HeroClawConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

// v2: the keys are the claw's own (v1 was the scaffold's copy of Card Shark's).
const KEY = 'ascent.heroclaw.v2';

let cfg: HeroClawConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_CLAW_DEFAULTS };
  try { return sanitizeHeroClawConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_CLAW_DEFAULTS }; }
})();

export function getHeroClawConfig(): HeroClawConfig { return cfg; }

export function setHeroClawValue(key: keyof HeroClawConfig, value: number | string): void {
  const safe = clampHeroClawValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroClawConfig(): void {
  cfg = { ...HERO_CLAW_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroClawConfigJson(c: HeroClawConfig = cfg): string {
  const ship: Partial<HeroClawConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

/** The preview speed. Previews always play at 1x (owner 2026-09-29: no Speed buttons on the attack tuners). */
export function heroClawPreviewSpeed(): number { return 1; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One look's dials, read out of the config. */
export function clawLevelDials(level: ClawLevel, c: HeroClawConfig = cfg): Record<ClawLevelSuffix, number> {
  return Object.fromEntries(CLAW_LEVEL_SUFFIXES.map((s) => [s, c[`v${level}${s}`]])) as Record<ClawLevelSuffix, number>;
}

/** The view everything must stay inside (the screen, or the sandbox box). */
export interface ClawFrame { x0: number; y0: number; x1: number; y1: number }

/** The room there is to lift a portrait: from the top of the hub, clamped on it in its socket, to the top of the view. */
export function clawHeadroom(d: Pt, R: number, frame: ClawFrame, c: Pick<HeroClawConfig, 'hubOff'>): number {
  return d.y - R * c.hubOff - R * 0.5 - frame.y0;
}

/**
 * NO HEADROOM (the struck portrait sits against the top of the view, as the opponent's does): the claw cannot lift it,
 * so it PULLS IT OUT instead (see the header). True when the hub would not even fit above the socket.
 */
export function clawCramped(d: Pt, R: number, frame: ClawFrame, c: Pick<HeroClawConfig, 'hubOff'>): boolean {
  return clawHeadroom(d, R, frame, c) < R * 0.3;
}

export interface ClawPlanInput extends AttackTierContext {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** The struck portrait has no room above it (`clawCramped`): the claw pulls it out and slams it home. */
  cramped?: boolean;
  reduced?: boolean;
}

export interface ClawPlan {
  reduced: boolean;
  /** The SHARED damage tier (1..4; a knockout is 4). */
  tier: TierNum;
  /** The look: 1 fumble, 2 shake, 3 prize. */
  level: ClawLevel;
  /** 0..1 across the looks (fumble 0, prize 1). */
  k: number;
  total: number;
  /** No room to lift: the portrait is pulled OUT of its socket into the open, and (Fumble, Shake) yanked back home. */
  pull: boolean;
  /** The total sinks into the striking hero; the claw starts to come in. */
  chargeAt: number;
  absorbEnd: number;
  /** The claw is over the struck portrait. */
  hoverAt: number;
  /** It drops. */
  dropAt: number;
  /** The prongs touch the portrait and start to close. */
  clampAt: number;
  /** Closed on it: the click. The portrait is in the grip from here. */
  grabAt: number;
  /** The lift (or the pull out) is done: the portrait hangs in the open. */
  liftEnd: number;
  /** Shake: when each hard shake peaks (coins fall). Empty on the other looks. */
  shakes: number[];
  /** Shake: the whole shaking window. */
  shakeFrom: number; shakeTo: number; shakeMs: number;
  /** Prize: the carry across to the chute (`carryAt` = `liftEnd`). */
  carryAt: number; carryEnd: number;
  /** The grip goes: the prongs let go (or, pulled out on Fumble and Shake, the claw yanks the portrait back up). */
  releaseAt: number;
  /** The portrait leaves the prongs for good (`releaseAt`, or `impactAt` when it is yanked home). */
  heldTo: number;
  /** THE consequence beat: the portrait lands in its socket (Fumble, Shake) or drops into the chute (Prize). */
  impactAt: number;
  /** Prize: the portrait pops back up in its socket. */
  returnAt: number;
  /** The struck portrait is back at rest, exactly (its transform is cleared from here on). */
  homeAt: number;
  /** The claw starts to retract, and is gone `leaveMs` later. */
  leaveAt: number; leaveMs: number;
  endAt: number;
  /** The lift, in portrait radii. */
  lift: number;
  bouncePx: number;
  shakePx: number;
  zoom: number;
  punch: number;
  sparks: number;
  coins: number;
  dim: number;
}

/** The whole Grabby Claw, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function clawPlan(input: ClawPlanInput, c: HeroClawConfig = cfg): ClawPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays Tier IV (heroAttack/tiers.ts), so Prize
  const level = clawLevel(tier);
  const V = clawLevelDials(level, c);
  const k = (level - 1) / 2;
  const pull = !!input.cramped;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      reduced: true, tier, level, k, total, pull, chargeAt: at, absorbEnd: at, hoverAt: at, dropAt: at, clampAt: at, grabAt: at, liftEnd: at,
      shakes: [], shakeFrom: at, shakeTo: at, shakeMs: 1, carryAt: at, carryEnd: at, releaseAt: at, heldTo: at, impactAt: at, returnAt: at, homeAt: at,
      leaveAt: at, leaveMs: 1, endAt: r.endAt, lift: 0, bouncePx: 0, shakePx: 0, zoom: 0, punch: 0, sparks: 0, coins: 0, dim: 0,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  // Pulled out: the claw first shows itself in the open (it cannot be seen over a portrait at the top edge).
  const hoverAt = chargeAt + V.SlideMs + (pull ? c.peekMs : 0);
  const dropAt = hoverAt + c.hoverMs;
  const clampAt = dropAt + c.dropMs;
  const grabAt = clampAt + c.clampMs;
  const liftEnd = grabAt + V.LiftMs;
  const n = level === 2 ? clamp(Math.round(c.shakes), 1, CLAW_CAPS.shakes) : 0;
  const shakeFrom = liftEnd + (level === 2 ? 40 : 0);
  const shakeTo = shakeFrom + n * c.shakeMs;
  // A shake peaks a quarter of the way through its swing (the first hard stop).
  const shakes = Array.from({ length: n }, (_, i) => shakeFrom + (i + 0.25) * c.shakeMs);
  const carryAt = liftEnd;
  const carryEnd = level === 3 ? carryAt + c.carryMs : carryAt;
  const releaseAt = level === 1 ? liftEnd + c.fumbleMs : level === 2 ? shakeTo + 70 : carryEnd + c.holdMs;
  const yank = pull && level !== 3;
  const impactAt = releaseAt + V.FallMs + (yank ? 30 : 0);
  const heldTo = yank ? impactAt : releaseAt;
  const returnAt = level === 3 ? impactAt + c.returnMs : impactAt;
  const homeAt = level === 3 ? returnAt + c.popMs : impactAt + c.bounceMs;
  const leaveAt = yank ? impactAt : releaseAt + 110;
  const leaveMs = yank ? Math.min(c.leaveMs, 220) : c.leaveMs;
  // The claw is gone and the portrait is home before the end: nothing is still moving when the fight goes on.
  const endAt = Math.max(homeAt, leaveAt + leaveMs, impactAt + c.zoomOutMs * 0.8) + V.SettleMs;

  return {
    reduced: false, tier, level, k, total, pull, chargeAt, absorbEnd, hoverAt, dropAt, clampAt, grabAt, liftEnd,
    shakes, shakeFrom, shakeTo, shakeMs: c.shakeMs, carryAt, carryEnd, releaseAt, heldTo, impactAt, returnAt, homeAt,
    leaveAt, leaveMs, endAt,
    lift: V.Lift,
    bouncePx: V.Bounce,
    shakePx: clamp(V.Shake, 0, CLAW_CAPS.shakePx),
    zoom: clamp(V.Zoom, 0, CLAW_CAPS.zoom),
    punch: V.Punch,
    sparks: Math.round(clamp(V.Sparks, 0, CLAW_CAPS.sparks)),
    coins: level === 2 ? Math.round(clamp(c.coins, 0, CLAW_CAPS.coins)) : 0,
    dim: V.Dim,
  };
}

export type ClawCueKind = 'charge' | 'chute' | 'drop' | 'grab' | 'lift' | 'slip' | 'shake' | 'carry' | 'release' | 'impact' | 'win' | 'return' | 'home' | 'end';
export interface ClawCue { at: number; kind: ClawCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep the order below, so the release precedes the impact). */
export function clawCues(p: ClawPlan): ClawCue[] {
  const out: ClawCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.dropAt, kind: 'drop', i: 0 });
    out.push({ at: p.grabAt, kind: 'grab', i: 0 });
    out.push({ at: p.grabAt + 30, kind: 'lift', i: 0 });
    if (p.level === 1) out.push({ at: p.liftEnd, kind: 'slip', i: 0 });
    p.shakes.forEach((at, i) => out.push({ at, kind: 'shake', i }));
    if (p.level === 3) {
      out.push({ at: p.grabAt, kind: 'chute', i: 0 });
      out.push({ at: p.carryAt, kind: 'carry', i: 0 });
      out.push({ at: p.impactAt + 70, kind: 'win', i: 0 });
      out.push({ at: p.returnAt, kind: 'return', i: 0 });
    }
    out.push({ at: p.releaseAt, kind: 'release', i: 0 });
    out.push({ at: p.homeAt, kind: 'home', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<ClawCueKind, number> = { charge: 0, drop: 1, chute: 2, grab: 3, lift: 4, slip: 5, shake: 6, carry: 7, release: 8, impact: 9, win: 10, return: 11, home: 12, end: 13 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the geometry (pure) ──────────────────────────────────────────────────────────────────────────────────────

/** Where the prize chute stands: `x` its centre, `y` its MOUTH (top edge), `w` x `h` its size. */
export interface ChuteBox { x: number; y: number; w: number; h: number }

export interface ClawGeo {
  /** The struck portrait's resting centre and radius. */
  d: Pt; R: number;
  /** How far the hub sits above the centre of a held portrait. */
  hubOff: number;
  /**
   * The hub's stations: where it comes in (above the view); where it first shows itself whole (pulled out only; else
   * the same as `hover`); hovering over the socket; clamped on the resting portrait; and holding the portrait in the
   * open (`show`: straight up from the socket when there is room to lift, down and toward the middle when there is not).
   */
  enter: Pt; pre: Pt; hover: Pt; grab: Pt; show: Pt;
  /** The cable's top end (above the view). */
  topY: number;
  /** Prize: how far the hub carries from `show` (signed px); 0 on the other looks. */
  carry: number;
  /** Prize: the chute, and where the portrait's centre ends up inside it (an offset from its socket). */
  chute: ChuteBox | null;
  sinkX: number; sinkY: number;
}

/**
 * Lay the grab out from the struck portrait and the view. The claw always comes from the TOP of the view. With room
 * above the socket the portrait is lifted straight up (less far near the top, so the hub stays in view). With none
 * (`p.pull`) it is pulled out, down and toward the middle, far enough that the whole claw and a length of cable show.
 * The chute stands on the side with more room, under where the portrait hangs, inside the view. Pure.
 */
export function clawGeo(
  p: Pick<ClawPlan, 'level' | 'lift' | 'reduced' | 'pull'>, a: Pt, d: Pt, R: number, frame: ClawFrame,
  c: Pick<HeroClawConfig, 'hubOff' | 'hoverGap' | 'carryReach' | 'chuteSize' | 'pullOut'>,
): ClawGeo {
  const hubOff = R * c.hubOff;
  const grab = { x: d.x, y: d.y - hubOff };
  const midX = (frame.x0 + frame.x1) / 2;
  const inward = d.x > midX ? -1 : 1;
  const topY = frame.y0 - R * 0.6;
  let show: Pt, pre: Pt, hover: Pt, enter: Pt;
  if (p.pull) {
    // The hub hangs with its top about a third of a radius (and more on the bigger looks) under the top edge.
    show = { x: d.x + inward * R * c.pullOut * (0.75 + 0.25 * p.lift), y: Math.max(grab.y + R * 0.4, frame.y0 + R * (0.85 + 0.3 * p.lift)) };
    pre = { x: show.x + inward * R * 0.5, y: frame.y0 + R * 0.95 };
    hover = { x: d.x, y: grab.y - R * c.hoverGap };
    enter = { x: pre.x, y: frame.y0 - R * 1.9 };
  } else {
    const room = clawHeadroom(d, R, frame, c);
    const lift = clamp(R * p.lift, R * 0.28, Math.max(R * 0.28, room));
    show = { x: d.x, y: grab.y - lift };
    hover = { x: d.x, y: Math.min(grab.y - R * 0.3, Math.max(frame.y0 + R * 0.3, grab.y - R * c.hoverGap)) };
    pre = hover;
    // It runs in from the striker's side of the socket (from the middle when the two are stacked).
    const from = Math.abs(a.x - d.x) > R ? Math.sign(a.x - d.x) : inward;
    enter = { x: d.x + from * R * 1.5, y: Math.min(hover.y - R * 0.8, frame.y0 - R * 1.9) };
  }
  let carry = 0;
  let chute: ChuteBox | null = null;
  let sinkX = 0, sinkY = 0;
  if (p.level === 3 && !p.reduced) {
    const w = R * 2.7 * c.chuteSize, h = R * 2.5 * c.chuteSize;
    const right = frame.x1 - show.x, left = show.x - frame.x0;
    const sgn = right >= left ? 1 : -1;
    const span = Math.max(0, (sgn > 0 ? right : left) - w * 0.5 - R * 0.15);
    carry = sgn * Math.max(Math.min(R * c.carryReach, span), Math.min(R * 2.3, span));
    // The mouth sits just under the hanging portrait; a chute by the bottom edge keeps at least half of itself in view
    // (the portrait is then lifted higher to clear it, while there is room).
    let mouth = show.y + hubOff + R * 1.3;
    const lowest = frame.y1 - h * 0.5;
    if (mouth > lowest) {
      mouth = lowest;
      if (!p.pull) show = { x: show.x, y: Math.max(Math.min(show.y, mouth - R * 1.3 - hubOff), Math.min(show.y, frame.y0 + R * 0.5)) };
    }
    mouth = Math.max(mouth, show.y + hubOff + R * 1.15);
    chute = { x: show.x + carry, y: mouth, w, h };
    sinkX = chute.x - d.x;
    sinkY = mouth + R * 0.95 - d.y;
  }
  return { d, R, hubOff, enter, pre, hover, grab, show, topY, carry, chute, sinkX, sinkY };
}

// ─── the pose (pure) ──────────────────────────────────────────────────────────────────────────────────────────

/** Everything on screen at one instant. The runner keeps ONE of these and refills it each frame (no allocation). */
export interface ClawPose {
  /** The struck portrait: its offset from its socket (px), turn (radians, clockwise), scale and opacity. */
  px: number; py: number; prot: number; psx: number; psy: number; palpha: number;
  /** It is in the claw's grip. */
  held: boolean;
  /** The hub's centre, the claw's turn (radians, clockwise), how open the prongs are (0 clamped .. 1 wide) and its opacity. */
  hx: number; hy: number; crot: number; open: number; calpha: number;
  /** The cable's top end (the trolley, above the view). */
  tx: number;
  /** Prize: how far the chute has slid up (0 hidden .. 1 standing), its lamp (0..1) and the WINNER sign (scale, opacity). */
  chute: number; lamp: number; win: number; winAlpha: number;
}

export function blankPose(): ClawPose {
  return { px: 0, py: 0, prot: 0, psx: 1, psy: 1, palpha: 1, held: false, hx: 0, hy: 0, crot: 0, open: 1, calpha: 0, tx: 0, chute: 0, lamp: 0, win: 0, winAlpha: 0 };
}

const damped = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.sin(2 * Math.PI * hz * (ms / 1000)));
const TAU = Math.PI * 2;
/** Yanked home: how far above its grip the hub has run on when the socket catches the portrait (portrait radii). */
const YANK_OVER = 0.4;

interface Grip { hx: number; hy: number; phi: number; slip: number; loose: number }

/**
 * The grip: where the hub is, how far the held portrait swings (clockwise about the hub), how far it has slipped down
 * in the prongs and how loose they are, at `t` within the hold.
 */
function gripAt(p: ClawPlan, g: ClawGeo, c: HeroClawConfig, t: number, out: Grip): void {
  const R = g.R;
  const lu = clamp01((t - p.grabAt) / Math.max(1, p.liftEnd - p.grabAt));
  const le = easeInOutSine(lu);
  const dx = g.show.x - g.grab.x;
  let hx = g.grab.x + dx * le;
  let hy = g.grab.y + (g.show.y - g.grab.y) * le;
  // Carried sideways, the portrait trails behind the hub.
  let phi = Math.abs(dx) > 1 ? Math.sign(dx) * 0.16 * Math.sin(Math.PI * lu) : 0;
  let slip = 0, loose = 0;
  if (p.level === 1 && t > p.liftEnd) {
    // FUMBLE: the grip goes. The portrait slips down in the prongs and rattles.
    const u = clamp01((t - p.liftEnd) / Math.max(1, p.releaseAt - p.liftEnd));
    slip = R * 0.14 * u * u;
    phi = 0.06 * Math.sin(u * Math.PI * 5) * (0.4 + u);
    hx += Math.sin(u * Math.PI * 7) * R * 0.02;
    loose = 0.18 * u;
  } else if (p.level === 2 && t > p.shakeFrom) {
    // SHAKE: the hub jerks side to side; the portrait swings under it a touch behind.
    const tau = t - p.shakeFrom;
    if (t < p.shakeTo) {
      const ph = (tau / p.shakeMs) * TAU;
      hx += R * c.shakeAmp * Math.sin(ph);
      phi = 0.2 * Math.sin(ph);
      hy += R * 0.05 * Math.abs(Math.sin(ph));
    } else {
      const r = damped(t - p.shakeTo, 1000 / p.shakeMs, 55);
      hx += R * c.shakeAmp * 0.5 * r;
      phi = 0.1 * r;
    }
  } else if (p.level === 3 && t > p.carryAt) {
    // PRIZE: carried across; the portrait trails behind, then swings through as the trolley stops.
    const u = clamp01((t - p.carryAt) / Math.max(1, p.carryEnd - p.carryAt));
    const sgn = Math.sign(g.carry) || 1;
    hx += g.carry * easeInOutSine(u);
    phi = t < p.carryEnd ? sgn * 0.22 * Math.sin(Math.PI * u) : -sgn * 0.13 * damped(t - p.carryEnd, 2.6, 150);
    hy += R * 0.03 * Math.sin(u * Math.PI * 4);
  }
  if (p.heldTo > p.releaseAt && t > p.releaseAt) {
    // YANKED HOME (pulled out, Fumble and Shake): the claw snatches it back up toward the top, faster and faster, the
    // portrait slipping in the loosening prongs, until its socket catches it exactly as the hub runs on.
    const u = clamp01((t - p.releaseAt) / Math.max(1, p.heldTo - p.releaseAt));
    const e = u * u;
    hx += (g.grab.x - hx) * e;
    hy += (g.grab.y - R * YANK_OVER - hy) * e;
    slip += (R * YANK_OVER - slip) * e;
    phi *= 1 - u;
    loose += (0.5 - loose) * e;
  }
  out.hx = hx; out.hy = hy; out.phi = phi; out.slip = slip; out.loose = loose;
}

const G: Grip = { hx: 0, hy: 0, phi: 0, slip: 0, loose: 0 };
const G0: Grip = { hx: 0, hy: 0, phi: 0, slip: 0, loose: 0 };

/**
 * THE POSE at sequence time `t`: the claw (hub, turn, prongs, cable) and the struck portrait (offset, turn, scale,
 * opacity), plus the chute, its lamp and the WINNER sign. From `homeAt` on the portrait is EXACTLY at rest (offset 0,
 * turn 0, scale 1, opacity 1), and before the prongs start to close it never moves. Pure; fills and returns `out`.
 */
export function clawPose(p: ClawPlan, g: ClawGeo, c: HeroClawConfig, t: number, out: ClawPose = blankPose()): ClawPose {
  out.px = 0; out.py = 0; out.prot = 0; out.psx = 1; out.psy = 1; out.palpha = 1; out.held = false;
  out.hx = g.enter.x; out.hy = g.enter.y; out.crot = 0; out.open = 1; out.calpha = 0; out.tx = g.enter.x;
  out.chute = 0; out.lamp = 0; out.win = 0; out.winAlpha = 0;
  if (p.reduced || t < p.chargeAt) return out;
  const R = g.R;

  if (t < p.hoverAt) {
    // ── it comes in on its trolley with a servo judder, snipping its prongs once on the way ──
    const u = clamp01((t - p.chargeAt) / Math.max(1, p.hoverAt - p.chargeAt));
    let snip: number;
    if (p.pull) {
      // Down into the open first (the whole claw on its cable), then across and up over the socket.
      const half = 0.56;
      if (u < half) {
        const e = easeOutCubic(u / half);
        out.hx = g.enter.x + (g.pre.x - g.enter.x) * e; out.hy = g.enter.y + (g.pre.y - g.enter.y) * e;
      } else {
        const e = easeInOutSine((u - half) / (1 - half));
        out.hx = g.pre.x + (g.hover.x - g.pre.x) * e; out.hy = g.pre.y + (g.hover.y - g.pre.y) * e;
        out.crot = -0.12 * Math.sin(Math.PI * e) * Math.sign(g.hover.x - g.pre.x || 1);
      }
      out.hx += Math.sin(u * Math.PI * 11) * R * 0.025 * (1 - u);
      snip = clamp01((u - 0.3) / 0.36);
    } else {
      const e = easeInOutSine(u);
      out.hx = g.enter.x + (g.hover.x - g.enter.x) * e + Math.sin(u * Math.PI * 9) * R * 0.03 * (1 - u);
      out.hy = g.enter.y + (g.hover.y - g.enter.y) * e;
      out.crot = -0.1 * Math.sin(Math.PI * u) * Math.sign(g.hover.x - g.enter.x || 1);
      snip = clamp01((u - 0.35) / 0.42);
    }
    out.open = 1 - 0.6 * Math.sin(Math.PI * snip);
    out.calpha = clamp01((t - p.chargeAt) / 80);
  } else if (t < p.dropAt) {
    out.hx = g.hover.x + damped(t - p.hoverAt, 11, 50) * R * 0.05; out.hy = g.hover.y;
    out.crot = 0.06 * damped(t - p.hoverAt, 6, 60);
    out.calpha = 1;
  } else if (t < p.clampAt) {
    const u = clamp01((t - p.dropAt) / Math.max(1, p.clampAt - p.dropAt));
    out.hx = g.hover.x; out.hy = g.hover.y + (g.grab.y - g.hover.y) * u * u;
    out.calpha = 1;
  } else if (t < p.grabAt) {
    // The prongs close on it (a small press down as they bite).
    const u = clamp01((t - p.clampAt) / Math.max(1, p.grabAt - p.clampAt));
    out.hx = g.grab.x; out.hy = g.grab.y + R * 0.035 * Math.sin(Math.PI * u);
    out.open = 1 - easeOutCubic(u);
    out.calpha = 1;
    const sq = c.squeeze * easeOutCubic(u);
    out.psx = 1 - sq; out.psy = 1 + sq * 0.5;
  } else if (t < p.heldTo) {
    // ── HELD ──
    gripAt(p, g, c, t, G);
    out.held = true;
    out.hx = G.hx; out.hy = G.hy; out.crot = G.phi; out.open = G.loose; out.calpha = 1;
    out.px = G.hx - g.hubOff * Math.sin(G.phi) - g.d.x;
    out.py = G.hy + g.hubOff * Math.cos(G.phi) + G.slip - g.d.y;
    out.prot = G.phi;
    const sq = c.squeeze * (1 - G.loose * 2) * (1 + 0.6 * Math.exp(-(t - p.grabAt) / 50) * Math.cos((t - p.grabAt) * 0.05));
    out.psx = 1 - sq; out.psy = 1 + sq * 0.5;
  } else {
    // ── LET GO: the prongs spring open, the claw recoils, then retracts up its cable ──
    gripAt(p, g, c, p.heldTo, G0);
    const since = t - p.heldTo;
    out.open = G0.loose + (1 - G0.loose) * Math.min(1.15, easeOutBack(since / 120, 2.4));
    out.hx = G0.hx;
    out.crot = G0.phi * Math.exp(-since / 60) + 0.05 * damped(since, 5, 90);
    const recoil = R * 0.1 * (1 - Math.exp(-since / 45));
    const lu = clamp01((t - p.leaveAt) / Math.max(1, p.leaveMs));
    out.hy = G0.hy - recoil + (g.enter.y - (G0.hy - recoil)) * easeInBack(lu, 1.2);
    out.calpha = t >= p.leaveAt + p.leaveMs ? 0 : 1 - clamp01((lu - 0.75) / 0.25);

    // The portrait, from where the grip left it.
    const x0 = G0.hx - g.hubOff * Math.sin(G0.phi) - g.d.x;
    const y0 = G0.hy + g.hubOff * Math.cos(G0.phi) + G0.slip - g.d.y;
    if (t < p.impactAt) {
      const u = clamp01(since / Math.max(1, p.impactAt - p.heldTo));
      if (p.level === 3 && g.chute) {
        // Into the chute: straight down, shrinking, gone by the bottom.
        out.px = x0 + (g.sinkX - x0) * Math.min(1, u * 2);
        out.py = y0 + (g.sinkY - y0) * u * u;
        out.psx = out.psy = 1 - 0.42 * u;
        out.prot = G0.phi * (1 - u) + 0.3 * u * (Math.sign(g.carry) || 1);
        out.palpha = u < 0.5 ? 1 : 1 - (u - 0.5) / 0.5;
      } else {
        // The fall: gravity, a small tumble, and stretched a touch on the way down.
        out.px = x0 * (1 - u);
        out.py = y0 * (1 - u * u);
        out.prot = G0.phi * (1 - u) + 0.07 * Math.sin(Math.PI * u);
        out.psx = 1 - 0.04 * u; out.psy = 1 + 0.05 * u;
      }
    } else if (t < p.homeAt) {
      const since2 = t - p.impactAt;
      if (p.level === 3) {
        if (t < p.returnAt) {
          // Gone down the chute.
          out.palpha = 0; out.psx = out.psy = 0.58;
        } else {
          // It pops back up in its own socket.
          const u = clamp01((t - p.returnAt) / Math.max(1, p.homeAt - p.returnAt));
          out.psx = out.psy = 0.35 + 0.65 * easeOutBack(u, 2.6);
          out.palpha = clamp01(u * 5);
        }
      } else {
        // The landing: a squash and a bounce that both die inside `bounceMs`. Dropped, it bounces up off its socket;
        // yanked home, it was going UP when the socket caught it, so it rebounds down.
        const life = Math.max(1, p.homeAt - p.impactAt);
        const env = Math.exp(-since2 / (life * 0.3)) * (1 - clamp01(since2 / life));
        const way = p.heldTo > p.releaseAt ? 1 : -1;
        out.py = way * p.bouncePx * (R / 100) * Math.abs(Math.sin((Math.PI * since2) / (life * 0.42))) * env;
        const sq = c.squash * (0.6 + 0.5 * p.k) * Math.cos((TAU * since2) / (life * 0.6)) * env;
        out.psx = 1 + sq * 0.55; out.psy = 1 - sq;
        out.prot = 0.035 * Math.sin((TAU * since2) / (life * 0.5)) * env;
      }
    }
  }
  out.tx = out.hx;

  // ── the prize chute, its lamp and the sign ──
  if (p.level === 3 && g.chute) {
    const upU = clamp01((t - p.grabAt) / 300);
    const downU = clamp01((t - (p.returnAt + 80)) / 260);
    out.chute = t < p.grabAt ? 0 : easeOutBack(upU, 1.4) * (1 - downU * downU);
    if (t >= p.impactAt) {
      // A win: the lamp flashes fast and the sign punches in, blinking.
      const s2 = t - p.impactAt;
      out.lamp = Math.floor(s2 / 70) % 2 === 0 ? 1 : 0.25;
      const wu = clamp01((s2 - 70) / 170);
      out.win = s2 < 70 ? 0 : 0.4 + 0.6 * easeOutBack(wu, 3);
      out.winAlpha = s2 < 70 ? 0 : (Math.floor(s2 / 90) % 2 === 0 ? 1 : 0.6) * (1 - downU);
    } else if (t >= p.grabAt) {
      out.lamp = Math.floor((t - p.grabAt) / 190) % 2 === 0 ? 0.75 : 0.15;
    }
  }
  return out;
}

// ─── the operator (pure) ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The striking hero works the machine: it leans with the trolley as the claw comes in, presses down as it drops, and
 * hops when the blow lands. Small, and back to exactly rest by the end. Fills its offset (px) and scale. Pure.
 */
export function operatorAt(p: ClawPlan, g: ClawGeo, c: Pick<HeroClawConfig, 'heroLeanPx'>, t: number, out: { x: number; y: number; sx: number; sy: number }): void {
  out.x = 0; out.y = 0; out.sx = 1; out.sy = 1;
  if (p.reduced || t < p.chargeAt) return;
  const dir = Math.sign(g.hover.x - g.enter.x) || 1;
  if (t < p.dropAt) {
    const u = clamp01((t - p.chargeAt) / Math.max(1, p.hoverAt - p.chargeAt));
    out.x = dir * c.heroLeanPx * Math.sin(Math.PI * u);
  } else if (t < p.grabAt + 120) {
    // The button press.
    const u = clamp01((t - p.dropAt) / Math.max(1, p.grabAt + 120 - p.dropAt));
    const k = Math.sin(Math.PI * u);
    out.y = c.heroLeanPx * 0.5 * k; out.sx = 1 + 0.03 * k; out.sy = 1 - 0.04 * k;
  } else if (t >= p.impactAt) {
    const s = t - p.impactAt;
    if (s < 300) out.y = -c.heroLeanPx * (0.8 + 0.6 * p.k) * Math.sin((Math.PI * s) / 300);
  }
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/**
 * The camera at sequence time `t`: a small push in from the drop through the lift, held while the portrait is in the
 * air; a tick on the clamp; a sideways kick on each shake; on THE impact a punch in and a shake along the blow (down
 * for a drop, up when the portrait is yanked home) that dies. Deterministic. Pure.
 */
export function clawCameraAt(p: ClawPlan, c: HeroClawConfig, t: number): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.dropAt && t < p.impactAt) z = p.zoom * easeInOutSine((t - p.dropAt) / Math.max(1, p.liftEnd - p.dropAt));
  else if (t >= p.impactAt) z = (p.zoom + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  let x = 0, y = 0;
  if (t >= p.grabAt) y += p.shakePx * 0.18 * springAt(t - p.grabAt, 16, 35);
  for (let i = 0; i < p.shakes.length; i++) {
    const at = p.shakes[i]!;
    if (t >= at) x += (i % 2 === 0 ? 1 : -1) * p.shakePx * 0.4 * springAt(t - at, 14, 40);
  }
  if (t >= p.impactAt) {
    const age = t - p.impactAt, tau = Math.max(1, c.shakeDecayMs / 4);
    y += (p.heldTo > p.releaseAt ? -1 : 1) * p.shakePx * springAt(age, 15, tau);
    x += p.shakePx * 0.25 * Math.sin(age * 0.09) * Math.exp(-age / tau);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the struck portrait's socket; on the Prize it eases to halfway between the socket and the
 * chute through the carry, so both stay in the push. A zoom anchored on a point keeps that point still. Pure.
 */
export function clawCameraFocus(p: ClawPlan, g: ClawGeo, t: number, out: Pt): Pt {
  out.x = g.d.x; out.y = g.d.y;
  if (p.level === 3 && g.chute && t > p.carryAt) {
    const e = t >= p.returnAt ? 1 - easeInOutSine((t - p.returnAt) / Math.max(1, p.homeAt - p.returnAt)) : easeInOutSine((t - p.carryAt) / Math.max(1, p.carryEnd - p.carryAt));
    out.x += g.sinkX * 0.5 * e;
  }
  return out;
}
