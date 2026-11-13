/**
 * THE FOURTH WALL HERO ATTACK ("Fourth Wall", style id `glass`; ANCIENT rarity, dev-only until it gets a cosmetic): its
 * tuned values, its pure timeline, the pure crack and shard geometry and the pure camera.
 *
 * THE SIGNATURE: THE SCREEN ITSELF IS A PANE OF GLASS between the player and the game, and the blow breaks it. The
 * cracks are drawn ON the screen surface, over everything; in the top look the whole view shatters into shards that
 * burst at the viewer and fall away, and the scene is simply there behind them, clean. No other attack treats the
 * screen as an object.
 *
 * SEVEN CAUSES, ROLLED PER FIGHT (owner 2026-11-12: "add more ways of cracking the glass so it's not throwing a rock
 * every time"). What cracks the glass is rolled from the stable per-blow seed (`causeOf(rollSeed)`, the way Soccer rolls
 * its corner), so a replay rolls the same; the DEV tuner's "Variation" row forces one. Every cause is light, force or
 * portrait motion (no drawn object), and each leaves its OWN CRACK SHAPE:
 *  - `butt`, THE HEADBUTT: the striker's portrait launches itself at the glass over the target, flattens against it
 *    for a beat and bounces home. A tight IMPACT STAR (dense spokes and rings, a crushed heart).
 *  - `knock`, THE KNOCK: tap, tap, KNOCK, a ripple at each. A BULLSEYE of broken concentric rings.
 *  - `hum`, RESONANCE: a rising tone, standing rings shimmering over the target, the portrait humming; then it gives
 *    way all at once from the centre. A SUNBURST of fine straight needles, no rings.
 *  - `creep`, PRESSURE: no impact at all. One crack is born on the EDGE of the screen and creeps toward the target in
 *    jerks, forking, then blooms on the portrait. A long edge-born FRACTURE TREE.
 *  - `shock`, THE SHOCKWAVE: the striker stamps and a ring of force rolls across the board; the glass over the target
 *    crazes as it passes. A fine FROSTED CRAZE (a mosaic of short cracks) under a haze.
 *  - `beam`, THE BEAM: a pinpoint of light from the striker heats a glowing spot until the glass pops. A few long
 *    wandering THERMAL cracks from an ember.
 *  - `ricochet`, THE RICOCHET: one fast point of light bounces off the inside of the screen edges, chipping each, and
 *    hits home. A lopsided SKID STAR thrown forward along its last leg, plus the chips on the edges.
 *
 * FOUR LOOKS on the shared thresholds (`attackTier`: a knockout always plays Tier 4), each cause scaled across them.
 * Third pass (owner: "the final attack is cool, but it's overall quite boring"): every tier is now a little SCENE with
 * the glass as a character. A glare sweeps the screen as the attack starts (there IS a pane here), the striker's ghost
 * shows in the glass over the target while the cause plays, the cracks GLOW and pulse with energy, glints of prismatic
 * light run along them, and the struck hero REACTS: it comes up to the glass, presses its face to it (a fog print) and
 * knocks on it from the inside, which only makes the cracks worse.
 *  - Tier 1, THE CHIP: the cause's small mark, a prismatic flare, then the struck hero leans in to look at it, fogging
 *    the glass. It heals in a shimmer.
 *  - Tier 2, THE WEB: the mark spreads in creaking jumps; the struck hero presses against the glass and knocks twice
 *    from the inside, each knock a ripple and a creak. Then it heals.
 *  - Tier 3, THE PANE: it grows to about three and a half portrait radii, light leaking through the cracks; the struck
 *    hero presses, knocks, and shoves, and the PANE round it breaks out: its shards tip forward and fall, a dark hole
 *    stays for a beat, then the pane repairs in a shimmer.
 *  - Tier 4, THE SHATTER: the cause cracks the glass over the struck portrait, and from that mark ONE BOLD FRACTURE TEARS
 *    across the whole screen, both ways through both portraits, forking with a prismatic flash at every fork; a long
 *    held beat (the web spreading everywhere and glowing brighter and faster, glints racing along it, the trapped hero
 *    pounding on the glass from inside, the glass trembling, a swelling groan); then THE INHALE (the screen darkens and
 *    the cracks blaze) and THE WHOLE SCREEN SHATTERS: forty to seventy shards that tile the view burst TOWARD the viewer
 *    over a white-blue flash, hang for a breath, tumble and fall, and glass dust sparkles after them. The blow lands at
 *    the shatter.
 *
 * ONE GEOMETRY for the break: Tier 4's web is a fan of jittered spokes and rings round the struck portrait (`buildWeb`); its
 * spokes, rings and diagonals are the crack lines of the held beat and the same cells are the shards, so the screen
 * breaks exactly where it cracked. Everything is generated from the blow's seed (never `Math.random`).
 *
 * NEVER A FROZEN FRAME (R-PROG-ATTACK-10): the held beat keeps creaking and trembling, and Tier 4's shatter gets a slow-mo
 * DIP through the frame source (a smooth ramp that never reaches 0), never a hit-stop.
 *
 * THE CONTRACT: every beat before the blow (a tap, a jerk, a bounce, Tier 4's first crack) is FX and sound only. The
 * consequence lands exactly ONCE, on the impact beat (Tiers 1 to 3: the glass first cracks; Tier 4: the shatter). Reduced
 * motion: fades only.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, seededRng, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, isKnockoutVariant, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';
import { KO_SHAKE, koDipExtraMs, koTimeScale, type KoDip } from '../heroAttack/knockout';

export type { TierNum };

export const GLASS_LEVELS = ['t1', 't2', 't3', 't4'] as const;
export type GlassLevel = (typeof GLASS_LEVELS)[number];

export const GLASS_TIER_SUFFIXES = [
  'ReadyMs', 'CauseMs', 'GrowMs', 'HoldMs', 'Web', 'Shake', 'Zoom', 'Push', 'Punch', 'SettleMs', 'Dim',
] as const;
export type GlassTierSuffix = (typeof GLASS_TIER_SUFFIXES)[number];
type TierKey = `${GlassLevel}${GlassTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  /** DEV: '' = the cause is rolled per blow; a cause id forces it (a string so the tuner shows it as a select). */
  variation: string;
  absorbMs: number;
  /** Tier 3: the pane breaks out this long after the glass cracks, and the hole stays this long before the repair. */
  breakMs: number;
  holeMs: number;
  /** Tiers 1 to 3: the cracks fade (the glass heals) over this. */
  healMs: number;
  /** How many little jumps the cracks spread in (each one creaks). */
  creakJumps: number;
  /** Tier 4: how long the bold fracture takes to tear across the screen (at 1600 px between the portraits). */
  raceMs: number;
  /** Tier 4: the tear's thickness, and how far the glass trembles through the held beat (px). */
  tearWidth: number;
  tremblePx: number;
  /** Tier 4: the slow-mo dip on the shatter (lowest clock speed, and how long it takes to ease back, attack ms). */
  slowMo: number;
  slowMoMs: number;
  /** The shards: gravity (px/s^2), the outward burst (px/s), the tumble (radians/s) and the rim highlight (px). */
  shardGravity: number;
  shardBurst: number;
  shardSpin: number;
  shardRim: number;
  /** Tier 4: how far the shards jump TOWARD the viewer as the screen breaks (extra scale), and how much dust sparkles after. */
  shardLunge: number;
  dust: number;
  /** A crack line's thickness multiplier. */
  crackWidth: number;
  /** Tier 4: how strong the faint offset tint either side of the main crack is. */
  splitAlpha: number;
  /** How strongly the cracks glow with energy (an additive glow under every crack line, pulsing). */
  crackGlow: number;
  /** How many glints of light run along the cracks (a multiplier on each tier's count). */
  glints: number;
  /** How strong the prismatic (rainbow) refraction flares are where the glass cracks and forks. */
  prism: number;
  /** How far the struck hero comes up to the glass when it presses its face to it (extra scale). */
  pressScale: number;
  /** How strongly the striker's ghost shows in the glass while the cause plays. */
  ghost: number;
  /** Tier 4: THE INHALE before the shatter, its length (the screen darkens, the cracks blaze) and how dark. */
  inhaleMs: number;
  inhaleDark: number;
  impactSize: number;
  heroWindPx: number;
  heroThrowPx: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorGlass: string;
  colorEdge: string;
  colorShade: string;
  colorFlash: string;
  colorHeat: string;
  colorEnergy: string;
  colorPlayer: string;
  colorFoe: string;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxTickClip: string; sfxTickGain: number; sfxTickRate: number;
  sfxCreakClip: string; sfxCreakGain: number; sfxCreakRate: number;
  sfxRaceClip: string; sfxRaceGain: number; sfxRaceRate: number;
  sfxPaneClip: string; sfxPaneGain: number; sfxPaneRate: number;
  sfxShatterClip: string; sfxShatterGain: number; sfxShatterRate: number;
  sfxCrashClip: string; sfxCrashGain: number; sfxCrashRate: number;
  sfxRepairClip: string; sfxRepairGain: number; sfxRepairRate: number;
  sfxThudClip: string; sfxThudGain: number; sfxThudRate: number;
  sfxBodyClip: string; sfxBodyGain: number; sfxBodyRate: number;
  sfxKnockClip: string; sfxKnockGain: number; sfxKnockRate: number;
  sfxSingClip: string; sfxSingGain: number; sfxSingRate: number;
  sfxPopClip: string; sfxPopGain: number; sfxPopRate: number;
  sfxSqueakClip: string; sfxSqueakGain: number; sfxSqueakRate: number;
  sfxSwellClip: string; sfxSwellGain: number; sfxSwellRate: number;
  sfxTailMix: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroGlassConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_GLASS_COLOR_KEYS = ['colorGlass', 'colorEdge', 'colorShade', 'colorFlash', 'colorHeat', 'colorEnergy', 'colorPlayer', 'colorFoe'] as const;
