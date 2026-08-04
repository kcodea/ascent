/**
 * `react` — the DOM layer. The card itself moves, instead of something being drawn in front of it.
 *
 * Every other primitive renders into a Pixi container floating over the board. That is right for sparks,
 * trails and shockwaves, and wrong for "this card flinched": a burst drawn on top of a badge is a decoration
 * near the badge, while a badge that actually swells is the game reacting. This primitive animates the real
 * elements — the card, a stat badge, the badge's `plate` (circle) or its `value` (digit), each addressable
 * on its own since `Card.tsx` split them.
 *
 * ── it rides the PLAYER's clock, not its own ─────────────────────────────────────────────────────────
 * Every animation is created PAUSED and its `currentTime` is written each frame from the accumulated
 * `update(dtMs)`. WAAPI would happily run these itself, and that is exactly what must not happen: the
 * player's dt is already scaled by combat speed and the workbench's transport, so a self-driven animation
 * would keep wall-clock time while the effect around it stretched — the fixed-CSS-vs-scaled-hold split that
 * makes an effect look right at 1x and wrong everywhere else. Driving `currentTime` by hand means scrubbing,
 * pausing and speed all work for free, because there is only ever one clock.
 *
 * ── transform/opacity only, and ADDITIVE ─────────────────────────────────────────────────────────────
 * Only compositor properties are animated (CLAUDE.md's looping-paint rule). Every animation composites with
 * `add` rather than replacing, which is load-bearing rather than a nicety: cards already carry transforms
 * from drag and the reorder slide, and a replacing animation would snap a mid-slide card to the origin for
 * its duration. Additively, transforms concatenate onto whatever the card is already doing, and an
 * untouched card composes against identity — a no-op. Opacity is expressed as a DIP (a negative delta) for
 * the same reason.
 *
 * ── what it does NOT do ──────────────────────────────────────────────────────────────────────────────
 * It draws nothing, so its Pixi container stays empty; the layer exists purely for its timing slot. It also
 * never reads `getBoundingClientRect` — it needs elements, not geometry, so there is no per-frame layout
 * read here (CLAUDE.md).
 */

import { scheduleLands, waves } from '../land';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import type { ParamsOf } from '../params';
import { registerPrimitive } from '../registry';
import {
  FX_ORDERS, FX_PARTS, FX_REACHES, partElements, recipientsFor, unitElement,
  type FxOrder, type FxPart, type FxReach,
} from '../reactTargets';
import { EASES, EASE_IDS, amplitudeAt, keyframesFor } from '../reactMotion';


const SPECS = {
  part: {
    kind: 'enum', label: 'Part', group: 'Target', options: FX_PARTS, default: 'card', essential: true,
    help: 'Which piece of the card moves. `plate` is the badge circle, `value` the number — plural hits attack and health together.',
  },
  reach: {
    kind: 'enum', label: 'Reach', group: 'Target', options: FX_REACHES, default: 'self', essential: true,
    help: 'How far the reaction spreads from the unit the moment is about.',
  },
  order: {
    kind: 'enum', label: 'Order', group: 'Target', options: FX_ORDERS, default: 'ripple', essential: true,
    help: 'Ripple spreads outward from the unit both ways at once; cascade sweeps left to right across the row; volley hits everyone together.',
  },
  gap: {
    kind: 'slider', label: 'Gap', group: 'Target', min: 0, max: 400, step: 5, default: 60,
    help: 'Milliseconds between each step outward (ripple) or each unit (cascade). Ignored by volley.',
  },
  falloff: {
    kind: 'slider', label: 'Falloff', group: 'Target', min: 0, max: 1, step: 0.01, default: 0.4,
    help: 'How much weaker each further unit reacts. 0 = all equal, 1 = the furthest barely moves.',
  },
  hold: {
    kind: 'slider', label: 'Hold', group: 'Motion', min: 60, max: 1200, step: 10, default: 300, essential: true,
    help: "One unit's whole reaction, in milliseconds.",
  },
  peak: {
    kind: 'slider', label: 'Peak at', group: 'Motion', min: 0.05, max: 0.9, step: 0.01, default: 0.35,
    help: 'Where in the hold the reaction is at its strongest. Low = a snap that settles slowly.',
  },
  scale: {
    kind: 'slider', label: 'Scale', group: 'Motion', min: 0.5, max: 2.5, step: 0.01, default: 1.35, essential: true,
    help: 'Peak size. 1 = no size change.',
  },
  squash: {
    kind: 'slider', label: 'Squash', group: 'Motion', min: -1, max: 1, step: 0.01, default: 0,
    help: 'Squash and stretch. Positive = wider and shorter (an impact absorbed); negative = taller and thinner (a lunge). Changes shape where Scale changes size.',
  },
  lift: {
    kind: 'slider', label: 'Lift', group: 'Motion', min: -60, max: 60, step: 1, default: 0,
    help: 'Peak vertical shift in pixels. Negative lifts, positive presses down.',
  },
  nudge: {
    kind: 'slider', label: 'Nudge', group: 'Motion', min: -60, max: 60, step: 1, default: 0,
    help: 'Peak horizontal shift in pixels. Negative goes left. With Lift, gives a directional recoil.',
  },
  shakes: {
    kind: 'slider', label: 'Shakes', group: 'Motion', min: 0, max: 6, step: 1, default: 0,
    help: 'Extra swings past the first, each reversing and weaker than the last. 0 is a single pop; 2+ reads as an impact the unit is recovering from.',
  },
  spin: {
    kind: 'slider', label: 'Spin', group: 'Motion', min: -90, max: 90, step: 1, default: 0,
    help: 'Peak rotation in degrees.',
  },
  dip: {
    kind: 'slider', label: 'Opacity dip', group: 'Motion', min: 0, max: 1, step: 0.01, default: 0,
    help: 'How far opacity drops at the peak. 0 = stays solid.',
  },
  ease: {
    kind: 'enum', label: 'Ease', group: 'Motion', options: EASE_IDS, default: 'overshoot',
    help: 'The shape of the motion into and out of the peak.',
  },
} as const;

