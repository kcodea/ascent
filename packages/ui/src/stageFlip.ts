import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { stageScale, toScreen, toStage } from './stage';

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
 * rect per card at capture, one at play): capture each element's on-screen box, and on play start it at
 * `toStage(old − new)` and tween to 0. At `s === 1` both functions are exactly `Flip.getState` / `Flip.from`.
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
    // The element's natural (untranslated) box in screen px, then the old-minus-new offset in layout px.
    const curX = Number(gsap.getProperty(el, 'x')) || 0;
    const curY = Number(gsap.getProperty(el, 'y')) || 0;
    const dx = toStage(rec.left - (r.left - toScreen(curX)));
    const dy = toStage(rec.top - (r.top - toScreen(curY)));
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      if (curX !== 0 || curY !== 0) tl.to(el, { x: 0, y: 0, duration: vars.duration, ease: vars.ease }, 0);
      continue;
    }
    gsap.killTweensOf(el, 'x,y');
    tl.fromTo(el, { x: dx, y: dy }, { x: 0, y: 0, duration: vars.duration, ease: vars.ease, immediateRender: true }, 0);
  }
  return tl;
}
