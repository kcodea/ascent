/**
 * THE CHECKMATE HERO ATTACK (style id `chess`, an EPIC): its tuned values, its pure timeline, the pure board geometry,
 * the pure piece poses and the pure camera.
 *
 * THE ONE IDEA: chess pieces that MOVE BY THEIR OWN RULES across a faint chessboard that fades in on the ground near
 * the struck hero. The board's squares are aligned to the line between the two heroes, and the struck portrait sits on
 * one of them like a piece about to be taken. No other attack moves anything on a grid.
 *
 * THE THREE LOOKS. Every hero attack reads its tier from the shared `attackTier` (the owner-approved damage thresholds
 * I 1-5 / II 6-11 / III 12-19 / IV 20+, and a knockout always plays IV). An Epic maps those four onto its three looks
 * here (`chessLevel`, the same mapping Card Shark uses): I -> the PAWN, II and III -> the KNIGHT, IV -> the QUEEN.
 *  - THE PAWN. A few squares fade in. A pawn is set down with a tap on the file beside the struck hero, hops forward
 *    square by square (a tap each) and takes the portrait DIAGONALLY, as a pawn captures. The capture is THE impact.
 *  - THE KNIGHT. A knight is set down, rears back, spins once on its square and makes its L-shaped jump (two squares
 *    along, one across) in a high arc, landing ON the struck portrait with a thud. The landing is THE impact.
 *  - THE QUEEN. A wider patch of board fades in, with a small king of the struck side standing beside the portrait. The
 *    queen is set down with weight, a gleam runs up to her crown, and she sweeps the long diagonal in one fast slide (a
 *    streak behind her) into the portrait: THE impact (a flash, a hard shake). The king rocks on its base, hangs, and
 *    topples slowly with weight, bouncing and rolling to rest (the resignation), and the word CHECKMATE slams in and holds.
 *
 * The striker's pieces are ivory when YOU strike and ebony when the foe does (each with gold bands); the king that
 * falls is the other colour. The squares that the move will cross light up gold first, the way a chess app shows a move.
 *
 * EVERYTHING DRAWN IS A PURE FUNCTION OF THE SEQUENCE TIME: `chessPieceAt`, `chessKingAt`, `chessWordAt` and
 * `chessBoardAlpha` take the plan, the geometry and `t` and write a pose. The scene only draws them, so slow motion, a
 * replay and the tests all see exactly the same frames.
 *
 * The damage formation (shared, `../heroAttack/damageFormation.ts`) opens every attack; this style starts where it ends.
 * The consequence (the damage, Armor, Resolve) lands exactly ONCE, on the impact beat. No hit-stop anywhere. Reduced
 * motion: no board, pieces, shake or zoom; the numbers fade and the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always plays
 * DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { clamp, clamp01, easeInOutSine, easeOutBack, easeOutCubic, hexToNum, spring, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, reducedAttackTimeline, attackTier, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';

export { hexToNum, type TierNum };

/** Checkmate's three looks. */
export const CHESS_LEVELS = [1, 2, 3] as const;
export type ChessLevel = (typeof CHESS_LEVELS)[number];
export const CHESS_LEVEL_NAMES: Record<ChessLevel, string> = { 1: 'Pawn', 2: 'Knight', 3: 'Queen' };

/** The pieces painted (`heroChessTextures.ts`). */
export type PieceKind = 'pawn' | 'knight' | 'queen' | 'king';
export const PIECE_OF_LEVEL: Record<ChessLevel, PieceKind> = { 1: 'pawn', 2: 'knight', 3: 'queen' };

/**
 * THE PIECE BOX (texture px; `heroChessTextures.ts` paints into it): every piece stands on its base at `PIECE_BASE_Y`
 * in a 128 x 192 box. `PIECE_TALL` is each piece's own height, `PIECE_MID` how far above the base its middle is (a
 * piece sprite turns about its middle), `PIECE_BASE_HALF` half the width of a base (a piece on its side rests that high).
 */
export const PIECE_W = 128;
export const PIECE_H = 192;
export const PIECE_BASE_Y = 182;
export const PIECE_TALL: Record<PieceKind, number> = { pawn: 112, knight: 140, queen: 168, king: 176 };
export const PIECE_MID: Record<PieceKind, number> = { pawn: 50, knight: 64, queen: 80, king: 84 };
export const PIECE_BASE_HALF = 32;
/** The fallen king is drawn a little smaller than the piece that beat it. */
export const KING_SIZE = 0.82;

/** The shared four damage tiers mapped onto the three looks: I the pawn, II and III the knight, IV (and a knockout) the queen. */
export function chessLevel(tier: TierNum): ChessLevel {
  return tier <= 1 ? 1 : tier >= 4 ? 3 : 2;
}

