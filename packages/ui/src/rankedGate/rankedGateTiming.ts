/**
 * THE RANKED GATE — the sequence's clock (owner 2026-10-12). Owner, verbatim: "once the player hits the 'yes
 * continue' button, i want an animation equipped with sound effects and everything. where two gates slide in with a
 * grinding motion and sound and slam shut with smoke and sparks that emit from the impact. and then after a brief 1
 * second delay, they shudder and open again to reveal the hero select screen".
 *
 * THE CRYSTAL (owner 2026-10-13) replaced that fixed delay with the player's own hand: "once the gate closes with
 * the slam. i want it to sit in that position as the center gold diamond forms the blue crystal ... then i want the
 * crystal to be steadily pulsing until the player clicks it with their mouse. upon clicking it, i want the crystal
 * to shatter, which then triggers the gate to slide open, revealing the character select screen".
 *
 * So the sequence is TWO clocks with a wait between them:
 *   1. `rankedGateCloseTimeline`, from the press of "Yes": close, slam, the swap behind the shut doors, the crystal
 *      forming, then ARMED. The gate then sits shut, the crystal pulsing, for as long as the player likes.
 *   2. `rankedGateOpenTimeline`, from the press on the crystal: it shatters, the doors shudder, then grind open.
 *
 * Pure numbers, no DOM: the component schedules from the two timelines, the stylesheet reads the same durations as
 * `--rg-*` vars (`rankedGateCssVars`), and the test pins the order. The durations are fitted to the owner's
 * recorded cues (measured 2026-10-12):
 *   - `gateclose`  (2.5 s): a steady grind for ~1.5 s, then it fades. The doors travel for that 1.5 s.
 *   - `gateslam`   (2.4 s): the hit is at the very start, so it fires as the doors meet.
 *   - `gaterattle` (2.3 s): the rattle is loud for ~0.7 s. The doors shake for that long.
 *   - `gateopen`   (2.9 s): a clunk ~0.4 s in, then the grind. It starts `openSoundLeadMs` before the doors move,
 *                           so the clunk lands as they part.
 */
import { cubicBezier } from '../wipeGeometry';

export interface RankedGateTiming {
  /** The doors' travel from off-screen to shut. */
  closeMs: number;
  /** The impact shake + seam flash that follows the slam. */
  slamShakeMs: number;
  /** After the slam, how long until the screen BEHIND the shut gate is swapped (the mode picker for hero select). */
  handoffMs: number;
  /** After the slam, how long the gate sits (the recoil settles, the dust rolls) before the crystal starts to form. */
  crystalDelayMs: number;
  /** The centre diamond forming the crystal: sparks are pulled into its centre and the gem grows there, white-hot,
   *  then cools. 1100 ms at first; 1600 ms since the coalescing (2026-10-13), which needs the time to read. */
  crystalFormMs: number;
  /** The crystal's burst once it is pressed. */
  shatterMs: number;
  /** How long the shut doors shudder (from the shatter) before they part. */
  shudderMs: number;
  /** How long before the doors start to part the `gateopen` cue begins (its clunk sits ~0.4 s into the clip). */
  openSoundLeadMs: number;
  /** The doors' travel from shut to off-screen. */
  openMs: number;
}

export const RANKED_GATE_TIMING: RankedGateTiming = {
  closeMs: 1500,
  slamShakeMs: 460,
  handoffMs: 220,
  crystalDelayMs: 650,
  crystalFormMs: 1600,
  shatterMs: 420,
  shudderMs: 700,
  openSoundLeadMs: 300,
  openMs: 1500,
};

/**
 * The gate's visible states, in order. The root wears `is-<phase>`.
 * `armed` is the only one with no clock: it lasts until the crystal is pressed.
 */
export type RankedGatePhase = 'closing' | 'shut' | 'forming' | 'armed' | 'shatter' | 'opening';

/** The first clock: every moment from the press of "Yes" to the crystal being ready, in ms. */
export interface RankedGateCloseTimeline {
  /** The doors start to slide; `gateclose` plays. */
  closeAt: number;
  /** The doors meet: `gateslam`, the shake, the smoke, the sparks and the blue embers. */
  slamAt: number;
  /** The screen behind the shut gate is swapped. */
  handoffAt: number;
  /** The centre diamond starts to form the crystal. */
  formAt: number;
  /** The crystal is whole, pulsing, and can be pressed. */
  armedAt: number;
}

export function rankedGateCloseTimeline(t: RankedGateTiming = RANKED_GATE_TIMING): RankedGateCloseTimeline {
  const slamAt = t.closeMs;
  const formAt = slamAt + Math.max(0, t.crystalDelayMs);
  const armedAt = formAt + Math.max(0, t.crystalFormMs);
  return {
    closeAt: 0,
    slamAt,
    // Never before the doors are fully shut, and always before the crystal can be pressed: the gate must never
    // be openable onto a screen that has not been swapped yet.
    handoffAt: Math.max(slamAt, Math.min(slamAt + Math.max(0, t.handoffMs), armedAt - 1)),
    formAt,
    armedAt,
  };
}

/** The second clock: every moment from the press on the crystal, in ms. */
export interface RankedGateOpenTimeline {
  /** The crystal shatters and the doors start to shudder; `gaterattle` plays. */
  shatterAt: number;
  /** `gateopen` starts. */
  openSoundAt: number;
  /** The doors start to part. */
  openAt: number;
  /** The doors are clear of the screen; the gate unmounts. */
  endAt: number;
}

