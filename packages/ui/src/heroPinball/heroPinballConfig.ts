/**
 * THE PINBALL HERO ATTACK ("Multiball", a Legendary with four looks): its tuned values, its pure timeline, the pure
 * geometry (the flipper beside the striker, the pop bumpers round the target, the lane of insert arrows, the wire ramp
 * and its loop, the score display), the pure paths of the steel balls, the state of every light, the tilt and the
 * camera.
 *
 * THE SIGNATURE: the board becomes a PINBALL TABLE. A FLIPPER (white bat, red rubber) stands in front of the striking
 * hero, the blow is a chrome STEEL BALL, the struck hero is the table's target (a ring of lamps round it), pop BUMPERS
 * rise round it and light when hit, and the top look rolls a JACKPOT up on a dot-matrix display that stops on the real
 * damage of the blow (`total`, the engine's number).
 *
 * FOUR LOOKS on the shared thresholds (`attackTier`: a knockout always plays IV):
 *  - I THE FLIPPER SHOT: the flipper snaps up and thwacks the ball straight into the target: a ding, the lamps light.
 *  - II THE BUMPERS: three pop bumpers rise round the target. The ball rattles between them (each one flashes, kicks
 *    and pops a "+10"), then drops onto the target.
 *  - III THE RAMP AND MULTIBALL: a wire ramp lights up arching over the play area. The ball shoots up it, goes round
 *    its loop and comes off as THREE balls ("MULTIBALL" on the display), which hit the bumpers and then the target in
 *    a quick cascade. The blow lands with the FIRST of the three; the other two are its echoes.
 *  - IV THE JACKPOT: the bumpers and the lane arrows chase, the ball goes wild between the bumpers, the striker shoves
 *    the table and the whole play area TILTS a few degrees and back ("TILT" blinks), then every light strobes and the
 *    JACKPOT rolls up, its last reel stopping on the damage number as the ball slams the target.
 *
 * The bounce order is rolled from the stable per-blow seed, so a replay bounces the same. Every point is computed from
 * the two portraits and kept on screen, so it works in both directions and on any layout. No hit-stop and no slow
 * motion: the one clock never changes pace, and the blow lands once, on `impactAt`.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, easeInOutSine, easeOutBack, easeOutCubic, seededRng, spring, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { TIERS };
export type { TierNum };

export const PINBALL_KINDS = ['flipper', 'bumpers', 'multiball', 'jackpot'] as const;
export type PinballKind = (typeof PINBALL_KINDS)[number];

/** Each tier's look. */
export function pinballKind(tier: TierNum): PinballKind { return PINBALL_KINDS[tier - 1]!; }

/** The tier dial groups the tuner shows (`t1` ... `t4`). */
export const PINBALL_LEVELS = ['t1', 't2', 't3', 't4'] as const;

