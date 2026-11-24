/**
 * THE RIPPLE's place in the hero ceremony (R-LOCATION-05): where its wave starts, its own times, and what hero select does as
 * the wave comes (it leans away from it). The picture itself is locationReveal/heroRipple.ts.
 */
import { rippleFar, rippleReach } from '../locationReveal/heroRipple';
import { rectToStage, stageViewport } from '../stage';
import type { HeroCeremonyTiming } from './heroCeremonyTiming';

/** The ceremony's marks when the ripple plays: the picture is whole from the start, Start Game may be pressed as the wave
 *  leaves the screen, and the hero speaks once it has. */
export const RIPPLE_TIMING: Partial<HeroCeremonyTiming> = {
  headerExitDelayMs: 0, optionExitDelayMs: 0, focusDelayMs: 0, focusMs: 1, settleMs: 1,
  voiceAtMs: 1250, transformAtMs: 30, transformMs: 1, identityAtMs: 400, readyAtMs: 620, readyMs: 380,
};

/** The middle of the Select Hero button that was pressed (stage px); the bottom middle when there is none on screen. */
export function waveOrigin(): { x: number; y: number } {
  const vp = stageViewport();
  const all = typeof document === 'undefined' ? [] : [...document.querySelectorAll<HTMLElement>('.heroselect .hss-confirm')];
  const el = all.filter((e) => e.getBoundingClientRect().width > 0).pop(); // the "All heroes" window's is over the grid's
  if (!el) return { x: vp.w / 2, y: vp.h * 0.88 };
  const r = rectToStage(el.getBoundingClientRect());
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

const PIECES = '.hs-eyebrow, .hsprompt, .hsline, .hsback, .hss-slot, .hss-card, .phi-nav, .hsbook, .hsb-panel';

/** Each piece of hero select leans away as the wave's front comes to it; the wave then covers it. Compositor only. */
export function shoveAside(root: HTMLElement, from: { x: number; y: number }, vp: { w: number; h: number }, sink: Animation[]): void {
  const far = rippleFar(from.x, from.y, vp.w, vp.h);
  for (const e of root.querySelectorAll<HTMLElement>(PIECES)) {
    if (typeof e.animate !== 'function') continue;
    const r = rectToStage(e.getBoundingClientRect());
    if (r.width === 0) continue;
    const dx = r.left + r.width / 2 - from.x;
    const dy = r.top + r.height / 2 - from.y;
    const d = Math.hypot(dx, dy);
    const k = d > 1 ? 1 / d : 0;
    const at = rippleReach(d / vp.h, far) * 1000;
    sink.push(e.animate([
      { translate: '0px 0px', scale: '1' },
      { translate: `${(dx * k * 16).toFixed(1)}px ${(dy * k * 16).toFixed(1)}px`, scale: '0.985' },
    ], { delay: Math.max(0, at - 240), duration: 420, easing: 'cubic-bezier(0.3, 0, 0.3, 1)', fill: 'both' }));
  }
}
