import { hexToNum } from './color';
import { getMilestoneFrameConfig } from '../milestoneFrameConfig';

/**
 * The burst palette a milestone tier celebrates in — derived from that tier's FRAME GLOW colour, so the
 * celebration and the frame it lands on always share ONE colour source: retune a `glowN` in the Milestone
 * Badges tuner and the celebration follows, no code change (owner decision 2026-09-15).
 *
 * The FX system has no per-call colour channel by design (see `recolorDef` / `scaleDef`). `recolorDef` — a
 * uniform palette swap — is how the one bound `rune-select-implosion` def plays in five colours instead of
 * five near-duplicate defs. This module is the milestone-specific half: a glow colour → the 4-stop rim→core
 * palette that swap writes onto the burst and shockwave.
 */

/** The ramp shape — rim/outer darken factors and the core→white blend. The tunable knobs (approved on the
 *  2026-09-15 preview): if a tier's burst wants a hotter core or darker rim, this is the one place to move. */
const RIM = 0.18;
const OUTER = 0.5;
const CORE_TO_WHITE = 0.78;

/**
 * PURE: a single glow colour → a 4-stop rim→core palette in the family of the authored palettes
 * (dark saturated rim → the colour → near-white core). rim/outer scale the colour toward black; inner IS the
 * colour (the burst biases most particles here, see the def's `coreBias`); core blends toward white for the
 * hot centre. Returns four `0xRRGGBB` numbers, rim first — the exact shape `palette` params expect.
 */
export function rampFromColor(hex: number): [number, number, number, number] {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const mul = (f: number): number =>
    (Math.round(r * f) << 16) | (Math.round(g * f) << 8) | Math.round(b * f);
  const toWhite = (t: number): number =>
    (Math.round(r + (255 - r) * t) << 16)
    | (Math.round(g + (255 - g) * t) << 8)
    | Math.round(b + (255 - b) * t);
  return [mul(RIM), mul(OUTER), (r << 16) | (g << 8) | b, toWhite(CORE_TO_WHITE)];
}

const GLOW_KEYS = ['glow1', 'glow2', 'glow3', 'glow4', 'glow5', 'glow6'] as const;

/**
 * The recolor palette for a milestone tier (1..6), or `undefined` for a tier with no glow entry — which
 * `playDef` treats as "no recolor", so the def plays its own authored colours. Reads the LIVE config, so an
 * owner-retuned `glowN` recolours the celebration with no code change.
 */
export function milestoneTierPalette(tier: number): [number, number, number, number] | undefined {
  const key = GLOW_KEYS[tier - 1];
  if (key === undefined) return undefined;
  return rampFromColor(hexToNum(getMilestoneFrameConfig()[key]));
}