export const PINBALL_TIER_SUFFIXES = [
  'ReadyMs', 'SetMs', 'FlightMs', 'Bounces', 'BounceMs', 'DropMs', 'HoldMs', 'OutMs', 'Zoom', 'Punch', 'Shake', 'Burst', 'Rings', 'Dim',
] as const;
export type PinballTierSuffix = (typeof PINBALL_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${PinballTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  ballSize: number;
  flipperSize: number;
  swingMs: number;
  bumperSize: number;
  bumperDist: number;
  kickPx: number;
  rampMs: number;
  rampBow: number;
  loopSize: number;
  splitMs: number;
  cascadeMs: number;
  chaseMs: number;
  tiltDeg: number;
  tiltMs: number;
  rollMs: number;
  displaySize: number;
  scoreSize: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorFlash: string;
  colorLamp: string;
  colorSpark: string;
  colorPlayer: string;
  colorFoe: string;
  sfxFlipperClip: string; sfxFlipperGain: number; sfxFlipperRate: number;
  sfxBumperClip: string; sfxBumperGain: number; sfxBumperRate: number;
  sfxRampClip: string; sfxRampGain: number; sfxRampRate: number;
  sfxReelClip: string; sfxReelGain: number; sfxReelRate: number;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroPinballConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_PINBALL_COLOR_KEYS = ['colorFlash', 'colorLamp', 'colorSpark', 'colorPlayer', 'colorFoe'] as const;
export const HERO_PINBALL_CLIP_KEYS = ['sfxFlipperClip', 'sfxBumperClip', 'sfxRampClip', 'sfxReelClip', 'sfxWhooshClip', 'sfxBoomClip'] as const;
export type HeroPinballStrKey = (typeof HERO_PINBALL_COLOR_KEYS)[number] | (typeof HERO_PINBALL_CLIP_KEYS)[number];
export type HeroPinballNumKey = Exclude<keyof HeroPinballConfig, HeroPinballStrKey>;

/** Per tier: [I, II, III, IV]. A dial a tier's look does not use is ignored there (the tuner says which). */
const TIER_DEFAULTS: Record<PinballTierSuffix, [number, number, number, number]> = {
  ReadyMs: [120, 110, 100, 100],
  SetMs: [300, 440, 460, 260],
  FlightMs: [280, 240, 200, 230],
  Bounces: [0, 6, 2, 4],
  BounceMs: [100, 108, 112, 94],
  DropMs: [0, 150, 140, 160],
  HoldMs: [420, 440, 480, 760],
  OutMs: [220, 240, 240, 280],
  Zoom: [0.02, 0.03, 0.035, 0.055],
  Punch: [0.01, 0.015, 0.02, 0.045],
  Shake: [2, 3, 6, 16],
  Burst: [0.8, 1, 1.25, 1.8],
  Rings: [1, 1, 2, 4],
  Dim: [0.12, 0.2, 0.26, 0.36],
};

export const PINBALL_TIER_RANGES: Record<PinballTierSuffix, [number, number, number]> = {
  ReadyMs: [0, 1000, 10],
  SetMs: [120, 1500, 10],
  FlightMs: [80, 1200, 10],
  Bounces: [0, 10, 1],
  BounceMs: [60, 400, 2],
  DropMs: [0, 600, 10],
  HoldMs: [0, 1800, 10],
  OutMs: [60, 1000, 10],
  Zoom: [0, 0.2, 0.005],
  Punch: [0, 0.1, 0.001],
  Shake: [0, 40, 0.5],
  Burst: [0, 3, 0.05],
  Rings: [0, 8, 1],
  Dim: [0, 0.6, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => PINBALL_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_PINBALL_DEFAULTS: HeroPinballConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 180,
  ballSize: 0.27,
  flipperSize: 1,
  swingMs: 70,
  bumperSize: 0.5,
  bumperDist: 1,
  kickPx: 9,
  rampMs: 720,
  rampBow: 0.2,
  loopSize: 0.8,
  splitMs: 150,
  cascadeMs: 95,
  chaseMs: 700,
  tiltDeg: 2.4,
  tiltMs: 520,
  rollMs: 660,
  displaySize: 1,
  scoreSize: 1,
  knockPx: 18,
  squash: 0.09,
  shakeMs: 300,
  zoomOutMs: 420,
  reducedFadeMs: 260,
  colorFlash: '#fff6e0',
  colorLamp: '#ffc13a',
  colorSpark: '#cfe6ff',
  colorPlayer: '#ffcf5a',
  colorFoe: '#ff6a5a',
  // ElevenLabs clips (2026-11-12), each trimmed to its hit and levelled to about -20 LUFS: the flipper's clack (its
  // transient is 25 ms in), a pop bumper (a solenoid thwack with a soft bell, its hit at 0), the ball on the wire ramp,
  // and a score reel rattling.
  sfxFlipperClip: 'fx/pinball-flipper', sfxFlipperGain: 0.6, sfxFlipperRate: 1,
  sfxBumperClip: 'fx/pinball-bumper', sfxBumperGain: 0.75, sfxBumperRate: 1,
  sfxRampClip: 'fx/pinball-ramp', sfxRampGain: 0.5, sfxRampRate: 1,
  sfxReelClip: 'fx/pinball-reel', sfxReelGain: 0.5, sfxReelRate: 1,
  // The whoosh and the boom are SHARED clips (always decoded on a phone), so they cost the phone audio budget nothing.
  sfxWhooshClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxWhooshGain: 0.26, sfxWhooshRate: 1.25,
  sfxBoomClip: 'fx/universfield-ground-impact-352053', sfxBoomGain: 0.4, sfxBoomRate: 1,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroPinballStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  ballSize: [0.12, 0.6, 0.01],
  flipperSize: [0.5, 2, 0.05],
  swingMs: [30, 300, 5],
  bumperSize: [0.25, 1, 0.01],
  bumperDist: [0.7, 1.6, 0.01],
  kickPx: [0, 40, 1],
  rampMs: [200, 2000, 10],
  rampBow: [0, 0.4, 0.01],
  loopSize: [0.3, 1.6, 0.05],
  splitMs: [60, 600, 10],
  cascadeMs: [30, 400, 5],
  chaseMs: [0, 2000, 10],
  tiltDeg: [0, 6, 0.1],
  tiltMs: [120, 1500, 10],
  rollMs: [200, 2000, 10],
  displaySize: [0.4, 2, 0.05],
  scoreSize: [0, 2.5, 0.05],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxFlipperGain: [0, 2, 0.05], sfxFlipperRate: [0.5, 2.5, 0.01],
  sfxBumperGain: [0, 2, 0.05], sfxBumperRate: [0.5, 2.5, 0.01],
  sfxRampGain: [0, 2, 0.05], sfxRampRate: [0.5, 2.5, 0.01],
  sfxReelGain: [0, 2, 0.05], sfxReelRate: [0.5, 2.5, 0.01],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_PINBALL_RANGES: Record<HeroPinballNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => PINBALL_TIER_SUFFIXES.map((s) => [`t${t}${s}`, PINBALL_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** Hard caps (whatever the tuner says). */
export const PINBALL_CAPS = { shakePx: 40, bounces: 10, hits: 24, arrows: 5, rampPts: 56, cells: 4 } as const;
export const BUMPERS = 3;
export const MAX_BALLS = 3;

const store = configStore<HeroPinballConfig>({
  key: 'ascent.heropinball.v1', defaults: HERO_PINBALL_DEFAULTS, ranges: HERO_PINBALL_RANGES,
  colorKeys: HERO_PINBALL_COLOR_KEYS, clipKeys: HERO_PINBALL_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroPinballStore = store;
export const getHeroPinballConfig = store.get;
export const clampHeroPinballValue = store.clamp;
export const sanitizeHeroPinballConfig = store.sanitize;
export const heroPinballConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1: the tuner has no speed buttons. */
export function heroPinballPreviewSpeed(): number { return 1; }

export function pinballTierDials(tier: TierNum, c: HeroPinballConfig = store.get()): Record<PinballTierSuffix, number> {
  return Object.fromEntries(PINBALL_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<PinballTierSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export interface PinballPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  reduced?: boolean;
  /** The stable per-blow seed: it rolls the bounce order (and nothing else). Default 1. */
  seed?: number;
}

/** One ball off one bumper. */
export interface PinballHit { at: number; bumper: number; ball: number; score: 10 | 50 }

export interface PinballPlan {
  reduced: boolean;
  tier: TierNum;
  kind: PinballKind;
  k: number;
  /** THE DAMAGE of this blow (the engine's): what the jackpot stops on. */
  total: number;
  seed: number;
  chargeAt: number;
  absorbEnd: number;
  /** The table pops up: the flipper, the ball, the target's lamps (and from II the bumpers and the lane arrows). */
  startAt: number;
  /** How many pop bumpers stand round the target (0 on I). */
  bumpers: number;
  /** IV: the lights chase (bumpers and lane arrows in sequence) until the flipper fires. Null elsewhere. */
  chaseAt: number | null;
  /** THE FLIPPER fires: the bat meets the ball. */
  strikeAt: number;
  swingMs: number;
  /** III: the ball takes the ramp, and comes off it as three (`multiAt`). */
  rampInAt: number | null;
  multiAt: number | null;
  /** How many balls are in play (3 on III). */
  balls: number;
  /** Every bumper hit, in time order. */
  hits: PinballHit[];
  /** IV: the table is shoved and tilts, and is level again. */
  tiltAt: number | null;
  tiltEnd: number | null;
  /** IV: every light strobes and the jackpot rolls up, from here until the impact. */
  rollAt: number | null;
  /** THE impact: the (first) ball slams the target. The blow lands here, once. */
  impactAt: number;
  /** III: the second and third balls hitting the target (echoes of the blow; they land nothing). */
  echoes: number[];
  /** The table drops away. */
  outAt: number;
  endAt: number;
  // the looks
  zoom: number;
  punch: number;
  shakePx: number;
  burst: number;
  rings: number;
  dim: number;
}

/** The next bumper a ball bounces to: never the one it just left. */
function nextBumper(cur: number, rnd: () => number): number { return (cur + 1 + (rnd() < 0.5 ? 0 : 1)) % BUMPERS; }

/** The whole attack, in base ms. Pure and deterministic. */
export function pinballPlan(input: PinballPlanInput, c: HeroPinballConfig = store.get()): PinballPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const kind = pinballKind(tier);
  const L = pinballTierDials(tier, c);
  const k = (tier - 1) / 3;
  const seed = (Math.round(input.seed ?? 1) >>> 0) || 1;
  const looks = {
    tier, kind, k, total, seed, zoom: L.Zoom, punch: L.Punch, shakePx: clamp(L.Shake, 0, PINBALL_CAPS.shakePx), burst: L.Burst,
    rings: Math.round(L.Rings), dim: L.Dim, swingMs: Math.max(30, c.swingMs),
  };
  const none = { chaseAt: null, rampInAt: null, multiAt: null, tiltAt: null, tiltEnd: null, rollAt: null, hits: [] as PinballHit[], echoes: [] as number[] };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...looks, ...none, reduced: true, chargeAt: at, absorbEnd: at, startAt: at, bumpers: 0, balls: 1, strikeAt: at, impactAt: at, outAt: at, endAt: r.endAt,
      zoom: 0, punch: 0, shakePx: 0, burst: 0, rings: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const startAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs * 0.6);
  const flight = Math.max(80, L.FlightMs);
  const bounce = Math.max(60, L.BounceMs);
  const n = clamp(Math.round(L.Bounces), 0, PINBALL_CAPS.bounces);
  const rnd = seededRng(seed ^ 0x9e3779b9);
  const base = { ...looks, ...none, reduced: false, chargeAt, absorbEnd, startAt };
  const finish = (impactAt: number, last: number): { impactAt: number; outAt: number; endAt: number } => {
    const outAt = last + L.HoldMs;
    return { impactAt, outAt, endAt: outAt + Math.max(60, L.OutMs) };
  };
  /** `count` bounces of ball `ball`, the first at `t0` off bumper `first`; each gap is the bounce time, a little uneven. */
  const rattle = (ball: number, first: number, t0: number, count: number, score: 10 | 50): PinballHit[] => {
    const out: PinballHit[] = [];
    let b = first, t = t0;
    for (let i = 0; i < count; i++) {
      out.push({ at: t, bumper: b, ball, score });
      b = nextBumper(b, rnd);
      t += bounce * (0.86 + 0.28 * rnd());
    }
    return out;
  };

  if (kind === 'flipper') {
    const strikeAt = startAt + L.SetMs;
    const impactAt = strikeAt + flight;
    return { ...base, bumpers: 0, balls: 1, strikeAt, ...finish(impactAt, impactAt) };
  }
  if (kind === 'bumpers') {
    const strikeAt = startAt + L.SetMs;
    const hits = rattle(0, Math.floor(rnd() * BUMPERS) % BUMPERS, strikeAt + flight, Math.max(1, n), 10);
    const impactAt = hits[hits.length - 1]!.at + Math.max(60, L.DropMs);
    return { ...base, bumpers: BUMPERS, balls: 1, strikeAt, hits, ...finish(impactAt, impactAt) };
  }
  if (kind === 'multiball') {
    const strikeAt = startAt + L.SetMs;
    const rampInAt = strikeAt + flight;
    const multiAt = rampInAt + Math.max(200, c.rampMs);
    // Three balls come off the ramp one behind the other: each goes to its OWN bumper first, rattles, and drops.
    const first = Math.floor(rnd() * BUMPERS) % BUMPERS;
    const turn = rnd() < 0.5 ? 1 : 2;
    const per = Math.max(1, Math.min(4, n));
    const gap = Math.max(30, c.cascadeMs);
    let hits: PinballHit[] = [];
    const lands: number[] = [];
    for (let b = 0; b < MAX_BALLS; b++) {
      const h = rattle(b, (first + b * turn) % BUMPERS, multiAt + Math.max(60, c.splitMs) + gap * b, per, 10);
      hits = hits.concat(h);
      lands.push(h[h.length - 1]!.at + Math.max(60, L.DropMs));
    }
    // The cascade lands in order, never closer than half a gap (an uneven bounce cannot make two balls land together).
    for (let b = 1; b < lands.length; b++) lands[b] = Math.max(lands[b]!, lands[b - 1]! + gap * 0.5);
    hits.sort((p, q) => p.at - q.at);
    return { ...base, bumpers: BUMPERS, balls: MAX_BALLS, strikeAt, rampInAt, multiAt, hits, echoes: lands.slice(1), ...finish(lands[0]!, lands[lands.length - 1]!) };
  }
  // THE JACKPOT: the lights chase, the ball goes wild, the table tilts, everything strobes and the score rolls up.
  const chaseAt = startAt + L.SetMs;
  const strikeAt = chaseAt + Math.max(0, c.chaseMs);
  const first = Math.floor(rnd() * BUMPERS) % BUMPERS;
  const before = Math.max(1, n);
  const tiltMs = Math.max(120, c.tiltMs), rollMs = Math.max(200, c.rollMs), drop = Math.max(60, L.DropMs);
  // Enough bounces to carry the ball through the tilt and the roll-up (capped; a short one just rolls up sooner).
  const count = Math.min(PINBALL_CAPS.hits, before + Math.ceil((tiltMs + rollMs - drop) / bounce));
  const hits = rattle(0, first, strikeAt + flight, count, 50);
  const tiltAt = hits[Math.min(before, hits.length) - 1]!.at;
  const impactAt = Math.max(hits[hits.length - 1]!.at + drop, tiltAt + tiltMs + 200);
  const rollAt = Math.max(tiltAt + tiltMs, impactAt - rollMs);
  return { ...base, bumpers: BUMPERS, balls: 1, chaseAt, strikeAt, hits, tiltAt, tiltEnd: tiltAt + tiltMs, rollAt, ...finish(impactAt, impactAt) };
}

export type PinballCueKind = 'charge' | 'table' | 'chase' | 'flip' | 'ramp' | 'multi' | 'bump' | 'tilt' | 'roll' | 'impact' | 'echo' | 'out' | 'end';
export interface PinballCue { at: number; kind: PinballCueKind; i: number }

/** The plan's beats in time order (the runner fires each once). `bump`'s `i` indexes `plan.hits`. */
export function pinballCues(p: PinballPlan): PinballCue[] {
  const out: PinballCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.startAt, kind: 'table', i: 0 });
    if (p.chaseAt !== null) out.push({ at: p.chaseAt, kind: 'chase', i: 0 });
    out.push({ at: p.strikeAt, kind: 'flip', i: 0 });
    if (p.rampInAt !== null) out.push({ at: p.rampInAt, kind: 'ramp', i: 0 });
    if (p.multiAt !== null) out.push({ at: p.multiAt, kind: 'multi', i: 0 });
    p.hits.forEach((h, i) => out.push({ at: h.at, kind: 'bump', i }));
    if (p.tiltAt !== null) out.push({ at: p.tiltAt, kind: 'tilt', i: 0 });
    if (p.rollAt !== null) out.push({ at: p.rollAt, kind: 'roll', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  p.echoes.forEach((at, i) => out.push({ at, kind: 'echo', i }));
  if (!p.reduced) out.push({ at: p.outAt, kind: 'out', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order = (q: PinballCue): number => (q.kind === 'end' ? 2 : q.kind === 'impact' ? 1 : 0);
  return out.map((q, i) => ({ q, i })).sort((a, b) => a.q.at - b.q.at || order(a.q) - order(b.q) || a.i - b.i).map((x) => x.q);
}

// ─── the pure geometry ─────────────────────────────────────────────────────────────────────────────────────────

export interface Frame { x0: number; y0: number; x1: number; y1: number }

export function clampToFrame(p: Pt, f: Frame | null, mx: number, my = mx): Pt {
  if (!f) return p;
  const fx = Math.min(mx, (f.x1 - f.x0) / 2), fy = Math.min(my, (f.y1 - f.y0) / 2);
  return { x: clamp(p.x, f.x0 + fx, f.x1 - fx), y: clamp(p.y, f.y0 + fy, f.y1 - fy) };
}

/** How far inside the frame a point is (negative = outside). */
function inside(p: Pt, f: Frame | null): number {
  if (!f) return 1e6;
  return Math.min(p.x - f.x0, f.x1 - p.x, p.y - f.y0, f.y1 - p.y);
}

/** The wire ramp: evenly spaced points along it (entry first), each with the rail's heading. */
export interface RampPath { n: number; xs: number[]; ys: number[]; rot: number[]; length: number; spacing: number; side: 1 | -1 }

export interface PinballGeo {
  /** Unit vector from the striker to the target, and its normal. */
  u: Pt;
  n: Pt;
  dist: number;
  ballR: number;
  /** The flipper: its pivot, its length, and its resting / raised headings (radians). */
  pivot: Pt;
  batLen: number;
  restAng: number;
  upAng: number;
  /** Where the ball waits on the bat (and is struck). */
  cradle: Pt;
  /** The target's centre: every ball ends here. */
  hit: Pt;
  bumperR: number;
  /** The pop bumpers: [0] in front of the target (the striker's side), [1] and [2] flanking it. */
  bumpers: Pt[];
  /** The lane's insert arrows, striker to target, all pointing at the target (`arrowRot`). */
  arrows: Pt[];
  arrowRot: number;
  ramp: RampPath;
  /** The dot-matrix display: its centre and width (its height is `DISPLAY_ASPECT` of it). */
  display: Pt;
  displayW: number;
}

export const DISPLAY_ASPECT = 0.36;

const add = (p: Pt, d: Pt, k: number): Pt => ({ x: p.x + d.x * k, y: p.y + d.y * k });

/** Build the ramp for one side and size; `fit` is how far inside the frame its worst point is. */
function rampFor(e: Pt, x: Pt, n: Pt, side: 1 | -1, bow: number, loopR: number, frame: Frame | null, margin: number): { path: RampPath; fit: number } {
  const mid = { x: (e.x + x.x) / 2, y: (e.y + x.y) / 2 };
  const cq = add(mid, n, side * bow * 2);
  const bez = (v: number): Pt => {
    const m = 1 - v;
    return { x: m * m * e.x + 2 * m * v * cq.x + v * v * x.x, y: m * m * e.y + 2 * m * v * cq.y + v * v * x.y };
  };
  const apex = bez(0.5);
  // The loop sits on the OUTSIDE of the bow; the ball enters it heading the way the ramp runs.
  const cc = add(apex, n, side * loopR);
  const a0 = Math.atan2(apex.y - cc.y, apex.x - cc.x);
  const run = { x: x.x - e.x, y: x.y - e.y };
  const turn = (-Math.sin(a0)) * run.x + Math.cos(a0) * run.y >= 0 ? 1 : -1;
  const raw: Pt[] = [];
  const HALF = 12, LOOP = 22;
  for (let i = 0; i <= HALF; i++) raw.push(bez((i / HALF) * 0.5));
  for (let i = 1; i <= LOOP; i++) { const a = a0 + turn * (i / LOOP) * Math.PI * 2; raw.push({ x: cc.x + Math.cos(a) * loopR, y: cc.y + Math.sin(a) * loopR }); }
  for (let i = 1; i <= HALF; i++) raw.push(bez(0.5 + (i / HALF) * 0.5));
  // Resample evenly.
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1]! + Math.hypot(raw[i]!.x - raw[i - 1]!.x, raw[i]!.y - raw[i - 1]!.y));
  const length = cum[cum.length - 1]!;
  const count = clamp(Math.round(length / Math.max(8, margin * 1.25)) + 1, 8, PINBALL_CAPS.rampPts);
  const xs: number[] = [], ys: number[] = [], rot: number[] = [];
  let j = 0, fit = 1e6;
  for (let i = 0; i < count; i++) {
    const s = (length * i) / (count - 1);
    while (j < cum.length - 2 && cum[j + 1]! < s) j++;
    const seg = Math.max(1e-6, cum[j + 1]! - cum[j]!);
    const v = clamp01((s - cum[j]!) / seg);
    const p = { x: raw[j]!.x + (raw[j + 1]!.x - raw[j]!.x) * v, y: raw[j]!.y + (raw[j + 1]!.y - raw[j]!.y) * v };
    xs.push(p.x); ys.push(p.y); rot.push(Math.atan2(raw[j + 1]!.y - raw[j]!.y, raw[j + 1]!.x - raw[j]!.x));
    fit = Math.min(fit, inside(p, frame) - margin);
  }
  return { path: { n: count, xs, ys, rot, length, spacing: length / (count - 1), side }, fit };
}

/**
 * Every point of the table, from the two portraits (centres and radii) and the frame it must stay inside. Pure.
 * `a` / `d`: the striking and the struck hero.
 */
export function pinballGeo(a: Pt, d: Pt, aR: number, dR: number, frame: Frame | null, c: HeroPinballConfig = store.get()): PinballGeo {
  const dx = d.x - a.x, dy = d.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const u = { x: dx / dist, y: dy / dist };
  const n = { x: -u.y, y: u.x };
  const ballR = aR * c.ballSize;

  // THE FLIPPER: in front of the striker, its pivot off to one side and the bat lying across the lane.
  const batLen = aR * 1.5 * c.flipperSize;
  const fwd = Math.min(aR * 1.75, dist * 0.3);
  const REST = 0.5, UP = 0.52;
  const flip = (s: 1 | -1): { pivot: Pt; base: Pt; tipUp: Pt } => {
    const pivot = add(add(a, u, fwd), n, s * aR * 0.8);
    const base = { x: -n.x * s, y: -n.y * s };
    const tipUp = add(add(pivot, base, batLen * Math.cos(UP)), u, batLen * Math.sin(UP));
    return { pivot, base, tipUp };
  };
  const fp = flip(1), fm = flip(-1);
  const score = (f: { pivot: Pt; tipUp: Pt }): number => Math.min(inside(f.pivot, frame), inside(f.tipUp, frame));
  const fl = score(fm) > score(fp) + 1 ? fm : fp;
  const baseAng = Math.atan2(fl.base.y, fl.base.x);
  // Which way round turns the bat toward the target.
  const sg = fl.base.x * u.y - fl.base.y * u.x >= 0 ? 1 : -1;
  const restAng = baseAng - sg * REST, upAng = baseAng + sg * UP;
  const restDir = { x: Math.cos(restAng), y: Math.sin(restAng) };
  let lead = { x: -restDir.y, y: restDir.x };
  if (lead.x * u.x + lead.y * u.y < 0) lead = { x: -lead.x, y: -lead.y };
  const cradle = add(add(fl.pivot, restDir, batLen * 0.62), lead, batLen * 0.1 + ballR);

  // THE BUMPERS: one in front of the target, two flanking it, pulled in when the portraits are close.
  const bumperR = dR * c.bumperSize;
  const room = (dist - fwd - aR * 0.9) / (3.05 * dR * c.bumperDist + bumperR);
  const bk = clamp(room, 0.55, 1) * c.bumperDist;
  const keep = (p: Pt): Pt => {
    let q = clampToFrame(p, frame, bumperR * 1.15);
    // Never over the target's lamps: pushed back out along the way it came.
    const gx = q.x - d.x, gy = q.y - d.y, gl = Math.hypot(gx, gy) || 1;
    const min = dR * 1.2 + bumperR;
    if (gl < min) q = clampToFrame({ x: d.x + (gx / gl) * min, y: d.y + (gy / gl) * min }, frame, bumperR * 1.15);
    return q;
  };
  const bumpers = [
    keep(add(d, u, -3.05 * dR * bk)),
    keep(add(add(d, u, -1.5 * dR * bk), n, 1.75 * dR * bk)),
    keep(add(add(d, u, -1.5 * dR * bk), n, -1.75 * dR * bk)),
  ];

  // THE LANE: insert arrows from past the flipper to short of the front bumper.
  const s0 = fwd + aR * 1.7, s1 = dist - (3.05 * dR * bk + bumperR * 1.9);
  const step = aR * 0.95;
  const count = s1 - s0 < step * 0.5 ? 0 : clamp(Math.floor((s1 - s0) / step) + 1, 1, PINBALL_CAPS.arrows);
  const arrows: Pt[] = [];
  for (let i = 0; i < count; i++) arrows.push(add(a, u, count === 1 ? (s0 + s1) / 2 : s0 + ((s1 - s0) * i) / (count - 1)));

  // THE RAMP: from past the flipper, bowing out to one side with a loop at its top, down to the front of the bumpers.
  const eS = Math.min(fwd + aR * 2.1, dist * 0.34), xS = Math.max(eS + dR, dist - (3.05 * dR * bk + bumperR * 2.6));
  const e = add(a, u, eS), x = add(a, u, xS);
  const margin = ballR * 1.6;
  let best: { path: RampPath; fit: number } | null = null;
  for (const k of [1, 0.75, 0.5, 0.3]) {
    for (const s of [1, -1] as const) {
      const r = rampFor(e, x, n, s, c.rampBow * dist * k, dR * c.loopSize * Math.max(0.6, k), frame, margin);
      if (!best || r.fit > best.fit) best = r;
      if (r.fit >= 0) break;
    }
    if (best && best.fit >= 0) break;
  }
  const ramp = best!.path;

  // THE DISPLAY: on the other side of the lane from the ramp, kept whole on screen.
  const displayW = dR * 3.3 * c.displaySize;
  const dh = displayW * DISPLAY_ASPECT;
  const display = clampToFrame(add(add(a, u, dist * 0.56), n, -ramp.side * (dist * 0.09 + dh * 0.5)), frame, displayW / 2 + 10, dh / 2 + 10);

  return { u, n, dist, ballR, pivot: fl.pivot, batLen, restAng, upAng, cradle, hit: { x: d.x, y: d.y }, bumperR, bumpers, arrows, arrowRot: Math.atan2(u.y, u.x), ramp, display, displayW };
}

// ─── the balls' paths (built once per attack) ──────────────────────────────────────────────────────────────────

/** One ball's path: straight runs between keyframes (time, x, y). It is in play from `ts[0]` until `end`. */
export interface BallTrack { ts: number[]; xs: number[]; ys: number[]; end: number }
export interface PinballPaths {
  tracks: BallTrack[];
  /** For each `plan.hits[i]`: the unit way the ball was travelling INTO the bumper (the way it is kicked). */
  kicks: Pt[];
  /** The way the blow drives into the target (the first ball's last run). */
  blowDir: Pt;
}

/** Build every ball's path from the plan and the table. Pure. */
export function pinballPaths(p: PinballPlan, g: PinballGeo): PinballPaths {
  const kicks: Pt[] = p.hits.map(() => ({ x: g.u.x, y: g.u.y }));
  const tracks: BallTrack[] = [];
  let blowDir = { x: g.u.x, y: g.u.y };
  if (p.reduced) return { tracks, kicks, blowDir };
  const reach = g.bumperR * 0.92 + g.ballR;
  for (let b = 0; b < p.balls; b++) {
    const tr: BallTrack = { ts: [], xs: [], ys: [], end: 0 };
    const push = (t: number, x: number, y: number): void => {
      // Keyframes never go back in time (a tuner can ask for a zero-length run).
      const last = tr.ts.length ? tr.ts[tr.ts.length - 1]! : -Infinity;
      tr.ts.push(Math.max(t, last + 0.01)); tr.xs.push(x); tr.ys.push(y);
    };
    if (b === 0) {
      push(p.startAt, g.cradle.x, g.cradle.y);
      push(p.strikeAt, g.cradle.x, g.cradle.y);
      if (p.rampInAt !== null && p.multiAt !== null) {
        const r = g.ramp;
        for (let i = 0; i < r.n; i++) push(p.rampInAt + ((p.multiAt - p.rampInAt) * i) / (r.n - 1), r.xs[i]!, r.ys[i]!);
      }
    } else if (p.multiAt !== null) {
      const r = g.ramp;
      push(p.multiAt, r.xs[r.n - 1]!, r.ys[r.n - 1]!);
    }
    p.hits.forEach((h, i) => {
      if (h.ball !== b || !g.bumpers[h.bumper]) return;
      const c = g.bumpers[h.bumper]!;
      const px = tr.xs[tr.xs.length - 1]!, py = tr.ys[tr.ys.length - 1]!;
      const dx = c.x - px, dy = c.y - py, dl = Math.hypot(dx, dy) || 1;
      kicks[i] = { x: dx / dl, y: dy / dl };
      push(h.at, c.x - (dx / dl) * reach, c.y - (dy / dl) * reach);
    });
    const land = b === 0 ? p.impactAt : (p.echoes[b - 1] ?? p.impactAt);
    const lx = tr.xs[tr.xs.length - 1]!, ly = tr.ys[tr.ys.length - 1]!;
    push(land, g.hit.x, g.hit.y);
    tr.end = tr.ts[tr.ts.length - 1]!;
    if (b === 0) { const l = Math.hypot(g.hit.x - lx, g.hit.y - ly); if (l > 1) blowDir = { x: (g.hit.x - lx) / l, y: (g.hit.y - ly) / l }; }
    tracks.push(tr);
  }
  return { tracks, kicks, blowDir };
}

export interface BallState { visible: boolean; x: number; y: number; vx: number; vy: number; scale: number }
export const newBallState = (): BallState => ({ visible: false, x: 0, y: 0, vx: 0, vy: 0, scale: 1 });

/** Where a ball is at `t` (written into `out`, no allocation). `vx` / `vy` are px per ms. Pure. */
export function ballAt(tr: BallTrack | undefined, t: number, out: BallState, popMs = 160): BallState {
  if (!tr || tr.ts.length < 2 || t < tr.ts[0]! || t >= tr.end) { out.visible = false; out.vx = 0; out.vy = 0; return out; }
  let lo = 0, hi = tr.ts.length - 2;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tr.ts[m]! <= t) lo = m; else hi = m - 1; }
  const t0 = tr.ts[lo]!, t1 = tr.ts[lo + 1]!;
  const v = clamp01((t - t0) / Math.max(1e-6, t1 - t0));
  const x0 = tr.xs[lo]!, y0 = tr.ys[lo]!, x1 = tr.xs[lo + 1]!, y1 = tr.ys[lo + 1]!;
  out.visible = true;
  out.x = x0 + (x1 - x0) * v; out.y = y0 + (y1 - y0) * v;
  out.vx = (x1 - x0) / Math.max(1e-6, t1 - t0); out.vy = (y1 - y0) / Math.max(1e-6, t1 - t0);
  out.scale = popMs > 0 ? Math.max(0, easeOutBack((t - tr.ts[0]!) / popMs, 1.8)) : 1;
  return out;
}

// ─── the table's state at a time (pure) ────────────────────────────────────────────────────────────────────────

/** How far the table has popped up (0..1, overshooting a touch), `delay` ms after the start, and dropped away at the end. */
export function tableIn(p: PinballPlan, t: number, delay = 0): number {
  if (p.reduced || t < p.startAt + delay) return 0;
  const up = easeOutBack((t - p.startAt - delay) / 220, 1.7);
  const out = t <= p.outAt ? 1 : 1 - easeOutCubic((t - p.outAt) / Math.max(60, p.endAt - p.outAt));
  return Math.max(0, up * out);
}

/** The flipper's heading (radians): resting, snapped up through the strike, held a beat, dropped back. */
export function flipperAngle(p: PinballPlan, g: PinballGeo, t: number): number {
  const from = p.strikeAt - p.swingMs * 0.5;
  if (t <= from) return g.restAng;
  const up = clamp01((t - from) / p.swingMs);
  const hold = p.strikeAt + p.swingMs * 0.5 + 150;
  const down = t <= hold ? 0 : easeInOutSine((t - hold) / 170);
  return g.restAng + (g.upAng - g.restAng) * (easeOutCubic(up) - down);
}

export interface BumperState { x: number; y: number; scale: number; lit: boolean; alpha: number }
export const newBumperState = (): BumperState => ({ x: 0, y: 0, scale: 0, lit: false, alpha: 0 });
const FLASH_MS = 130;

/** Bumper `i` at `t`: popped up, flashing and kicked by a hit, chasing and strobing on the jackpot. Pure. */
export function bumperAt(p: PinballPlan, g: PinballGeo, paths: PinballPaths, i: number, t: number, kickPx: number, out: BumperState): BumperState {
  const at = g.bumpers[i];
  const k = i < p.bumpers && at ? tableIn(p, t, 70 * i) : 0;
  if (!at || k <= 0.001) { out.alpha = 0; out.scale = 0; out.lit = false; return out; }
  let kx = 0, ky = 0, punch = 0, lit = false;
  for (let h = 0; h < p.hits.length; h++) {
    const hit = p.hits[h]!;
    if (hit.bumper !== i) continue;
    const since = t - hit.at;
    if (since < 0) break;
    if (since < FLASH_MS) lit = true;
    if (since < 400) {
      const s = spring(since, 7, 55);
      const dir = paths.kicks[h]!;
      kx += dir.x * kickPx * s; ky += dir.y * kickPx * s; punch += 0.16 * s;
    }
  }
  if (p.chaseAt !== null && t >= p.chaseAt && t < p.strikeAt) lit = lit || Math.floor((t - p.chaseAt) / 90) % BUMPERS === i;
  if (p.rollAt !== null && t >= p.rollAt && t < p.outAt) lit = (Math.floor((t - p.rollAt) / 70) + i) % 2 === 0;
  else if (t >= p.impactAt && t < p.impactAt + 280) lit = true;
  out.x = at.x + kx; out.y = at.y + ky; out.scale = k * (1 + punch); out.lit = lit; out.alpha = Math.min(1, k * 1.6);
  return out;
}

/** The target's ring of lamps: whether it is lit and which marquee step it shows (it turns one lamp per step). */
export function lampAt(p: PinballPlan, t: number): { lit: boolean; step: number } {
  if (p.rollAt !== null && t >= p.rollAt && t < p.impactAt) return { lit: Math.floor((t - p.rollAt) / 70) % 2 === 0, step: Math.floor((t - p.rollAt) / 70) };
  if (t >= p.impactAt) return { lit: true, step: Math.floor((t - p.impactAt) / 90) };
  if (p.chaseAt !== null && t >= p.chaseAt && t < p.strikeAt) return { lit: Math.floor((t - p.chaseAt) / 175) % 2 === 1, step: 0 };
  return { lit: false, step: 0 };
}

/** Lane arrow `j` of `n`: lit in the chase (IV), in a wave behind the launched ball, and strobing with the jackpot. */
export function arrowLit(p: PinballPlan, j: number, n: number, t: number): boolean {
  if (n <= 0) return false;
  if (p.chaseAt !== null && t >= p.chaseAt && t < p.strikeAt) return Math.floor((t - p.chaseAt) / 70) % n === j;
  if (p.rollAt !== null && t >= p.rollAt && t < p.outAt) return (Math.floor((t - p.rollAt) / 70) + j) % 2 === 1;
  const wave = t - (p.strikeAt + j * 45);
  return wave >= 0 && wave < 260;
}

/** The ramp (III): how much of it has lit up (0..1, entry first) and its opacity. */
export function rampAt(p: PinballPlan, t: number): { reveal: number; alpha: number } {
  if (p.rampInAt === null || p.multiAt === null || t < p.startAt + 120) return { reveal: 0, alpha: 0 };
  const reveal = clamp01((t - p.startAt - 120) / 300);
  const gone = p.multiAt + 320;
  return { reveal, alpha: t <= gone ? 1 : 1 - clamp01((t - gone) / 260) };
}

export type DisplayWord = 'multiball' | 'tilt' | 'jackpot';
export interface DisplayState { alpha: number; scale: number; word: DisplayWord | null; wordOn: boolean; score: boolean }

/** The dot-matrix display: MULTIBALL on III; on IV TILT blinking, then JACKPOT over the score. Pure. */
export function displayAt(p: PinballPlan, t: number): DisplayState {
  const off: DisplayState = { alpha: 0, scale: 0, word: null, wordOn: false, score: false };
  if (p.reduced) return off;
  const win = (from: number, to: number): { alpha: number; scale: number } => ({
    scale: Math.max(0, easeOutBack((t - from) / 200, 1.6)), alpha: clamp01((t - from) / 90) * (1 - clamp01((t - to) / 200)),
  });
  if (p.kind === 'multiball' && p.multiAt !== null) {
    const from = p.multiAt - 60, to = p.outAt;
    if (t < from || t > to + 200) return off;
    return { ...win(from, to), word: 'multiball', wordOn: t > p.multiAt + 700 || Math.floor((t - from) / 100) % 2 === 0, score: false };
  }
  if (p.kind === 'jackpot' && p.tiltAt !== null && p.rollAt !== null) {
    const from = p.tiltAt - 40, to = p.outAt;
    if (t < from || t > to + 200) return off;
    if (t < p.rollAt) return { ...win(from, to), word: 'tilt', wordOn: Math.floor((t - from) / 110) % 2 === 0, score: false };
    // After the stop, JACKPOT blinks over the standing score.
    return { ...win(from, to), word: 'jackpot', wordOn: t < p.impactAt || Math.floor((t - p.impactAt) / 120) % 2 === 0, score: true };
  }
  return off;
}

/** How many reels the jackpot shows: the damage's digits, never fewer than two. */
export function jackpotCells(total: number): number {
  return clamp(String(Math.max(0, Math.round(total))).length, 2, PINBALL_CAPS.cells);
}

/** When reel `i` (0 = the leftmost) stops. The last one stops exactly on the impact. */
export function reelStopAt(p: PinballPlan, i: number, cells: number): number {
  if (p.rollAt === null) return p.impactAt;
  return p.rollAt + (p.impactAt - p.rollAt) * (0.5 + (0.5 * (i + 1)) / cells);
}

/**
 * THE JACKPOT'S REELS at `t`, written into `out` (one digit per reel, leftmost first): each spins until its stop, then
 * shows its digit of the DAMAGE. From the impact on, the display reads exactly `total`. Pure.
 */
export function jackpotDigits(p: PinballPlan, t: number, out: number[]): number[] {
  const cells = jackpotCells(p.total);
  const shown = Math.min(p.total, Math.pow(10, cells) - 1);
  out.length = cells;
  for (let i = 0; i < cells; i++) {
    const digit = Math.floor(shown / Math.pow(10, cells - 1 - i)) % 10;
    out[i] = t >= reelStopAt(p, i, cells) ? digit : (Math.floor(t / 42) * (3 + 2 * i) + i * 7 + (p.seed % 10)) % 10;
  }
  return out;
}

/** IV's TILT (radians): shoved one way, rocked back past level, and settled. 0 outside it. Pure. */
export function tiltAt(p: PinballPlan, c: HeroPinballConfig, t: number): number {
  if (p.tiltAt === null || p.tiltEnd === null || t <= p.tiltAt || t >= p.tiltEnd) return 0;
  const v = (t - p.tiltAt) / (p.tiltEnd - p.tiltAt);
  const max = (clamp(c.tiltDeg, 0, 6) * Math.PI) / 180;
  // A fast shove up to the peak (a fifth of the way in), a smaller rock back past level, and settled at exactly 0.
  return max * 1.36 * Math.sin(v * Math.PI * 2.5) * Math.pow(1 - v, 1.5) * Math.min(1, v * 8);
}

/** The striker's own little moves (px along the lane and across it, degrees): the flip's jolt, and IV's shove. */
export function strikerPose(p: PinballPlan, t: number, aR: number): { along: number; across: number; rot: number } {
  if (p.reduced) return { along: 0, across: 0, rot: 0 };
  let along = 0, across = 0, rot = 0;
  // Leaning back into the flip, then jolting forward with it.
  const wind = clamp01((t - (p.strikeAt - 200)) / 170);
  if (t < p.strikeAt) along -= aR * 0.07 * easeInOutSine(wind);
  else { const s = spring(t - p.strikeAt, 4.5, 80); along += aR * 0.16 * s; rot += 5 * s; }
  if (p.tiltAt !== null && t >= p.tiltAt) { const s = spring(t - p.tiltAt, 3.5, 110); across += aR * 0.3 * s; rot -= 7 * s; }
  return { along, across, rot };
}

/** The view: pushed in on the target while the ball is in play, punched and shaken on the impact, jolted by the tilt. */
export function pinballCameraAt(p: PinballPlan, c: HeroPinballConfig, t: number, dir: Pt): { zoom: number; x: number; y: number } {
  if (p.reduced || t < p.strikeAt) return { zoom: 1, x: 0, y: 0 };
  const settle = p.impactAt + 260;
  const push = easeInOutSine((t - p.strikeAt) / Math.max(1, p.impactAt - p.strikeAt)) * (1 - easeInOutSine((t - settle) / Math.max(60, c.zoomOutMs)));
  let zoom = 1 + p.zoom * push;
  let x = 0, y = 0;
  const jolt = (since: number, px: number, d: Pt): void => {
    if (since < 0 || px <= 0) return;
    const fall = Math.exp(-since / Math.max(1, c.shakeMs * 0.35));
    const a = Math.sin(since * 0.085) * fall, b = Math.sin(since * 0.131 + 1.3) * fall * 0.6;
    x += (d.x * a - d.y * b) * px; y += (d.y * a + d.x * b) * px;
  };
  if (t >= p.impactAt) {
    zoom += p.punch * Math.max(0, spring(t - p.impactAt, 3, 90));
    jolt(t - p.impactAt, p.shakePx, dir);
  }
  for (const e of p.echoes) jolt(t - e, p.shakePx * 0.5, dir);
  if (p.tiltAt !== null) jolt(t - p.tiltAt, p.shakePx * 0.45, { x: -dir.y, y: dir.x });
  return { zoom, x, y };
}