export const HERO_GLASS_CLIP_KEYS = [
  'sfxWhooshClip', 'sfxTickClip', 'sfxCreakClip', 'sfxRaceClip', 'sfxPaneClip', 'sfxShatterClip', 'sfxCrashClip', 'sfxRepairClip', 'sfxThudClip',
  'sfxBodyClip', 'sfxKnockClip', 'sfxSingClip', 'sfxPopClip', 'sfxSqueakClip', 'sfxSwellClip',
] as const;
export type HeroGlassStrKey = (typeof HERO_GLASS_COLOR_KEYS)[number] | (typeof HERO_GLASS_CLIP_KEYS)[number] | 'variation';
export type HeroGlassNumKey = Exclude<keyof HeroGlassConfig, HeroGlassStrKey>;

/**
 * Per look, Tier 1 / 2 / 3 / 4. `CauseMs`: the base length of the cause, from its start to the glass first cracking
 * (each cause scales it by its own pace: a headbutt is quick, a creeping crack slow). `GrowMs`: how long the cracks
 * keep spreading after that (Tier 4: unused, the hold sets it). `HoldMs`: Tiers 1 and 2 how long the cracks stay
 * before they heal (at least long enough for the struck hero's press and knocks); Tier 4 the held beat before the
 * shatter (Tier 3: unused, the press, the shove and the repair set it). `Web`: the mark's reach in struck-portrait radii
 * (Tier 4: unused, it covers the screen).
 */
const TIER_DEFAULTS: Record<GlassTierSuffix, [number, number, number, number]> = {
  ReadyMs: [200, 220, 260, 380],
  CauseMs: [400, 430, 470, 430],
  GrowMs: [70, 320, 300, 0],
  HoldMs: [520, 660, 0, 1050],
  Web: [1.4, 2.4, 3.4, 0],
  Shake: [4, 7, 14, 34],
  Zoom: [0.012, 0.018, 0.026, 0.035],
  Push: [0, 0, 0.02, 0.055],
  Punch: [0.02, 0.03, 0.05, 0.1],
  SettleMs: [720, 880, 1320, 1500],
  Dim: [0.08, 0.12, 0.18, 0.3],
};