type ReactParams = ParamsOf<typeof SPECS>;

/** One element's scheduled reaction. */
interface Beat {
  anim: Animation;
  /** Milliseconds from the effect's start at which this element's own animation begins. */
  at: number;
  duration: number;
}

/**
 * The subject this fire is about. `target` first: a reaction is something happening TO a unit, and for the
 * one-ended moments that dominate (a buff, a gem landing) `combatAnchors` has already folded the single
 * unit onto both ends, so either would do.
 *
 * **No uid means the layer plays on NOTHING, deliberately.** The first cut fell back to the first player
 * unit so the layer would be previewable in a workbench that stages anchors but no uids. That fallback was
 * a mistake and cost three rounds of live debugging: the effect ran, animated the LEFTMOST minion, and
 * looked for all the world like a targeting bug in the reach code. A silent wrong answer is worse than no
 * answer — an effect that does nothing is immediately legible as "nothing told me who this is about",
 * which is the truth. The workbench now names a subject explicitly (see its "React on" picker), so the
 * fallback bought nothing anyway.
 */
function subjectUid(ctx: FxContext): string | null {
  return ctx.uids?.target ?? ctx.uids?.source ?? null;
}

class ReactInstance implements FxInstance<ReactParams> {
  private beats: Beat[] = [];
  private localMs = 0;
  private totalMs = 0;
  private readonly subject: string | null;

  constructor(ctx: FxContext, params: ReactParams) {
    this.subject = subjectUid(ctx);
    this.build(params);
  }

  /** Tear down every live animation and schedule a fresh set. Called on construction and on every live
   *  param edit — rebuilding is what makes a slider drag show up immediately. */
  private build(p: ReactParams): void {
    this.cancelAll();
    this.beats = [];
    this.totalMs = 0;
    if (this.subject === null || typeof document === 'undefined') return;

    // RINGS, not a flat list: units the same distance from the subject fire TOGETHER. `waves` maps one ring
    // to one group, so `gap` spaces the rings rather than the individual units — which is what makes this a
    // ripple outward instead of a left-to-right sweep. `scheduleLands` owns the arithmetic for the whole
    // codebase (see `land.ts`); speed is 1 here because the player's dt is already scaled, and applying it
    // twice would compound.
    const rings = recipientsFor(this.subject, p.reach as FxReach, p.order as FxOrder);
    const lands = scheduleLands(waves(rings.map((r) => r.map((uid) => ({ uid })))), { gap: p.gap, speed: 1 });

    for (const land of lands) {
      const unit = unitElement(land.uid);
      if (unit === null) continue; // died, unmounted, or off-screen — skip it, don't fail the effect
      // Falloff keys off the GROUP (a ripple ring, or a cascade step), so everything landing at the same
      // moment is equally strong — weakening one side of a symmetric ripple was the bug that made
      // `neighbours` look one-sided.
      const amp = amplitudeAt(land.group, rings.length, p.falloff);
      const frames = keyframesFor(p, amp, EASES[p.ease] ?? EASES.out);
      for (const el of partElements(unit, p.part as FxPart)) {
        // NO `easing` here on purpose — it belongs on the keyframes (see `keyframesFor`). A timing-level
        // ease remaps the whole iteration and moves the peak off `peak`, which measured as a ~3%-of-intended
        // reaction in Chrome.
        const anim = el.animate(frames, { duration: p.hold, fill: 'none', composite: 'add' });
        anim.pause(); // the player owns the clock — see the module header
        this.beats.push({ anim, at: land.at, duration: p.hold });
      }
      this.totalMs = Math.max(this.totalMs, land.at + p.hold);
    }
    this.seek();
  }

  /** Write every animation's playhead from the effect's own clock. */
  private seek(): void {
    for (const b of this.beats) {
      b.anim.currentTime = Math.min(Math.max(this.localMs - b.at, 0), b.duration);
    }
  }

  private cancelAll(): void {
    for (const b of this.beats) b.anim.cancel();
  }

  update(dtMs: number): void {
    this.localMs += dtMs;
    this.seek();
  }

  setParams(next: ReactParams): void {
    this.build(next);
  }

  isComplete(): boolean {
    return this.localMs >= this.totalMs;
  }

  destroy(): void {
    this.cancelAll();
    this.beats = [];
  }
}

export const reactPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'react',
  params: SPECS,
  spawn: (ctx, params) => new ReactInstance(ctx, params),
};

registerPrimitive(reactPrimitive as FxPrimitive);
