/**
 * THE STORM CALL HERO ATTACK: its tuned values, its pure timeline, the pure bolt geometry and the pure camera.
 *
 * Owner 2026-09-29: "build 5 animations that range from rare -> epic. all of the animations we have done so far are
 * legendary. rare and epics should only have 2 or 3 tiers to them and generally be less exciting, but still extremely
 * clean and fun. get creative". Storm Call is an EPIC: one idea (lightning), three visual tiers, short to medium.
 *
 * THE THREE VISUAL TIERS. Every hero attack reads its tier from the shared `attackTier` (the owner-approved thresholds I
 * 1-5 / II 6-11 / III 12-19 / IV 20+, and a knockout always plays IV). An Epic maps those four onto three looks here
 * (`stormLevel`, local to this style): I -> SMALL, II and III -> MEDIUM, IV -> BIG.
 *  - SMALL. Static crackles round the hero, then a jagged bolt ARCS from the hero to the target: the leader races across
 *    in a blink, the bolt flickers (its shape regenerated every few frames, a live crackle) and a zap and a small spark
 *    burst land THE blow.
 *  - MEDIUM. A forked bolt: one trunk leaves the hero and SPLITS into two branches. The first branch strikes (a TICK:
 *    FX and sound only), the second strikes a beat later (THE impact), and static crawls over the struck portrait while
 *    it jitters.
 *  - BIG. The hero calls up a thin bolt; a small STORM CLOUD gathers over the target and rumbles (lit from inside), then
 *    drops one THICK strike: a flash across the screen, a ring of sparks, a shock ring, and static crawling over the
 *    portrait while the cloud breaks up. The strike is THE impact.
 *
 * The damage formation (shared) opens every attack; this style starts where it ends. The consequence lands exactly
 * ONCE, on the impact beat. No hit-stop. Reduced motion: no bolts, shake or zoom; the numbers fade and the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always plays
 * DEFAULTS.
 */
