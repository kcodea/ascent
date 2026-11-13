/**
 * THE GRAND FINALE HERO ATTACK (style `fireworks`, an EPIC): its tuned values, its pure timeline (every shell, when it
 * leaves, when it bursts), the pure geometry (where the spark is lit, every flight, where every shell opens) and the
 * pure camera.
 *
 * ONE IDEA: a fireworks show, launched from LIGHT. There is no launcher anywhere (the third pass took out the painted
 * rocket, candle and mortar): a spark ignites on the rim of the striking hero's portrait, a fuse of crackling sparks
 * crawls round the rim, and every shell leaves from that light as a glowing head with a glittering trail. Every shell is
 * live particle work: stars that burst, slow under drag and droop under gravity, glitter that flickers, crackle that
 * pops late, stars that change colour, ring, heart, spiral and smiley shells, and smoke that hangs and drifts.
 *
 * THE THREE LOOKS. Every hero attack reads its tier from the shared `attackTier` (shared tiers 1 to 4; a knockout always
 * plays 4). An Epic maps those four onto three looks (`fireworksLevel`): shared tier 1 plays TIER 1, shared tiers 2 and 3
 * play TIER 2, shared tier 4 (and any knockout) plays TIER 3.
 *  - TIER 1: one shell. The spark is lit, the fuse crawls, and the variant's shell flies at the struck portrait and
 *    bursts on it (the blow).
 *  - TIER 2: a volley of three. A ring shell opens round the struck face, a heart shell over it (both ticks: FX, sound and
 *    a flinch), then the variant's shell lands THE blow.
 *  - TIER 3, THE GRAND FINALE: a long rising barrage, wave after wave of shells from the hero's spark and from the bottom
 *    of the screen, across the whole sky (one shell per wave bursts on the struck portrait, which flinches and is singed).
 *    Then one comet rises off the top of the screen and THE HELD BEAT: a hush, the smoke hanging. Then ONE ENORMOUS
 *    SHELL fills the screen (the blow) with a camera push and a big shake and a crackling glitter rain over everything,
 *    and last a final flash on the struck portrait.
 *
 * THE VARIANT (rolled from the stable `rollSeed`, forced by the DEV tuner's Variation row) gives every tier its own
 * whimsy: 1 THE SMILEY (a shell that bursts into a smiley face, which winks and melts), 2 THE PINWHEEL (a catherine
 * wheel that spins up on the hero's rim before it flies, and spiral shells), 3 THE FAKE-OUT (Tier 1: a dud that fizzles
 * and flops, then the real one; Tier 2: a shell that hangs and sputters, then goes off all at once; Tier 3: the barrage
 * opens with a dud).
 *
 * The damage formation (shared) opens every attack; this style starts where it ends. The consequence lands exactly
 * ONCE, on the impact beat. No hit-stop: the clock runs straight through the held beat. Reduced motion: no fireworks,
 * shake or zoom; the numbers fade and the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always plays
 * DEFAULTS.
 */