export function rankedGateOpenTimeline(t: RankedGateTiming = RANKED_GATE_TIMING): RankedGateOpenTimeline {
  const openAt = Math.max(0, t.shudderMs);
  return {
    shatterAt: 0,
    openSoundAt: Math.max(0, openAt - Math.max(0, t.openSoundLeadMs)),
    openAt,
    endAt: openAt + t.openMs,
  };
}

/**
 * WHERE THE CRYSTAL SITS, in the gate art's own pixels. The art is 1672 x 941 with its seam on the centre column, so
 * each door's image is `halfW` x `h`. The centre diamond of the emblem is NOT on the art's vertical centre: it sits
 * a little above it, on row 429 (the emblem's own line of symmetry, measured). `crystalCy` is where the crystal
 * IMAGE's centre goes and `crystalSize` its square size, chosen so its solid body covers the gold diamond and fills
 * the steel recess around it (the owner's mock, 2026-10-13).
 *
 * `crystalCy` is 434, not 429: the crystal is a kite, widest (its side corners) on row 111 of its 232 px image, five
 * rows above the image's middle. Centring the image on the line left those corners sitting above it (owner, the
 * same day: "can you lower the diamond just slightly? its corner is slightly higher than the center line"), so the
 * image is placed for its CORNERS to land on row 429: 429 + (116 - 111) * 236 / 232.
 */
export const RANKED_GATE_ART = { halfW: 836, h: 941, crystalCy: 434, crystalSize: 236 } as const;

/**
 * THE CRYSTAL'S BODY inside its square image, as fractions of the image's size: the solid diamond is 128 x 183 px of
 * the 232 px art, its centre 3 px above the image's (measured off the art's alpha). The FX layer needs it to put
 * particles ON the gem's edge.
 */
export const RANKED_GATE_CRYSTAL_BODY = { halfW: 64 / 232, halfH: 91.5 / 232, dy: -3 / 232 } as const;

/**
 * HOW THE GEM GROWS while it forms: the `rg-cry-grow` keyframes of rankedGate.css, as numbers. From `fromScale` it
 * creeps to `startScale` by `startAt` (linear), swells to `peakScale` by `peakAt` along `bezier`, then settles to 1
 * (ease-in-out). The test reads the stylesheet and fails if the two disagree.
 */
export const RANKED_GATE_CRYSTAL_GROW = {
  fromScale: 0.02, startAt: 0.06, startScale: 0.05, peakAt: 0.88, peakScale: 1.05,
  bezier: [0.4, 0, 0.35, 1] as readonly [number, number, number, number],
} as const;
const growSwell = cubicBezier(...RANKED_GATE_CRYSTAL_GROW.bezier);
const growSettle = cubicBezier(0.42, 0, 0.58, 1); // CSS `ease-in-out`

/** The gem's scale at `t` (0..1) of its forming: what the stylesheet is showing at that moment. */
export function rankedGateCrystalGrowth(t: number): number {
  const g = RANKED_GATE_CRYSTAL_GROW;
  if (t <= 0) return g.fromScale;
  if (t >= 1) return 1;
  if (t < g.startAt) return g.fromScale + (g.startScale - g.fromScale) * (t / g.startAt);
  if (t < g.peakAt) return g.startScale + (g.peakScale - g.startScale) * growSwell((t - g.startAt) / (g.peakAt - g.startAt));
  return g.peakScale + (1 - g.peakScale) * growSettle((t - g.peakAt) / (1 - g.peakAt));
}

/** A box on screen (a `DOMRect` fits). */
export interface GateBox { left: number; top: number; width: number; height: number }

/**
 * The crystal's centre and size on screen, for the FX layer, from the doors' box. The door art is `cover`ed and
 * anchored on the seam (rankedGate.css), so one art pixel is `max(halfDoorWidth / halfW, height / h)` screen pixels
 * and the art's centre row sits on the box's centre row. The stylesheet places the crystal with the same formula.
 */
export function rankedGateCrystalAt(doors: GateBox, art: typeof RANKED_GATE_ART = RANKED_GATE_ART): { x: number; y: number; size: number } {
  const u = Math.max(doors.width / 2 / art.halfW, doors.height / art.h);
  return {
    x: doors.left + doors.width / 2,
    y: doors.top + doors.height / 2 + (art.crystalCy - art.h / 2) * u,
    size: art.crystalSize * u,
  };
}

/** The durations and the crystal's place, as the stylesheet reads them (`rankedGate.css`, off the gate's root). */
export function rankedGateCssVars(t: RankedGateTiming = RANKED_GATE_TIMING, art: typeof RANKED_GATE_ART = RANKED_GATE_ART): Record<string, string> {
  return {
    '--rg-close': `${t.closeMs}ms`,
    '--rg-shake': `${t.slamShakeMs}ms`,
    '--rg-form': `${t.crystalFormMs}ms`,
    '--rg-shatter': `${t.shatterMs}ms`,
    '--rg-shudder': `${t.shudderMs}ms`,
    '--rg-open': `${t.openMs}ms`,
    '--rg-art-hw': String(art.halfW),
    '--rg-art-h': String(art.h),
    '--rg-cry-dy': String(art.crystalCy - art.h / 2),
    '--rg-cry-size': String(art.crystalSize),
  };
}