import { clamp, hexToNum, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { hexToNum, type TierNum };

export const STORM_LEVELS = [1, 2, 3] as const;
export type StormLevel = (typeof STORM_LEVELS)[number];
export const STORM_LEVEL_NAMES: Record<StormLevel, string> = { 1: 'Small', 2: 'Medium', 3: 'Big' };

/** The shared four damage tiers mapped onto Storm Call's three looks: I small, II and III medium, IV (and a knockout) big. */
export function stormLevel(tier: TierNum): StormLevel {
  return tier <= 1 ? 1 : tier >= 4 ? 3 : 2;
}

/** The per-look dials. A config key is `v1..v3` + one of these. */
export const STORM_LEVEL_SUFFIXES = [
  'ChargeMs', 'LeaderMs', 'FlickerMs', 'Width', 'Jag', 'Forks',
  'Shake', 'Zoom', 'Punch', 'Sparks', 'Burst', 'SettleMs', 'Dim',
] as const;
export type StormLevelSuffix = (typeof STORM_LEVEL_SUFFIXES)[number];
type LevelKey = `v${StormLevel}${StormLevelSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  // Ready
  absorbMs: number;
  heroCoilPx: number;
  heroThrustPx: number;
  chargeArcs: number;
  // Bolts
  boltWidth: number;
  glowWidth: number;
  regenMs: number;
  fadeMs: number;
  bow: number;
  // The fork (Medium)
  forkAt: number;
  forkGapMs: number;
  forkSpread: number;
  // Static
  staticMs: number;
  staticArcs: number;
  jitterPx: number;
  // The storm (Big)
  callMs: number;
  gatherMs: number;
  rumbleMs: number;
  cloudSize: number;
  cloudLift: number;
  lingerMs: number;
  screenFlash: number;
  // Camera and portraits
  flashAlpha: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorBolt: string;
  colorViolet: string;
  colorCloud: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound
  sfxChargeClip: string; sfxChargeGain: number; sfxChargeRate: number;
  sfxZapClip: string; sfxZapGain: number; sfxZapRate: number;
  sfxCrackClip: string; sfxCrackGain: number; sfxCrackRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxStaticClip: string; sfxStaticGain: number; sfxStaticRate: number;
  sfxCallClip: string; sfxCallGain: number; sfxCallRate: number;
  sfxRumbleClip: string; sfxRumbleGain: number; sfxRumbleRate: number;
  sfxThunderClip: string; sfxThunderGain: number; sfxThunderRate: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only
  previewDamage: number;
  previewParts: number;
}
export type HeroStormConfig = GlobalConfig & Record<LevelKey, number>;

export const HERO_STORM_COLOR_KEYS = ['colorCore', 'colorBolt', 'colorViolet', 'colorCloud', 'colorPlayer', 'colorFoe'] as const;
export const HERO_STORM_CLIP_KEYS = [
  'sfxChargeClip', 'sfxZapClip', 'sfxCrackClip', 'sfxImpactClip', 'sfxStaticClip', 'sfxCallClip', 'sfxRumbleClip', 'sfxThunderClip',
] as const;
type ColorKey = (typeof HERO_STORM_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_STORM_CLIP_KEYS)[number];
export type HeroStormStrKey = ColorKey | ClipKey;
export type HeroStormNumKey = Exclude<keyof HeroStormConfig, HeroStormStrKey>;

/** Small, Medium, Big per suffix: the escalation ladder. */
const LEVEL_DEFAULTS: Record<StormLevelSuffix, [number, number, number]> = {
  ChargeMs: [380, 380, 320],
  LeaderMs: [70, 80, 60],
  FlickerMs: [260, 280, 380],
  Width: [1, 1.15, 2.6],
  Jag: [0.075, 0.08, 0.06],
  Forks: [2, 3, 4],
  Shake: [5, 8, 16],
  Zoom: [0.02, 0.035, 0.055],
  Punch: [0.015, 0.025, 0.05],
  Sparks: [12, 18, 32],
  Burst: [1, 1.15, 1.7],
  SettleMs: [260, 300, 320],
  Dim: [0, 0.2, 0.42],
};

export const STORM_LEVEL_RANGES: Record<StormLevelSuffix, [number, number, number]> = {
  ChargeMs: [80, 1500, 10],
  LeaderMs: [20, 400, 5],
  FlickerMs: [60, 1200, 10],
  Width: [0.3, 5, 0.05],
  Jag: [0, 0.3, 0.005],
  Forks: [0, 6, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.12, 0.002],
  Punch: [0, 0.1, 0.001],
  Sparks: [0, 60, 1],
  Burst: [0.3, 3, 0.05],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const levelDefaults = Object.fromEntries(STORM_LEVELS.flatMap((v) => STORM_LEVEL_SUFFIXES.map((s) => [`v${v}${s}`, LEVEL_DEFAULTS[s][v - 1]]))) as Record<LevelKey, number>;

export const HERO_STORM_DEFAULTS: HeroStormConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroCoilPx: 7,
  heroThrustPx: 12,
  chargeArcs: 2,
  boltWidth: 12,
  glowWidth: 4.5,
  regenMs: 45,
  fadeMs: 160,
  bow: 0.08,
  forkAt: 0.62,
  forkGapMs: 150,
  forkSpread: 0.5,
  staticMs: 520,
  staticArcs: 3,
  jitterPx: 4,
  callMs: 220,
  gatherMs: 520,
  rumbleMs: 420,
  cloudSize: 1,
  cloudLift: 2.1,
  lingerMs: 700,
  screenFlash: 0.3,
  flashAlpha: 0.9,
  knockPx: 14,
  squash: 0.08,
  shakeMs: 300,
  zoomOutMs: 340,
  reducedFadeMs: 260,
  colorCore: '#f4fbff',
  colorBolt: '#58c2ff',
  colorViolet: '#a377ff',
  colorCloud: '#262a44',
  colorPlayer: '#6fd4ff',
  colorFoe: '#b77bff',
  sfxChargeClip: 'turncharge', sfxChargeGain: 0.32, sfxChargeRate: 1.25,
  sfxZapClip: 'fx/blue-impact-hit', sfxZapGain: 0.5, sfxZapRate: 1.5,
  sfxCrackClip: 'crit', sfxCrackGain: 0.34, sfxCrackRate: 1.35,
  sfxImpactClip: 'flurryhit', sfxImpactGain: 0.5, sfxImpactRate: 1.1,
  sfxStaticClip: 'divineshieldbreak', sfxStaticGain: 0.16, sfxStaticRate: 1.8,
  sfxCallClip: 'windup', sfxCallGain: 0.32, sfxCallRate: 1.3,
  sfxRumbleClip: 'fx/heavy-rock-impact', sfxRumbleGain: 0.45, sfxRumbleRate: 0.55,
  sfxThunderClip: 'turnexplosion', sfxThunderGain: 0.55, sfxThunderRate: 0.75,
  sfxImpactLenMs: 900,
  sfxTailMix: 0.14,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...levelDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroStormStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroCoilPx: [0, 40, 1],
  heroThrustPx: [0, 50, 1],
  chargeArcs: [0, 5, 1],
  boltWidth: [1, 30, 0.5],
  glowWidth: [1, 10, 0.1],
  regenMs: [16, 200, 1],
  fadeMs: [40, 800, 10],
  bow: [0, 0.4, 0.01],
  forkAt: [0.2, 0.85, 0.01],
  forkGapMs: [40, 600, 5],
  forkSpread: [0.05, 0.9, 0.01],
  staticMs: [0, 2000, 10],
  staticArcs: [0, 6, 1],
  jitterPx: [0, 20, 0.5],
  callMs: [60, 800, 10],
  gatherMs: [150, 1500, 10],
  rumbleMs: [100, 1500, 10],
  cloudSize: [0.4, 2.5, 0.05],
  cloudLift: [1.2, 4, 0.05],
  lingerMs: [0, 2000, 10],
  screenFlash: [0, 0.8, 0.01],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxChargeGain: [0, 2, 0.05], sfxChargeRate: [0.5, 2.5, 0.01],
  sfxZapGain: [0, 2, 0.05], sfxZapRate: [0.5, 2.5, 0.01],
  sfxCrackGain: [0, 2, 0.05], sfxCrackRate: [0.5, 2.5, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2.5, 0.01],
  sfxStaticGain: [0, 2, 0.05], sfxStaticRate: [0.5, 2.5, 0.01],
  sfxCallGain: [0, 2, 0.05], sfxCallRate: [0.5, 2.5, 0.01],
  sfxRumbleGain: [0, 2, 0.05], sfxRumbleRate: [0.3, 2.5, 0.01],
  sfxThunderGain: [0, 2, 0.05], sfxThunderRate: [0.3, 2.5, 0.01],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_STORM_RANGES: Record<HeroStormNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(STORM_LEVELS.flatMap((v) => STORM_LEVEL_SUFFIXES.map((s) => [`v${v}${s}`, STORM_LEVEL_RANGES[s]]))) as Record<LevelKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say. */
export const STORM_CAPS = { forks: 6, sparks: 60, staticArcs: 6, shakePx: 40, zoom: 0.12 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_STORM_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_STORM_CLIP_KEYS as readonly string[]).includes(k);

export function clampHeroStormValue<K extends keyof HeroStormConfig>(key: K, value: unknown): HeroStormConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_STORM_DEFAULTS, key)) return undefined;
  const def = HERO_STORM_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroStormConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroStormConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_STORM_RANGES[key as HeroStormNumKey];
  return Math.min(max, Math.max(min, n)) as HeroStormConfig[K];
}

export function sanitizeHeroStormConfig(saved: unknown): HeroStormConfig {
  const out: HeroStormConfig = { ...HERO_STORM_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroStormValue(k as keyof HeroStormConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.herostorm.v1';

let cfg: HeroStormConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_STORM_DEFAULTS };
  try { return sanitizeHeroStormConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_STORM_DEFAULTS }; }
})();

export function getHeroStormConfig(): HeroStormConfig { return cfg; }

export function setHeroStormValue(key: keyof HeroStormConfig, value: number | string): void {
  const safe = clampHeroStormValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroStormConfig(): void {
  cfg = { ...HERO_STORM_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function heroStormConfigJson(c: HeroStormConfig = cfg): string {
  const ship: Partial<HeroStormConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

/** The preview speed. Previews always play at 1x (owner 2026-09-29: no Speed buttons on the attack tuners). */
export function heroStormPreviewSpeed(): number { return 1; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export function stormLevelDials(level: StormLevel, c: HeroStormConfig = cfg): Record<StormLevelSuffix, number> {
  return Object.fromEntries(STORM_LEVEL_SUFFIXES.map((s) => [s, c[`v${level}${s}`]])) as Record<StormLevelSuffix, number>;
}

/** What a bolt is: the Small arc, the Medium trunk and its two branches, the Big call (up to the cloud) and strike. */
export type BoltKind = 'arc' | 'trunk' | 'branch' | 'call' | 'strike';

export interface BoltPlan {
  kind: BoltKind;
  /** The leader leaves its start. */
  at: number;
  /** How long the leader takes to race to its end. */
  leaderMs: number;
  /** How long the whole bolt flickers once it has landed, before it fades. */
  holdMs: number;
  /** Width multiplier (on `boltWidth`). */
  width: number;
  /** Jaggedness (a fraction of the bolt's length). */
  jag: number;
  /** Side forks crackling off it. */
  forks: number;
  /** It lands on the struck hero (a strike: a tick or THE impact). */
  strikes: boolean;
}

export interface StormPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export interface StormPlan {
  reduced: boolean;
  /** The SHARED damage tier (1..4; a knockout is 4). */
  tier: TierNum;
  /** Storm Call's look: 1 small, 2 medium, 3 big. */
  level: StormLevel;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The first bolt leaves the hero (Big: the call). */
  boltAt: number;
  bolts: BoltPlan[];
  /** Big: the cloud gathers from here, and rumbles from `rumbleAt`. */
  storm: boolean;
  gatherAt: number;
  rumbleAt: number;
  /** Big: the flashes inside the cloud as it rumbles. */
  rumbles: number[];
  /** Strikes that land BEFORE the impact (Medium's first branch). */
  hits: number[];
  /** THE consequence beat: the Small arc, the Medium second branch, or the Big strike lands. */
  impactAt: number;
  /** Static crawls over the struck portrait from here (it jitters) until `staticEnd`. */
  staticAt: number;
  staticEnd: number;
  endAt: number;
  shakePx: number;
  zoom: number;
  punch: number;
  sparks: number;
  burst: number;
  dim: number;
}

/** The whole Storm Call, in base ms. Pure and deterministic. */
export function stormPlan(input: StormPlanInput, c: HeroStormConfig = cfg): StormPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays Tier IV (heroAttack/tiers.ts), so Big
  const level = stormLevel(tier);
  const V = stormLevelDials(level, c);
  const k = (level - 1) / 2;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, level, k, total, chargeAt: impactAt, absorbEnd: impactAt, boltAt: impactAt, bolts: [], storm: false,
      gatherAt: impactAt, rumbleAt: impactAt, rumbles: [], hits: [], impactAt, staticAt: impactAt, staticEnd: impactAt, endAt: r.endAt,
      shakePx: 0, zoom: 0, punch: 0, sparks: 0, burst: 0, dim: 0,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const boltAt = chargeAt + Math.max(V.ChargeMs, c.absorbMs);
  const forks = Math.round(clamp(V.Forks, 0, STORM_CAPS.forks));
  const hold = V.FlickerMs;
  const storm = level === 3;
  let bolts: BoltPlan[];
  let impactAt: number;
  let hits: number[] = [];
  let gatherAt = boltAt, rumbleAt = boltAt;
  let rumbles: number[] = [];
  let staticAt: number;

  if (level === 1) {
    bolts = [{ kind: 'arc', at: boltAt, leaderMs: V.LeaderMs, holdMs: hold, width: V.Width, jag: V.Jag, forks, strikes: true }];
    impactAt = boltAt + V.LeaderMs;
    staticAt = impactAt;
  } else if (level === 2) {
    // The trunk and the first branch race out together; the second branch splits off the fork a beat later.
    const trunkMs = V.LeaderMs * c.forkAt;
    const first = boltAt + V.LeaderMs;
    impactAt = first + c.forkGapMs;
    bolts = [
      { kind: 'trunk', at: boltAt, leaderMs: trunkMs, holdMs: hold + c.forkGapMs + V.LeaderMs * (1 - c.forkAt), width: V.Width * 1.15, jag: V.Jag, forks, strikes: false },
      { kind: 'branch', at: boltAt + trunkMs, leaderMs: V.LeaderMs - trunkMs, holdMs: hold, width: V.Width, jag: V.Jag, forks: Math.max(0, forks - 1), strikes: true },
      { kind: 'branch', at: impactAt - (V.LeaderMs - trunkMs), leaderMs: V.LeaderMs - trunkMs, holdMs: hold, width: V.Width, jag: V.Jag, forks: Math.max(0, forks - 1), strikes: true },
    ];
    hits = [first];
    staticAt = first;
  } else {
    // The hero calls up a thin bolt; the cloud gathers over the target, rumbles, and drops one thick strike.
    const callLeader = Math.max(40, c.callMs * 0.4);
    gatherAt = boltAt + callLeader * 0.6;
    rumbleAt = gatherAt + c.gatherMs;
    rumbles = [rumbleAt + c.rumbleMs * 0.2, rumbleAt + c.rumbleMs * 0.65];
    const strikeAt = rumbleAt + c.rumbleMs;
    impactAt = strikeAt + V.LeaderMs;
    bolts = [
      { kind: 'call', at: boltAt, leaderMs: callLeader, holdMs: c.callMs - callLeader, width: 0.55, jag: V.Jag * 1.2, forks: 1, strikes: false },
      { kind: 'strike', at: strikeAt, leaderMs: V.LeaderMs, holdMs: hold, width: V.Width, jag: V.Jag, forks, strikes: true },
    ];
    staticAt = impactAt;
  }

  const staticEnd = staticAt + (storm ? c.lingerMs : level === 2 ? c.staticMs + c.forkGapMs : 0);
  const lastBolt = Math.max(...bolts.map((b) => b.at + b.leaderMs + b.holdMs + c.fadeMs));
  // Static and a thinning cloud keep draining after the end (the scene runs until it is empty).
  const lastBeat = Math.max(impactAt + 160, impactAt + c.zoomOutMs * 0.8, lastBolt, storm ? impactAt + 480 : 0, level === 2 ? staticEnd - 120 : 0);
  const endAt = lastBeat + V.SettleMs;

  return {
    reduced: false, tier, level, k, total, chargeAt, absorbEnd, boltAt, bolts, storm, gatherAt, rumbleAt, rumbles, hits, impactAt,
    staticAt, staticEnd, endAt,
    shakePx: clamp(V.Shake, 0, STORM_CAPS.shakePx),
    zoom: clamp(V.Zoom, 0, STORM_CAPS.zoom),
    punch: V.Punch,
    sparks: Math.round(clamp(V.Sparks, 0, STORM_CAPS.sparks)),
    burst: V.Burst,
    dim: V.Dim,
  };
}

export type StormCueKind = 'charge' | 'bolt' | 'gather' | 'rumble' | 'hit' | 'impact' | 'end';
export interface StormCue { at: number; kind: StormCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a hit precedes the impact). */
export function stormCues(p: StormPlan): StormCue[] {
  const out: StormCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    p.bolts.forEach((b, i) => out.push({ at: b.at, kind: 'bolt', i }));
    if (p.storm) {
      out.push({ at: p.gatherAt, kind: 'gather', i: 0 });
      p.rumbles.forEach((at, i) => out.push({ at, kind: 'rumble', i }));
    }
    p.hits.forEach((at, i) => out.push({ at, kind: 'hit', i }));
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<StormCueKind, number> = { charge: 0, bolt: 1, gather: 2, rumble: 3, hit: 4, impact: 5, end: 6 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the bolt geometry (pure) ────────────────────────────────────────────────────────────────────────────────

/** One bolt's ends and bow (signed: which way its base curve swings). */
export interface BoltGeo { from: Pt; to: Pt; bow: number }

/** The view the cloud must stay inside. */
export interface ViewBox { w: number; h: number }

export interface StormGeo {
  bolts: BoltGeo[];
  /** Big: the storm cloud's centre, and its half width in px. */
  cloud: Pt | null;
  cloudR: number;
  /** Where each strike lands on the struck portrait (the hit flash, the sparks). */
  strikes: Pt[];
}

/**
 * Where every bolt runs, from the plan and the two heroes. Small arcs from the striker's rim into the face; Medium's
 * trunk splits at `forkAt` and its two branches land either side of the middle of the face; Big's call runs from the
 * hero up to a cloud gathered over the target (with no room above a hero at the top of the screen, the cloud rolls in
 * over the top edge and hangs just over the portrait), and the strike drops from the cloud into the top of the face. Pure: a replay strikes the same places.
 */
export function stormGeometry(p: StormPlan, a: Pt, d: Pt, radius: number, aRadius: number, c: Pick<HeroStormConfig, 'bow' | 'forkAt' | 'forkSpread' | 'cloudLift' | 'cloudSize'>, scale = 1, view: ViewBox | null = null): StormGeo {
  if (p.reduced) return { bolts: [], cloud: null, cloudR: 0, strikes: [] };
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const nrm = { x: -u.y, y: u.x };
  const rim = { x: a.x + u.x * aRadius * 0.7, y: a.y + u.y * aRadius * 0.7 };
  const bowSign = u.x >= 0 ? -1 : 1; // the arc bows up-screen on the usual diagonals
  if (p.level === 1) {
    const hit = { x: d.x - u.x * radius * 0.2, y: d.y - u.y * radius * 0.2 };
    return { bolts: [{ from: rim, to: hit, bow: c.bow * bowSign }], cloud: null, cloudR: 0, strikes: [hit] };
  }
  if (p.level === 2) {
    // The two branches land either side of the middle of the face, `forkSpread` (in radii) apart from the centre line.
    const sep = radius * (0.1 + c.forkSpread);
    const hitA = { x: d.x + nrm.x * sep - u.x * radius * 0.15, y: d.y + nrm.y * sep - u.y * radius * 0.15 };
    const hitB = { x: d.x - nrm.x * sep - u.x * radius * 0.15, y: d.y - nrm.y * sep - u.y * radius * 0.15 };
    const mid = { x: (hitA.x + hitB.x) / 2, y: (hitA.y + hitB.y) / 2 };
    const f = { x: rim.x + (mid.x - rim.x) * c.forkAt, y: rim.y + (mid.y - rim.y) * c.forkAt };
    return {
      bolts: [
        { from: rim, to: f, bow: c.bow * bowSign * 0.6 },
        { from: f, to: hitA, bow: c.bow * 0.5 },
        { from: f, to: hitB, bow: -c.bow * 0.5 },
      ],
      cloud: null, cloudR: 0, strikes: [hitA, hitB],
    };
  }
  // BIG: the cloud over the target.
  const cloudR = 190 * scale * c.cloudSize;
  const margin = 14 * scale + cloudR * 0.6;
  let cx = d.x;
  let cy = d.y - radius * c.cloudLift;
  if (cy < margin) {
    // No room above (a hero at the top of the screen): the cloud rolls in over the top edge, hanging just over the
    // portrait and a touch toward the striker, so the strike still DROPS onto the face (never a sideways beam).
    cy = Math.max(d.y - radius * 1.1, 4 * scale);
    cx += (a.x < d.x ? -1 : 1) * radius * 0.3;
  }
  if (view && view.w > 0) cx = clamp(cx, cloudR * 0.9, view.w - cloudR * 0.9);
  const cloud = { x: cx, y: cy };
  const base = { x: cx, y: cy + cloudR * 0.22 };
  const hit = { x: d.x, y: d.y - radius * 0.1 };
  // The call leaves the top of the striker's portrait (the hero raising the storm).
  const call = { x: a.x + u.x * aRadius * 0.2, y: a.y - aRadius * 0.8 };
  return {
    bolts: [
      { from: call, to: { x: cx - cloudR * 0.2, y: cy }, bow: c.bow * 1.4 * bowSign },
      { from: base, to: hit, bow: c.bow * 0.3 },
    ],
    cloud, cloudR, strikes: [hit],
  };
}

/** The direction THE blow arrives along (the last striking bolt): the shake and the knockback follow it. Unit. */
export function stormArrivalDir(p: StormPlan, g: StormGeo, a: Pt, d: Pt): Pt {
  const last = [...p.bolts.keys()].reverse().find((i) => p.bolts[i]!.strikes);
  const b = last !== undefined ? g.bolts[last] : undefined;
  const from = b ? b.from : a;
  const to = b ? b.to : d;
  const L = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / L, y: (to.y - from.y) / L };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The camera at sequence time `t`: a small push in through the charge (Big: through the gathering storm, with a faint
 * tremor as it rumbles); a kick along the bolt on each strike; on THE impact a punch in and a directional shake
 * (Big: hardest, mostly downward). Deterministic. Pure.
 */
export function stormCameraAt(p: StormPlan, c: HeroStormConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, (p.storm ? p.rumbleAt : p.boltAt) - p.chargeAt));
    if (p.storm && t >= p.rumbleAt) z += p.zoom * 0.4 * sine((t - p.rumbleAt) / Math.max(1, p.impactAt - p.rumbleAt));
  } else if (t >= p.impactAt) {
    z += (p.zoom * (p.storm ? 1.5 : 1) + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
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
  if (p.storm && t >= p.rumbleAt && t < p.impactAt) {
    const u = (t - p.rumbleAt) / Math.max(1, p.impactAt - p.rumbleAt);
    const a = p.shakePx * 0.08 * u;
    x += a * Math.sin(t * 0.12); y += a * Math.sin(t * 0.15 + 1.1);
  }
  p.hits.forEach((at) => kick(at, p.shakePx * 0.4, 40, 18, dir));
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, dir);
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** Where the camera anchors: the ATTACKER through the charge, the struck hero from the bolt (Big: from the gather) on. Pure. */
export function stormCameraFocus(p: StormPlan, t: number, a: Pt, d: Pt): Pt {
  const from = p.chargeAt;
  const to = p.storm ? p.gatherAt + (p.rumbleAt - p.gatherAt) * 0.5 : p.boltAt;
  if (t <= from + (to - from) * 0.4) return a;
  if (t >= to) return d;
  const e = sine((t - (from + (to - from) * 0.4)) / Math.max(1, (to - from) * 0.6));
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