import { clamp, hexToNum, seededRng, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { hexToNum, type TierNum };

export const FIREWORKS_LEVELS = [1, 2, 3] as const;
export type FireworksLevel = (typeof FIREWORKS_LEVELS)[number];
export const FIREWORKS_LEVEL_NAMES: Record<FireworksLevel, string> = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3' };
/** Which shared damage tiers play each look (for the tuner's hints). */
export const FIREWORKS_LEVEL_TIERS: Record<FireworksLevel, string> = { 1: 'shared tier 1', 2: 'shared tiers 2 and 3', 3: 'shared tier 4 and every knockout' };

/** The shared four damage tiers mapped onto the three looks: 1 -> Tier 1, 2 and 3 -> Tier 2, 4 (and a knockout) -> Tier 3. */
export function fireworksLevel(tier: TierNum): FireworksLevel {
  return tier <= 1 ? 1 : tier >= 4 ? 3 : 2;
}

// ─── the variant roll (pure) ─────────────────────────────────────────────────────────────────────────────────

export type FireworksVariant = 1 | 2 | 3;
export const FIREWORKS_VARIANTS: readonly FireworksVariant[] = [1, 2, 3];
export const FIREWORKS_VARIANT_NAMES: Record<FireworksVariant, string> = { 1: 'The smiley', 2: 'The pinwheel', 3: 'The fake-out' };

/** The per-look dials. A config key is `v1..v3` + one of these. */
export const FIREWORKS_LEVEL_SUFFIXES = [
  'FuseMs', 'FlyMs', 'Stars', 'Burst', 'Shake', 'Zoom', 'Punch', 'SettleMs', 'Dim',
] as const;
export type FireworksLevelSuffix = (typeof FIREWORKS_LEVEL_SUFFIXES)[number];
type LevelKey = `v${FireworksLevel}${FireworksLevelSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  // Ready
  absorbMs: number;
  heroCoilPx: number;
  heroFlinchPx: number;
  /** How far round the hero's rim the fuse crawls (degrees). */
  fuseArcDeg: number;
  // Whimsy
  /** The pinwheel spins on the rim this long before it flies. */
  spinMs: number;
  /** The dud's whole life (up, sputter, flop), and the pause before the real one. */
  dudMs: number;
  dudPauseMs: number;
  /** The fake-out shell hangs and sputters this long before it goes off all at once. */
  sputterMs: number;
  // Tier 2
  volleyGapMs: number;
  // Tier 3: the barrage
  waves: number;
  waveShells: number;
  waveGapMs: number;
  waveSpanMs: number;
  // Tier 3: the enormous shell
  riseMs: number;
  holdMs: number;
  giantSize: number;
  giantStars: number;
  rain: number;
  rainMs: number;
  skyFlash: number;
  finalMs: number;
  aftermathMs: number;
  // Atmosphere
  smoke: number;
  singe: number;
  // Camera and portraits
  rockDeg: number;
  flashAlpha: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorGold: string;
  colorMagenta: string;
  colorCyan: string;
  colorGreen: string;
  colorViolet: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound
  sfxIgniteClip: string; sfxIgniteGain: number; sfxIgniteRate: number;
  sfxFuseClip: string; sfxFuseGain: number; sfxFuseRate: number;
  sfxSquealClip: string; sfxSquealGain: number; sfxSquealRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxPopClip: string; sfxPopGain: number; sfxPopRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxWhistleClip: string; sfxWhistleGain: number; sfxWhistleRate: number;
  sfxCrackleClip: string; sfxCrackleGain: number; sfxCrackleRate: number;
  sfxDudClip: string; sfxDudGain: number; sfxDudRate: number;
  sfxPinwheelClip: string; sfxPinwheelGain: number; sfxPinwheelRate: number;
  sfxVolleyClip: string; sfxVolleyGain: number; sfxVolleyRate: number;
  sfxOohClip: string; sfxOohGain: number; sfxOohRate: number;
  sfxAahClip: string; sfxAahGain: number; sfxAahRate: number;
  sfxTailMix: number;
  sfxDuck: number;
  /** DEV: '' = rolled per blow, '1' / '2' / '3' force a variant (a string so the tuner shows it as a select). */
  variation: string;
  // Preview only
  previewDamage: number;
  previewParts: number;
}
export type HeroFireworksConfig = GlobalConfig & Record<LevelKey, number>;

export const HERO_FIREWORKS_COLOR_KEYS = ['colorCore', 'colorGold', 'colorMagenta', 'colorCyan', 'colorGreen', 'colorViolet', 'colorPlayer', 'colorFoe'] as const;
export const HERO_FIREWORKS_CLIP_KEYS = [
  'sfxIgniteClip', 'sfxFuseClip', 'sfxSquealClip', 'sfxThumpClip', 'sfxPopClip', 'sfxBoomClip', 'sfxWhistleClip', 'sfxCrackleClip',
  'sfxDudClip', 'sfxPinwheelClip', 'sfxVolleyClip', 'sfxOohClip', 'sfxAahClip',
] as const;
type ColorKey = (typeof HERO_FIREWORKS_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_FIREWORKS_CLIP_KEYS)[number];
export type HeroFireworksStrKey = ColorKey | ClipKey | 'variation';
export type HeroFireworksNumKey = Exclude<keyof HeroFireworksConfig, HeroFireworksStrKey>;

/** Tier 1, Tier 2, Tier 3 per suffix: the escalation ladder. */
const LEVEL_DEFAULTS: Record<FireworksLevelSuffix, [number, number, number]> = {
  FuseMs: [340, 300, 420],
  FlyMs: [420, 400, 520],
  Stars: [1, 1.1, 1],
  Burst: [1, 1, 1],
  Shake: [8, 12, 34],
  Zoom: [0.02, 0.03, 0.05],
  Punch: [0.02, 0.03, 0.09],
  SettleMs: [200, 240, 300],
  Dim: [0.58, 0.66, 0.78],
};

export const FIREWORKS_LEVEL_RANGES: Record<FireworksLevelSuffix, [number, number, number]> = {
  FuseMs: [80, 1500, 10],
  FlyMs: [160, 1200, 10],
  Stars: [0.3, 2, 0.05],
  Burst: [0.4, 2.5, 0.05],
  Shake: [0, 50, 0.5],
  Zoom: [0, 0.12, 0.002],
  Punch: [0, 0.14, 0.001],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.85, 0.01],
};

const levelDefaults = Object.fromEntries(FIREWORKS_LEVELS.flatMap((v) => FIREWORKS_LEVEL_SUFFIXES.map((s) => [`v${v}${s}`, LEVEL_DEFAULTS[s][v - 1]]))) as Record<LevelKey, number>;

export const HERO_FIREWORKS_DEFAULTS: HeroFireworksConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroCoilPx: 4,
  heroFlinchPx: 6,
  fuseArcDeg: 80,
  spinMs: 520,
  dudMs: 640,
  dudPauseMs: 200,
  sputterMs: 440,
  volleyGapMs: 250,
  waves: 3,
  waveShells: 6,
  waveGapMs: 470,
  waveSpanMs: 340,
  riseMs: 520,
  holdMs: 520,
  giantSize: 1,
  giantStars: 180,
  rain: 170,
  rainMs: 1700,
  skyFlash: 0.32,
  finalMs: 1350,
  aftermathMs: 2200,
  smoke: 1,
  singe: 1,
  rockDeg: 6,
  flashAlpha: 0.95,
  knockPx: 22,
  squash: 0.1,
  shakeMs: 520,
  zoomOutMs: 520,
  reducedFadeMs: 260,
  colorCore: '#fffbea',
  colorGold: '#ffc94a',
  colorMagenta: '#ff4fb0',
  colorCyan: '#45dcff',
  colorGreen: '#6dff7c',
  colorViolet: '#b285ff',
  colorPlayer: '#ffd66b',
  colorFoe: '#ff7bbd',
  sfxIgniteClip: 'fx/fireworks-ignite', sfxIgniteGain: 1.5, sfxIgniteRate: 1,
  sfxFuseClip: 'fx/fireworks-fuse', sfxFuseGain: 2, sfxFuseRate: 1,
  sfxSquealClip: 'fx/fireworks-squeal', sfxSquealGain: 1.5, sfxSquealRate: 1.1,
  sfxThumpClip: 'fx/fireworks-thump', sfxThumpGain: 1.2, sfxThumpRate: 1,
  sfxPopClip: 'fx/fireworks-pop', sfxPopGain: 1.1, sfxPopRate: 1,
  sfxBoomClip: 'fx/fireworks-boom', sfxBoomGain: 1.6, sfxBoomRate: 1,
  sfxWhistleClip: 'fx/fireworks-whistle', sfxWhistleGain: 0.6, sfxWhistleRate: 1,
  sfxCrackleClip: 'fx/fireworks-crackle', sfxCrackleGain: 0.9, sfxCrackleRate: 1,
  sfxDudClip: 'fx/fireworks-dud', sfxDudGain: 1.2, sfxDudRate: 1,
  sfxPinwheelClip: 'fx/fireworks-pinwheel', sfxPinwheelGain: 1.8, sfxPinwheelRate: 1,
  sfxVolleyClip: 'fx/fireworks-volley', sfxVolleyGain: 1.4, sfxVolleyRate: 1,
  sfxOohClip: 'fx/soccer-crowd-ooh', sfxOohGain: 0.5, sfxOohRate: 1.05,
  sfxAahClip: 'fx/fireworks-aah', sfxAahGain: 1.1, sfxAahRate: 1,
  sfxTailMix: 0.16,
  sfxDuck: 0.4,
  variation: '',
  previewDamage: 12,
  previewParts: 4,
  ...levelDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroFireworksStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroCoilPx: [0, 40, 1],
  heroFlinchPx: [0, 50, 1],
  fuseArcDeg: [0, 180, 1],
  spinMs: [120, 1500, 10],
  dudMs: [200, 1500, 10],
  dudPauseMs: [0, 1000, 10],
  sputterMs: [80, 1500, 10],
  volleyGapMs: [80, 800, 5],
  waves: [1, 4, 1],
  waveShells: [2, 10, 1],
  waveGapMs: [150, 1200, 10],
  waveSpanMs: [0, 900, 10],
  riseMs: [200, 1500, 10],
  holdMs: [0, 1500, 10],
  giantSize: [0.3, 1.4, 0.01],
  giantStars: [40, 320, 1],
  rain: [0, 360, 1],
  rainMs: [400, 3000, 10],
  skyFlash: [0, 0.6, 0.01],
  finalMs: [300, 2500, 10],
  aftermathMs: [800, 4000, 10],
  smoke: [0, 2, 0.05],
  singe: [0, 2, 0.05],
  rockDeg: [0, 14, 0.5],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1400, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxIgniteGain: [0, 2, 0.05], sfxIgniteRate: [0.5, 2.5, 0.01],
  sfxFuseGain: [0, 2, 0.05], sfxFuseRate: [0.5, 2.5, 0.01],
  sfxSquealGain: [0, 2, 0.05], sfxSquealRate: [0.5, 2.5, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.3, 2.5, 0.01],
  sfxPopGain: [0, 2, 0.05], sfxPopRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.3, 2.5, 0.01],
  sfxWhistleGain: [0, 2, 0.05], sfxWhistleRate: [0.3, 2.5, 0.01],
  sfxCrackleGain: [0, 2, 0.05], sfxCrackleRate: [0.3, 2.5, 0.01],
  sfxDudGain: [0, 2, 0.05], sfxDudRate: [0.5, 2.5, 0.01],
  sfxPinwheelGain: [0, 2, 0.05], sfxPinwheelRate: [0.5, 2.5, 0.01],
  sfxVolleyGain: [0, 2, 0.05], sfxVolleyRate: [0.5, 2.5, 0.01],
  sfxOohGain: [0, 2, 0.05], sfxOohRate: [0.5, 2.5, 0.01],
  sfxAahGain: [0, 2, 0.05], sfxAahRate: [0.5, 2.5, 0.01],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_FIREWORKS_RANGES: Record<HeroFireworksNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(FIREWORKS_LEVELS.flatMap((v) => FIREWORKS_LEVEL_SUFFIXES.map((s) => [`v${v}${s}`, FIREWORKS_LEVEL_RANGES[s]]))) as Record<LevelKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say. */
export const FIREWORKS_CAPS = { shells: 40, waves: 4, waveShells: 10, shakePx: 50, zoom: 0.12 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_FIREWORKS_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_FIREWORKS_CLIP_KEYS as readonly string[]).includes(k);

export function clampHeroFireworksValue<K extends keyof HeroFireworksConfig>(key: K, value: unknown): HeroFireworksConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_FIREWORKS_DEFAULTS, key)) return undefined;
  const def = HERO_FIREWORKS_DEFAULTS[key];
  if (key === 'variation') {
    const v = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    return (v === '1' || v === '2' || v === '3' ? v : '') as HeroFireworksConfig[K];
  }
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroFireworksConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroFireworksConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_FIREWORKS_RANGES[key as HeroFireworksNumKey];
  return Math.min(max, Math.max(min, n)) as HeroFireworksConfig[K];
}

export function sanitizeHeroFireworksConfig(saved: unknown): HeroFireworksConfig {
  const out: HeroFireworksConfig = { ...HERO_FIREWORKS_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroFireworksValue(k as keyof HeroFireworksConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

// v4: the third pass (no launchers, new dials); an older saved tuning is dropped rather than half applied.
const KEY = 'ascent.herofireworks.v4';

let cfg: HeroFireworksConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_FIREWORKS_DEFAULTS };
  try { return sanitizeHeroFireworksConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_FIREWORKS_DEFAULTS }; }
})();

export function getHeroFireworksConfig(): HeroFireworksConfig { return cfg; }

export function setHeroFireworksValue(key: keyof HeroFireworksConfig, value: number | string): void {
  const safe = clampHeroFireworksValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroFireworksConfig(): void {
  cfg = { ...HERO_FIREWORKS_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function heroFireworksConfigJson(c: HeroFireworksConfig = cfg): string {
  const ship: Partial<HeroFireworksConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  delete ship.variation;
  return JSON.stringify(ship, null, 2);
}

/** The preview speed. Previews always play at 1x (owner 2026-09-29: no Speed buttons on the attack tuners). */
export function heroFireworksPreviewSpeed(): number { return 1; }

/** The variant a blow plays: the DEV override when set, else rolled from the stable per-blow seed. Pure. */
export function fireworksVariantOf(rollSeed: number, c: Pick<HeroFireworksConfig, 'variation'> = cfg): FireworksVariant {
  const forced = Number(c.variation);
  if (c.variation !== '' && (forced === 1 || forced === 2 || forced === 3)) return forced;
  let h = ((Math.round(rollSeed) | 0) ^ 0x2f6b9d35) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return ((h % 3) + 1) as FireworksVariant;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export function fireworksLevelDials(level: FireworksLevel, c: HeroFireworksConfig = cfg): Record<FireworksLevelSuffix, number> {
  return Object.fromEntries(FIREWORKS_LEVEL_SUFFIXES.map((s) => [s, c[`v${level}${s}`]])) as Record<FireworksLevelSuffix, number>;
}

/** How a shell bursts. `none`: it never does (the dud). `giant`: the enormous shell. */
export type ShellKind = 'peony' | 'ring' | 'heart' | 'spiral' | 'smiley' | 'crackle' | 'willow' | 'giant' | 'none';
/**
 * How a shell gets there. `rise`: up from the light on a glittering trail. `pinwheel`: it spins on the hero's rim for
 * `spinMs` first, then flies still spinning. `dud`: it rises part way, sputters, flops over and fizzles out. `sputter`:
 * it reaches the top, hangs and sputters for `sputterMs`, then goes off all at once. `comet`: the enormous shell's
 * rise, off the top of the screen.
 */
export type ShellFlight = 'rise' | 'pinwheel' | 'dud' | 'sputter' | 'comet';
/** What a burst does: FX only, a TICK on the struck portrait (a flinch and a singe), or THE blow. */
export type ShellRole = 'fx' | 'hit' | 'impact';

export interface ShellPlan {
  kind: ShellKind;
  flight: ShellFlight;
  role: ShellRole;
  /** Where it leaves from: the spark on the hero's rim, or the bottom of the screen. */
  from: 'hero' | 'ground';
  /** It appears (the pinwheel starts spinning). */
  launchAt: number;
  /** It leaves the ground (later than `launchAt` only for the pinwheel). */
  takeoffAt: number;
  flyMs: number;
  /** The dud starts to sputter / the fake-out starts to hang (`-1` = never). */
  sputterAt: number;
  /** It bursts (the dud: it is gone). */
  burstAt: number;
  /** Its colours: palette indices (gold, magenta, cyan, green, violet); `tint2` -1 = it does not change colour. */
  tint: number;
  tint2: number;
  /** Its size, in struck-portrait radii (the giant: a share of the view, see the geometry). */
  size: number;
  /** Tier 3: which wave (-1 = not a barrage shell). */
  wave: number;
}

export interface FireworksPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
  variant?: FireworksVariant;
  /** Seeds the barrage's spread, kinds and colours (the runner's fight seed; a replay plays the same show). */
  seed?: number;
}

export interface FireworksPlan {
  reduced: boolean;
  /** The SHARED damage tier (1..4; a knockout is 4). */
  tier: TierNum;
  /** The look: Tier 1, Tier 2 or Tier 3. */
  level: FireworksLevel;
  variant: FireworksVariant;
  k: number;
  total: number;
  /** The spark is lit on the hero's rim (the attack's first beat). */
  chargeAt: number;
  absorbEnd: number;
  /** The fuse crawls round the rim for `fuseMs` from `chargeAt`. */
  fuseMs: number;
  /** Every shell, in launch order. */
  shells: ShellPlan[];
  /** The shell that lands THE blow (its burst is `impactAt`). */
  impactShell: number;
  /** Bursts that TICK the struck portrait before the blow (a flinch and a singe). */
  hits: number[];
  /** Tier 3: THE HELD BEAT, from the comet leaving the screen (`holdAt`) for `holdMs`. Otherwise `holdMs` is 0. */
  holdAt: number;
  holdMs: number;
  /** THE consequence beat. */
  impactAt: number;
  /** Tier 3: the final flash on the struck portrait (-1 otherwise). */
  finalAt: number;
  endAt: number;
  stars: number;
  burst: number;
  shakePx: number;
  zoom: number;
  punch: number;
  dim: number;
}

/** The five colours a shell may take, by index. */
export const PALETTE_KEYS = ['colorGold', 'colorMagenta', 'colorCyan', 'colorGreen', 'colorViolet'] as const;
const BARRAGE_KINDS: readonly ShellKind[] = ['peony', 'ring', 'peony', 'heart', 'crackle', 'willow', 'spiral', 'peony'];

const shell = (o: Partial<ShellPlan> & Pick<ShellPlan, 'kind' | 'flight' | 'role' | 'launchAt' | 'flyMs'>): ShellPlan => {
  const takeoffAt = o.takeoffAt ?? o.launchAt;
  return {
    from: 'hero', sputterAt: -1, burstAt: takeoffAt + o.flyMs, tint: 0, tint2: -1, size: 1, wave: -1, ...o, takeoffAt,
  };
};

/** The whole Grand Finale, in base ms. Pure and deterministic (the same input and seed plan the same show). */
export function fireworksPlan(input: FireworksPlanInput, c: HeroFireworksConfig = cfg): FireworksPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays shared tier 4 (heroAttack/tiers.ts): Tier 3
  const level = fireworksLevel(tier);
  const variant: FireworksVariant = input.variant ?? 1;
  const V = fireworksLevelDials(level, c);
  const k = (level - 1) / 2;
  const base = {
    tier, level, variant, k, total, stars: V.Stars, burst: V.Burst,
  };

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      ...base, reduced: true, chargeAt: impactAt, absorbEnd: impactAt, fuseMs: 0, shells: [], impactShell: -1, hits: [], holdAt: impactAt, holdMs: 0,
      impactAt, finalAt: -1, endAt: r.endAt, shakePx: 0, zoom: 0, punch: 0, dim: 0,
    };
  }

  const rnd = seededRng(((input.seed ?? 1) >>> 0) ^ 0x9e3779b9);
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const first = chargeAt + V.FuseMs;
  const F = V.FlyMs;
  const shells: ShellPlan[] = [];
  let holdAt = 0, holdMs = 0, finalAt = -1;

  if (level === 1) {
    if (variant === 1) shells.push(shell({ kind: 'smiley', flight: 'rise', role: 'impact', launchAt: first, flyMs: F, tint: 0, size: 1.75 }));
    else if (variant === 2) shells.push(shell({ kind: 'spiral', flight: 'pinwheel', role: 'impact', launchAt: first, takeoffAt: first + c.spinMs, flyMs: F * 0.9, tint: 2, tint2: 1, size: 1.9 }));
    else {
      // THE DUD: up, a sputter, a flop and a fizzle. A breath. Then the real one, quick and straight.
      shells.push(shell({ kind: 'none', flight: 'dud', role: 'fx', launchAt: first, flyMs: c.dudMs, sputterAt: first + c.dudMs * 0.4, tint: 3 }));
      const real = first + c.dudMs + c.dudPauseMs;
      shells.push(shell({ kind: 'peony', flight: 'rise', role: 'impact', launchAt: real, flyMs: F * 0.75, tint: 1, tint2: 0, size: 2 }));
    }
  } else if (level === 2) {
    const g = c.volleyGapMs;
    shells.push(shell({ kind: 'ring', flight: 'rise', role: 'hit', launchAt: first, flyMs: F, tint: 2, size: 1.7 }));
    shells.push(shell({ kind: 'heart', flight: 'rise', role: 'hit', launchAt: first + g, flyMs: F, tint: 1, size: 1.5 }));
    const at = first + 2 * g;
    if (variant === 1) shells.push(shell({ kind: 'smiley', flight: 'rise', role: 'impact', launchAt: at, flyMs: F, tint: 0, size: 1.8 }));
    else if (variant === 2) shells.push(shell({ kind: 'spiral', flight: 'rise', role: 'impact', launchAt: at, flyMs: F, tint: 3, tint2: 4, size: 2 }));
    else shells.push(shell({ kind: 'crackle', flight: 'sputter', role: 'impact', launchAt: at, flyMs: F, sputterAt: at + F, tint: 0, tint2: 1, size: 2.1 }));
    const last = shells[2]!;
    if (last.flight === 'sputter') last.burstAt = last.takeoffAt + F + c.sputterMs;
  } else {
    // THE BARRAGE: wave after wave across the whole sky, from the hero's spark and from the bottom of the screen.
    const waves = Math.round(clamp(c.waves, 1, FIREWORKS_CAPS.waves));
    let start = first;
    if (variant === 3) {
      // The fake-out: the show opens with a dud that fizzles out. Then everything goes.
      shells.push(shell({ kind: 'none', flight: 'dud', role: 'fx', launchAt: first, flyMs: c.dudMs, sputterAt: first + c.dudMs * 0.4, tint: 3 }));
      start = first + c.dudMs * 0.75;
    }
    for (let w = 0; w < waves; w++) {
      const n = Math.round(clamp(c.waveShells + w * 2, 2, FIREWORKS_CAPS.waveShells + 4));
      const hitAt = 1 + Math.floor(rnd() * Math.max(1, n - 2));
      for (let j = 0; j < n && shells.length < FIREWORKS_CAPS.shells - 1; j++) {
        const launchAt = Math.max(first, start + w * c.waveGapMs + (n > 1 ? (j / (n - 1)) * c.waveSpanMs : 0) + (rnd() - 0.5) * 50);
        const fly = F * (0.82 + rnd() * 0.36);
        const tint = Math.floor(rnd() * 5);
        const change = rnd() < 0.4;
        let kind = BARRAGE_KINDS[Math.floor(rnd() * BARRAGE_KINDS.length)]!;
        let flight: ShellFlight = 'rise';
        let size = 1 + rnd() * 0.8;
        const role: ShellRole = j === hitAt ? 'hit' : 'fx';
        if (role === 'hit') { kind = w % 2 ? 'ring' : 'peony'; size = 1.2; }
        const from: 'hero' | 'ground' = role === 'hit' || j % 3 === 0 ? 'hero' : 'ground';
        // The variant's whimsy rides the barrage: a smiley in the sky, a pinwheel off the hero's rim.
        let takeoffAt = launchAt;
        if (variant === 1 && w === Math.min(1, waves - 1) && j === n - 1) { kind = 'smiley'; size = 1.7; }
        if (variant === 2 && w === 0 && j === 0) { kind = 'spiral'; flight = 'pinwheel'; takeoffAt = launchAt + c.spinMs; size = 1.6; }
        shells.push(shell({
          kind, flight, role, from, launchAt, takeoffAt, flyMs: fly, tint, tint2: change ? (tint + 1 + Math.floor(rnd() * 4)) % 5 : -1, size, wave: w,
        }));
      }
    }
    // THE ENORMOUS SHELL: its comet rises as the last wave bursts, leaves the top, and the HELD BEAT follows.
    const lastLaunch = Math.max(...shells.map((s) => s.takeoffAt));
    const lastBurst = Math.max(...shells.map((s) => s.burstAt));
    const giantAt = Math.max(lastLaunch + 160, lastBurst - c.riseMs * 0.4);
    holdAt = giantAt + c.riseMs;
    holdMs = c.holdMs;
    const impactAt = holdAt + holdMs;
    shells.push(shell({ kind: 'giant', flight: 'comet', role: 'impact', launchAt: giantAt, flyMs: c.riseMs, burstAt: impactAt, tint: 0, tint2: 4, size: 1 }));
    finalAt = impactAt + c.finalMs;
  }

  const impactShell = shells.findIndex((s) => s.role === 'impact');
  const impactAt = shells[impactShell]!.burstAt;
  const hits = shells.filter((s) => s.role === 'hit' && s.burstAt < impactAt).map((s) => s.burstAt).sort((a, b) => a - b);
  const tail = level === 3 ? Math.max(c.aftermathMs, c.finalMs + 500, c.zoomOutMs) : level === 2 ? 900 : 760;
  const endAt = impactAt + tail + V.SettleMs;
  if (level !== 3) holdAt = impactAt;

  return {
    ...base, reduced: false, chargeAt, absorbEnd, fuseMs: V.FuseMs, shells, impactShell, hits, holdAt, holdMs, impactAt, finalAt, endAt,
    shakePx: clamp(V.Shake, 0, FIREWORKS_CAPS.shakePx),
    zoom: clamp(V.Zoom, 0, FIREWORKS_CAPS.zoom),
    punch: V.Punch,
    dim: V.Dim,
  };
}

export type FireworksCueKind = 'ignite' | 'launch' | 'takeoff' | 'sputter' | 'burst' | 'hold' | 'impact' | 'final' | 'end';
export interface FireworksCue { at: number; kind: FireworksCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a burst precedes the impact). */
export function fireworksCues(p: FireworksPlan): FireworksCue[] {
  const out: FireworksCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'ignite', i: 0 });
    p.shells.forEach((s, i) => {
      out.push({ at: s.launchAt, kind: 'launch', i });
      if (s.takeoffAt > s.launchAt) out.push({ at: s.takeoffAt, kind: 'takeoff', i });
      if (s.sputterAt >= 0) out.push({ at: s.sputterAt, kind: 'sputter', i });
      if (s.role !== 'impact') out.push({ at: s.burstAt, kind: 'burst', i });
    });
    if (p.holdMs > 0) out.push({ at: p.holdAt, kind: 'hold', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: Math.max(0, p.impactShell) });
  if (!p.reduced && p.finalAt >= 0) out.push({ at: p.finalAt, kind: 'final', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<FireworksCueKind, number> = { ignite: 0, launch: 1, takeoff: 2, sputter: 3, burst: 4, hold: 5, impact: 6, final: 7, end: 8 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the geometry (pure) ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A flight: a quadratic curve `from` -> `to` bent by `ctrl`. The point `e` (0..1) along it is written into `out` (no
 * allocation: the scene calls this every frame).
 */
export interface FireworksPath { from: Pt; ctrl: Pt; to: Pt }

export function fireworksPathAt(p: FireworksPath, e: number, out: Pt): Pt {
  const t = e < 0 ? 0 : e > 1 ? 1 : e;
  const m = 1 - t;
  out.x = m * m * p.from.x + 2 * m * t * p.ctrl.x + t * t * p.to.x;
  out.y = m * m * p.from.y + 2 * m * t * p.ctrl.y + t * t * p.to.y;
  return out;
}

/** The view everything must stay inside. */
export interface ViewBox { w: number; h: number }

/** A shell's place: its flight and where (and how big) it opens. */
export interface ShellGeo { path: FireworksPath; at: Pt; R: number }

export interface FireworksGeo {
  /** The spark on the rim of the striking hero's portrait: every hero shell leaves from it. */
  ember: Pt;
  /** The fuse: an arc of the rim (centre, radius, from angle, to angle) it crawls along to the spark. */
  fuse: { c: Pt; r: number; a0: number; a1: number };
  shells: ShellGeo[];
  /** Tier 3: the enormous shell's centre and radius (null otherwise). */
  bloom: Pt | null;
  bloomR: number;
  /** Where THE blow lands on the struck portrait. */
  strike: Pt;
}

const EMPTY_GEO: FireworksGeo = { ember: { x: 0, y: 0 }, fuse: { c: { x: 0, y: 0 }, r: 0, a0: 0, a1: 0 }, shells: [], bloom: null, bloomR: 0, strike: { x: 0, y: 0 } };

/** A shell's radius never passes this share of the view's shorter side (the giant has its own rule). */
export const SHELL_VIEW = 0.26;

/**
 * Where everything is, from the plan and the two heroes. The spark sits on the striker's rim, turned between the target
 * and straight up. Tier 1 and 2 shells open ON the struck portrait (the heart just above it); the barrage spreads
 * across the whole sky (seeded), its tick shells beside the struck portrait; the enormous shell opens between the
 * middle of the view and the struck hero, sized to the view. Every point that must be seen is kept inside the view.
 * Pure.
 */
export function fireworksGeometry(
  p: FireworksPlan, a: Pt, d: Pt, radius: number, aRadius: number,
  c: Pick<HeroFireworksConfig, 'fuseArcDeg' | 'giantSize'>, scale = 1, view: ViewBox | null = null, seed = 1,
): FireworksGeo {
  if (p.reduced) return EMPTY_GEO;
  const v = view && view.w > 0 && view.h > 0 ? view : { w: Math.max(1920 * scale, a.x + 400 * scale, d.x + 400 * scale), h: Math.max(1080 * scale, a.y + 300 * scale, d.y + 300 * scale) };
  const rnd = seededRng(((seed >>> 0) ^ 0x51ed270b) >>> 0);
  const inX = (x: number, m: number): number => clamp(x, Math.min(m, v.w / 2), Math.max(v.w - m, v.w / 2));
  const inY = (y: number, m: number): number => clamp(y, Math.min(m, v.h / 2), Math.max(v.h - m, v.h / 2));

  // THE SPARK: on the rim, turned from the target toward straight up (shells rise out of it).
  const toward = Math.atan2(d.y - a.y, d.x - a.x);
  const side = d.x >= a.x ? 1 : -1;
  const up = -Math.PI / 2;
  let diff = toward - up;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const emberAng = up + diff * 0.5;
  const rimR = aRadius * 1.04;
  const ember = { x: inX(a.x + Math.cos(emberAng) * rimR, 24 * scale), y: inY(a.y + Math.sin(emberAng) * rimR, 24 * scale) };
  const arc = (c.fuseArcDeg * Math.PI) / 180;
  // The fuse crawls up the rim from below the spark, on the side away from the target.
  const fuse = { c: { x: a.x, y: a.y }, r: rimR, a0: emberAng + side * arc, a1: emberAng };

  const shellR = (s: ShellPlan): number => Math.min(radius * s.size * p.burst, Math.min(v.w, v.h) * SHELL_VIEW);
  const toCentre = (() => { const mx = v.w / 2 - d.x, my = v.h / 2 - d.y; const L = Math.hypot(mx, my) || 1; return { x: mx / L, y: my / L }; })();

  let bloom: Pt | null = null;
  let bloomR = 0;
  let k = 0;
  const shells = p.shells.map((s): ShellGeo => {
    const R = s.kind === 'giant' ? 0 : shellR(s);
    let at: Pt;
    if (s.kind === 'giant') {
      bloomR = Math.min(v.w, v.h) * c.giantSize;
      bloom = { x: inX(v.w / 2 + (d.x - v.w / 2) * 0.3, bloomR * 0.35), y: inY(v.h * 0.42 + (d.y - v.h * 0.42) * 0.2, bloomR * 0.35) };
      at = bloom;
    } else if (p.level === 3 && s.wave >= 0 && s.role !== 'hit') {
      // The barrage: spread evenly across the sky with a seeded wobble (a golden-ratio walk across the width).
      k++;
      const fx = (k * 0.618034 + rnd() * 0.18) % 1;
      at = { x: inX(v.w * (0.07 + 0.86 * fx), R * 0.6), y: inY(v.h * (0.1 + 0.42 * rnd()), R * 0.6) };
    } else if (p.level === 3 && s.role === 'hit') {
      // A tick: just beside the struck portrait, toward the middle of the view and a little above.
      const lean = rnd() < 0.5 ? -1 : 1;
      at = { x: inX(d.x + toCentre.x * radius * 1.0 + lean * radius * 0.5, R * 0.5), y: inY(d.y + toCentre.y * radius * 0.6 - radius * 0.7, R * 0.5) };
    } else if (s.kind === 'heart') {
      at = { x: inX(d.x + toCentre.x * radius * 1.6 + (toCentre.x >= 0 ? -1 : 1) * radius * 0.3, R * 0.8), y: inY(d.y + toCentre.y * radius * 1.6 - radius * 0.3, R * 0.8) };
    } else if (s.flight === 'dud') {
      // The dud only gets a little way up off the hero before it gives out.
      at = { x: inX(ember.x + side * radius * 0.9, radius * 0.5), y: inY(ember.y - radius * 2.4, radius * 0.5) };
    } else {
      // Beside the struck portrait on the side facing the middle of the view (where the dim makes it glow), so its
      // stars sweep across the portrait: a ring just round it, the rest a little farther out.
      const off = radius * (s.kind === 'ring' ? 0.45 : s.kind === 'smiley' ? 1.5 : 1.15);
      at = { x: inX(d.x + toCentre.x * off, R * 0.45), y: inY(d.y + toCentre.y * off, R * 0.45) };
    }
    // The flight: from the spark (or the bottom of the view), bending up and over onto the burst point.
    let from: Pt;
    let ctrl: Pt;
    if (s.flight === 'comet') {
      from = ember;
      const top = { x: ember.x + ((bloom?.x ?? d.x) - ember.x) * 0.3, y: -90 * scale };
      ctrl = { x: ember.x, y: (ember.y + top.y) / 2 };
      return { path: { from, ctrl, to: top }, at, R: bloomR };
    }
    if (s.from === 'ground') {
      from = { x: clamp(at.x + (rnd() - 0.5) * v.w * 0.25, 20 * scale, v.w - 20 * scale), y: v.h + 30 * scale };
      ctrl = { x: from.x + (at.x - from.x) * 0.15, y: (from.y + at.y) / 2 };
    } else {
      from = ember;
      const peak = Math.max(24 * scale, Math.min(from.y, at.y) - Math.max(radius * 0.9, Math.abs(at.x - from.x) * 0.22));
      ctrl = { x: from.x + (at.x - from.x) * 0.35, y: peak };
    }
    ctrl = { x: inX(ctrl.x, 10 * scale), y: Math.max(10 * scale, ctrl.y) };
    return { path: { from, ctrl, to: at }, at, R };
  });
  return { ember, fuse, shells, bloom, bloomR, strike: { x: d.x, y: d.y } };
}

/** The direction THE blow arrives along: the impact flight's final heading, or (the giant) from the bloom down. Unit. */
export function fireworksArrivalDir(p: FireworksPlan, g: FireworksGeo, a: Pt, d: Pt): Pt {
  let from = a, to = d;
  if (g.bloom) { from = g.bloom; to = { x: d.x, y: d.y + 1 }; if (Math.hypot(d.x - from.x, d.y - from.y) > 1) to = d; } else {
    const s = g.shells[p.impactShell];
    if (s) { from = s.path.ctrl; to = s.path.to; }
  }
  const L = Math.hypot(to.x - from.x, to.y - from.y);
  if (L < 1e-6) return { x: 0, y: 1 };
  return { x: (to.x - from.x) / L, y: (to.y - from.y) / L };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
const CROSS_A: Pt = { x: 0.6, y: -0.8 };
const CROSS_B: Pt = { x: -0.7, y: -0.7 };
/** How long a launch or tick kick lasts: it is CUT here, so nothing of the barrage shakes into the held beat. */
export const LAUNCH_KICK_MS = 200;

/**
 * The camera at sequence time `t`: a small push in while the fuse burns; a kick on every hero launch and every tick;
 * Tier 3 pushes in as the comet rises and is exactly STILL through the held beat; on THE impact a punch in and a
 * directional shake; the final flash punches once more. Deterministic. Pure.
 */
export function fireworksCameraAt(p: FireworksPlan, c: HeroFireworksConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  const first = p.shells[0]?.launchAt ?? p.impactAt;
  const giant = p.holdMs > 0 || p.level === 3;
  const riseFrom = giant ? (p.shells[p.impactShell]?.launchAt ?? first) : first;
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    if (giant) {
      // A light push while the barrage plays, then all the way in as the comet rises; held through the beat.
      z = p.zoom * 0.4 * sine((t - p.chargeAt) / Math.max(1, first - p.chargeAt)) + p.zoom * 0.6 * sine((t - riseFrom) / Math.max(1, p.holdAt - riseFrom));
    } else z = p.zoom * sine((t - p.chargeAt) / Math.max(1, first - p.chargeAt));
  } else if (t >= p.impactAt) {
    z = (p.zoom + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 3));
    if (p.finalAt >= 0 && t >= p.finalAt) z += p.punch * 0.5 * Math.exp(-(t - p.finalAt) / 120);
  }
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number, v: Pt, cut = Infinity): void => {
    const age = t - at;
    if (age < 0 || age >= cut) return;
    const fade = cut === Infinity ? 1 : 1 - age / cut;
    const s = springAt(age, hz, tau) * fade;
    const across = amp * 0.25 * Math.sin(age * 0.11) * Math.exp(-age / tau) * fade;
    x += v.x * amp * s - v.y * across;
    y += v.y * amp * s + v.x * across;
  };
  const down = { x: 0, y: 1 };
  for (let i = 0; i < p.shells.length; i++) {
    const s = p.shells[i]!;
    if (s.from !== 'hero') continue;
    const amp = s.flight === 'comet' ? 0.4 : giant ? 0.08 : 0.2;
    kick(s.takeoffAt, p.shakePx * amp, 38, 17, down, LAUNCH_KICK_MS);
  }
  for (const at of p.hits) kick(at, p.shakePx * (giant ? 0.18 : 0.4), 40, 18, dir, LAUNCH_KICK_MS);
  // THE blow: slower and rolling for the enormous shell (a boom, not a tick).
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / (giant ? 3 : 4)), giant ? 11 : 16, dir);
  if (p.finalAt >= 0) kick(p.finalAt, p.shakePx * 0.35, 70, 14, CROSS_A);
  if (giant) kick(p.impactAt + 260, p.shakePx * 0.4, 90, 9, CROSS_B);
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER until the first shell leaves, gliding to the struck hero over its flight; Tier
 * 3 glides on toward the enormous shell's heart as its comet rises. Pure.
 */
export function fireworksCameraFocus(p: FireworksPlan, t: number, a: Pt, d: Pt, bloom: Pt | null = null): Pt {
  const s0 = p.shells[0];
  const from = s0?.takeoffAt ?? p.impactAt;
  const to = from + Math.max(1, s0?.flyMs ?? 1);
  let x = d.x, y = d.y;
  if (t <= from) return a;
  if (t < to) { const e = sine((t - from) / (to - from)); x = a.x + (d.x - a.x) * e; y = a.y + (d.y - a.y) * e; }
  if (bloom && p.holdMs > 0) {
    const g = p.shells[p.impactShell];
    const g0 = g?.launchAt ?? p.holdAt;
    const e = sine((t - g0) / Math.max(1, p.holdAt - g0)) * 0.5;
    x += (bloom.x - x) * e; y += (bloom.y - y) * e;
  }
  return { x, y };
}
