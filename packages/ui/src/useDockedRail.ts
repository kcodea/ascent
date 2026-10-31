import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import { dockedLayout, type Box, type DockAnchors, type DockCfg, type DockLayout } from './lobbyRailDockedLayout';

/**
 * THE DOCKED RAIL'S MEASUREMENT (owner review 2026-10-31, DEV only). The panels are anchored to the board's own Refresh
 * pill, End Turn gem and Gold coin, so they move and scale with the board on every window shape.
 *
 * PERFORMANCE: the board is measured ONCE per layout change (mount, a window resize, the rail coming back after a fight,
 * and one settle pass after the HUD's entrance), never per frame. Rects are read in SCREEN px and converted into the
 * rail layer's own CSS px (the layer may sit under the stage's scale, stage.ts), so the layout is in the units it is
 * written in.
 */
const same = (a: Box, b: Box): boolean => Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.right - b.right) < 0.5 && Math.abs(a.bottom - b.bottom) < 0.5;
const sameAnchors = (a: DockAnchors | null, b: DockAnchors | null): boolean =>
  !!a && !!b && same(a.refresh, b.refresh) && same(a.gem, b.gem) && same(a.gold, b.gold) && same(a.view, b.view);

export function measureDockAnchors(layer: HTMLElement): DockAnchors | null {
  const rf = document.querySelector('.rfbwrap');
  const gem = document.querySelector('.etb-base');
  const gold = document.querySelector('.goldpill');
  // Measured against the rail's CONTAINING BLOCK, not the rail: the docked rail fills it (inset 0), and the rail's
  // header and Guides tab are positioned in it too, while the rail's own box changes with the variant it falls back to.
  const host = layer.offsetParent;
  if (!rf || !gem || !gold || !(host instanceof HTMLElement) || !host.offsetWidth) return null;
  const hr = host.getBoundingClientRect();
  const k = hr.width / host.offsetWidth;
  if (!(k > 0)) return null;
  const ox = hr.left + host.clientLeft * k, oy = hr.top + host.clientTop * k;
  const conv = (b: { left: number; top: number; right: number; bottom: number }): Box => ({
    left: (b.left - ox) / k, top: (b.top - oy) / k, right: (b.right - ox) / k, bottom: (b.bottom - oy) / k,
  });
  const g = gem.getBoundingClientRect();
  if (g.height <= 0) return null;
  return {
    refresh: conv(rf.getBoundingClientRect()),
    gem: conv(g),
    gold: conv(gold.getBoundingClientRect()),
    view: conv({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }),
  };
}

/**
 * The docked layout for these seats, or null (not docked, the board's HUD not on screen, or no room: the caller falls
 * back to the tile column). `live` in standing order, `dead` in place order.
 */
export function useDockedRail(on: boolean, layerRef: RefObject<HTMLElement | null>, live: readonly string[], dead: readonly string[], cfg: DockCfg, paused: boolean, teamOf?: readonly number[], teamLead = false): DockLayout | null {
  const [anchors, setAnchors] = useState<DockAnchors | null>(null);
  useLayoutEffect(() => {
    if (!on || paused) return;
    let raf = 0;
    const measure = (): void => {
      const layer = layerRef.current;
      if (!layer) return;
      const next = measureDockAnchors(layer);
      if (next) setAnchors((prev) => (sameAnchors(prev, next) ? prev : next));
    };
    const later = (): void => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    measure();
    // One settle pass: the HUD's entrance (and late art) can move the Refresh / gem / Gold just after mount.
    const t1 = window.setTimeout(later, 400);
    const t2 = window.setTimeout(later, 1500);
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('resize', later);
    };
  }, [on, paused, layerRef]);
  const liveKey = live.join(','), deadKey = dead.join(','), teamKey = teamOf?.join(',') ?? '';
  return useMemo(
    () => (on && anchors ? dockedLayout(anchors, live, dead, cfg, teamOf, teamLead) : null),
    // The id lists are keyed by their joined form (a new array each render must not re-run the layout).
    [on, anchors, liveKey, deadKey, teamKey, teamLead, cfg],
  );
}
