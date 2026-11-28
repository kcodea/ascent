/**
 * HERO SELECT ARRIVING (owner 2026-11-24): it is mounted and whole behind the reveal; as the leaving wave crosses the
 * screen, each piece of it rises into place when the wave reaches it. One-shot, compositor-only (`opacity`, `translate`,
 * `scale`), measured once. The individual properties compose with whatever transform a piece already has.
 */
export interface ArriveFrom {
  /** Where the wave starts (screen px). */
  x: number;
  y: number;
  /** When it reaches a point `px` away (ms). */
  delayMs: (px: number) => number;
}

/** The pieces, as hero select's three bodies draw them (showcase, the roster grid, the banners) and its own chrome. */
const PIECES = '.hs-eyebrow, .hsprompt, .hsline, .hsback, .hss-slot, .hss-card, .herocard, .hsbook, .hs-poster';

export function arriveHeroSelect(from: ArriveFrom, root: ParentNode = document): number {
  return arriveScreen(from, '.heroselect:not(.hswatch)', PIECES, root);
}

/** The same arrival for any screen: `host` its root, `pieces` what rises into place as the wave reaches it. */
export function arriveScreen(from: ArriveFrom, hostSel: string, pieces: string, root: ParentNode = document): number {
  const host = root.querySelector<HTMLElement>(hostSel);
  if (!host) return 0;
  const vh = window.innerHeight;
  let n = 0;
  for (const e of host.querySelectorAll<HTMLElement>(pieces)) {
    if (typeof e.animate !== 'function') continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.top > vh || r.bottom < 0) continue;
    const dx = r.left + r.width / 2 - from.x;
    const dy = r.top + r.height / 2 - from.y;
    const d = Math.hypot(dx, dy);
    const k = d > 1 ? 1 / d : 0;
    // Pushed back the way the wave came from, then let go: it overshoots its place a touch and settles.
    e.animate([
      { opacity: 0, translate: `${(-dx * k * 26).toFixed(1)}px ${(-dy * k * 18 + 22).toFixed(1)}px`, scale: '0.9' },
      { opacity: 1, translate: `${(dx * k * 5).toFixed(1)}px ${(dy * k * 3 - 3).toFixed(1)}px`, scale: '1.012', offset: 0.62 },
      { translate: '0px 0px', scale: '1' },
    ], { delay: Math.max(0, from.delayMs(d) - 40), duration: 640, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)', fill: 'backwards' });
    n++;
  }
  return n;
}
