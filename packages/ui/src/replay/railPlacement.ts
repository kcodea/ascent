/**
 * REPLAY ROUND RAIL — the viewer's own placement (2026-09-19): where they DRAGGED the rail to, and whether they
 * COLLAPSED it. Persisted per browser (localStorage, try/caught — a private window or blocked storage simply
 * forgets between sessions), for players as much as the owner; the DEV tuner's `x`/`y` remain the rail's HOME.
 *
 * The drag offset is kept in screen pixels relative to that home and applied as a CSS translate through two
 * custom properties on the rail's wrapper — so a `pointermove` writes two vars on one element and never asks
 * React to re-render (the rail's rows are memoized per round; a drag must not touch them).
 *
 * Pure helpers here; the DOM wiring lives in `RoundRail.tsx`.
 */

export interface RailPlacement {
  /** Drag offset from the home position, screen px. */
  dx: number;
  dy: number;
  collapsed: boolean;
}

export const RAIL_PLACEMENT_KEY = 'ascent.replayrail.place';
export const DEFAULT_RAIL_PLACEMENT: RailPlacement = { dx: 0, dy: 0, collapsed: false };

/** Minimum px of the rail that must stay on screen on every side — a rail you can drag entirely off the
 *  viewport is a rail you cannot drag back. */
export const RAIL_MIN_VISIBLE = 40;

export function loadRailPlacement(): RailPlacement {
  try {
    const raw = localStorage.getItem(RAIL_PLACEMENT_KEY);
    if (!raw) return { ...DEFAULT_RAIL_PLACEMENT };
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return { ...DEFAULT_RAIL_PLACEMENT };
    const o = v as Partial<RailPlacement>;
    return {
      dx: typeof o.dx === 'number' && Number.isFinite(o.dx) ? o.dx : 0,
      dy: typeof o.dy === 'number' && Number.isFinite(o.dy) ? o.dy : 0,
      collapsed: o.collapsed === true,
    };
  } catch {
    return { ...DEFAULT_RAIL_PLACEMENT };
  }
}

export function saveRailPlacement(p: RailPlacement): void {
  try { localStorage.setItem(RAIL_PLACEMENT_KEY, JSON.stringify(p)); } catch { /* storage refused — forget */ }
}

/**
 * Clamp a candidate offset so the rail stays on screen. `rect` is the rail's CURRENT on-screen box (measured
 * once, at pointerdown or on a resize) under the CURRENT offset `cur`; the candidate `next` shifts it by the
 * difference. Pure — tested.
 */
export function clampRailOffset(
  next: { dx: number; dy: number },
  cur: { dx: number; dy: number },
  rect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
  minVisible = RAIL_MIN_VISIBLE,
): { dx: number; dy: number } {
  const w = Math.min(minVisible, rect.width);
  const h = Math.min(minVisible, rect.height);
  // Where the box would land under `next`.
  const left = rect.left + (next.dx - cur.dx);
  const top = rect.top + (next.dy - cur.dy);
  const minLeft = w - rect.width;               // right edge at least `w` px inside
  const maxLeft = viewport.width - w;            // left edge at most `w` px from the right
  const minTop = h - rect.height;
  const maxTop = viewport.height - h;
  const cl = Math.max(minLeft, Math.min(maxLeft, left));
  const ct = Math.max(minTop, Math.min(maxTop, top));
  return { dx: next.dx + (cl - left), dy: next.dy + (ct - top) };
}
