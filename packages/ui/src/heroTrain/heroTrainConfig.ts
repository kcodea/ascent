/**
 * THE TRAIN HERO ATTACK ("Right on Schedule", a Legendary with four looks; DEV-ONLY, no cosmetic yet): its tuned values,
 * its pure timeline, the pure geometry (the track under the struck portrait, which edge the vehicle enters from, the
 * crossing signal), the consist (which vehicles, how long), the vehicle's motion, the struck portrait's reaction and
 * the camera.
 *
 * THE SIGNATURE: a length of RAIL TRACK fades in under the struck portrait, running off both sides of the screen, and
 * a VEHICLE crosses the whole screen along it, THROUGH the portrait. It always enters from the striker's side. No other
 * attack runs a vehicle through the screen.
 *
 * FOUR LOOKS on the shared thresholds (`attackTier`: a knockout always plays IV):
 *  - I THE HANDCAR: a little pump trolley (its see-saw handle rocking as it rolls) trundles across and BONKS the
 *    portrait: a small nudge and a spinning star.
 *  - II THE MINE CART: a rattling ore cart, faster, bouncing on the rails; it spills glowing ore as it hits and the
 *    portrait is knocked and wobbles.
 *  - III THE STEAM ENGINE: a whistle, then a steam locomotive and its tender at speed, puffing steam, its wheels and
 *    rods turning. The portrait is FLATTENED while it passes and springs back up.
 *  - IV THE FREIGHT EXPRESS: a CROSSING SIGNAL rises beside the track, its two red lamps alternating with a bell; the
 *    striped GATE ARM drops; a horn sounds off screen and a headlight glow grows at the edge. Then the engine and car
 *    after car STREAK through; the portrait is thrown up and SPINS above the train, buffeted by each car, until the
 *    caboose passes with a last puff of steam. It drops, wobbles to rest, and the gate lifts.
 *
 * THE BLOW LANDS ONCE: when the vehicle's nose reaches the portrait (`impactAt`). The plan never depends on where the
 * portraits are (so a replay's cue times are identical); the geometry only decides how fast the vehicle has to go.
 * No hit-stop, no slow motion: one clock, flat 2D.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, easeInOutSine, easeOutBack, easeOutCubic, spring, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { TIERS };
export type { TierNum };

export const TRAIN_KINDS = ['handcar', 'minecart', 'engine', 'freight'] as const;
export type TrainKind = (typeof TRAIN_KINDS)[number];

/** Each tier's vehicle. */
export function trainKind(tier: TierNum): TrainKind { return TRAIN_KINDS[tier - 1]!; }

/** The tier dial groups the tuner shows (`t1` ... `t4`). */
export const TRAIN_LEVELS = ['t1', 't2', 't3', 't4'] as const;