export const GLASS_TIER_RANGES: Record<GlassTierSuffix, [number, number, number]> = {
  ReadyMs: [80, 1500, 10],
  CauseMs: [120, 1500, 10],
  GrowMs: [0, 1200, 10],
  HoldMs: [0, 2500, 10],
  Web: [0, 6, 0.05],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.1, 0.002],
  Push: [0, 0.2, 0.002],
  Punch: [0, 0.15, 0.001],
  SettleMs: [0, 3000, 10],
  Dim: [0, 0.6, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => GLASS_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_GLASS_DEFAULTS: HeroGlassConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  variation: '',
  absorbMs: 160,
  breakMs: 330,
  holeMs: 560,
  healMs: 280,
  creakJumps: 5,
  raceMs: 560,
  tearWidth: 1.2,
  tremblePx: 3,
  slowMo: 0.26,
  slowMoMs: 460,
  shardGravity: 3600,
  shardBurst: 340,
  shardSpin: 2.2,
  shardRim: 10,
  shardLunge: 0.55,
  dust: 70,
  crackWidth: 1,
  splitAlpha: 0.07,
  crackGlow: 1,
  glints: 1,
  prism: 1,
  pressScale: 0.1,
  ghost: 1,
  inhaleMs: 280,
  inhaleDark: 0.38,
  impactSize: 1,
  heroWindPx: 10,
  heroThrowPx: 14,
  knockPx: 22,
  squash: 0.09,
  shakeMs: 520,
  zoomOutMs: 460,
  reducedFadeMs: 260,
  colorGlass: '#bfe3ff',
  colorEdge: '#ffffff',
  colorShade: '#0a1626',
  colorFlash: '#e2f3ff',
  colorHeat: '#ff9a3c',
  colorEnergy: '#6fd6ff',
  colorPlayer: '#ffe9b0',
  colorFoe: '#ff7a5c',
  sfxWhooshClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxWhooshGain: 0.6, sfxWhooshRate: 1,
  sfxTickClip: 'fx/glass-tick', sfxTickGain: 0.85, sfxTickRate: 1,
  sfxCreakClip: 'fx/glass-creak', sfxCreakGain: 1.2, sfxCreakRate: 1,
  sfxRaceClip: 'fx/glass-race', sfxRaceGain: 1.2, sfxRaceRate: 1,
  sfxPaneClip: 'fx/glass-pane', sfxPaneGain: 1, sfxPaneRate: 1,
  sfxShatterClip: 'fx/glass-shatter', sfxShatterGain: 0.75, sfxShatterRate: 0.92,
  sfxCrashClip: 'fx/glass-crash', sfxCrashGain: 1.1, sfxCrashRate: 1,
  sfxRepairClip: 'equipmentsheen', sfxRepairGain: 0.7, sfxRepairRate: 1.5,
  sfxThudClip: 'fx/universfield-ground-impact-352053', sfxThudGain: 0.75, sfxThudRate: 1,
  sfxBodyClip: 'fx/glass-body', sfxBodyGain: 1, sfxBodyRate: 1,
  sfxKnockClip: 'fx/glass-knock', sfxKnockGain: 1, sfxKnockRate: 1,
  sfxSingClip: 'fx/glass-sing', sfxSingGain: 0.7, sfxSingRate: 1,
  sfxPopClip: 'fx/glass-pop', sfxPopGain: 1, sfxPopRate: 1,
  sfxSqueakClip: 'fx/glass-squeak', sfxSqueakGain: 0.8, sfxSqueakRate: 1,
  sfxSwellClip: 'fx/glass-swell', sfxSwellGain: 0.55, sfxSwellRate: 1,
  sfxTailMix: 0.18,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroGlassStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  breakMs: [80, 1200, 10],
  holeMs: [100, 2000, 10],
  healMs: [60, 1200, 10],
  creakJumps: [2, 10, 1],
  raceMs: [160, 1600, 10],
  tearWidth: [0.3, 3, 0.05],
  tremblePx: [0, 12, 0.5],
  slowMo: [0.1, 1, 0.01],
  slowMoMs: [0, 1200, 10],
  shardGravity: [600, 8000, 50],
  shardBurst: [0, 1500, 10],
  shardSpin: [0, 10, 0.1],
  shardRim: [2, 30, 0.5],
  shardLunge: [0, 1.5, 0.05],
  dust: [0, 120, 1],
  crackWidth: [0.3, 3, 0.05],
  splitAlpha: [0, 0.3, 0.005],
  crackGlow: [0, 3, 0.05],
  glints: [0, 3, 0.05],
  prism: [0, 3, 0.05],
  pressScale: [0, 0.3, 0.005],
  ghost: [0, 2, 0.05],
  inhaleMs: [0, 800, 10],
  inhaleDark: [0, 0.8, 0.01],
  impactSize: [0.3, 3, 0.05],
  heroWindPx: [0, 40, 1],
  heroThrowPx: [0, 50, 1],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1500, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxWhooshGain: [0, 3, 0.05], sfxWhooshRate: [0.5, 2.5, 0.01],
  sfxTickGain: [0, 3, 0.05], sfxTickRate: [0.5, 2.5, 0.01],
  sfxCreakGain: [0, 3, 0.05], sfxCreakRate: [0.5, 2.5, 0.01],
  sfxRaceGain: [0, 3, 0.05], sfxRaceRate: [0.5, 2.5, 0.01],
  sfxPaneGain: [0, 3, 0.05], sfxPaneRate: [0.5, 2.5, 0.01],
  sfxShatterGain: [0, 3, 0.05], sfxShatterRate: [0.5, 2.5, 0.01],
  sfxCrashGain: [0, 3, 0.05], sfxCrashRate: [0.5, 2.5, 0.01],
  sfxRepairGain: [0, 3, 0.05], sfxRepairRate: [0.5, 2.5, 0.01],
  sfxThudGain: [0, 3, 0.05], sfxThudRate: [0.5, 2.5, 0.01],
  sfxBodyGain: [0, 3, 0.05], sfxBodyRate: [0.5, 2.5, 0.01],
  sfxKnockGain: [0, 3, 0.05], sfxKnockRate: [0.5, 2.5, 0.01],
  sfxSingGain: [0, 3, 0.05], sfxSingRate: [0.5, 2.5, 0.01],
  sfxPopGain: [0, 3, 0.05], sfxPopRate: [0.5, 2.5, 0.01],
  sfxSqueakGain: [0, 3, 0.05], sfxSqueakRate: [0.5, 2.5, 0.01],
  sfxSwellGain: [0, 3, 0.05], sfxSwellRate: [0.5, 2.5, 0.01],
  sfxTailMix: [0, 1, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_GLASS_RANGES: Record<HeroGlassNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => GLASS_TIER_SUFFIXES.map((s) => [`t${t}${s}`, GLASS_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** Hard caps whatever the tuner says. */
export const GLASS_CAPS = { shards: 70, minShards: 40, cracks: 560, shakePx: 40, zoom: 0.1, forks: 8 } as const;

const store = configStore<HeroGlassConfig>({
  key: 'ascent.heroglass.v4', defaults: HERO_GLASS_DEFAULTS, ranges: HERO_GLASS_RANGES,
  colorKeys: HERO_GLASS_COLOR_KEYS, clipKeys: [...HERO_GLASS_CLIP_KEYS, 'variation'], previewKeys: ['previewDamage', 'previewParts', 'variation'],
});
export const heroGlassStore = store;
export const getHeroGlassConfig = store.get;
export const clampHeroGlassValue = store.clamp;
export const sanitizeHeroGlassConfig = store.sanitize;
export const heroGlassConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1. */
export function heroGlassPreviewSpeed(): number { return 1; }

export function glassTierDials(tier: TierNum, c: HeroGlassConfig = store.get()): Record<GlassTierSuffix, number> {
  return Object.fromEntries(GLASS_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<GlassTierSuffix, number>;
}

// ─── the causes (the per-blow roll; pure) ───────────────────────────────────────────────────────────────────────

export const GLASS_CAUSES = ['butt', 'knock', 'hum', 'creep', 'shock', 'beam', 'ricochet'] as const;
export type GlassCause = (typeof GLASS_CAUSES)[number];

/** What each cause is, for the tuner. */
export const GLASS_CAUSE_NAMES: Record<GlassCause, string> = {
  butt: 'the headbutt (the portrait slams the glass): an impact star',
  knock: 'the knock (tap, tap, KNOCK): a bullseye of rings',
  hum: 'resonance (a rising tone breaks it): a sunburst of needles',
  creep: 'pressure (a crack creeps in from the screen edge): a fracture tree',
  shock: 'the shockwave (a stamp, a ring of force): a frosted craze',
  beam: 'the beam (a hot spot pops): long thermal cracks',
  ricochet: 'the ricochet (a point of light off the screen edges): a skid star',
};

/** How long each cause takes, as a multiple of the look's `CauseMs`. */
export const GLASS_CAUSE_PACE: Record<GlassCause, number> = { butt: 0.72, knock: 1.25, hum: 1.5, creep: 1.55, shock: 0.85, beam: 1.4, ricochet: 1.15 };
/** The causes that cross the board (their length follows the distance between the portraits). */
const TRAVELS: ReadonlySet<GlassCause> = new Set(['butt', 'shock', 'ricochet']);

const isCause = (v: string): v is GlassCause => (GLASS_CAUSES as readonly string[]).includes(v);

/** The cause a blow plays: the DEV override when set, else rolled from the stable per-blow seed. Pure. */
export function causeOf(rollSeed: number, c: HeroGlassConfig = store.get()): GlassCause {
  if (isCause(c.variation)) return c.variation;
  let h = ((Math.round(rollSeed) | 0) ^ 0x5bd1e995) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return GLASS_CAUSES[h % GLASS_CAUSES.length]!;
}

/**
 * The cause's own beats BEFORE the glass first cracks, as fractions of its length: the knock's two taps, the hum's
 * pulses (they quicken), the creeping crack's jerks, the stamp, the beam's spits, the ricochet's bounces. FX and sound
 * only. A bigger look creeps and bounces once more.
 */
export function causeBeats(cause: GlassCause, tier: TierNum): number[] {
  switch (cause) {
    case 'knock': return [0.3, 0.62];
    case 'hum': return [0.04, 0.24, 0.42, 0.57, 0.7, 0.8, 0.88, 0.95];
    case 'creep': { const n = tier === 1 ? 3 : tier === 2 ? 4 : 5; return Array.from({ length: n }, (_, i) => i / n); }
    case 'shock': return [0];
    case 'beam': return [0.3, 0.55, 0.75, 0.9];
    case 'ricochet': { const n = tier === 1 ? 2 : 3; return Array.from({ length: n }, (_, i) => (i + 1) / (n + 1)); }
    default: return [];
  }
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export const GLASS_REF_DISTANCE = 1600;

/** A crossing (a lunge, a ring of force, Tier 4's tear) scaled gently by the distance between the two portraits. */
export function glassLegMs(distance: number, ms: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : GLASS_REF_DISTANCE;
  return Math.round(ms * clamp(Math.sqrt(d / GLASS_REF_DISTANCE), 0.62, 1.15));
}

export interface GlassPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
  /** What cracks the glass (default: the headbutt). */
  cause?: GlassCause;
}

export type GlassKind = 'chip' | 'web' | 'pane' | 'shatter';

export interface GlassPlan {
  reduced: boolean;
  tier: TierNum;
  kind: GlassKind;
  cause: GlassCause;
  k: number;
  total: number;
  chargeAt: number;
  absorbEnd: number;
  /** The cause begins (the lunge, the first tap's wind, the tone, the creep, the stamp, the beam, the bolt). */
  fireAt: number;
  /** The cause's own beats before the glass cracks (`causeBeats`), ascending. FX and sound only. */
  pre: number[];
  /** The glass first cracks over the struck portrait. Tiers 1 to 3: the blow. Tier 4: where the tear starts. */
  strikeAt: number;
  /** Tier 4: the bold fracture tears across the screen from `raceAt` to `raceEnd` (other looks: both the impact). */
  raceAt: number;
  raceEnd: number;
  /** The cracks spread in little jumps: each time is one jump (and one creak). Ascending. */
  jumps: number[];
  /** Marks on the glass over the struck portrait BEFORE the blow (Tier 4: the first crack). */
  hits: number[];
  impactAt: number;
  /** The glass breaks out: Tier 3's pane a beat after the crack, Tier 4's whole screen on the impact (Tiers 1, 2: never, -1). */
  breakAt: number;
  /** Tier 3: the pane repairs (-1 otherwise). */
  repairAt: number;
  /** Tiers 1 to 3: the cracks fade from `healAt` to `healEnd` (Tier 4: the shatter takes them, both the impact). */
  healAt: number;
  healEnd: number;
  /**
   * THE STRUCK HERO REACTS: it comes up to the glass at `pressAt` and presses its face to it until `pressEnd` (Tier 3:
   * until the pane gives way under it; Tier 4: until the inhale). `knocksIn`: it knocks on the glass from the INSIDE
   * (Tier 2 twice, Tier 3 once before its shove breaks the pane, Tier 4 twice through the held beat). FX and sound only.
   */
  pressAt: number;
  pressEnd: number;
  knocksIn: number[];
  /** Tier 4: THE INHALE before the shatter (the screen darkens, the cracks blaze); -1 below Tier 4. */
  inhaleAt: number;
  /** The Knockout variant ("Tier V"): Tier 4 with the prism, a bigger shake and a deeper dip. */
  ko: boolean;
  /** Tier 4's slow-mo dip on the shatter (null below Tier 4): the one clock eases down and back, never 0. */
  dip: KoDip | null;
  endAt: number;
  /** The mark's reach in struck radii (Tier 4: 0, it covers the screen). */
  web: number;
  shakePx: number;
  zoom: number;
  push: number;
  punch: number;
  dim: number;
}

export function glassKind(tier: TierNum): GlassKind { return tier === 1 ? 'chip' : tier === 2 ? 'web' : tier === 3 ? 'pane' : 'shatter'; }

/** `n` jump times from `from` to `to`, the gaps shrinking (the creaking quickens). */
function spread(from: number, to: number, n: number): number[] {
  const out: number[] = [];
  const span = Math.max(0, to - from);
  for (let i = 0; i < n; i++) { const u = n <= 1 ? 0 : i / (n - 1); out.push(Math.round(from + span * (1 - (1 - u) * (1 - u) * 0.55 - (1 - u) * 0.45))); }
  return out;
}

/** The whole Fourth Wall, in base ms. Pure and deterministic. */
export function glassPlan(input: GlassPlanInput, c: HeroGlassConfig = store.get()): GlassPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier 4
  const kind = glassKind(tier);
  const cause: GlassCause = input.cause ?? 'butt';
  const ko = tier === 4 && isKnockoutVariant(input);
  const L = glassTierDials(tier, c);
  const k = (tier - 1) / 3;
  const base = {
    tier, kind, cause, k, total, ko, web: L.Web, shakePx: clamp(L.Shake * (ko ? KO_SHAKE : 1), 0, GLASS_CAPS.shakePx), zoom: clamp(L.Zoom, 0, GLASS_CAPS.zoom),
    push: L.Push, punch: L.Punch * (ko ? 1.2 : 1), dim: L.Dim,
  };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...base, reduced: true, chargeAt: at, absorbEnd: at, fireAt: at, pre: [], strikeAt: at, raceAt: at, raceEnd: at, jumps: [], hits: [], impactAt: at,
      breakAt: -1, repairAt: -1, healAt: at, healEnd: at, pressAt: -1, pressEnd: -1, knocksIn: [], inhaleAt: -1, dip: null, endAt: r.endAt, web: 0, shakePx: 0, zoom: 0, push: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const fireAt = chargeAt + Math.max(L.ReadyMs, c.absorbMs);
  const causeMs = Math.max(120, Math.round((TRAVELS.has(cause) ? glassLegMs(input.distance, L.CauseMs) : L.CauseMs) * GLASS_CAUSE_PACE[cause]));
  const strikeAt = fireAt + causeMs;
  const pre = causeBeats(cause, tier).map((f) => Math.round(fireAt + causeMs * f));
  const J = Math.round(clamp(c.creakJumps, 2, 10));
  const hits: number[] = [];
  let raceAt: number, raceEnd: number, impactAt: number, jumps: number[], breakAt = -1, repairAt = -1, healAt: number, healEnd: number;
  let pressAt: number, pressEnd: number, inhaleAt = -1;
  const knocksIn: number[] = [];
  if (kind === 'shatter') {
    // The cause cracks the glass (a mark, not the blow); a breath later the tear is off; then the held beat; then the shatter.
    hits.push(strikeAt);
    raceAt = strikeAt + 90; raceEnd = raceAt + glassLegMs(input.distance, c.raceMs);
    impactAt = raceEnd + Math.max(200, L.HoldMs);
    // The rest of the web starts creaking out while the tear is still running, and quickens up to the shatter.
    jumps = spread(raceAt + (raceEnd - raceAt) * 0.45, impactAt - 110, J + 3);
    breakAt = impactAt; healAt = impactAt; healEnd = impactAt;
    // The trapped hero comes up to the glass and pounds on it twice; then THE INHALE, and the shatter.
    const hold = impactAt - raceEnd;
    inhaleAt = Math.max(raceEnd + 120, impactAt - Math.max(0, c.inhaleMs));
    pressAt = raceEnd + Math.round(hold * 0.06);
    knocksIn.push(Math.round(raceEnd + hold * 0.32), Math.round(raceEnd + hold * 0.56));
    pressEnd = inhaleAt;
  } else {
    impactAt = strikeAt;
    raceAt = impactAt; raceEnd = impactAt;
    // The first jump is the crack itself; the rest creak outward over `GrowMs`.
    jumps = kind === 'chip' ? [impactAt, impactAt + Math.max(20, L.GrowMs)] : [impactAt, ...spread(impactAt + 60, impactAt + Math.max(80, L.GrowMs), J - 1)];
    const grown = jumps[jumps.length - 1]!;
    if (kind === 'pane') {
      // It presses, knocks once, and SHOVES: the pane gives way under it.
      pressAt = grown + 40;
      knocksIn.push(pressAt + 200);
      breakAt = Math.max(grown + 40, impactAt + c.breakMs, knocksIn[0]! + 190);
      repairAt = breakAt + c.holeMs;
      healAt = repairAt;
      pressEnd = breakAt;
    } else if (kind === 'web') {
      // It presses its face to the glass and knocks twice from the inside; each knock creaks the web.
      pressAt = grown + 60;
      knocksIn.push(pressAt + 210, pressAt + 400);
      healAt = Math.max(grown + L.HoldMs, knocksIn[1]! + 200);
      pressEnd = healAt + c.healMs;
    } else {
      // It leans in to look at the chip, fogging the glass.
      pressAt = grown + 90;
      healAt = Math.max(grown + L.HoldMs, pressAt + 360);
      pressEnd = healAt + c.healMs;
    }
    healEnd = healAt + c.healMs;
  }
  const endAt = Math.max(impactAt + Math.max(c.zoomOutMs * 0.8, L.SettleMs), healEnd + 40);
  // Tier 4's dip on the shatter; the Knockout's is deeper and longer.
  const dip: KoDip | null = tier === 4 && c.slowMoMs > 0
    ? { at: impactAt, lo: ko ? Math.max(0.1, c.slowMo * 0.8) : c.slowMo, ms: c.slowMoMs + (ko ? 60 : 0) }
    : null;
  return { ...base, reduced: false, chargeAt, absorbEnd, fireAt, pre, strikeAt, raceAt, raceEnd, jumps, hits, impactAt, breakAt, repairAt, healAt, healEnd, pressAt, pressEnd, knocksIn, inhaleAt, dip, endAt };
}

/**
 * `fire`: the cause begins. `pre`: one of its beats. `strike`: Tier 4's first crack (a mark, never the blow). `race`:
 * Tier 4's tear is off. `tense`: Tier 4's held beat begins. `creak`: a jump of the web. `press`: the struck hero comes up
 * to the glass. `inknock`: it knocks from the inside. `inhale`: Tier 4's breath before the shatter.
 */
export type GlassCueKind = 'charge' | 'fire' | 'pre' | 'strike' | 'race' | 'tense' | 'creak' | 'press' | 'inknock' | 'inhale' | 'impact' | 'break' | 'repair' | 'heal' | 'end';
export interface GlassCue { at: number; kind: GlassCueKind; i: number }

export function glassCues(p: GlassPlan): GlassCue[] {
  const out: GlassCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.fireAt, kind: 'fire', i: 0 });
    p.pre.forEach((at, i) => out.push({ at, kind: 'pre', i }));
    if (p.kind === 'shatter') {
      out.push({ at: p.strikeAt, kind: 'strike', i: 0 });
      out.push({ at: p.raceAt, kind: 'race', i: 0 });
      out.push({ at: p.raceEnd, kind: 'tense', i: 0 });
    }
    // The jump that IS the blow makes its own sound; the others creak.
    p.jumps.forEach((at, i) => { if (at !== p.impactAt) out.push({ at, kind: 'creak', i }); });
    if (p.pressAt >= 0) out.push({ at: p.pressAt, kind: 'press', i: 0 });
    p.knocksIn.forEach((at, i) => out.push({ at, kind: 'inknock', i }));
    if (p.inhaleAt >= 0) out.push({ at: p.inhaleAt, kind: 'inhale', i: 0 });
    if (p.kind === 'pane') { out.push({ at: p.breakAt, kind: 'break', i: 0 }); out.push({ at: p.repairAt, kind: 'repair', i: 0 }); }
    if (p.kind !== 'shatter') out.push({ at: p.healAt, kind: 'heal', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<GlassCueKind, number> = { charge: 0, fire: 1, pre: 2, strike: 3, race: 4, tense: 5, creak: 6, press: 7, inknock: 8, inhale: 9, impact: 10, break: 11, repair: 12, heal: 13, end: 14 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

/**
 * Tier 4's SLOW-MO DIP on the shatter (a freeze is banned, R-PROG-ATTACK-10): the one clock drops to `slowMo` the instant the
 * screen breaks and eases back over `slowMoMs`, a smooth ramp never reaching 0, so the shards hang at the viewer.
 */
export function glassScale(p: GlassPlan, c: HeroGlassConfig, t: number): number {
  void c;
  return p.reduced ? 1 : koTimeScale(p.dip, t);
}

export function glassSlowExtraMs(p: GlassPlan, c: HeroGlassConfig): number {
  void c;
  return p.reduced ? 0 : koDipExtraMs(p.dip);
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

export type Box = { x: number; y: number; w: number; h: number };

/**
 * One crack line: a straight piece from `a` to `b` that GROWS from `a` between `t0` and `t1` (sequence ms; a jump is a
 * few tens of ms, Tier 4's tear a real sweep). `w`: its thickness (the tear heavy, a hairline light).
 */
export interface CrackSeg { ax: number; ay: number; bx: number; by: number; len: number; ang: number; w: number; t0: number; t1: number }

/** One shard: a triangle of the broken glass (its three corners, its centre and how far that is from the impact). */
export interface ShardTri { x: [number, number, number]; y: [number, number, number]; cx: number; cy: number; dist: number }

/** A web: `nodes[ring][spoke]` round `origin` (ring 0 the innermost), spoke 0 pointing along `aim`. */
export interface GlassWeb { origin: Pt; spokes: number; rings: number; nodes: Pt[][] }

/**
 * A SPIDER WEB round `origin`: `spokes` rays at jittered angles (spoke 0 exactly along `aim`, and with an even count the
 * opposite spoke exactly against it, so one straight fracture runs through the middle) crossing rings at the jittered
 * `radii`. The last ring is never pulled inward, so a web sized to cover a box still covers it. Pure.
 */
export function buildWeb(rnd: () => number, origin: Pt, aim: number, spokes: number, radii: readonly number[]): GlassWeb {
  const N = Math.max(3, Math.round(spokes));
  const gap = (Math.PI * 2) / N;
  const angles: number[] = [];
  for (let s = 0; s < N; s++) {
    const straight = s === 0 || (N % 2 === 0 && s === N / 2);
    angles.push(aim + gap * (s + (straight ? 0 : (rnd() - 0.5) * 0.5)));
  }
  const nodes: Pt[][] = [];
  radii.forEach((r, ri) => {
    const last = ri === radii.length - 1;
    const row: Pt[] = [];
    for (let s = 0; s < N; s++) {
      const rr = r * (last ? 1 + rnd() * 0.08 : 0.86 + rnd() * 0.28);
      const a = angles[s]! + (last || s === 0 || (N % 2 === 0 && s === N / 2) ? 0 : (rnd() - 0.5) * gap * 0.12);
      row.push({ x: origin.x + Math.cos(a) * rr, y: origin.y + Math.sin(a) * rr });
    }
    nodes.push(row);
  });
  return { origin: { x: origin.x, y: origin.y }, spokes: N, rings: radii.length, nodes };
}

const tri = (o: Pt, a: Pt, b: Pt, c: Pt): ShardTri => {
  const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3;
  return { x: [a.x, b.x, c.x], y: [a.y, b.y, c.y], cx, cy, dist: Math.hypot(cx - o.x, cy - o.y) };
};

/**
 * The web's cells as triangles: the centre fan, then every cell between two rings split along a diagonal (`flip[ring][s]`
 * says which, the same choice the crack lines draw). They share their corners, so together they tile the web exactly.
 * `upTo`: how many rings of cells (1 = the centre fan only). `bounds`: drop a triangle wholly outside it.
 */
export function webTris(w: GlassWeb, flips: readonly (readonly boolean[])[], upTo = w.rings, bounds?: Box): ShardTri[] {
  const out: ShardTri[] = [];
  const N = w.spokes;
  const keep = (t: ShardTri): void => {
    if (bounds) {
      const x0 = Math.min(...t.x), x1 = Math.max(...t.x), y0 = Math.min(...t.y), y1 = Math.max(...t.y);
      if (x1 <= bounds.x || x0 >= bounds.x + bounds.w || y1 <= bounds.y || y0 >= bounds.y + bounds.h) return;
    }
    out.push(t);
  };
  for (let s = 0; s < N; s++) keep(tri(w.origin, w.origin, w.nodes[0]![s]!, w.nodes[0]![(s + 1) % N]!));
  for (let r = 1; r < Math.min(upTo, w.rings); r++) {
    for (let s = 0; s < N; s++) {
      const a = w.nodes[r - 1]![s]!, b = w.nodes[r - 1]![(s + 1) % N]!, c2 = w.nodes[r]![(s + 1) % N]!, d = w.nodes[r]![s]!;
      if (flips[r]?.[s]) { keep(tri(w.origin, a, b, d)); keep(tri(w.origin, b, c2, d)); } else { keep(tri(w.origin, a, b, c2)); keep(tri(w.origin, a, c2, d)); }
    }
  }
  return out;
}

/** Which diagonal each cell splits along, rolled once per web. */
export function webFlips(rnd: () => number, w: GlassWeb): boolean[][] {
  return w.nodes.map(() => Array.from({ length: w.spokes }, () => rnd() < 0.5));
}

const inBox = (x: number, y: number, b: Box, m = 0): boolean => x >= b.x - m && x <= b.x + b.w + m && y >= b.y - m && y <= b.y + b.h + m;

/** How far a ray from `o` along `a` travels before it leaves `b` (0 when `o` is outside). */
export function rayExit(o: Pt, a: number, b: Box): number {
  if (!inBox(o.x, o.y, b)) return 0;
  const dx = Math.cos(a), dy = Math.sin(a);
  const tx = Math.abs(dx) < 1e-9 ? Infinity : ((dx > 0 ? b.x + b.w : b.x) - o.x) / dx;
  const ty = Math.abs(dy) < 1e-9 ? Infinity : ((dy > 0 ? b.y + b.h : b.y) - o.y) / dy;
  return Math.max(0, Math.min(tx, ty));
}

/** Everything one blow draws on the glass, decided once (the runner and the scene only read it). */
export interface GlassGeo {
  cause: GlassCause;
  /** Where the striker's light leaves it (the beam, the bolt): a point on its rim toward the target. */
  hand: Pt;
  /** The struck point on the glass (over the struck portrait). */
  origin: Pt;
  /** The pits, each appearing at its own time `t` (ascending): at the crack, the knuckles, the bounces. */
  chips: { at: Pt; size: number; t: number }[];
  /** Every crack line, in the order it starts growing. */
  segs: CrackSeg[];
  /** The shards that fall (Tier 3: the pane's; Tier 4: the whole screen's, tiling it). */
  tris: ShardTri[];
  /**
   * The cause's own path on the glass: `creep` the crack from the screen edge to the portrait (one node per jerk);
   * `ricochet` the bolt's legs (the hand, each bounce, the portrait). Empty otherwise.
   */
  path: Pt[];
  /** Tier 4: the tear's two ends on the screen edges, its speed (px per ms) and where and when it forks (null otherwise). */
  main: { a: Pt; b: Pt; v: number; rear: number; fwd: number; back: number } | null;
  forks: { at: Pt; ang: number; t: number }[];
  /** `shock`: the haze over the craze (null otherwise). */
  frost: { at: Pt; r: number } | null;
}

interface SegSink { segs: CrackSeg[]; rnd: () => number; bounds?: Box; unit: number; width: number }

/**
 * A crack from `a` to `b` growing over [t0, t1]: cut into a few jagged pieces (a real fracture never runs straight),
 * each growing in turn, so a long crack visibly travels. Pieces wholly off the screen are dropped.
 */
function crack(k: SegSink, a: Pt, b: Pt, w: number, t0: number, t1: number, jag = 1): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return;
  const n = Math.max(1, Math.min(4, Math.round(len / (120 * k.unit))));
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  let px = a.x, py = a.y;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const off = i === n ? 0 : (k.rnd() - 0.5) * 2 * Math.min(len * 0.05, 9 * k.unit) * jag;
    const qx = a.x + (b.x - a.x) * u + nx * off, qy = a.y + (b.y - a.y) * u + ny * off;
    const m = 20 * k.unit;
    if (!k.bounds || inBox(px, py, k.bounds, m) || inBox(qx, qy, k.bounds, m) || inBox((px + qx) / 2, (py + qy) / 2, k.bounds, m)) {
      const l = Math.hypot(qx - px, qy - py);
      if (k.segs.length < GLASS_CAPS.cracks && l > 0.5) {
        k.segs.push({ ax: px, ay: py, bx: qx, by: qy, len: l, ang: Math.atan2(qy - py, qx - px), w: w * k.width, t0: t0 + (t1 - t0) * ((i - 1) / n), t1: t0 + (t1 - t0) * u });
      }
    }
    px = qx; py = qy;
  }
}

const polar = (o: Pt, a: number, r: number): Pt => ({ x: o.x + Math.cos(a) * r, y: o.y + Math.sin(a) * r });

/** A short dead-end hairline off `at`, heading roughly along `ang`. */
function branch(k: SegSink, at: Pt, ang: number, len: number, t0: number, w = 0.6): void {
  const a = ang + (k.rnd() < 0.5 ? -1 : 1) * (0.45 + k.rnd() * 0.5);
  const mid = polar(at, a, len * 0.55);
  const a2 = a + (k.rnd() - 0.5) * 0.7;
  crack(k, at, mid, w, t0, t0 + 30, 0.6);
  crack(k, mid, polar(mid, a2, len * 0.45), w * 0.75, t0 + 30, t0 + 60, 0.6);
}

/** A BOLD fork off a tear: two heavy pieces that bend, and a hairline off the bend. */
function fork(k: SegSink, at: Pt, ang: number, len: number, t0: number, w: number): void {
  const a = ang + (k.rnd() < 0.5 ? -1 : 1) * (0.42 + k.rnd() * 0.45);
  const mid = polar(at, a, len * 0.5);
  crack(k, at, mid, w, t0, t0 + 70);
  crack(k, mid, polar(mid, a + (k.rnd() - 0.5) * 0.7, len * 0.5), w * 0.65, t0 + 70, t0 + 150);
  branch(k, mid, a, len * 0.4, t0 + 70, 0.8);
}

const JUMP_MS = 46;

/**
 * A web's crack lines, spreading outward in the plan's jumps: ring `r`'s spokes land on jump `first + r * per`, its ring
 * a breath later, its diagonals (when `diag`) after that. `rings`: how many rings draw their ring lines.
 */
function webCracks(k: SegSink, w: GlassWeb, flips: readonly (readonly boolean[])[], jumps: readonly number[], first: number, o: { ringLines: number; diag: boolean; branches: number; skip?: ReadonlySet<number> }): void {
  const N = w.spokes;
  const last = jumps.length - 1;
  const jumpOf = (r: number): number => jumps[Math.min(last, first + Math.round((r * Math.max(0, last - first)) / Math.max(1, w.rings - 1)))]!;
  for (let r = 0; r < w.rings; r++) {
    const t = jumpOf(r);
    for (let s = 0; s < N; s++) {
      if (o.skip?.has(s)) continue;
      const from = r === 0 ? w.origin : w.nodes[r - 1]![s]!;
      const st = t + k.rnd() * 24;
      crack(k, from, w.nodes[r]![s]!, r === 0 ? 1 : 0.85, st, st + JUMP_MS);
      if (k.rnd() < o.branches) branch(k, w.nodes[r]![s]!, Math.atan2(w.nodes[r]![s]!.y - from.y, w.nodes[r]![s]!.x - from.x), Math.hypot(w.nodes[r]![s]!.x - from.x, w.nodes[r]![s]!.y - from.y) * 0.4, st + JUMP_MS);
    }
    if (r < o.ringLines) {
      for (let s = 0; s < N; s++) {
        const st = t + 30 + k.rnd() * 30;
        crack(k, w.nodes[r]![s]!, w.nodes[r]![(s + 1) % N]!, 0.7, st, st + JUMP_MS, 0.7);
      }
    }
    if (o.diag && r >= 1) {
      const td = jumps[last]! + k.rnd() * 20;
      for (let s = 0; s < N; s++) {
        const a = w.nodes[r - 1]![s]!, b = w.nodes[r - 1]![(s + 1) % N]!, c2 = w.nodes[r]![(s + 1) % N]!, d = w.nodes[r]![s]!;
        if (flips[r]?.[s]) crack(k, b, d, 0.5, td, td + JUMP_MS, 0.4); else crack(k, a, c2, 0.5, td, td + JUMP_MS, 0.4);
      }
    }
  }
}

/** The seed of a blow's glass (the same fight cracks the same way). */
export function glassSeed(total: number, distance: number, side: 'player' | 'opp' | undefined, rollSeed = 0): number {
  return (Math.round(total) * 6977 + Math.round(distance) * 43 + (side === 'opp' ? 251 : 29) + Math.imul(rollSeed | 0, 2654435761)) >>> 0;
}

/**
 * Tier 4's whole-screen web round the struck portrait: spoke 0 points at the striker (so the tear runs through both
 * portraits), the last ring reaches past the farthest corner, and the spoke and ring counts are picked so the shards on
 * screen number forty to seventy (aiming for the mid fifties). Pure: each candidate is rolled from the same seed.
 */
export function screenWeb(seed: number, origin: Pt, aim: number, radius: number, bounds: Box): { web: GlassWeb; flips: boolean[][]; tris: ShardTri[] } {
  const far = Math.max(
    Math.hypot(origin.x - bounds.x, origin.y - bounds.y), Math.hypot(origin.x - bounds.x - bounds.w, origin.y - bounds.y),
    Math.hypot(origin.x - bounds.x, origin.y - bounds.y - bounds.h), Math.hypot(origin.x - bounds.x - bounds.w, origin.y - bounds.y - bounds.h),
  );
  let best: { web: GlassWeb; flips: boolean[][]; tris: ShardTri[] } | null = null;
  let bestErr = Infinity;
  for (const rings of [5, 4]) {
    for (const N of [10, 12, 8, 14]) {
      const rnd = seededRng(seed ^ 0x9e3779b9);
      // The outer ring must contain the box even between two spokes at their widest jitter.
      const outer = (far * 1.04) / Math.cos(((Math.PI * 2) / N) * 0.75);
      const inner = Math.min(radius * 1.25, far * 0.12);
      const radii = rings === 5 ? [inner, far * 0.2, far * 0.4, far * 0.68, outer] : [inner, far * 0.26, far * 0.56, outer];
      const web = buildWeb(rnd, origin, aim, N, radii);
      const flips = webFlips(rnd, web);
      const tris = webTris(web, flips, web.rings, bounds);
      const n = tris.length;
      const err = (n < GLASS_CAPS.minShards || n > GLASS_CAPS.shards ? 1000 : 0) + Math.abs(n - 56);
      if (err < bestErr) { bestErr = err; best = { web, flips, tris }; }
    }
  }
  return best!;
}

// ─── the seven crack shapes (pure) ─────────────────────────────────────────────────────────────────────────────

/** What a shape is drawn from: the sink, the struck point, its reach (px), how big a version (1 to 3) and its jumps. */
interface Pat {
  k: SegSink; rnd: () => number; geo: GlassGeo; p: GlassPlan; o: Pt; R: number; reach: number; lvl: 1 | 2 | 3; jumps: readonly number[];
  /** The angle from the struck point back toward the striker. */
  back: number; bounds: Box; unit: number;
}

/** The jump a piece lands on: `u` 0..1 of the way out (0 = the crack itself, 1 = the last creak). */
const jumpAt = (q: Pat, u: number): number => q.jumps[Math.min(q.jumps.length - 1, Math.max(0, Math.round(u * (q.jumps.length - 1))))]!;

/** `butt`: THE IMPACT STAR. A tight spider web (many spokes, close rings) with a crushed heart. */
function patStar(q: Pat): void {
  const N = q.lvl === 1 ? 7 : q.lvl === 2 ? 10 : 12;
  const radii = (q.lvl === 1 ? [0.42, 1] : [0.2, 0.42, 0.7, 1]).map((f) => f * q.reach);
  const web = buildWeb(q.rnd, q.o, q.back + q.rnd() * 0.5, N, radii);
  webCracks(q.k, web, [], q.jumps, 0, { ringLines: q.lvl === 1 ? 1 : 2, diag: false, branches: 0.3 });
  // The crushed heart: short chords across the middle.
  for (let i = 0; i < 3 + q.lvl * 2; i++) {
    const a = q.rnd() * Math.PI * 2, r = q.reach * 0.2 * (0.4 + q.rnd() * 0.6);
    const b = a + 1.6 + q.rnd() * 1.6;
    crack(q.k, polar(q.o, a, r), polar(q.o, b, r * (0.5 + q.rnd() * 0.5)), 0.6, q.jumps[0]!, q.jumps[0]! + 30, 0.3);
  }
  q.geo.chips.push({ at: q.o, size: 0.42 + 0.2 * q.lvl, t: q.jumps[0]! });
}

/** `knock`: THE BULLSEYE. Broken concentric rings with a few short ties between them; a knuckle pit per knock. */
function patBullseye(q: Pat): void {
  const rings = q.lvl + 1;
  const t0 = q.jumps[0]!;
  const tap = (i: number): number => q.p.pre[i] ?? t0;
  const last = q.jumps.length - 1;
  let prev = q.reach * 0.06;
  for (let r = 0; r < rings; r++) {
    const rad = q.reach * ((r + 1) / rings) * (0.92 + q.rnd() * 0.12);
    const M = 8 + r * 3;
    const turn = q.rnd() * Math.PI * 2;
    const pts: Pt[] = [];
    for (let i = 0; i < M; i++) pts.push(polar(q.o, turn + ((i + (q.rnd() - 0.5) * 0.4) / M) * Math.PI * 2, rad * (0.94 + q.rnd() * 0.12)));
    const tr = r === 0 ? -1 : q.jumps[rings <= 2 ? 0 : Math.round(((r - 1) * last) / (rings - 2))]!;
    for (let i = 0; i < M; i++) {
      if (q.rnd() > (r === 0 ? 0.9 : 0.76)) continue; // the rings are broken
      // The inner ring comes in halves, one per early tap; the rest burst on the knock and creak outward.
      const t = r === 0 ? tap(i % 2) : tr + q.rnd() * 26;
      crack(q.k, pts[i]!, pts[(i + 1) % M]!, r === 0 ? 0.95 : 0.8, t, t + JUMP_MS, 0.5);
    }
    for (let i = 0; i < 2 + r; i++) {
      const a = q.rnd() * Math.PI * 2;
      const t = (r === 0 ? t0 : tr) + 20 + q.rnd() * 20;
      crack(q.k, polar(q.o, a, prev * 1.04), polar(q.o, a + (q.rnd() - 0.5) * 0.12, rad * 0.97), 0.7, t, t + JUMP_MS, 0.5);
    }
    prev = rad;
  }
  // Three knuckles in a short row across the line of the blow.
  const px = -Math.sin(q.back), py = Math.cos(q.back);
  [-1, 1, 0].forEach((side, i) => {
    q.geo.chips.push({ at: { x: q.o.x + px * side * q.R * 0.17, y: q.o.y + py * side * q.R * 0.17 }, size: i === 2 ? 0.3 + 0.08 * q.lvl : 0.24, t: i === 2 ? t0 : tap(i) });
  });
}

/** `hum`: THE SUNBURST. Fine straight needles from the centre, all at once, no rings; the longer ones split at the tip. */
function patNeedles(q: Pat): void {
  const N = q.lvl === 1 ? 12 : q.lvl === 2 ? 20 : 28;
  const t0 = q.jumps[0]!;
  const turn = q.rnd() * Math.PI;
  for (let i = 0; i < N; i++) {
    const a = turn + ((i + q.rnd() * 0.8) / N) * Math.PI * 2;
    const len = q.reach * (0.34 + 0.66 * Math.pow(q.rnd(), 1.4));
    const r0 = q.reach * 0.05 * (0.5 + q.rnd());
    const l1 = Math.min(len, q.reach * 0.55);
    const st = t0 + q.rnd() * 26;
    const w = i % 4 === 0 ? 0.95 : 0.55;
    crack(q.k, polar(q.o, a, r0), polar(q.o, a, l1), w, st, st + 70, 0.25);
    let end = st + 70;
    if (len > l1 + 4) {
      const tj = jumpAt(q, 0.3 + q.rnd() * 0.7) + q.rnd() * 20;
      crack(q.k, polar(q.o, a, l1), polar(q.o, a, len), w * 0.85, Math.max(tj, end), Math.max(tj, end) + JUMP_MS, 0.25);
      end = Math.max(tj, end) + JUMP_MS;
    }
    if (i % 3 === 0) {
      const tip = polar(q.o, a, len);
      for (const s of [-1, 1]) crack(q.k, tip, polar(tip, a + s * (0.3 + q.rnd() * 0.25), q.reach * (0.08 + q.rnd() * 0.08)), 0.45, end, end + 30, 0.2);
    }
  }
  q.geo.chips.push({ at: q.o, size: 0.22 + 0.06 * q.lvl, t: t0 });
}

/**
 * Where the creeping crack is born: on the nearest screen edge that still leaves it a real run to `o` (a struck portrait
 * sits in a corner, a few px from two edges: a crack from there would be over before it was seen), slid along that
 * edge so it comes in on a slant.
 */
function edgeBirth(rnd: () => number, o: Pt, b: Box, unit: number): Pt {
  if (!inBox(o.x, o.y, b)) return { x: o.x, y: b.y };
  const d = [o.y - b.y, b.x + b.w - o.x, b.y + b.h - o.y, o.x - b.x]; // top, right, bottom, left
  const run = Math.min(420 * unit, Math.max(...d));
  let e = -1;
  for (let i = 0; i < 4; i++) if (d[i]! >= run - 1e-6 && (e < 0 || d[i]! < d[e]!)) e = i;
  if (e < 0) e = 0;
  const slide = (rnd() < 0.5 ? -1 : 1) * Math.max(d[e]!, 220) * (0.3 + rnd() * 0.4);
  if (e === 0 || e === 2) return { x: clamp(o.x + slide, b.x + 20, b.x + b.w - 20), y: e === 0 ? b.y : b.y + b.h };
  return { x: e === 1 ? b.x + b.w : b.x, y: clamp(o.y + slide, b.y + 20, b.y + b.h - 20) };
}

/** `creep`: THE FRACTURE TREE. One crack from the screen edge to the portrait, a piece per jerk, forking; a bloom on arrival. */
function patTree(q: Pat): void {
  const E = edgeBirth(q.rnd, q.o, q.bounds, q.unit);
  const n = Math.max(1, q.p.pre.length);
  const L = Math.hypot(q.o.x - E.x, q.o.y - E.y) || 1;
  const dir = Math.atan2(q.o.y - E.y, q.o.x - E.x);
  const nx = -(q.o.y - E.y) / L, ny = (q.o.x - E.x) / L;
  const nodes: Pt[] = [E];
  for (let i = 1; i < n; i++) {
    const u = i / n, off = (q.rnd() - 0.5) * 2 * Math.min(L * 0.09, 60 * q.unit);
    nodes.push({ x: E.x + (q.o.x - E.x) * u + nx * off, y: E.y + (q.o.y - E.y) * u + ny * off });
  }
  nodes.push({ x: q.o.x, y: q.o.y });
  const t0 = q.jumps[0]!;
  const w = q.lvl === 1 ? 0.9 : q.lvl === 2 ? 1.25 : 1.5;
  for (let i = 0; i < n; i++) {
    const t = q.p.pre[i] ?? t0, next = q.p.pre[i + 1] ?? t0;
    // A jerk: the piece runs in under half the gap, then the crack waits.
    crack(q.k, nodes[i]!, nodes[i + 1]!, w, t, t + Math.max(40, (next - t) * 0.42), 0.9);
    if (i < n - 1 && (q.lvl > 1 || i % 2 === 0)) {
      const piece = Math.hypot(nodes[i + 1]!.x - nodes[i]!.x, nodes[i + 1]!.y - nodes[i]!.y);
      const tf = t + Math.max(40, (next - t) * 0.42);
      if (q.lvl === 1) branch(q.k, nodes[i + 1]!, dir, piece * 0.4, tf, 0.6);
      else fork(q.k, nodes[i + 1]!, dir, piece * (0.45 + q.rnd() * 0.3), tf, w * 0.7);
    }
  }
  q.geo.path = nodes;
  // The bloom: curved petals fanned forward off the crack's last heading.
  const petals = q.lvl === 1 ? 3 : q.lvl === 2 ? 5 : 7;
  for (let i = 0; i < petals; i++) {
    const a = dir + ((i + 0.5) / petals - 0.5) * 3.6 + (q.rnd() - 0.5) * 0.3;
    const len = q.reach * (0.5 + 0.5 * q.rnd());
    const mid = polar(q.o, a, len * 0.5);
    const st = t0 + q.rnd() * 24;
    crack(q.k, q.o, mid, 0.9, st, st + JUMP_MS, 0.8);
    const tj = q.lvl === 1 ? st + JUMP_MS : jumpAt(q, 0.4 + q.rnd() * 0.6);
    const tip = polar(mid, a + (q.rnd() - 0.5) * 0.8, len * 0.5);
    crack(q.k, mid, tip, 0.7, tj, tj + JUMP_MS, 0.8);
    if (q.lvl === 3 && i % 2 === 0) branch(q.k, tip, a, len * 0.4, tj + JUMP_MS);
  }
  q.geo.chips.push({ at: q.o, size: 0.26 + 0.1 * q.lvl, t: t0 });
}

/** `shock`: THE FROSTED CRAZE. A mosaic of short fine cracks filling a disc, swept in along the ring's heading. */
function patCraze(q: Pat): void {
  const M = q.lvl === 1 ? 20 : q.lvl === 2 ? 46 : 66;
  const min = (q.reach * 1.45) / Math.sqrt(M);
  const pts: Pt[] = [{ x: q.o.x, y: q.o.y }];
  for (let tries = 0; pts.length < M && tries < M * 14; tries++) {
    const a = q.rnd() * Math.PI * 2, r = q.reach * Math.sqrt(q.rnd());
    const c = polar(q.o, a, r);
    let ok = true;
    for (const p of pts) if (Math.hypot(p.x - c.x, p.y - c.y) < min) { ok = false; break; }
    if (ok) pts.push(c);
  }
  const t0 = q.jumps[0]!;
  const wx = -Math.cos(q.back), wy = -Math.sin(q.back); // the way the ring is travelling
  const seen = new Set<number>();
  pts.forEach((p, i) => {
    // Each point ties to its nearest two (three for every other one in the big version): a net, never a fan.
    const near = pts.map((o2, j) => ({ j, d: j === i ? Infinity : Math.hypot(o2.x - p.x, o2.y - p.y) })).sort((x, y) => x.d - y.d);
    const ties = q.lvl === 3 && i % 2 === 0 ? 3 : 2;
    for (let n = 0; n < ties && n < near.length; n++) {
      const j = near[n]!.j;
      if (!Number.isFinite(near[n]!.d)) continue;
      const key = Math.min(i, j) * 1000 + Math.max(i, j);
      if (seen.has(key)) continue;
      seen.add(key);
      const o2 = pts[j]!;
      const mx = (p.x + o2.x) / 2 - q.o.x, my = (p.y + o2.y) / 2 - q.o.y;
      const s = clamp(((mx * wx + my * wy) / q.reach + 1) / 2, 0, 1); // 0 = the near side, struck first
      const far = Math.hypot(mx, my) / q.reach;
      // The heart crazes at once as the ring crosses it (near side first); the rim follows on the creaks.
      const t = q.lvl === 1 || far < 0.5 ? t0 + clamp((s - 0.25) * 2, 0, 1) * 110 : jumpAt(q, 0.25 + 0.75 * s) + q.rnd() * 30;
      crack(q.k, p, o2, 0.6 + q.rnd() * 0.35, t, t + 40, 0.5);
    }
  });
  q.geo.frost = { at: { x: q.o.x, y: q.o.y }, r: q.reach };
}

/** `beam`: THE THERMAL CRACKS. A few long cracks wandering out from the hot spot, a step per creak. */
function patHeat(q: Pat): void {
  const K = q.lvl === 1 ? 4 : q.lvl === 2 ? 6 : 7;
  const steps = q.lvl * 2;
  const stepLen = (q.reach * 1.1) / steps;
  const turn = q.rnd() * Math.PI;
  for (let i = 0; i < K; i++) {
    let a = turn + ((i + (q.rnd() - 0.5) * 0.6) / K) * Math.PI * 2;
    let pt = polar(q.o, a, q.R * 0.05);
    for (let j = 0; j < steps; j++) {
      a += (q.rnd() - 0.5) * 0.8;
      const nxt = polar(pt, a, stepLen * (0.75 + q.rnd() * 0.5));
      const t = jumpAt(q, steps <= 1 ? 0 : j / (steps - 1)) + q.rnd() * 20;
      crack(q.k, pt, nxt, Math.max(0.6, 1.2 - 0.12 * j), t, t + JUMP_MS, 1.3);
      if (q.rnd() < 0.3) branch(q.k, nxt, a, stepLen * 0.5, t + JUMP_MS);
      pt = nxt;
    }
  }
  q.geo.chips.push({ at: q.o, size: 0.26 + 0.05 * q.lvl, t: q.jumps[0]! });
}

/** The bolt's legs: from the hand, off `n` different screen edges in turn (walking round the screen), to the portrait. */
function ricochetPath(rnd: () => number, from: Pt, to: Pt, b: Box, n: number): Pt[] {
  const start = Math.floor(rnd() * 4), step = rnd() < 0.5 ? 1 : 3;
  const out: Pt[] = [{ x: from.x, y: from.y }];
  const diag = Math.hypot(b.w, b.h);
  for (let i = 0; i < n; i++) {
    const e = (start + i * step) % 4;
    let u = 0.18 + rnd() * 0.64;
    const at = (v: number): Pt => (e === 0 ? { x: b.x + b.w * v, y: b.y } : e === 1 ? { x: b.x + b.w, y: b.y + b.h * v } : e === 2 ? { x: b.x + b.w * v, y: b.y + b.h } : { x: b.x, y: b.y + b.h * v });
    // Keep every leg long enough to read (the first off the hand, the last onto the portrait).
    const prev = out[out.length - 1]!;
    const short = (p: Pt): boolean => Math.hypot(p.x - prev.x, p.y - prev.y) < diag * 0.16 || (i === n - 1 && Math.hypot(p.x - to.x, p.y - to.y) < diag * 0.16);
    if (short(at(u))) u = 1 - u;
    out.push(at(u));
  }
  out.push({ x: to.x, y: to.y });
  return out;
}

/** `ricochet`: THE SKID STAR. A chip with three ticks at every bounce; on the portrait a star thrown forward along the last leg. */
function patSkid(q: Pat): void {
  const path = ricochetPath(q.rnd, q.geo.hand, q.o, q.bounds, Math.max(1, q.p.pre.length));
  q.geo.path = path;
  const cx = q.bounds.x + q.bounds.w / 2, cy = q.bounds.y + q.bounds.h / 2;
  const t0 = q.jumps[0]!;
  for (let i = 1; i < path.length - 1; i++) {
    const b = path[i]!, t = q.p.pre[i - 1] ?? t0;
    const inward = Math.atan2(cy - b.y, cx - b.x);
    const at = polar(b, inward, 10 * q.unit);
    q.geo.chips.push({ at, size: 0.26, t });
    for (let j = -1; j <= 1; j++) {
      const a = inward + j * 0.7 + (q.rnd() - 0.5) * 0.3;
      crack(q.k, at, polar(at, a, (50 + q.rnd() * 60) * q.unit), 0.7, t, t + 36, 0.6);
    }
  }
  const from = path[path.length - 2]!;
  const v = Math.atan2(q.o.y - from.y, q.o.x - from.x);
  const fwd = q.lvl === 1 ? 3 : q.lvl === 2 ? 5 : 6;
  for (let i = 0; i < fwd; i++) {
    const a = v + ((i + 0.5) / fwd - 0.5) * 1.7 + (q.rnd() - 0.5) * 0.2;
    const len = q.reach * (0.7 + 0.5 * q.rnd());
    const pieces = q.lvl === 1 ? 1 : q.lvl + 1;
    let pt = { x: q.o.x, y: q.o.y }, ang = a;
    for (let j = 0; j < pieces; j++) {
      const nxt = polar(pt, ang, len / pieces);
      const t = jumpAt(q, pieces <= 1 ? 0 : j / (pieces - 1)) + q.rnd() * 20;
      crack(q.k, pt, nxt, Math.max(0.6, 1.1 - 0.15 * j), t, t + JUMP_MS, 0.8);
      if (q.lvl > 1 && j === pieces - 2 && q.rnd() < 0.6) branch(q.k, nxt, ang, (len / pieces) * 0.6, t + JUMP_MS);
      pt = nxt; ang += (q.rnd() - 0.5) * 0.3;
    }
  }
  for (let i = 0; i < 3 + q.lvl; i++) {
    const a = v + Math.PI + (q.rnd() - 0.5) * 2.4;
    const st = t0 + q.rnd() * 20;
    crack(q.k, q.o, polar(q.o, a, q.reach * (0.16 + q.rnd() * 0.16)), 0.7, st, st + 30, 0.5);
  }
  q.geo.chips.push({ at: q.o, size: 0.36 + 0.1 * q.lvl, t: t0 });
}

const PATTERNS: Record<GlassCause, (q: Pat) => void> = {
  butt: patStar, knock: patBullseye, hum: patNeedles, creep: patTree, shock: patCraze, beam: patHeat, ricochet: patSkid,
};

/**
 * Everything the blow draws on the glass, from the two portraits and the seed. `unit` is the stage scale (px sizes),
 * `bounds` the screen. Reduced motion draws nothing.
 */
export function glassGeo(p: GlassPlan, a: Pt, d: Pt, radius: number, aRadius: number, c: HeroGlassConfig, bounds: Box, seed: number, unit = 1): GlassGeo {
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const hand = { x: a.x + u.x * aRadius * 0.85, y: a.y + u.y * aRadius * 0.85 };
  const geo: GlassGeo = { cause: p.cause, hand, origin: { x: d.x, y: d.y }, chips: [], segs: [], tris: [], path: [], main: null, forks: [], frost: null };
  if (p.reduced) return geo;
  const rnd = seededRng(seed);
  const k: SegSink = { segs: geo.segs, rnd, bounds, unit, width: c.crackWidth };
  const back = Math.atan2(a.y - d.y, a.x - d.x);
  const R = radius;
  const o = geo.origin;
  const pat = (reach: number, lvl: 1 | 2 | 3, jumps: readonly number[]): void => PATTERNS[p.cause]({ k, rnd, geo, p, o, R, reach, lvl, jumps, back, bounds, unit });
  if (p.kind === 'shatter') {
    // The screen's own web first (it must never lose a line to the cap), then the tear, then the cause's mark.
    const { web, flips, tris } = screenWeb(seed, o, back, R, bounds);
    geo.tris = tris;
    const opp = web.spokes / 2;
    webCracks(k, web, flips, p.jumps, 0, { ringLines: web.rings - 1, diag: true, branches: 0.12, skip: new Set([0, opp]) });
    // THE TEAR: one bold fracture from the struck point, both ways at one speed: back through the striker to the near
    // edge and on to the far edge, the longer arm arriving at `raceEnd`. It forks as it goes.
    const rear = rayExit(o, back, bounds), fwd = rayExit(o, back + Math.PI, bounds);
    const v = Math.max(rear, fwd, 1) / Math.max(1, p.raceEnd - p.raceAt);
    geo.main = { a: polar(o, back, rear), b: polar(o, back + Math.PI, fwd), v, rear, fwd, back };
    const W = 2.7 * c.tearWidth;
    [[0, back, rear], [opp, back + Math.PI, fwd]].forEach(([s, ang, len]) => {
      const stops = [0, ...web.nodes.map((row) => Math.hypot(row[s!]!.x - o.x, row[s!]!.y - o.y)).filter((r) => r < len! - 1), len!];
      for (let i = 1; i < stops.length; i++) {
        const lo = stops[i - 1]!, hi = stops[i]!;
        if (hi - lo < 1) continue;
        crack(k, polar(o, ang!, lo), polar(o, ang!, hi), W * (1 - 0.25 * (lo / Math.max(1, len!))), p.raceAt + lo / v, p.raceAt + hi / v);
      }
      for (let i = 0; i < 4 && geo.forks.length < GLASS_CAPS.forks; i++) {
        const at = len! * (0.14 + 0.21 * i + rnd() * 0.08);
        if (at > len! - 60 * unit) break;
        const pt = polar(o, ang!, at);
        fork(k, pt, ang!, (190 + rnd() * 230) * unit, p.raceAt + at / v, W * 0.6);
        geo.forks.push({ at: pt, ang: ang!, t: p.raceAt + at / v });
      }
    });
    geo.forks.sort((x, y) => x.t - y.t);
    pat(R * 1.5, 2, [p.strikeAt, p.strikeAt + 60, p.strikeAt + 130]);
  } else {
    const lvl = p.kind === 'chip' ? 1 : p.kind === 'web' ? 2 : 3;
    if (lvl === 3) {
      // THE PANE that breaks out: eight shards round the portrait. Its outline cracks through just before it lets go.
      const pane = buildWeb(rnd, o, back, 8, [R * 1.18]);
      geo.tris = webTris(pane, [], 1);
      const tb = p.breakAt - 90;
      for (let s = 0; s < 8; s++) {
        const st = tb + rnd() * 30;
        crack(k, o, pane.nodes[0]![s]!, 1, st, st + 50);
        crack(k, pane.nodes[0]![s]!, pane.nodes[0]![(s + 1) % 8]!, 1.15, tb + 40, tb + 90, 0.7);
      }
    }
    pat(R * Math.max(0.4, p.web), lvl, p.jumps);
  }
  geo.segs.sort((x, y) => x.t0 - y.t0);
  geo.chips.sort((x, y) => x.t - y.t);
  return geo;
}

/**
 * Where the bolt is at `t` on a polyline whose point `i` is reached at `times[i]` (each leg at its own speed, so every
 * bounce lands exactly on its beat). Pure.
 */
export function legPoint(path: readonly Pt[], times: readonly number[], t: number): { p: Pt; leg: number; ang: number } {
  const n = Math.min(path.length, times.length);
  if (n < 2) return { p: path[0] ?? { x: 0, y: 0 }, leg: 0, ang: 0 };
  let i = 1;
  while (i < n - 1 && t >= times[i]!) i++;
  const a = path[i - 1]!, b = path[i]!;
  const e = clamp((t - times[i - 1]!) / Math.max(1, times[i]! - times[i - 1]!), 0, 1);
  return { p: { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }, leg: i - 1, ang: Math.atan2(b.y - a.y, b.x - a.x) };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
/** The causes whose beats jolt the view (a knock, a jerk of the crack, a bounce, the stamp). */
const JOLTS: ReadonlySet<GlassCause> = new Set(['knock', 'creep', 'ricochet', 'shock']);

/**
 * The camera: a small push in through the ready; Tier 4 keeps pushing in through the tear and the held beat (the screen
 * never holds still); a knock, a jerk, a bounce and Tier 4's first crack kick it; the impact punches and shakes (Tier 4 the
 * hardest, and for longer). Pure.
 */
export function glassCameraAt(p: GlassPlan, c: HeroGlassConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.fireAt - p.chargeAt));
    if (t >= p.fireAt) z += p.push * sine((t - p.fireAt) / Math.max(1, p.impactAt - p.fireAt));
    // Tier 4's inhale: one last lean in before the glass goes.
    if (p.inhaleAt >= 0 && t >= p.inhaleAt) z += p.push * 0.6 * sine((t - p.inhaleAt) / Math.max(1, p.impactAt - p.inhaleAt));
  } else if (t >= p.impactAt) {
    z += (p.zoom + p.push * 0.5 + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  }
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => { const s = springAt(t - at, hz, tau); x += dir.x * amp * s; y += dir.y * amp * s; };
  if (JOLTS.has(p.cause)) for (const at of p.pre) kick(at, Math.max(2, p.shakePx * 0.2), 40, 18);
  for (const at of p.hits) kick(at, p.shakePx * 0.4, 50, 18);
  // The struck hero's knocks from the inside jolt the view back the other way.
  for (const at of p.knocksIn) kick(at, -Math.max(2.5, p.shakePx * 0.3), 45, 16);
  if (p.breakAt > p.impactAt) kick(p.breakAt, p.shakePx * 0.45, 70, 14);
  kick(p.impactAt, p.shakePx, Math.max(1, (c.shakeMs * (p.kind === 'shatter' ? 1 : 0.7)) / 4), 16);
  // Tier 4: a second, slower heave under the shake (the whole pane letting go).
  if (p.kind === 'shatter') { const s = springAt(t - p.impactAt, 5, c.shakeMs / 2.5); x -= dir.y * p.shakePx * 0.35 * s; y += dir.x * p.shakePx * 0.35 * s; }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/** The anchor: the striker through the ready, gliding to the struck hero while the cause plays. */
export function glassCameraFocus(p: GlassPlan, t: number, a: Pt, d: Pt): Pt {
  if (t <= p.fireAt) return a;
  if (t < p.strikeAt) { const e = sine((t - p.fireAt) / Math.max(1, p.strikeAt - p.fireAt)); return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e }; }
  return d;
}
