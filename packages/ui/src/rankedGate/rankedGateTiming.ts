/**
 * THE RANKED GATE — the sequence's clock (owner 2026-10-12). Owner, verbatim: "once the player hits the 'yes
 * continue' button, i want an animation equipped with sound effects and everything. where two gates slide in with a
 * grinding motion and sound and slam shut with smoke and sparks that emit from the impact. and then after a brief 1
 * second delay, they shudder and open again to reveal the hero select screen".
 *
 * Pure numbers, no DOM: the component schedules from `rankedGateTimeline`, the stylesheet reads the same durations
 * as `--rg-*` vars (`rankedGateCssVars`), and the test pins the order. The durations are fitted to the owner's four
 * recorded cues (measured 2026-10-12):
 *   - `gateclose`  (2.5 s): a steady grind for ~1.5 s, then it fades. The doors travel for that 1.5 s.
 *   - `gateslam`   (2.4 s): the hit is at the very start, so it fires as the doors meet.
 *   - `gaterattle` (2.3 s): the rattle is loud for ~0.7 s. The doors shake for that long.
 *   - `gateopen`   (2.9 s): a clunk ~0.4 s in, then the grind. It starts `openSoundLeadMs` before the doors move,
 *                           so the clunk lands as they part.
 */
export interface RankedGateTiming {
  /** The doors' travel from off-screen to shut. */
  closeMs: number;
  /** The impact shake + seam flash that follows the slam. */
  slamShakeMs: number;
  /** After the slam, how long until the screen BEHIND the shut gate is swapped (the mode picker for hero select). */
  handoffMs: number;
  /** The owner's "brief 1 second delay": from the slam to the shudder. */
  holdMs: number;
  /** How long the shut doors shudder before they part. */
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
  holdMs: 1000,
  shudderMs: 700,
  openSoundLeadMs: 300,
  openMs: 1500,
};

/** The gate's visible states, in order. The root wears `is-<phase>`. */
export type RankedGatePhase = 'closing' | 'shut' | 'shudder' | 'opening';

/** Every moment of the sequence, in ms from the press. */
export interface RankedGateTimeline {
  /** The doors start to slide; `gateclose` plays. */
  closeAt: number;
  /** The doors meet: `gateslam`, the shake, the smoke and the sparks. */
  slamAt: number;
  /** The screen behind the shut gate is swapped. */
  handoffAt: number;
  /** The shudder starts; `gaterattle` plays. */
  shudderAt: number;
  /** `gateopen` starts. */
  openSoundAt: number;
  /** The doors start to part. */
  openAt: number;
  /** The doors are clear of the screen; the gate unmounts. */
  endAt: number;
}

export function rankedGateTimeline(t: RankedGateTiming = RANKED_GATE_TIMING): RankedGateTimeline {
  const slamAt = t.closeMs;
  const shudderAt = slamAt + t.holdMs;
  const openAt = shudderAt + t.shudderMs;
  return {
    closeAt: 0,
    slamAt,
    // Never before the doors are fully shut and never once they start to part: the swap must stay hidden.
    handoffAt: Math.min(slamAt + Math.max(0, t.handoffMs), openAt - 1),
    shudderAt,
    openSoundAt: Math.max(shudderAt, openAt - Math.max(0, t.openSoundLeadMs)),
    openAt,
    endAt: openAt + t.openMs,
  };
}

/** The durations the stylesheet's keyframes run for (`rankedGate.css` reads these off the gate's root). */
export function rankedGateCssVars(t: RankedGateTiming = RANKED_GATE_TIMING): Record<string, string> {
  return {
    '--rg-close': `${t.closeMs}ms`,
    '--rg-shake': `${t.slamShakeMs}ms`,
    '--rg-shudder': `${t.shudderMs}ms`,
    '--rg-open': `${t.openMs}ms`,
  };
}