export const TRAIN_TIER_SUFFIXES = ['ReadyMs', 'ApproachMs', 'PassMs', 'ExitMs', 'HoldMs', 'Zoom', 'Punch', 'Shake', 'Knock', 'Burst', 'Dim'] as const;
export type TrainTierSuffix = (typeof TRAIN_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${TrainTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  trackFadeMs: number;
  railDrop: number;
  trackSize: number;
  vehicleSize: number;
  handleSwing: number;
  bounce: number;
  flatten: number;
  cars: number;
  liftSize: number;
  spinTurns: number;
  signalSize: number;
  signalOffset: number;
  lampMs: number;
  bellEveryMs: number;
  puffMs: number;
  windMs: number;
  knockPx: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorSteam: string;
  colorOre: string;
  colorLamp: string;
  colorHeadlight: string;
  colorSpark: string;
  colorStar: string;
  colorFlash: string;
  colorPlayer: string;
  colorFoe: string;
  sfxBellClip: string; sfxBellGain: number; sfxBellRate: number;
  sfxWhistleClip: string; sfxWhistleGain: number; sfxWhistleRate: number;
  sfxHornClip: string; sfxHornGain: number; sfxHornRate: number;
  sfxPassClip: string; sfxPassGain: number; sfxPassRate: number;
  sfxClatterClip: string; sfxClatterGain: number; sfxClatterRate: number;
  sfxSqueakClip: string; sfxSqueakGain: number; sfxSqueakRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroTrainConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_TRAIN_COLOR_KEYS = [
  'colorSteam', 'colorOre', 'colorLamp', 'colorHeadlight', 'colorSpark', 'colorStar', 'colorFlash', 'colorPlayer', 'colorFoe',
] as const;
export const HERO_TRAIN_CLIP_KEYS = [
  'sfxBellClip', 'sfxWhistleClip', 'sfxHornClip', 'sfxPassClip', 'sfxClatterClip', 'sfxSqueakClip', 'sfxBoomClip', 'sfxWhooshClip',
] as const;
export type HeroTrainStrKey = (typeof HERO_TRAIN_COLOR_KEYS)[number] | (typeof HERO_TRAIN_CLIP_KEYS)[number];
export type HeroTrainNumKey = Exclude<keyof HeroTrainConfig, HeroTrainStrKey>;

/** Per tier: [I, II, III, IV]. */
const TIER_DEFAULTS: Record<TrainTierSuffix, [number, number, number, number]> = {
  // Before the vehicle may appear: the track fading in (III: the whistle; IV: the whole crossing signal routine).
  ReadyMs: [240, 220, 520, 1500],
  // The longest the vehicle is on screen before it reaches the portrait (a far portrait makes it faster, never later).
  ApproachMs: [900, 640, 520, 420],
  // How long the vehicle takes to pass the portrait (IV: the whole train, engine to caboose).
  PassMs: [380, 300, 380, 1150],
  ExitMs: [420, 360, 380, 420],
  HoldMs: [140, 160, 320, 380],
  Zoom: [0.015, 0.02, 0.03, 0.05],
  Punch: [0.008, 0.014, 0.024, 0.04],
  Shake: [1.5, 3, 7, 16],
  Knock: [0.7, 1.5, 1.2, 1.4],
  Burst: [0.7, 1, 1.3, 1.7],
  Dim: [0.08, 0.12, 0.18, 0.28],
};

export const TRAIN_TIER_RANGES: Record<TrainTierSuffix, [number, number, number]> = {
  ReadyMs: [0, 3000, 10],
  ApproachMs: [120, 2000, 10],
  PassMs: [100, 2500, 10],
  ExitMs: [100, 1500, 10],
  HoldMs: [0, 1500, 10],
  Zoom: [0, 0.2, 0.005],
  Punch: [0, 0.1, 0.001],
  Shake: [0, 40, 0.5],
  Knock: [0, 4, 0.05],
  Burst: [0, 3, 0.05],
  Dim: [0, 0.6, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => TRAIN_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_TRAIN_DEFAULTS: HeroTrainConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 180,
  trackFadeMs: 240,
  railDrop: 0.8,
  trackSize: 0.52,
  vehicleSize: 1,
  handleSwing: 0.4,
  bounce: 0.07,
  flatten: 0.74,
  cars: 7,
  liftSize: 1.05,
  spinTurns: 3,
  signalSize: 2.5,
  signalOffset: 2.5,
  lampMs: 260,
  bellEveryMs: 1500,
  puffMs: 46,
  windMs: 70,
  knockPx: 16,
  shakeMs: 300,
  zoomOutMs: 420,
  reducedFadeMs: 260,
  colorSteam: '#f4f7fb',
  colorOre: '#ffb347',
  colorLamp: '#ff3b2f',
  colorHeadlight: '#ffe9a8',
  colorSpark: '#ffc65a',
  colorStar: '#ffd84a',
  colorFlash: '#fff4dc',
  colorPlayer: '#ffcf5a',
  colorFoe: '#ff6a5a',
  // Generated with ElevenLabs for this attack (2026-11-12), trimmed and levelled to about -20 LUFS. The bell's three
  // dings start 0, 0.47 and 1.07 s in; the horn and the whistle sound from their first ms; the pass roars from 0.05 s to
  // about 1.2 s and fades; the clatter's burst is 0.08 to 0.45 s in; the handcar squeaks 0.05 and 0.7 s in.
  sfxBellClip: 'fx/train-bell', sfxBellGain: 0.5, sfxBellRate: 1,
  sfxWhistleClip: 'fx/train-whistle', sfxWhistleGain: 0.5, sfxWhistleRate: 1,
  sfxHornClip: 'fx/train-horn', sfxHornGain: 0.55, sfxHornRate: 1,
  sfxPassClip: 'fx/train-pass', sfxPassGain: 0.7, sfxPassRate: 1,
  sfxClatterClip: 'fx/train-clatter', sfxClatterGain: 0.55, sfxClatterRate: 1,
  sfxSqueakClip: 'fx/train-handcar', sfxSqueakGain: 0.6, sfxSqueakRate: 1,
  // The boom and the whoosh are SHARED clips (always decoded on a phone), so they cost the phone audio budget nothing.
  sfxBoomClip: 'fx/universfield-ground-impact-352053', sfxBoomGain: 0.45, sfxBoomRate: 1,
  sfxWhooshClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxWhooshGain: 0.3, sfxWhooshRate: 1,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroTrainStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  trackFadeMs: [60, 800, 10],
  railDrop: [0, 1.2, 0.01],
  trackSize: [0.2, 1.2, 0.01],
  vehicleSize: [0.5, 1.6, 0.01],
  handleSwing: [0, 1, 0.01],
  bounce: [0, 0.3, 0.005],
  flatten: [0, 0.88, 0.01],
  cars: [3, 8, 1],
  liftSize: [0, 2, 0.05],
  spinTurns: [0, 6, 1],
  signalSize: [1, 4, 0.05],
  signalOffset: [1.6, 5, 0.05],
  lampMs: [80, 800, 10],
  bellEveryMs: [600, 3000, 10],
  puffMs: [20, 200, 1],
  windMs: [30, 300, 1],
  knockPx: [0, 60, 1],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxBellGain: [0, 2, 0.05], sfxBellRate: [0.5, 2.5, 0.01],
  sfxWhistleGain: [0, 2, 0.05], sfxWhistleRate: [0.5, 2.5, 0.01],
  sfxHornGain: [0, 2, 0.05], sfxHornRate: [0.5, 2.5, 0.01],
  sfxPassGain: [0, 2, 0.05], sfxPassRate: [0.5, 2.5, 0.01],
  sfxClatterGain: [0, 2, 0.05], sfxClatterRate: [0.5, 2.5, 0.01],
  sfxSqueakGain: [0, 2, 0.05], sfxSqueakRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2.5, 0.01],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2.5, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_TRAIN_RANGES: Record<HeroTrainNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => TRAIN_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TRAIN_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** Hard caps (whatever the tuner says). */
export const TRAIN_CAPS = { shakePx: 40, cars: 8, bells: 4 } as const;

const store = configStore<HeroTrainConfig>({
  key: 'ascent.herotrain.v2', defaults: HERO_TRAIN_DEFAULTS, ranges: HERO_TRAIN_RANGES,
  colorKeys: HERO_TRAIN_COLOR_KEYS, clipKeys: HERO_TRAIN_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroTrainStore = store;
export const getHeroTrainConfig = store.get;
export const clampHeroTrainValue = store.clamp;
export const sanitizeHeroTrainConfig = store.sanitize;
export const heroTrainConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1: the tuner has no speed buttons. */
export function heroTrainPreviewSpeed(): number { return 1; }

export function trainTierDials(tier: TierNum, c: HeroTrainConfig = store.get()): Record<TrainTierSuffix, number> {
  return Object.fromEntries(TRAIN_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<TrainTierSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export interface TrainPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  reduced?: boolean;
}

export interface TrainPlan {
  reduced: boolean;
  tier: TierNum;
  kind: TrainKind;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The track starts to fade in. */
  trackAt: number;
  /** IV: the crossing signal rises, its lamps and bell start, the gate arm drops, the horn sounds (the headlight grows from it). */
  signalAt: number | null;
  lampsAt: number | null;
  bellAts: number[];
  gateAt: number | null;
  hornAt: number | null;
  /** III: the steam whistle. */
  whistleAt: number | null;
  /** I: the handcar's squeaks. II: the cart's rattles. */
  rollAts: number[];
  /** I to III: the vehicle's nose crosses the entry edge at or after this. IV: the train is due (it comes at its own speed). */
  enterAt: number;
  /** THE impact: the vehicle's nose reaches the portrait. The blow lands here, once. */
  impactAt: number;
  /** IV: each car reaching the portrait (it buffets it). */
  carAts: number[];
  /** The vehicle's tail has passed the portrait (IV: the caboose; the last puff). */
  passEnd: number;
  /** IV: the gate lifts. */
  gateUpAt: number | null;
  /** The tail has left the screen. */
  exitEnd: number;
  /** The track (and IV's signal) starts to fade out. */
  trackOutAt: number;
  endAt: number;
  // the looks
  approachMs: number;
  passMs: number;
  cars: number;
  zoom: number;
  punch: number;
  shakePx: number;
  knock: number;
  burst: number;
  dim: number;
}

/** The whole attack, in base ms. Pure and deterministic; it never reads where the portraits are. */
export function trainPlan(input: TrainPlanInput, c: HeroTrainConfig = store.get()): TrainPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier IV
  const kind = trainKind(tier);
  const L = trainTierDials(tier, c);
  const k = (tier - 1) / 3;
  const cars = kind === 'freight' ? clamp(Math.round(c.cars), 3, TRAIN_CAPS.cars) : 0;
  const approachMs = Math.max(120, L.ApproachMs), passMs = Math.max(100, L.PassMs);
  const looks = {
    tier, kind, k, total, approachMs, passMs, cars, zoom: L.Zoom, punch: L.Punch, shakePx: clamp(L.Shake, 0, TRAIN_CAPS.shakePx),
    knock: L.Knock, burst: L.Burst, dim: L.Dim,
  };
  const none = { signalAt: null, lampsAt: null, gateAt: null, hornAt: null, whistleAt: null, gateUpAt: null, bellAts: [] as number[], rollAts: [] as number[], carAts: [] as number[] };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...looks, ...none, reduced: true, chargeAt: at, absorbEnd: at, trackAt: at, enterAt: at, impactAt: at, passEnd: at, exitEnd: at, trackOutAt: at,
      endAt: r.endAt, zoom: 0, punch: 0, shakePx: 0, knock: 0, burst: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const enterAt = chargeAt + Math.max(0, L.ReadyMs);
  const impactAt = enterAt + approachMs;
  const passEnd = impactAt + passMs;
  const exitEnd = passEnd + Math.max(100, L.ExitMs);
  const endAt = exitEnd + Math.max(0, L.HoldMs);
  const base = { ...looks, ...none, reduced: false, chargeAt, absorbEnd, trackAt: chargeAt, enterAt, impactAt, passEnd, exitEnd, trackOutAt: Math.max(passEnd, endAt - c.trackFadeMs - 40), endAt };
  if (kind === 'handcar') {
    // The squeaky pump on the way in (the clip squeaks twice), and once more as it trundles off.
    return { ...base, rollAts: [enterAt, impactAt + 140] };
  }
  if (kind === 'minecart') {
    return { ...base, rollAts: [enterAt + approachMs * 0.15, enterAt + approachMs * 0.6] };
  }
  if (kind === 'engine') {
    return { ...base, whistleAt: chargeAt + Math.min(80, L.ReadyMs * 0.5) };
  }
  // THE FREIGHT EXPRESS: the signal rises, the lamps and the bell, the gate drops, the horn; then the train.
  const ready = Math.max(0, L.ReadyMs);
  const signalAt = chargeAt + ready * 0.04;
  const lampsAt = chargeAt + ready * 0.22;
  const gateAt = chargeAt + ready * 0.36;
  const hornAt = chargeAt + ready * 0.62;
  const bellAts: number[] = [];
  for (let t = lampsAt; t < passEnd - 500 && bellAts.length < TRAIN_CAPS.bells; t += Math.max(600, c.bellEveryMs)) bellAts.push(t);
  // The engine and its tender are the first two units; each car after them buffets the portrait as it arrives.
  const units = cars + 3;
  const carAts = Array.from({ length: cars + 1 }, (_, i) => impactAt + (passMs * (i + 2)) / units);
  return { ...base, signalAt, lampsAt, gateAt, hornAt, bellAts, carAts, gateUpAt: passEnd + 160 };
}

export type TrainCueKind = 'charge' | 'signal' | 'bell' | 'gate' | 'horn' | 'whistle' | 'roll' | 'enter' | 'impact' | 'car' | 'tail' | 'gateup' | 'trackout' | 'end';
export interface TrainCue { at: number; kind: TrainCueKind; i: number }

/** Every beat the runner fires, in time order. The blow lands on `impact`, once. */
export function trainCues(p: TrainPlan): TrainCue[] {
  const out: TrainCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    if (p.signalAt !== null) out.push({ at: p.signalAt, kind: 'signal', i: 0 });
    p.bellAts.forEach((at, i) => out.push({ at, kind: 'bell', i }));
    if (p.gateAt !== null) out.push({ at: p.gateAt, kind: 'gate', i: 0 });
    if (p.hornAt !== null) out.push({ at: p.hornAt, kind: 'horn', i: 0 });
    if (p.whistleAt !== null) out.push({ at: p.whistleAt, kind: 'whistle', i: 0 });
    p.rollAts.forEach((at, i) => out.push({ at, kind: 'roll', i }));
    out.push({ at: p.enterAt, kind: 'enter', i: 0 });
    p.carAts.forEach((at, i) => out.push({ at, kind: 'car', i }));
    out.push({ at: p.passEnd, kind: 'tail', i: 0 });
    if (p.gateUpAt !== null) out.push({ at: p.gateUpAt, kind: 'gateup', i: 0 });
    out.push({ at: p.trackOutAt, kind: 'trackout', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<TrainCueKind, number> = {
    charge: 0, signal: 1, bell: 2, gate: 3, horn: 4, whistle: 5, roll: 6, enter: 7, impact: 8, car: 9, tail: 10, gateup: 11, trackout: 12, end: 13,
  };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

// ─── the vehicles (pure) ───────────────────────────────────────────────────────────────────────────────────────

export const UNIT_KINDS = ['handcar', 'cart', 'engine', 'tender', 'box', 'tank', 'hopper', 'flat', 'caboose'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/** A wheel drawn as its own turning sprite: where along the unit (0 = its front, 1 = its back) and its radius (a fraction of the unit's height). */
export interface WheelSlot { fx: number; r: number; small?: boolean }

/**
 * Each vehicle's painted texture (px, facing RIGHT, its wheels' feet on the bottom edge), how tall it is drawn (struck
 * portrait radii) and the wheels drawn as turning sprites (a freight car's are painted on: at that speed they blur).
 */
export const UNIT_SHAPES: Record<UnitKind, { tw: number; th: number; h: number; wheels: readonly WheelSlot[] }> = {
  handcar: { tw: 288, th: 176, h: 0.95, wheels: [{ fx: 0.215, r: 0.176 }, { fx: 0.785, r: 0.176 }] },
  cart: { tw: 256, th: 192, h: 1, wheels: [{ fx: 0.273, r: 0.156 }, { fx: 0.727, r: 0.156 }] },
  engine: { tw: 512, th: 256, h: 1.35, wheels: [{ fx: 0.379, r: 0.164 }, { fx: 0.582, r: 0.164 }, { fx: 0.785, r: 0.164 }, { fx: 0.18, r: 0.086, small: true }] },
  tender: { tw: 224, th: 176, h: 0.93, wheels: [] },
  box: { tw: 448, th: 208, h: 1.08, wheels: [] },
  tank: { tw: 448, th: 208, h: 1.08, wheels: [] },
  hopper: { tw: 448, th: 208, h: 1.08, wheels: [] },
  flat: { tw: 448, th: 208, h: 1.08, wheels: [] },
  caboose: { tw: 352, th: 224, h: 1.16, wheels: [] },
};

/** Where the handcar's see-saw pivots, the engine's funnel mouth and its side rod's crank (fractions of the unit: `fx` from its front, `fy` up from the rail). */
export const HANDLE_PIVOT = { fx: 0.5, fy: 0.75 } as const;
export const FUNNEL_MOUTH = { fx: 0.242, fy: 0.94 } as const;
export const ROD_CRANK = 0.078;

export interface TrainUnit { kind: UnitKind; /** Screen px. */ w: number; h: number; /** From the train's nose back to this unit's front. */ off: number; tint: number }

/** The freight cars, in the order they pass (cycled), each with the paint it wears (a tint over a pale texture). */
const FREIGHT: readonly [UnitKind, number][] = [
  ['box', 0xc9764a], ['tank', 0xdfe5ec], ['hopper', 0x9aa3b0], ['flat', 0xffffff], ['box', 0x7fa56a], ['tank', 0xf0c75a], ['hopper', 0xb58a62], ['box', 0x6f93bf],
];

/** The consist a plan runs: its units front to back (sized from the struck portrait's radius `dR`). Pure. */
export function trainConsist(p: TrainPlan, dR: number, c: HeroTrainConfig = store.get()): TrainUnit[] {
  if (p.reduced) return [];
  const kinds: [UnitKind, number][] = p.kind === 'handcar' ? [['handcar', 0xffffff]]
    : p.kind === 'minecart' ? [['cart', 0xffffff]]
      : p.kind === 'engine' ? [['engine', 0xffffff], ['tender', 0xffffff]]
        : [['engine', 0xffffff], ['tender', 0xffffff], ...Array.from({ length: p.cars }, (_, i) => FREIGHT[i % FREIGHT.length]!), ['caboose', 0xffffff]];
  let off = 0;
  return kinds.map(([kind, tint]) => {
    const s = UNIT_SHAPES[kind];
    const h = dR * s.h * c.vehicleSize;
    const w = (h * s.tw) / s.th;
    const u = { kind, w, h, off, tint };
    off += w;
    return u;
  });
}

export function consistLength(units: readonly TrainUnit[]): number {
  const last = units[units.length - 1];
  return last ? last.off + last.w : 0;
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

export interface Frame { x0: number; y0: number; x1: number; y1: number }

export interface TrainGeo {
  /** The way the vehicle travels: +1 = left to right. It always ENTERS from the striker's side. */
  dir: 1 | -1;
  /** The track's centre line, and where the wheels' feet sit (the near rail). */
  railY: number;
  wheelY: number;
  /** The track runs from `x0` to `x1` (past both edges of the frame). */
  x0: number;
  x1: number;
  /** The edges the nose enters from and the tail leaves by. */
  enterX: number;
  exitX: number;
  /** Where the nose is on the impact (the portrait's near edge), and how far that is from each edge. */
  hitX: number;
  distIn: number;
  distOut: number;
  /** The contact point (for the impact FX) and the struck portrait's centre. */
  contact: Pt;
  hit: Pt;
  /** IV: the crossing signal (its foot, its height, which way its gate arm lies) and how far the portrait is thrown up. */
  signal: { x: number; footY: number; h: number; arm: 1 | -1 };
  lift: number;
}

/** Where everything goes, from the two heroes and the frame (screen px). Pure. */
export function trainGeo(a: Pt, d: Pt, dR: number, frame: Frame | null, c: HeroTrainConfig = store.get(), side: 'player' | 'opp' = 'player'): TrainGeo {
  const f: Frame = frame ?? { x0: Math.min(a.x, d.x) - 900, y0: Math.min(a.y, d.y) - 500, x1: Math.max(a.x, d.x) + 900, y1: Math.max(a.y, d.y) + 500 };
  // The striker's side: where it stands; straight above or below, yours come from the left and the foe's from the right.
  const dir: 1 | -1 = a.x < d.x - 2 ? 1 : a.x > d.x + 2 ? -1 : side === 'opp' ? -1 : 1;
  const railY = d.y + dR * c.railDrop;
  const wheelY = railY + dR * c.trackSize * 0.19;
  const over = dR * 0.6 + 80; // past the edges, so a camera shake never shows the track's end
  const enterX = dir > 0 ? f.x0 : f.x1, exitX = dir > 0 ? f.x1 : f.x0;
  const hitX = d.x - dir * dR * 0.85;
  // The signal stands on the near side of the track, on the entry side of the portrait (the other side when there is no
  // room), as tall as the screen above it allows; its arm lies away from the portrait.
  const want = d.x - dir * dR * c.signalOffset;
  const fits = want > f.x0 + dR * 0.6 && want < f.x1 - dR * 0.6;
  const sx = fits ? want : d.x + dir * dR * c.signalOffset;
  const footY = railY + dR * 0.42;
  const h = clamp(dR * c.signalSize, dR * 0.8, Math.max(dR * 0.8, footY - f.y0 - 6));
  const arm: 1 | -1 = sx < d.x ? -1 : 1;
  const lift = clamp(dR * c.liftSize, 0, Math.max(0, d.y - dR - f.y0 - 4));
  return {
    dir, railY, wheelY, x0: f.x0 - over, x1: f.x1 + over, enterX, exitX, hitX, distIn: Math.abs(hitX - enterX), distOut: Math.abs(exitX - hitX),
    contact: { x: hitX, y: d.y }, hit: { ...d }, signal: { x: sx, footY, h, arm }, lift,
  };
}

// ─── the vehicle's motion (pure) ───────────────────────────────────────────────────────────────────────────────

export interface TrainMotion { /** Px per ms on the way in. */ v0: number; /** When its nose crosses the entry edge (sequence ms). */ arriveAt: number; /** The consist's length (px). */ len: number; /** Extra px it must make up after the impact to be off screen in time. */ extra: number; /** Impact to off screen (ms). */ T: number }

/**
 * How fast the vehicle goes. I to III: fast enough to cross from the entry edge within the approach AND for its whole
 * length to pass the portrait within the pass. IV: exactly the speed that takes the whole train past the portrait in the
 * pass (so the caboose clears it on the beat the portrait drops), wherever the portraits are. After the impact it speeds
 * up (smoothly) if it must, to be off screen on time.
 */
export function trainMotion(p: TrainPlan, g: TrainGeo, len: number, dR: number): TrainMotion {
  const byPass = (len + dR * 1.7) / Math.max(1, p.passMs);
  const v0 = Math.max(p.kind === 'freight' ? byPass : Math.max(g.distIn / Math.max(1, p.approachMs), byPass), 0.05);
  const T = Math.max(1, p.exitEnd - p.impactAt);
  const need = g.distOut + len + dR * 0.5;
  return { v0, arriveAt: p.impactAt - g.distIn / v0, len, extra: Math.max(0, need - v0 * T), T };
}

/** How far the nose has travelled past the impact point at `t` (px along its heading; negative before the impact). Pure. */
export function noseTravel(p: TrainPlan, m: TrainMotion, t: number): number {
  const tau = t - p.impactAt;
  if (tau <= 0) return m.v0 * tau;
  const u = tau / m.T;
  // Past the planned exit it keeps the speed it left with.
  return u <= 1 ? m.v0 * tau + m.extra * u * u : m.v0 * tau + m.extra * (2 * u - 1);
}

// ─── the track, the signal and the headlight (pure) ────────────────────────────────────────────────────────────

/** The track's opacity: in at the charge, out at the end. */
export function trackAlpha(p: TrainPlan, c: HeroTrainConfig, t: number): number {
  if (p.reduced || t < p.trackAt) return 0;
  const f = Math.max(1, c.trackFadeMs);
  return easeOutCubic((t - p.trackAt) / f) * (1 - clamp01((t - p.trackOutAt) / f));
}

export interface SignalState { alpha: number; /** 0..1 risen (it overshoots a touch). */ rise: number; /** 0 = the arm up, 1 = down. */ arm: number; lampA: number; lampB: number }

const NO_SIGNAL: SignalState = { alpha: 0, rise: 0, arm: 0, lampA: 0, lampB: 0 };

/** IV's crossing signal: it rises, its lamps alternate from the bell to the caboose, the arm drops and lifts, and it sinks away with the track. */
export function signalAt(p: TrainPlan, c: HeroTrainConfig, t: number): SignalState {
  if (p.reduced || p.signalAt === null || t < p.signalAt) return NO_SIGNAL;
  const rise = easeOutBack((t - p.signalAt) / 320, 1.6);
  const out = clamp01((t - p.trackOutAt) / Math.max(1, c.trackFadeMs));
  let arm = 0;
  if (p.gateAt !== null && t >= p.gateAt) {
    const age = t - p.gateAt;
    // It drops, bounces once on its stop, and lifts again after the caboose.
    arm = age < 380 ? easeInOutSine(age / 380) : 1 - 0.07 * spring(age - 380, 5, 90);
    if (p.gateUpAt !== null && t >= p.gateUpAt) arm *= 1 - easeInOutSine((t - p.gateUpAt) / 420);
  }
  let lampA = 0, lampB = 0;
  if (p.lampsAt !== null && t >= p.lampsAt && t < (p.gateUpAt ?? p.passEnd)) {
    const ph = ((t - p.lampsAt) / Math.max(40, c.lampMs)) % 2;
    // One lamp, then the other, each with a quick soft edge.
    lampA = ph < 1 ? Math.min(1, Math.min(ph, 1 - ph) * 6) : 0;
    lampB = ph >= 1 ? Math.min(1, Math.min(ph - 1, 2 - ph) * 6) : 0;
  }
  return { alpha: clamp01((t - p.signalAt) / 120) * (1 - out), rise, arm, lampA, lampB };
}

/** IV's headlight glow at the entry edge: it grows from the horn until the engine's nose arrives there (`arriveAt`), then is gone. 0..1. */
export function headlightAt(p: TrainPlan, t: number, arriveAt: number): number {
  if (p.reduced || p.hornAt === null || t < p.hornAt) return 0;
  const grow = clamp01((t - p.hornAt) / Math.max(1, arriveAt - p.hornAt));
  const gone = clamp01((t - arriveAt) / 160);
  return (0.25 + 0.75 * grow * grow) * clamp01((t - p.hornAt) / 120) * (1 - gone);
}

// ─── the struck portrait (pure) ────────────────────────────────────────────────────────────────────────────────

/** The struck portrait at a moment: an offset from its slot (screen px), a turn (degrees) and a scale each way. */
export interface FoePose { x: number; y: number; rot: number; sx: number; sy: number }

/**
 * How the struck portrait takes it. Nothing before the impact. I: a small nudge. II: knocked along the track, and it
 * wobbles. III: FLATTENED onto the sleepers while the engine passes, then it springs back up. IV: thrown up, SPINNING
 * above the train and buffeted by each car, then it drops as the caboose passes and wobbles to rest. Every look settles
 * to exactly nothing. `out` is written and returned (no allocation per frame).
 */
export function foePose(p: TrainPlan, g: TrainGeo, c: HeroTrainConfig, dR: number, t: number, out: FoePose): FoePose {
  out.x = 0; out.y = 0; out.rot = 0; out.sx = 1; out.sy = 1;
  if (p.reduced || t < p.impactAt) return out;
  const age = t - p.impactAt;
  const K = c.knockPx * p.knock * (dR / 120);
  if (p.kind === 'handcar') {
    out.x = g.dir * K * spring(age, 3.2, 150);
    out.rot = g.dir * 5 * spring(age, 3.2, 170);
    out.y = -K * 0.35 * Math.max(0, spring(age, 3.2, 120));
    return out;
  }
  if (p.kind === 'minecart') {
    out.x = g.dir * K * spring(age, 2.8, 190);
    out.rot = g.dir * 15 * spring(age, 2.6, 260);
    const sq = 0.08 * spring(age, 5, 110);
    out.sx = 1 - sq; out.sy = 1 + sq * 0.6;
    return out;
  }
  if (p.kind === 'engine') {
    // Down flat in a few frames, held under the engine, then a spring up that overshoots (taller, then settles).
    const up = t - p.passEnd;
    const f = up < 0 ? easeOutCubic(age / 70) : spring(up, 3, 120);
    const flat = clamp(c.flatten * f, -0.3, 0.88);
    out.sy = 1 - flat;
    out.sx = 1 + flat * 0.28;
    // Pressed down ONTO the track: at its flattest its lower edge rests on the near side of the sleepers (the track is
    // drawn over the portraits, so anything lower would be hidden under it).
    const rest = c.railDrop - c.trackSize * 0.5 - (1 - c.flatten);
    out.y = c.flatten > 0.01 ? (flat / c.flatten) * rest * dR : 0;
    out.x = g.dir * K * 0.5 * (up < 0 ? easeOutCubic(age / 70) : spring(up, 2.4, 180));
    return out;
  }
  // THE FREIGHT: up over the train and spinning until the caboose has passed; then down, a bounce and a wobble.
  const pass = Math.max(1, p.passEnd - p.impactAt);
  const down = t - p.passEnd;
  if (down < 0) {
    const u = age / pass;
    out.y = -g.lift * easeOutCubic(age / 150);
    // The spin eases to a stop exactly upright (whole turns).
    out.rot = g.dir * 360 * Math.round(c.spinTurns) * (1 - Math.pow(1 - u, 1.6));
    for (let i = 0; i < p.carAts.length; i++) {
      const s = t - p.carAts[i]!;
      if (s < 0) break;
      const b = spring(s, 7, 55);
      out.x += g.dir * K * 0.7 * b;
      out.y -= K * 0.45 * b * (i % 2 ? -1 : 1);
    }
    out.x += g.dir * K * 0.8 * spring(age, 4, 140);
    out.sx = out.sy = 1 - 0.06 * clamp01(age / 150);
    return out;
  }
  const fall = clamp01(down / 190);
  const land = down - 190;
  // It falls back onto its slot and takes one small bounce (which starts from nothing, so there is no jump).
  out.y = -g.lift * (1 - fall * fall) - (land >= 0 ? K * 0.6 * Math.abs(Math.sin(2 * Math.PI * 3.4 * (land / 1000))) * Math.exp(-land / 110) : 0);
  out.rot = down >= 150 ? g.dir * -11 * spring(down - 150, 2.8, 210) * Math.sin(Math.min(1, (down - 150) / 60) * Math.PI / 2) : 0;
  const sq = down >= 190 ? 0.1 * spring(down - 190, 4.5, 100) : 0;
  out.sx = (1 - 0.06 * (1 - fall)) * (1 + sq * 0.6); out.sy = (1 - 0.06 * (1 - fall)) * (1 - sq);
  return out;
}

/** The striker sends it off: a small hop as the track appears and a lean down the line until the blow lands. */
export function strikerPose(p: TrainPlan, g: TrainGeo, aR: number, t: number, out: FoePose): FoePose {
  out.x = 0; out.y = 0; out.rot = 0; out.sx = 1; out.sy = 1;
  if (p.reduced || t < p.chargeAt || t > p.passEnd + 300) return out;
  const hop = clamp01((t - p.chargeAt) / 260);
  out.y = -aR * 0.14 * Math.sin(Math.PI * hop);
  const lean = clamp01((t - p.chargeAt) / 200) * (1 - clamp01((t - p.impactAt) / 300));
  out.rot = g.dir * 5 * lean;
  out.sx = out.sy = 1 + 0.04 * lean;
  return out;
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The camera: it pushes in on the struck portrait as the vehicle comes, holds while it passes, punches and shakes ALONG
 * THE TRACK on the impact, and IV rumbles the whole board while the cars go by. Pure.
 */
export function trainCameraAt(p: TrainPlan, c: HeroTrainConfig, t: number, dir: 1 | -1): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  const inFrom = p.hornAt ?? p.enterAt;
  const push = t < inFrom ? 0 : t < p.impactAt ? easeInOutSine((t - inFrom) / Math.max(1, p.impactAt - inFrom))
    : t < p.passEnd ? 1 : 1 - easeInOutSine((t - p.passEnd) / Math.max(1, c.zoomOutMs));
  let z = p.zoom * clamp01(push);
  let x = 0, y = 0;
  const tau = Math.max(1, c.shakeMs / 4);
  if (t >= p.impactAt) {
    const age = t - p.impactAt;
    z += p.punch * Math.exp(-age / tau);
    x += dir * spring(age, 15, tau) * p.shakePx;
    if (p.kind === 'freight' || p.kind === 'engine') {
      // The ground rumbles while the train is on the portrait, dying away after the tail.
      const hold = t < p.passEnd ? 1 : Math.exp(-(t - p.passEnd) / 160);
      const r = p.shakePx * (p.kind === 'freight' ? 0.32 : 0.2) * hold;
      x += Math.sin(age * 0.137) * r; y += Math.cos(age * 0.101) * r;
    }
  }
  return { zoom: 1 + z, x, y };
}
