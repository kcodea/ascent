// packages/ui/src/godMode/GodFlyout.tsx
import { memo, useEffect, useLayoutEffect, useRef, type MutableRefObject, type ReactElement } from 'react';
import { stageViewport } from '../stage';

/**
 * The God Mode panel's SIDE WINDOW (owner 2026-10-08: "a button that when you press it, it opens up another window to
 * the side with the search and dropdown"). One list at a time — Minions, Spells, Runes or Epic runes — with its
 * title, search box (focused on open) and results; only the results scroll. Seated beside the panel: right of it, or
 * left when the stage has no room on the right, always fully on-stage.
 */

/** Gap between the panel and the flyout, and the minimum margin to the stage edge (stage px). */
export const FLYOUT_GAP = 8;
const EDGE = 8;

/** Where the flyout goes, in stage px: right of the panel when it fits, else left of it; clamped fully on-stage (and
 *  top-aligned with the panel, nudged up when it would run off the bottom). Pure — measured sizes come in. */
export function placeGodFlyout(
  panel: { x: number; y: number; w: number },
  fly: { w: number; h: number },
  vp: { w: number; h: number },
): { x: number; y: number; side: 'right' | 'left' } {
  const rightX = panel.x + panel.w + FLYOUT_GAP;
  const fitsRight = rightX + fly.w <= vp.w - EDGE;
  const side = fitsRight ? 'right' : 'left';
  const rawX = side === 'right' ? rightX : panel.x - FLYOUT_GAP - fly.w;
  const x = Math.round(Math.min(Math.max(EDGE, rawX), Math.max(EDGE, vp.w - fly.w - EDGE)));
  const y = Math.round(Math.min(Math.max(EDGE, panel.y), Math.max(EDGE, vp.h - fly.h - EDGE)));
  return { x, y, side };
}

/** Seat the flyout element beside the panel element (stage px). One layout read of each element, at call time —
 *  never per frame; the panel's drag calls it once per pointer move with sizes cached at drag start. */
export function seatGodFlyout(fly: HTMLElement, panel: { x: number; y: number; w: number }, flySize: { w: number; h: number }): void {
  const p = placeGodFlyout(panel, flySize, stageViewport());
  fly.style.left = `${p.x}px`;
  fly.style.top = `${p.y}px`;
  fly.dataset.side = p.side;
}

type ListProps<T extends { id: string; name: string }> = {
  label: string; rows: readonly T[]; query: string; setQuery: (q: string) => void; onPick: (r: T) => void;
  onHover: (r: T, el: HTMLElement) => void; onLeave: () => void; locked: boolean; owned?: (r: T) => boolean; meta: (r: T) => string;
  onClose: () => void;
  /** The flyout element (the panel's drag moves it too) and the panel it sits beside. */
  flyRef: MutableRefObject<HTMLDivElement | null>;
  panelRef: MutableRefObject<HTMLDivElement | null>;
  panelX: number;
  panelY: number;
  /** Bumps on a stage resize, so the flyout re-seats. */
  stageTick: number;
};

/** The side window. Memoized with stable callbacks so a hover / toast re-render of the panel doesn't re-render every
 *  row of the open list. */
export const GodFlyout = memo(function GodFlyout<T extends { id: string; name: string }>(props: ListProps<T>) {
  const { label, rows, query, setQuery, onPick, onHover, onLeave, locked, owned, meta, onClose, flyRef, panelRef, panelX, panelY, stageTick } = props;
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Focus the search when the flyout opens or switches list.
  useEffect(() => { searchRef.current?.focus({ preventScroll: true }); }, [label]);

  // Seat it beside the panel: on open / switch, when the panel moves (drag release), on a stage resize, and when the
  // result count changes its height. offsetWidth/Height are layout (stage) px.
  useLayoutEffect(() => {
    const fly = flyRef.current;
    const panel = panelRef.current;
    if (!fly || !panel) return;
    const vp = stageViewport();
    fly.style.maxHeight = `${Math.max(120, vp.h - 2 * EDGE)}px`;
    seatGodFlyout(fly, { x: panelX, y: panelY, w: panel.offsetWidth }, { w: fly.offsetWidth, h: fly.offsetHeight });
    fly.style.visibility = 'visible';
  }, [flyRef, panelRef, panelX, panelY, stageTick, label, rows.length]);

  return (
    <div ref={flyRef} className={`godp-fly${locked ? ' inert' : ''}`} style={{ visibility: 'hidden' }} role="dialog" aria-label={`${label} list`}>
      <section className="godp-list" aria-label={label}>
        <div className="godp-fly-head">
          <div className="godp-lh">{label}</div>
          <button type="button" className="godp-fly-x" aria-label={`Close ${label}`} onClick={onClose}>✕</button>
        </div>
        <input ref={searchRef} className="godp-search" value={query} placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label}`}
          onChange={(e) => setQuery(e.target.value)} />
        <div className="godp-rows" onMouseLeave={onLeave}>
          {rows.map((r) => {
            const isOwned = owned?.(r) ?? false;
            return (
              <button key={r.id} type="button" className="godp-row" disabled={locked || isOwned}
                aria-label={isOwned ? `${r.name} (owned)` : r.name}
                onClick={() => { if (!locked && !isOwned) onPick(r); }}
                onMouseEnter={(e) => onHover(r, e.currentTarget)} onFocus={(e) => onHover(r, e.currentTarget)} onBlur={onLeave}>
                <span className="godp-name">{r.name}</span><span className="godp-meta">{isOwned ? 'owned' : meta(r)}</span>
              </button>
            );
          })}
          {rows.length === 0 && <div className="godp-empty">Nothing matches</div>}
        </div>
      </section>
    </div>
  );
}) as <T extends { id: string; name: string }>(p: ListProps<T>) => ReactElement;
