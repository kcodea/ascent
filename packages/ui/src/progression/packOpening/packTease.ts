/**
 * PACK OPENING: THE RARITY TEASE (owner 2026-11-24: "lets do the rarity tease before the flip", with a neutral card
 * back "so the player doesnt know what rarity it is from the edge").
 *
 * Every card back is the same navy reveal frame, so nothing gives a card's rarity away while it waits. The tease is what
 * the player gets for resting the pointer on the draw pile (owner 2026-11-24: "only do that buildup if the player is
 * hovering over the card draw pile"): a glow builds behind the top card and CLIMBS the rarity ladder one colour at a
 * time (Common's grey, then Rare's blue, Epic's purple, Legendary's gold, Ancient's aurora), stopping at the card's own
 * rarity and holding there. A Common settles at once; every step higher costs one more beat, so a glow that keeps
 * climbing is the anticipation. Each step lands with a small pop of the card, a sound, and a little more wobble. Moving
 * the pointer away eases it all out. A click turns the card at any moment, built up or not; the glow then fades out
 * through the turn. Touch has no hover, so a tap just turns the card.
 *
 * Pure data + maths (no Pixi): the scene (packScene.ts) drives its glow sprite and the top card from these, per frame,
 * without allocating. Time is in 60 Hz frames, like the rest of the scene. The Pack Lab's `tease` knob
 * (packFxConfig.ts, 0..2.5, default 1) scales the length; 0 turns the tease off.
 */
import { COSMETIC_RARITIES, type CrateRarity } from '@game/progression';

/** The first step (Common's glow): short, so a pack of Commons still flips briskly. */
export const TEASE_FIRST_FRAMES = 6;
/** Every further step up the ladder. */
export const TEASE_STEP_FRAMES = 9;

const mult = (m: number): number => (Number.isFinite(m) ? Math.max(0, m) : 1);

/** How many colours the glow shows for a card of rarity `r`: 1 (Common) to 5 (Ancient). */
export const teaseStages = (r: CrateRarity): number => COSMETIC_RARITIES.indexOf(r) + 1;

/** The whole tease's length for `r`, in frames, at the `tease` knob (0 = no tease). */
export function teaseFrames(r: CrateRarity, tease: number): number {
  const m = mult(tease);
  return m <= 0 ? 0 : (TEASE_FIRST_FRAMES + (teaseStages(r) - 1) * TEASE_STEP_FRAMES) * m;
}

export interface TeaseAt {
  /** Which colour the glow is on: 0 = Common's ... up to `teaseStages(r) - 1`. */
  stage: number;
  /** Progress through that step, 0..1. */
  k: number;
}

/** Where the tease is at `t` frames in. Writes `out`, returns it (clamped to the last step past the end). */
export function teaseAt(r: CrateRarity, t: number, tease: number, out: TeaseAt): TeaseAt {
  const m = mult(tease) || 1;
  const stages = teaseStages(r);
  const first = TEASE_FIRST_FRAMES * m, step = TEASE_STEP_FRAMES * m;
  const tt = Math.max(0, t);
  if (tt < first) { out.stage = 0; out.k = tt / first; return out; }
  const s = Math.min(stages - 1, 1 + Math.floor((tt - first) / step));
  out.stage = s;
  out.k = Math.min(1, (tt - first - (s - 1) * step) / step);
  return out;
}

/** The rarity whose colour step `stage` shows. */
export const teaseRarityAt = (stage: number): CrateRarity =>
  COSMETIC_RARITIES[Math.max(0, Math.min(COSMETIC_RARITIES.length - 1, Math.floor(stage)))]!;

/** The glow's alpha on step `stage` at progress `k`: brighter each step up, swelling through the step. */
export const teaseGlowAlpha = (stage: number, k: number): number => Math.min(1, 0.42 + 0.15 * stage) * (0.55 + 0.45 * k);

/** The glow's alpha as the card turns away: from where the tease left it (`a0`) down to nothing at the flip's edge (`p` 0..1). */
export const teaseGlowFade = (a0: number, p: number): number => {
  const q = 1 - Math.max(0, Math.min(1, p));
  return Math.max(0, a0) * q * q;
};

/** The card's extra scale as a step lands (a pop that settles through the step): bigger each step up. */
export const teasePop = (stage: number, k: number): number => (0.012 + 0.009 * stage) * (1 - k) * (1 - k);

/** The glow's extra size as a step lands (it punches out, then settles through the step). */
export const teaseGlowPop = (k: number): number => 1 + 0.2 * (1 - k) * (1 - k);

/** The shader aura's level on step `stage` at progress `k` (packAura.ts): further and hotter each step up. */
export const teaseAuraLevel = (stage: number, k: number): number => Math.min(1, 0.38 + 0.155 * stage) * (0.6 + 0.4 * k);

/**
 * The card's rotation (radians) on step `stage` at scene time `time` (60 Hz frames): the slow wobble, and from Legendary
 * up a faster tremble on top of it, as if the card can barely hold what is in it.
 */
export const teaseTremble = (stage: number, time: number): number => {
  const a = teaseWobble(stage);
  return Math.sin(time * 0.9) * a + (stage >= 3 ? Math.sin(time * 2.9 + 1.3) * a * 0.55 : 0);
};

/** Frames between heartbeats while a finished tease is held (0 = no heartbeat: Common..Epic). Ancient beats faster. */
export const teaseBeatFrames = (stage: number): number => (stage >= 4 ? 27 : stage >= 3 ? 36 : 0);

/** The card's wobble amplitude (radians) on step `stage`: none on Common's, a little more each step up. */
export const teaseWobble = (stage: number): number => 0.0045 * stage;