/** The per-look dials. A config key is `v1..v3` + one of these. */
export const CHESS_LEVEL_SUFFIXES = [
  'ReadyMs', 'PieceSize', 'Shake', 'Zoom', 'Punch', 'Sparks', 'Burst', 'SettleMs', 'Dim',
] as const;
export type ChessLevelSuffix = (typeof CHESS_LEVEL_SUFFIXES)[number];
type LevelKey = `v${ChessLevel}${ChessLevelSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  // Ready
  absorbMs: number;
  heroCoilPx: number;
  heroNodPx: number;
  // The board
  squareK: number;
  boardAlpha: number;
  boardFadeMs: number;
  hintAlpha: number;
  // The pieces
  pieceK: number;
  setMs: number;
  setDropPx: number;
  holdMs: number;
  // The pawn
  pawnHops: number;
  hopMs: number;
  hopGapMs: number;
  hopLift: number;
  captureMs: number;
  // The knight
  rearMs: number;
  jumpMs: number;
  jumpLift: number;
  jumpSpins: number;
  // The queen
  gleamMs: number;
  coilMs: number;
  slideMs: number;
  diagMax: number;
  ghostAlpha: number;
  kingWobbleMs: number;
  kingFallMs: number;
  wordAtMs: number;
  wordHoldMs: number;
  wordSize: number;
  // Camera and portraits
  flashAlpha: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorIvory: string;
  colorEbony: string;
  colorGold: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxSetClip: string; sfxSetGain: number; sfxSetRate: number;
  sfxHopClip: string; sfxHopGain: number; sfxHopRate: number;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxSlideClip: string; sfxSlideGain: number; sfxSlideRate: number;
  sfxGleamClip: string; sfxGleamGain: number; sfxGleamRate: number;
  sfxThudClip: string; sfxThudGain: number; sfxThudRate: number;
  sfxPunchClip: string; sfxPunchGain: number; sfxPunchRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxToppleClip: string; sfxToppleGain: number; sfxToppleRate: number;
  sfxKnockClip: string; sfxKnockGain: number; sfxKnockRate: number;
  sfxRollClip: string; sfxRollGain: number; sfxRollRate: number;
  sfxBodyClip: string; sfxBodyGain: number; sfxBodyRate: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroChessConfig = GlobalConfig & Record<LevelKey, number>;

export const HERO_CHESS_COLOR_KEYS = ['colorIvory', 'colorEbony', 'colorGold', 'colorPlayer', 'colorFoe'] as const;
export const HERO_CHESS_CLIP_KEYS = [
  'sfxSetClip', 'sfxHopClip', 'sfxWhooshClip', 'sfxSlideClip', 'sfxGleamClip', 'sfxThudClip', 'sfxPunchClip',
  'sfxImpactClip', 'sfxBigClip', 'sfxToppleClip', 'sfxKnockClip', 'sfxRollClip', 'sfxBodyClip',
] as const;
type ColorKey = (typeof HERO_CHESS_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_CHESS_CLIP_KEYS)[number];
export type HeroChessStrKey = ColorKey | ClipKey;
export type HeroChessNumKey = Exclude<keyof HeroChessConfig, HeroChessStrKey>;

/** Pawn, Knight, Queen per suffix: the escalation ladder. */
const LEVEL_DEFAULTS: Record<ChessLevelSuffix, [number, number, number]> = {
  ReadyMs: [200, 220, 240],
  PieceSize: [1.2, 1.1, 1.1],
  Shake: [6, 13, 28],
  Zoom: [0.02, 0.035, 0.055],
  Punch: [0.018, 0.04, 0.085],
  Sparks: [10, 18, 34],
  Burst: [1, 1.3, 2],
  SettleMs: [240, 280, 340],
  Dim: [0.1, 0.24, 0.46],
};

export const CHESS_LEVEL_RANGES: Record<ChessLevelSuffix, [number, number, number]> = {
  ReadyMs: [80, 1500, 10],
  PieceSize: [0.4, 2.5, 0.05],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.12, 0.002],
  Punch: [0, 0.1, 0.001],
  Sparks: [0, 60, 1],
  Burst: [0.3, 3, 0.05],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const levelDefaults = Object.fromEntries(CHESS_LEVELS.flatMap((v) => CHESS_LEVEL_SUFFIXES.map((s) => [`v${v}${s}`, LEVEL_DEFAULTS[s][v - 1]]))) as Record<LevelKey, number>;

export const HERO_CHESS_DEFAULTS: HeroChessConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps Checkmate up where every style steps up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroCoilPx: 7,
  heroNodPx: 11,
  squareK: 1.45,
  boardAlpha: 0.46,
  boardFadeMs: 240,
  hintAlpha: 0.62,
  pieceK: 1.2,
  setMs: 150,
  setDropPx: 54,
  holdMs: 480,
  pawnHops: 2,
  hopMs: 150,
  hopGapMs: 45,
  hopLift: 0.26,
  captureMs: 130,
  rearMs: 300,
  jumpMs: 440,
  jumpLift: 1.25,
  jumpSpins: 1,
  gleamMs: 460,
  coilMs: 200,
  slideMs: 230,
  diagMax: 4,
  ghostAlpha: 0.3,
  kingWobbleMs: 620,
  kingFallMs: 520,
  wordAtMs: 170,
  wordHoldMs: 1300,
  wordSize: 1,
  flashAlpha: 0.85,
  knockPx: 22,
  squash: 0.09,
  shakeMs: 460,
  zoomOutMs: 520,
  reducedFadeMs: 260,
  colorIvory: '#f6ead0',
  colorEbony: '#231c2e',
  colorGold: '#ffc83a',
  colorPlayer: '#ffd76a',
  colorFoe: '#ff5a6e',
  // The set-down tap peaks about 25 ms into its clip; the slide swells for 250 ms; the topple's clack is at its start.
  // Second pass: the KNOCK (a heavy piece slammed on wood, its hit at 0) is under every capture, the ROLL is the king
  // falling and rocking to rest, and the BODY is the low layer (a shared ground impact whose hit is 380 ms into its clip).
  sfxSetClip: 'fx/chess-set', sfxSetGain: 1.5, sfxSetRate: 1,
  sfxHopClip: 'fx/chess-set', sfxHopGain: 1.4, sfxHopRate: 1.25,
  // The whoosh is the shared drop whoosh: it is loud from its first 80 ms (the long swish the first pass used is silent
  // for its first 0.2 s, so a short cue of it was nearly inaudible). The sparkle is played from 1.5 s in for the same reason.
  sfxWhooshClip: 'fx/duos-drop-whoosh', sfxWhooshGain: 0.5, sfxWhooshRate: 1.1,
  sfxSlideClip: 'fx/chess-slide', sfxSlideGain: 1.1, sfxSlideRate: 1.3,
  sfxGleamClip: 'fx/djartmusic-christmas-sparkle-whoosh-1-275404', sfxGleamGain: 0.8, sfxGleamRate: 1.2,
  sfxThudClip: 'fel-spike-echo-land', sfxThudGain: 0.8, sfxThudRate: 0.95,
  sfxPunchClip: 'smack1', sfxPunchGain: 0.5, sfxPunchRate: 1.2,
  sfxImpactClip: 'flurryhit', sfxImpactGain: 0.8, sfxImpactRate: 1,
  sfxBigClip: 'crit', sfxBigGain: 0.5, sfxBigRate: 1.05,
  sfxToppleClip: 'fx/chess-topple', sfxToppleGain: 1.5, sfxToppleRate: 1,
  sfxKnockClip: 'fx/chess-knock', sfxKnockGain: 1, sfxKnockRate: 1,
  sfxRollClip: 'fx/chess-roll', sfxRollGain: 0.9, sfxRollRate: 1,
  sfxBodyClip: 'fx/universfield-ground-impact-352053', sfxBodyGain: 0.9, sfxBodyRate: 1,
  sfxImpactLenMs: 700,
  sfxTailMix: 0.1,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...levelDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroChessStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroCoilPx: [0, 40, 1],
  heroNodPx: [0, 50, 1],
  squareK: [0.8, 2.6, 0.05],
  boardAlpha: [0, 0.8, 0.01],
  boardFadeMs: [60, 1000, 10],
  hintAlpha: [0, 1, 0.01],
  pieceK: [0.5, 2.5, 0.05],
  setMs: [40, 600, 10],
  setDropPx: [0, 200, 2],
  holdMs: [100, 2000, 10],
  pawnHops: [1, 3, 1],
  hopMs: [60, 600, 10],
  hopGapMs: [0, 400, 5],
  hopLift: [0, 1, 0.01],
  captureMs: [60, 600, 10],
  rearMs: [80, 1200, 10],
  jumpMs: [160, 1500, 10],
  jumpLift: [0.2, 3, 0.05],
  jumpSpins: [0, 3, 1],
  gleamMs: [60, 1200, 10],
  coilMs: [0, 800, 10],
  slideMs: [80, 1000, 10],
  diagMax: [2, 5, 1],
  ghostAlpha: [0, 0.8, 0.01],
  kingWobbleMs: [60, 1200, 10],
  kingFallMs: [80, 1000, 10],
  wordAtMs: [0, 800, 10],
  wordHoldMs: [200, 2500, 10],
  wordSize: [0.4, 2, 0.05],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxSetGain: [0, 2, 0.05], sfxSetRate: [0.5, 2.5, 0.01],
  sfxHopGain: [0, 2, 0.05], sfxHopRate: [0.5, 2.5, 0.01],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2.5, 0.01],
  sfxSlideGain: [0, 2, 0.05], sfxSlideRate: [0.5, 2.5, 0.01],
  sfxGleamGain: [0, 2, 0.05], sfxGleamRate: [0.5, 2.5, 0.01],
  sfxThudGain: [0, 2, 0.05], sfxThudRate: [0.5, 2.5, 0.01],
  sfxPunchGain: [0, 2, 0.05], sfxPunchRate: [0.5, 2.5, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2.5, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2.5, 0.01],
  sfxToppleGain: [0, 2, 0.05], sfxToppleRate: [0.5, 2.5, 0.01],
  sfxKnockGain: [0, 2, 0.05], sfxKnockRate: [0.5, 2.5, 0.01],
  sfxRollGain: [0, 2, 0.05], sfxRollRate: [0.5, 2.5, 0.01],
  sfxBodyGain: [0, 2, 0.05], sfxBodyRate: [0.5, 2.5, 0.01],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_CHESS_RANGES: Record<HeroChessNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(CHESS_LEVELS.flatMap((v) => CHESS_LEVEL_SUFFIXES.map((s) => [`v${v}${s}`, CHESS_LEVEL_RANGES[s]]))) as Record<LevelKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say. */
export const CHESS_CAPS = { hops: 3, diag: 5, sparks: 60, shakePx: 40, zoom: 0.12 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_CHESS_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_CHESS_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroChessValue<K extends keyof HeroChessConfig>(key: K, value: unknown): HeroChessConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_CHESS_DEFAULTS, key)) return undefined;
  const def = HERO_CHESS_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroChessConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroChessConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_CHESS_RANGES[key as HeroChessNumKey];
  return Math.min(max, Math.max(min, n)) as HeroChessConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroChessConfig(saved: unknown): HeroChessConfig {
  const out: HeroChessConfig = { ...HERO_CHESS_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroChessValue(k as keyof HeroChessConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

// A fresh key: the scaffold's `ascent.herochess.v1` held Card Shark's values under other names.
const KEY = 'ascent.herochess.v3';

let cfg: HeroChessConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_CHESS_DEFAULTS };
  try { return sanitizeHeroChessConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_CHESS_DEFAULTS }; }
})();

export function getHeroChessConfig(): HeroChessConfig { return cfg; }

export function setHeroChessValue(key: keyof HeroChessConfig, value: number | string): void {
  const safe = clampHeroChessValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroChessConfig(): void {
  cfg = { ...HERO_CHESS_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroChessConfigJson(c: HeroChessConfig = cfg): string {
  const ship: Partial<HeroChessConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

/** The preview speed. Previews always play at 1x (owner 2026-09-29: no Speed buttons on the attack tuners). */
export function heroChessPreviewSpeed(): number { return 1; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One look's dials, read out of the config. */
export function chessLevelDials(level: ChessLevel, c: HeroChessConfig = cfg): Record<ChessLevelSuffix, number> {
  return Object.fromEntries(CHESS_LEVEL_SUFFIXES.map((s) => [s, c[`v${level}${s}`]])) as Record<ChessLevelSuffix, number>;
}

/** One move of the piece: a pawn's hop or its diagonal capture, the knight's jump, the queen's slide. */
export interface ChessMove { kind: 'hop' | 'capture' | 'jump' | 'slide'; at: number; ms: number; landAt: number }

export interface ChessPlanInput extends AttackTierContext {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** Screen px between the attacker's and the defender's centres (kept for the tuner's note; the moves are on a grid). */
  distance: number;
  reduced?: boolean;
}

export interface ChessPlan {
  reduced: boolean;
  /** The SHARED damage tier (1..4; a knockout is 4). */
  tier: TierNum;
  /** Checkmate's look: 1 the pawn, 2 the knight, 3 the queen. */
  level: ChessLevel;
  piece: PieceKind;
  /** 0..1 across the looks (pawn 0, queen 1). */
  k: number;
  total: number;
  /** The ready starts: the total sinks into the hero and the board starts to fade in. */
  chargeAt: number;
  absorbEnd: number;
  /** The piece appears above its square and starts to come down. */
  setAt: number;
  /** It touches the board (the tap). */
  tapAt: number;
  /** The knight rears (it spins on its square over the last part); the queen's gleam starts. */
  rearAt: number;
  gleamAt: number;
  /** Every move, in order. The last one is the strike (the capture, the jump, the slide). */
  moves: ChessMove[];
  /** The pawn's hops (how many squares it walks before it captures). */
  hops: number;
  /** The strike move starts. */
  strikeAt: number;
  /** Hop landings BEFORE the impact: the rhythm taps (the pawn only). FX and sound only. */
  taps: number[];
  /** THE consequence beat: the piece takes the portrait. */
  impactAt: number;
  /** The queen only: the struck side's king wobbles from the impact, starts to tip, and lies on its side. */
  king: boolean;
  tipAt: number;
  fallAt: number;
  /** The queen only: CHECKMATE sets, and starts to fade. */
  wordAt: number;
  wordEndAt: number;
  /** The piece and the board fade away. */
  dissolveAt: number;
  /** Nothing of the scene draws after this (it may be after `endAt`: the scene drains on its own). */
  clearAt: number;
  endAt: number;
  size: number;
  shakePx: number;
  zoom: number;
  punch: number;
  sparks: number;
  burst: number;
  dim: number;
}

/** How many times the king rocks on its base before it tips (the wobble's knocks). */
export const KING_ROCKS = 4;
/** How long the fades at the very end take (the piece, the king, the word). */
export const CHESS_FADE_MS = 220;

/** The whole Checkmate, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function chessPlan(input: ChessPlanInput, c: HeroChessConfig = cfg): ChessPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays Tier IV (heroAttack/tiers.ts), so the queen
  const level = chessLevel(tier);
  const V = chessLevelDials(level, c);
  const k = (level - 1) / 2;
  const piece = PIECE_OF_LEVEL[level];

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, level, piece, k, total, chargeAt: impactAt, absorbEnd: impactAt, setAt: impactAt, tapAt: impactAt,
      rearAt: impactAt, gleamAt: impactAt, moves: [], hops: 0, strikeAt: impactAt, taps: [], impactAt, king: false, tipAt: impactAt,
      fallAt: impactAt, wordAt: impactAt, wordEndAt: impactAt, dissolveAt: impactAt, clearAt: impactAt, endAt: r.endAt,
      size: 0, shakePx: 0, zoom: 0, punch: 0, sparks: 0, burst: 0, dim: 0,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const setAt = chargeAt + Math.max(V.ReadyMs, c.absorbMs * 0.6);
  const tapAt = setAt + c.setMs;
  const moves: ChessMove[] = [];
  const taps: number[] = [];
  let rearAt = tapAt, gleamAt = tapAt;
  let hops = 0;

  if (level === 1) {
    // THE PAWN: a beat on its square, then hop, hop, and the diagonal capture.
    hops = clamp(Math.round(c.pawnHops), 1, CHESS_CAPS.hops);
    let at = tapAt + 90;
    for (let i = 0; i < hops; i++) {
      moves.push({ kind: 'hop', at, ms: c.hopMs, landAt: at + c.hopMs });
      taps.push(at + c.hopMs);
      at += c.hopMs + c.hopGapMs;
    }
    at += 30;
    moves.push({ kind: 'capture', at, ms: c.captureMs, landAt: at + c.captureMs });
  } else if (level === 2) {
    // THE KNIGHT: it rears, spins on its square, and jumps its L.
    rearAt = tapAt + 70;
    const at = rearAt + c.rearMs;
    moves.push({ kind: 'jump', at, ms: c.jumpMs, landAt: at + c.jumpMs });
  } else {
    // THE QUEEN: the gleam runs up to her crown, she draws herself back (the coil: a held breath), then the slide.
    gleamAt = tapAt + 80;
    const at = gleamAt + c.gleamMs + 60 + Math.max(0, c.coilMs);
    moves.push({ kind: 'slide', at, ms: c.slideMs, landAt: at + c.slideMs });
  }

  const strike = moves[moves.length - 1]!;
  const impactAt = strike.landAt;
  const king = level === 3;
  const tipAt = impactAt + c.kingWobbleMs;
  const fallAt = tipAt + c.kingFallMs;
  const wordAt = impactAt + c.wordAtMs;
  const wordEndAt = wordAt + c.wordHoldMs;
  const dissolveAt = king ? Math.max(wordEndAt, fallAt + 300) : impactAt + c.holdMs;
  const clearAt = dissolveAt + Math.max(CHESS_FADE_MS, c.boardFadeMs);
  // The fades play out AFTER the end (the scene drains on its own), so the fight never waits on a fading board. The
  // queen's end waits for the king to be down and the word to have been read.
  const lastBeat = king ? Math.max(fallAt + 160, wordAt + c.wordHoldMs * 0.75) : Math.max(impactAt + c.zoomOutMs * 0.8, dissolveAt - 80);
  const endAt = lastBeat + V.SettleMs;

  return {
    reduced: false, tier, level, piece, k, total, chargeAt, absorbEnd, setAt, tapAt, rearAt, gleamAt, moves, hops,
    strikeAt: strike.at, taps, impactAt, king, tipAt, fallAt, wordAt, wordEndAt, dissolveAt, clearAt, endAt,
    size: V.PieceSize,
    shakePx: clamp(V.Shake, 0, CHESS_CAPS.shakePx),
    zoom: clamp(V.Zoom, 0, CHESS_CAPS.zoom),
    punch: V.Punch,
    sparks: Math.round(clamp(V.Sparks, 0, CHESS_CAPS.sparks)),
    burst: V.Burst,
    dim: V.Dim,
  };
}

export type ChessCueKind = 'charge' | 'set' | 'tap' | 'rear' | 'gleam' | 'hop' | 'land' | 'strike' | 'impact' | 'wobble' | 'topple' | 'word' | 'dissolve' | 'end';
export interface ChessCue { at: number; kind: ChessCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order). */
export function chessCues(p: ChessPlan): ChessCue[] {
  const out: ChessCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.setAt, kind: 'set', i: 0 });
    out.push({ at: p.tapAt, kind: 'tap', i: 0 });
    if (p.level === 2) out.push({ at: p.rearAt, kind: 'rear', i: 0 });
    if (p.level === 3) out.push({ at: p.gleamAt, kind: 'gleam', i: 0 });
    p.moves.forEach((m, i) => {
      if (m.kind === 'hop') { out.push({ at: m.at, kind: 'hop', i }); out.push({ at: m.landAt, kind: 'land', i }); } else out.push({ at: m.at, kind: 'strike', i });
    });
    if (p.king) {
      // The king rocks on its base before it goes (a knock each time it comes down), then hits the board.
      for (let i = 0; i < KING_ROCKS; i++) out.push({ at: p.impactAt + ((p.tipAt - p.impactAt) * (i + 0.5)) / KING_ROCKS, kind: 'wobble', i });
      out.push({ at: p.fallAt, kind: 'topple', i: 0 }); out.push({ at: p.wordAt, kind: 'word', i: 0 });
    }
    out.push({ at: p.dissolveAt, kind: 'dissolve', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<ChessCueKind, number> = { charge: 0, set: 1, tap: 2, rear: 3, gleam: 4, hop: 5, land: 6, strike: 7, impact: 8, wobble: 9, topple: 10, word: 11, dissolve: 12, end: 13 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the board (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/** The view everything must stay inside (the screen, or the sandbox box). */
export interface ViewBox { w: number; h: number }

/** One drawn square. `f` files across from the struck hero (toward the side the piece starts on), `r` ranks back from it. */
export interface ChessCell {
  f: number; r: number; x: number; y: number;
  dark: boolean;
  /** The move crosses this square (it lights up gold before the move); its place along the move, 0..1. */
  hint: boolean; hintOrder: number;
  /** When it fades in, 0..1 (the squares ripple in from the striker's end toward the target). */
  order: number;
  /** Its opacity share: 1 on the squares in play, less on the fringe (the patch has a soft edge). */
  weight: number;
}

export interface ChessGeo {
  /** A square's side, px. */
  sq: number;
  /** The board's rotation (radians): its ranks run along the line from the striker to the struck hero. */
  ang: number;
  /** Unit vectors: along the line toward the struck hero, and across it toward the side the piece starts on. */
  u: Pt; n: Pt;
  /** Where the piece is set down (its square's centre), and where it stands after each move (the last is the contact). */
  start: Pt;
  stops: Pt[];
  /** The direction the piece is travelling as it takes the portrait (unit; the knight lands from above). */
  dir: Pt;
  /** Which way the piece faces (the knight's profile): 1 right, -1 left. */
  face: 1 | -1;
  /** Px per texture px for the striking piece and for the king (the piece box is `pieceK` squares tall). */
  k: number; kingK: number;
  /** How high the knight's jump rises, px (capped so it stays on screen under a hero at the top). */
  jumpLift: number;
  /** How long the queen's diagonal is, in squares (0 for the other looks). */
  diag: number;
  cells: ChessCell[];
  /** The queen only: where the struck side's king stands, which way it tips, and where CHECKMATE sets. */
  king: Pt | null;
  kingFall: 1 | -1;
  word: Pt | null;
  /** The word's drawn width, px. */
  wordW: number;
}

const cellAt = (d: Pt, u: Pt, n: Pt, sq: number, f: number, r: number): Pt => ({ x: d.x + n.x * f * sq - u.x * r * sq, y: d.y + n.y * f * sq - u.y * r * sq });

function inView(p: Pt, view: ViewBox | null, mx: number, top: number, bottom: number): boolean {
  if (!view || view.w <= 0 || view.h <= 0) return true;
  return p.x >= mx && p.x <= view.w - mx && p.y >= top && p.y <= view.h - bottom;
}

/**
 * The board for one blow: the square size, which side of the line the piece starts on (the side that is on screen and
 * nearer the middle of the view), every square drawn, the piece's stops, the king's square and where the word sets.
 * `radius` is the struck portrait's, `aRadius` the striker's, `avoid` where the big -N pops. Pure, so a replay lays out
 * the same board.
 */
export function chessBoard(
  p: ChessPlan, a: Pt, d: Pt, radius: number, aRadius: number,
  c: Pick<HeroChessConfig, 'squareK' | 'diagMax' | 'wordSize' | 'pieceK' | 'jumpLift' | 'hopLift'>, view: ViewBox | null = null, avoid: Pt | null = null,
): ChessGeo {
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const n0 = { x: -u.y, y: u.x };
  const ang = Math.atan2(u.y, u.x);
  // The ranks the look needs between the two heroes; the squares shrink if the heroes are close (a sandbox box).
  const need = p.level === 1 ? p.hops + 1 : 2;
  const sq0 = Math.max(8, Math.min(radius * c.squareK, (L - aRadius * 0.4) / (need + 0.5)));
  const pieceHOf = (side: number): number => (PIECE_TALL[p.piece] * side * c.pieceK * Math.max(0.1, p.size)) / PIECE_H;
  const mid = view ? { x: view.w / 2, y: view.h / 2 } : { x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 };
  const startOf = (side: number, sign: number, f: number, r: number): Pt => cellAt(d, u, { x: n0.x * sign, y: n0.y * sign }, side, f, r);
  // A hopping pawn needs its hop's height above it too, all the way up its file; the knight's L turns on the square
  // beside the struck hero, so that one must be in view as well.
  const headroom = p.level === 1 ? c.hopLift : 0;
  const fitsAt = (side: number, pt: Pt): boolean => inView(pt, view, side * 0.35, pieceHOf(side) * 1.05 + headroom * side, side * 0.2);
  const nearer = (side: number, f: number, r: number): 1 | -1 => {
    const A = startOf(side, 1, f, r), B = startOf(side, -1, f, r);
    const also = p.level === 1 ? 1 : p.level === 2 ? 0 : -1;
    // The start square on screen matters most; then the other square the move needs.
    const score = (sg: number, pt: Pt): number => (fitsAt(side, pt) ? 2 : 0) + (also < 0 || fitsAt(side, startOf(side, sg, f, also)) ? 1 : 0);
    const fa = score(1, A), fb = score(-1, B);
    if (fa !== fb) return fa > fb ? 1 : -1;
    return Math.hypot(A.x - mid.x, A.y - mid.y) <= Math.hypot(B.x - mid.x, B.y - mid.y) ? 1 : -1;
  };

  let sq = sq0;
  let sign: 1 | -1 = 1;
  let diag = 0;
  let sf = 1, sr = need;
  if (p.level === 3) {
    // The longest diagonal that starts on screen (preferring the side nearer the middle). A diagonal of three squares
    // is worth smaller squares (a hero in a corner leaves little room); two full-size squares are the last resort.
    const max = clamp(Math.round(c.diagMax), 2, CHESS_CAPS.diag);
    const tries: [number, number][] = [];
    for (let n = max; n >= 3; n--) tries.push([n, 1]);
    for (const shrink of [0.86, 0.74]) for (let n = Math.min(max, 4); n >= 3; n--) tries.push([n, shrink]);
    diag = 2; sign = nearer(sq0, 2, 2);
    for (const [n, shrink] of tries) {
      const side = sq0 * shrink;
      const pref = nearer(side, n, n);
      if (fitsAt(side, startOf(side, pref, n, n))) { diag = n; sign = pref; sq = side; break; }
    }
    sf = diag; sr = diag;
  } else {
    sign = nearer(sq, 1, need);
  }
  const k = (sq * c.pieceK * Math.max(0.1, p.size)) / PIECE_H;
  const kingK = k * KING_SIZE;
  const pieceH = PIECE_TALL[p.piece] * k;
  const kingH = PIECE_TALL.king * kingK;
  const n = { x: n0.x * sign, y: n0.y * sign };
  const at = (f: number, r: number): Pt => cellAt(d, u, n, sq, f, r);
  const start = at(sf, sr);

  // The stops: the pawn's squares up its file, then the contact; the knight lands on the portrait; the queen's contact.
  const stops: Pt[] = [];
  let dir: Pt;
  let jumpLift = 0;
  if (p.level === 1) {
    for (let i = 1; i <= p.hops; i++) stops.push(at(1, need - i));
    const from = at(1, 1);
    const dl = Math.hypot(d.x - from.x, d.y - from.y) || 1;
    dir = { x: (d.x - from.x) / dl, y: (d.y - from.y) / dl };
    const reach = Math.min(radius * 0.7, dl * 0.6);
    stops.push({ x: d.x - dir.x * reach, y: d.y - dir.y * reach });
  } else if (p.level === 2) {
    // It lands a little below the middle, so its head covers the middle of the portrait.
    // Under a hero at the very top of the view it lands a little lower, so its head stays on screen.
    stops.push({ x: d.x, y: Math.max(d.y + radius * 0.34, Math.min(d.y + radius * 0.8, view && view.h > 0 ? pieceH + 4 : 0)) });
    const lx = (d.x - start.x) * 0.25;
    // The arc is as high as the dial asks, unless the top of the view is in the way.
    // (Sampled along the flight: the board under it climbs toward a hero at the top faster than the arc comes down.)
    let room = Infinity;
    if (view && view.h > 0) {
      const cy = start.y + u.y * 2 * sq;
      for (let fu = 0.15; fu < 0.95; fu += 0.1) {
        // The same path the pose flies (see the jump in chessPieceAt).
        const gy = start.y + (cy - start.y) * easeOutCubic(Math.min(1, fu / 0.72)) + (stops[0]!.y - cy) * easeInOutSine(clamp01((fu - 0.38) / 0.62));
        room = Math.min(room, (gy - pieceH * 1.08) / (4 * fu * (1 - fu)));
      }
    }
    jumpLift = Math.max(sq * 0.12, Math.min(c.jumpLift * sq, room));
    const ll = Math.hypot(lx, radius) || 1;
    dir = { x: lx / ll, y: radius / ll };
  } else {
    const dl = Math.hypot(d.x - start.x, d.y - start.y) || 1;
    dir = { x: (d.x - start.x) / dl, y: (d.y - start.y) / dl };
    const reach = Math.min(radius * 0.72, dl * 0.6);
    stops.push({ x: d.x - dir.x * reach, y: d.y - dir.y * reach });
  }
  const face: 1 | -1 = d.x - start.x >= 0 ? 1 : -1;

  // The squares: the ones in play and a fringe one square round them. The struck hero's own square is left clear (the
  // portrait is the piece on it), as is anything under the striker.
  const fMax = sf + 1, rMax = sr + 1;
  const hintOf = (f: number, r: number): number => {
    if (p.level === 1) return f === 1 && r >= 1 && r <= need ? (need - r) / Math.max(1, need) : -1;
    if (p.level === 2) return f === 1 && r >= 0 && r <= 2 ? (2 - r) / 3 : -1;
    return f === r && f >= 1 && f <= diag ? (diag - f) / Math.max(1, diag) : -1;
  };
  const cells: ChessCell[] = [];
  for (let r = -1; r <= rMax; r++) {
    for (let f = -1; f <= fMax; f++) {
      if (f === 0 && r === 0) continue;
      const pt = at(f, r);
      if (Math.hypot(pt.x - a.x, pt.y - a.y) < aRadius * 0.95) continue;
      if (view && view.w > 0 && (pt.x < -sq * 0.5 || pt.x > view.w + sq * 0.5 || pt.y < -sq * 0.5 || pt.y > view.h + sq * 0.5)) continue;
      const fringe = f < 0 || r < 0 || f > sf || r > sr;
      const h = hintOf(f, r);
      cells.push({
        f, r, x: pt.x, y: pt.y, dark: ((f + r) & 1) === 0, hint: h >= 0, hintOrder: Math.max(0, h),
        order: clamp01(1 - (r + 1) / (rMax + 1)), weight: fringe ? 0.42 : 1,
      });
    }
  }

  // The king stands on a square beside the struck hero, on the far side from the queen, wherever that is on screen.
  let king: Pt | null = null;
  let kingFall: 1 | -1 = 1;
  let word: Pt | null = null;
  let wordW = 0;
  if (p.king) {
    const spots: [number, number][] = [[-1, 0], [0, -1], [-1, -1], [-1, 1], [1, -1], [1, 0], [0, 1]];
    const kingFits = (pt: Pt): boolean => inView(pt, view, sq * 0.4, kingH * 1.08, sq * 0.2);
    for (const [f, r] of spots) { const pt = at(f, r); if (kingFits(pt)) { king = pt; break; } }
    if (!king) {
      const pt = at(-1, 0);
      king = view ? { x: clamp(pt.x, sq * 0.4, view.w - sq * 0.4), y: clamp(pt.y, kingH * 1.08, view.h - sq * 0.2) } : pt;
    }
    // It tips the way the queen was travelling, unless that would lay it off the edge of the view.
    kingFall = dir.x >= 0 ? 1 : -1;
    if (view && view.w > 0) {
      const tipX = king.x + kingFall * kingH * 1.1;
      if (tipX < 8 || tipX > view.w - 8) kingFall = kingFall === 1 ? -1 : 1;
    }
    // CHECKMATE sets above the portrait, or below it when there is no room above or the big -N pops there.
    wordW = Math.min(radius * 4.6 * c.wordSize, view && view.w > 0 ? view.w * 0.8 : Infinity);
    const wh = wordW * 0.2;
    const gap = radius + wh * 0.75;
    const above = d.y - gap, below = d.y + gap;
    const roomAbove = !view || above - wh * 0.6 >= 0;
    const roomBelow = !view || below + wh * 0.6 <= view.h;
    // The queen ends on the side she came from, so the word prefers the other side.
    const busyAbove = (!!avoid && avoid.y < d.y - radius * 0.5) || dir.y > 0.3;
    const useBelow = roomBelow && (!roomAbove || busyAbove);
    // When it has to share the queen's side (no room on the other), it sets beside her, toward the middle of the view.
    const shared = useBelow ? dir.y < -0.3 : dir.y > 0.3;
    const cx = shared ? stops[0]!.x + (mid.x >= d.x ? 1 : -1) * (wordW / 2 + sq * 0.42) : d.x;
    const wx = view && view.w > 0 ? clamp(cx, wordW / 2 + 8, view.w - wordW / 2 - 8) : cx;
    word = { x: wx, y: useBelow ? below : above };
  }
  return { sq, ang, u, n, start, stops, dir, face, k, kingK, jumpLift, diag, cells, king, kingFall, word, wordW };
}

/** The whole board's opacity at `t` for a square of ripple `order`: fading in from the ready, and out at the dissolve. */
export function chessBoardAlpha(p: ChessPlan, c: Pick<HeroChessConfig, 'boardFadeMs'>, t: number, order: number): number {
  if (p.reduced || t < p.chargeAt || t >= p.clearAt) return 0;
  const span = Math.max(1, p.tapAt - p.chargeAt - c.boardFadeMs * 0.5);
  const inU = clamp01((t - p.chargeAt - order * span * 0.6) / Math.max(1, c.boardFadeMs));
  const outU = clamp01((t - p.dissolveAt) / Math.max(1, c.boardFadeMs));
  return easeOutCubic(inU) * (1 - outU);
}

/** How gold a hint square is at `t` (0..1): the move's squares light up in order from the tap and go out at the impact. */
export function chessHintAt(p: ChessPlan, t: number, hintOrder: number): number {
  if (p.reduced || t < p.tapAt || t >= p.dissolveAt) return 0;
  const lit = clamp01((t - p.tapAt - 40 - hintOrder * HINT_STEP_MS) / 120);
  const out = clamp01((t - p.impactAt) / 320);
  return easeOutCubic(lit) * (1 - out);
}

/** The gap between one square of the move lighting and the next (ms). */
export const HINT_STEP_MS = 150;

/**
 * The FLASH as a hint square lights (0..1): bright the moment it comes on, settled a quarter of a second later, so the
 * squares visibly light ONE AFTER ANOTHER toward the struck hero. Pure.
 */
export function chessHintFlashAt(p: ChessPlan, t: number, hintOrder: number): number {
  if (p.reduced) return 0;
  const age = t - (p.tapAt + 40 + hintOrder * HINT_STEP_MS);
  if (age < 0 || age > 300 || t >= p.impactAt) return 0;
  return age < 50 ? age / 50 : 1 - (age - 50) / 250;
}

// ─── the poses (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * How a piece is drawn at one moment. `(x, y)` is the point on the board under it and `lift` how high it is above that
 * (px). `rot` tips it about its base; `spin` turns it about its middle (the knight's somersault). `sx`, `sy` scale it
 * (`sx` passes through zero as the knight spins on its square; `sy` squashes it on a landing). `ride`: it rests on the
 * struck portrait and follows its knockback.
 */
export interface PiecePose { x: number; y: number; lift: number; rot: number; spin: number; sx: number; sy: number; alpha: number; ride: boolean }

export function newPiecePose(): PiecePose { return { x: 0, y: 0, lift: 0, rot: 0, spin: 0, sx: 1, sy: 1, alpha: 0, ride: false }; }

/** A landing's squash: a quick dip that springs back. */
const landSquash = (ms: number, amp: number): number => (ms < 0 ? 0 : amp * spring(ms, 7, 55));

/**
 * THE STRIKING PIECE at sequence time `t`, written into `out` (no allocation: it is called every frame, and again a few
 * ms back for the queen's ghosts). Pure: the same plan, geometry and time always draw the same piece.
 */
export function chessPieceAt(p: ChessPlan, g: ChessGeo, c: HeroChessConfig, t: number, out: PiecePose): PiecePose {
  out.x = g.start.x; out.y = g.start.y; out.lift = 0; out.rot = 0; out.spin = 0; out.sx = 1; out.sy = 1; out.alpha = 0; out.ride = false;
  if (p.reduced || t < p.setAt || t >= p.clearAt) return out;
  out.alpha = 1 - clamp01((t - p.dissolveAt) / CHESS_FADE_MS);

  // Set down: it comes in from above, quick, and lands with a small squash.
  if (t < p.tapAt) {
    const uu = clamp01((t - p.setAt) / Math.max(1, p.tapAt - p.setAt));
    out.lift = c.setDropPx * (g.sq / 170) * (1 - uu * uu);
    out.alpha = Math.min(1, uu * 2.5);
    return out;
  }
  let squash = landSquash(t - p.tapAt, p.level === 3 ? 0.16 : 0.12);
  let px = g.start.x, py = g.start.y;
  const last = p.moves.length - 1;

  for (let i = 0; i < p.moves.length; i++) {
    const m = p.moves[i]!;
    if (t < m.at) break;
    const to = g.stops[i]!;
    const uu = clamp01((t - m.at) / Math.max(1, m.ms));
    const done = t >= m.landAt;
    if (m.kind === 'hop') {
      const e = easeInOutSine(uu);
      const fx = px, fy = py;
      px = fx + (to.x - fx) * e; py = fy + (to.y - fy) * e;
      if (!done) {
        out.lift = c.hopLift * g.sq * Math.sin(Math.PI * uu);
        out.rot = 0.12 * g.face * Math.sin(Math.PI * uu);
      } else squash = Math.max(squash, landSquash(t - m.landAt, 0.1));
    } else if (m.kind === 'capture') {
      // A little draw back, then the diagonal jab.
      const e = uu < 0.25 ? -0.1 * Math.sin((uu / 0.25) * Math.PI * 0.5) : -0.1 + 1.1 * easeOutCubic((uu - 0.25) / 0.75);
      const fx = px, fy = py;
      px = fx + (to.x - fx) * e; py = fy + (to.y - fy) * e;
      if (!done) {
        out.lift = 0.1 * g.sq * Math.sin(Math.PI * uu);
        out.rot = 0.3 * g.face * Math.sin(Math.PI * Math.min(1, uu * 1.1));
      }
    } else if (m.kind === 'jump') {
      // The L: two squares along, then one across, smoothed into one flight; a high arc with a somersault.
      const al = easeOutCubic(Math.min(1, uu / 0.72));
      const ac = easeInOutSine(clamp01((uu - 0.38) / 0.62));
      const sx0 = g.start.x, sy0 = g.start.y;
      const cx = sx0 + g.u.x * 2 * g.sq, cy = sy0 + g.u.y * 2 * g.sq;
      px = sx0 + (cx - sx0) * al + (to.x - cx) * ac;
      py = sy0 + (cy - sy0) * al + (to.y - cy) * ac;
      if (!done) {
        out.lift = g.jumpLift * 4 * uu * (1 - uu);
        out.spin = g.face * Math.PI * 2 * c.jumpSpins * easeInOutSine(uu);
      }
    } else {
      // The queen's slide: she leans into it and never leaves the board.
      const e = Math.pow(uu, 1.7);
      const fx = px, fy = py;
      // She leaves from her coil (drawn back along the diagonal), so there is no snap as the slide starts.
      const back = g.sq * 0.16 * (1 - Math.min(1, uu * 3));
      px = fx + (to.x - fx) * e - g.dir.x * back; py = fy + (to.y - fy) * e - g.dir.y * back;
      if (!done) out.rot = 0.2 * g.face * Math.min(1, uu * 4) - 0.2 * g.face * (1 - Math.min(1, uu * 6));
    }
    if (i === last && done) {
      // It has taken the portrait: a thump, a small recoil, and it rides the knockback.
      const ms = t - m.landAt;
      out.ride = true;
      squash = Math.max(squash, landSquash(ms, p.level === 2 ? 0.2 : 0.12));
      if (p.level !== 2) {
        const back = 0.07 * g.sq * (1 - Math.exp(-ms / 70));
        px -= g.dir.x * back; py -= g.dir.y * back;
        out.rot = 0.16 * g.face * spring(ms, 5, 70);
      }
    }
  }

  // Before the strike: the knight rears back and spins on its square; the queen draws herself up.
  if (t < p.strikeAt) {
    if (p.level === 2 && t >= p.rearAt) {
      const ru = clamp01((t - p.rearAt) / Math.max(1, p.strikeAt - p.rearAt));
      out.rot = -0.32 * g.face * Math.sin(Math.PI * Math.min(1, ru / 0.55)) * (ru < 0.55 ? 1 : 0);
      out.lift = 0.06 * g.sq * Math.sin(Math.PI * Math.min(1, ru / 0.55));
      if (ru >= 0.55) {
        const su = (ru - 0.55) / 0.45;
        out.sx = Math.cos(Math.PI * 2 * easeInOutSine(su));
        squash = Math.max(squash, 0.14 * su * su);
      }
    } else if (p.level === 3 && t >= p.gleamAt) {
      const gu = clamp01((t - p.gleamAt) / Math.max(1, p.strikeAt - p.gleamAt));
      // She draws herself up with the gleam, then COILS: leaning back from the diagonal and sinking, held, before she goes.
      const coil = gu > 0.6 ? easeInOutSine((gu - 0.6) / 0.4) : 0;
      squash = Math.max(squash, -0.06 * Math.sin(Math.PI * Math.min(1, gu / 0.6)) * (gu < 0.6 ? 1 : 0) + 0.14 * coil);
      out.rot = -0.2 * g.face * coil;
      px -= g.dir.x * g.sq * 0.16 * coil; py -= g.dir.y * g.sq * 0.16 * coil;
    }
  }

  out.x = px; out.y = py;
  out.sy = 1 - squash;
  out.sx *= 1 + squash * 0.6;
  return out;
}

/** Where the queen's gleam is on her at `t`: 0 at her base, 1 at her crown; -1 when it is not showing. */
export function chessGleamAt(p: ChessPlan, c: Pick<HeroChessConfig, 'gleamMs'>, t: number): number {
  if (p.level !== 3 || p.reduced || t < p.gleamAt || t > p.gleamAt + c.gleamMs) return -1;
  return easeOutCubic((t - p.gleamAt) / Math.max(1, c.gleamMs));
}

/** How strong the queen's streak is at `t` (0..1): it grows with the slide and fades after the impact. */
export function chessStreakAt(p: ChessPlan, t: number): number {
  if (p.level !== 3 || p.reduced || t < p.strikeAt) return 0;
  if (t < p.impactAt) return clamp01((t - p.strikeAt) / Math.max(1, (p.impactAt - p.strikeAt) * 0.4));
  return 1 - clamp01((t - p.impactAt) / 260);
}

/**
 * THE KING of the struck side at `t` (the queen's look only): it stands beside the portrait, jolts and wobbles from the
 * impact, tips over (falling like a real piece: slowly, then fast), rocks once on its side and lies still. Pure.
 */
export function chessKingAt(p: ChessPlan, g: ChessGeo, t: number, out: PiecePose): PiecePose {
  out.lift = 0; out.rot = 0; out.spin = 0; out.sx = 1; out.sy = 1; out.alpha = 0; out.ride = false;
  if (!p.king || !g.king || p.reduced || t < p.chargeAt || t >= p.clearAt) { out.x = 0; out.y = 0; return out; }
  out.x = g.king.x; out.y = g.king.y;
  out.alpha = easeOutCubic(clamp01((t - p.chargeAt - 120) / 220)) * (1 - clamp01((t - p.dissolveAt) / CHESS_FADE_MS));
  if (t < p.impactAt) return out;
  const side = g.kingFall;
  const down = Math.PI / 2;
  if (t < p.tipAt) {
    // The wobble: knocked by the capture, it rocks on its base, wider each time, leaning the way it will go.
    const w = (t - p.impactAt) / Math.max(1, p.tipAt - p.impactAt);
    const rock = Math.sin(w * Math.PI * KING_ROCKS);
    out.rot = side * (0.1 * w + (0.1 + 0.2 * w) * rock);
    out.lift = 0.03 * g.sq * Math.abs(rock);
    out.x += side * 0.04 * g.sq * w;
  } else if (t < p.fallAt) {
    // THE FALL: slow at first (it hangs past its balance), then it goes all at once. A heavy piece, not a flick.
    const w = (t - p.tipAt) / Math.max(1, p.fallAt - p.tipAt);
    out.rot = side * (0.1 + (down - 0.1) * Math.pow(w, 2.6));
    out.x += side * 0.04 * g.sq;
  } else {
    // On its side: it bounces off the board once, then rolls a little way and rocks slowly to rest.
    const ms = t - p.fallAt;
    out.rot = side * (down - 0.2 * Math.abs(spring(ms, 3.2, 170)));
    out.lift = 0.1 * g.sq * Math.abs(Math.sin((Math.PI * Math.min(ms, 260)) / 260)) * (ms < 260 ? 1 : 0);
    out.x += side * g.sq * (0.04 + 0.34 * (1 - Math.exp(-ms / 260)));
  }
  return out;
}

/** CHECKMATE at `t`: its scale (it sets with a small overshoot) and opacity. Pure. */
export function chessWordAt(p: ChessPlan, t: number, out: { scale: number; alpha: number }): { scale: number; alpha: number } {
  out.scale = 1; out.alpha = 0;
  if (!p.king || p.reduced || t < p.wordAt || t >= p.wordEndAt + CHESS_FADE_MS) return out;
  // It SLAMS in from big (a stamp), then holds.
  const inU = clamp01((t - p.wordAt) / 200);
  out.scale = 2.3 - 1.3 * easeOutBack(inU, 1.4);
  out.alpha = Math.min(1, inU * 3) * (1 - clamp01((t - p.wordEndAt) / CHESS_FADE_MS));
  return out;
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * The camera at sequence time `t`: a small push in through the ready, held until the piece takes the portrait; a tiny
 * dip on the set-down and on each hop; on THE impact a punch in and a shake along the piece's travel; a small bump when
 * the king hits the board. Deterministic. Pure.
 */
export function chessCameraAt(p: ChessPlan, c: HeroChessConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.strikeAt - p.chargeAt));
  else if (t >= p.impactAt) z += (p.zoom + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number, vx: number, vy: number): void => {
    const age = t - at;
    if (age < 0) return;
    const s = spring(age, hz, tau);
    const across = amp * 0.2 * Math.sin(age * 0.09) * Math.exp(-age / tau);
    x += vx * amp * s - vy * across;
    y += vy * amp * s + vx * across;
  };
  kick(p.tapAt, p.shakePx * (p.level === 3 ? 0.22 : 0.12), 40, 16, 0, 1);
  for (let i = 0; i < p.taps.length; i++) kick(p.taps[i]!, p.shakePx * 0.1, 36, 18, 0, 1);
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, dir.x, dir.y);
  if (p.king) { kick(p.wordAt, p.shakePx * 0.3, 45, 15, 0, 1); kick(p.fallAt, p.shakePx * 0.45, 70, 13, 0, 1); }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER as the ready starts, easing over to the DEFENDER by the time the piece is set
 * down (the whole move happens beside the struck hero). A zoom anchored on a point keeps that point still. Pure.
 */
export function chessCameraFocus(p: ChessPlan, t: number, a: Pt, d: Pt): Pt {
  if (t <= p.chargeAt) return a;
  if (t >= p.tapAt) return d;
  const e = sine((t - p.chargeAt) / Math.max(1, p.tapAt - p.chargeAt));
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
