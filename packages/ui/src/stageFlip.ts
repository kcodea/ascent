import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { stageScale, toStage } from './stage';

/** An element's current `x` / `y` translate in layout px, re-parsed from its computed transform (GSAP's
 *  `getProperty` 4th argument, `uncache` — untyped in gsap's .d.ts). Flip reads its end state the same way. */
const freshTranslate = (el: Element, prop: 'x' | 'y'): number =>
  Number((gsap.getProperty as (t: Element, p: string, unit?: string, uncache?: boolean) => string | number)(el, prop, undefined, true)) || 0;

/**
 * GSAP Flip's `simple: true` fast path on the SCALED STAGE (stage.ts).
 *
 * The row slides (board / shop / hand reorders, the drag's pre-emptive parting) use `Flip.getState(…, { simple:
 * true })` because the full path forces a layout per card (owner drag-stutter traces 2026-09-04 / 09-17). The simple
 * path adds the SCREEN-px distance between the old and new box straight onto the element's `x` / `y`, which are
 * LAYOUT px. Unscaled those are the same unit; on a scaled stage the offset comes out `1 / s` too big and every
 * card flies in from far outside its row (2.8× on a phone). The full path accounts for the ancestor scale, but it
 * is exactly the per-card forced layout the simple path was chosen to avoid.
 *
 * So below the design size this module does the same translate-only FLIP by hand, at the simple path's cost (one
 * rect per card at capture, one at play): capture each element's on-screen box, and on play start it
 * `toStage(old − new)` away from its CURRENT transform and tween back to that transform. At `s === 1` both functions
 * are exactly `Flip.getState` / `Flip.from`.
 *
 * The END of the glide is the element's current transform, read FRESH — never `x: 0`, never GSAP's cached value
 * (owner report 2026-09-30, R-PRESENT-27). During a drag the row opens its gap with a React `slideDir` transform
 * (Card.tsx) that GSAP never wrote, so its cache is stale; Flip re-reads it (`cache.uncache = 1`) and ends on it.
 * Tweening to 0 instead wiped the make-room slide the instant it was applied — the warband twitched and fell back
 * instead of parting, but only below full screen.
 */

interface StageRecord { el: Element; left: number; top: number }
export type StageFlipState = ReturnType<typeof Flip.getState> | { stageRecords: StageRecord[] };

/** `Flip.getState(targets, { simple: true })`, scaled-stage safe. */
export function getSimpleState(targets: string | Element[]): StageFlipState {
  if (stageScale() === 1) return Flip.getState(targets, { simple: true });
  const els = typeof targets === 'string' ? Array.from(document.querySelectorAll(targets)) : targets;
  return {
    stageRecords: els.map((el) => {
      const r = el.getBoundingClientRect();
      return { el, left: r.left, top: r.top };
    }),
  };
}

/** `Flip.from(state, { ...vars, simple: true })`, scaled-stage safe. Translate-only (what these rows do). */
export function fromSimpleState(
  state: StageFlipState,
  vars: { duration: number; ease: string; onComplete?: () => void },
): gsap.core.Timeline | gsap.core.Animation {
  if (!('stageRecords' in state)) return Flip.from(state, { ...vars, simple: true });
  const tl = gsap.timeline({ onComplete: vars.onComplete });
  for (const rec of state.stageRecords) {
    const el = rec.el as HTMLElement;
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // Where the element's transform puts it NOW (layout px), read fresh like Flip does: the drag's make-room slide
    // is a React transform GSAP's cache has never seen. That is the glide's END; its start is the old-minus-new
    // on-screen offset (screen px -> layout px) away from it.
    const curX = freshTranslate(el, 'x');
    const curY = freshTranslate(el, 'y');
    const dx = toStage(rec.left - r.left);
    const dy = toStage(rec.top - r.top);
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue; // already where the layout wants it
    gsap.killTweensOf(el, 'x,y');
    tl.fromTo(el, { x: curX + dx, y: curY + dy }, { x: curX, y: curY, duration: vars.duration, ease: vars.ease, immediateRender: true }, 0);
  }
  return tl;
}
