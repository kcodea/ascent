/**
 * THE GAME SCROLLBAR (R-UI-SCROLLBAR-01, owner 2026-10-30: "any way you can make the scroll bar look more in our style").
 *
 * A native scrollbar (even a styled `::-webkit-scrollbar`) forces the OS arrow cursor and draws the grey OS bar with
 * arrow buttons, so scroll areas hide it (styles.css). `GameScroll` puts a slim bar of our own back: a rounded gold
 * thumb on a faint dark track, no arrows.
 *
 *  - Wheel, trackpad and touch scrolling are the browser's own (the view is an ordinary `overflow: auto` box).
 *  - Drag the thumb (the open gauntlet, the closed hand while held) to scroll; press the track to jump there.
 *  - No overflow, no bar. A touch screen shows no bar (a finger scrolls the list itself).
 *
 * USE: `<GameScroll className="my-list" outerClassName="my-list-wrap" viewRef={ref} ...props>children</GameScroll>`.
 * The outer box takes the list's place in its parent's layout (give it the flex / margin rules); the inner view is the
 * scroller and receives `className`, `viewRef` and every other prop (role, aria, onScroll...). `axis="x"` for a strip.
 *
 * COST (CLAUDE.md, docs/performance.md): sizes are measured only when the view or its content changes size
 * (ResizeObserver on the view and its direct children, re-armed when children come and go). A scroll reads
 * `scrollTop` once and writes the thumb's `transform`; nothing lays out. A drag or a track press reads the track's
 * rect once, at the press. Nothing loops.
 */
import { useCallback, useEffect, useRef, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref, type RefObject } from 'react';
import './gameScroll.css';

export type ScrollAxis = 'x' | 'y';

/** The smallest thumb (px along the track), so a very long list still has something to grab. */
export const MIN_THUMB = 24;

/** The thumb's length and travel for a view: `null` when the content fits (no bar). Pure: the tests drive it. */
export function thumbMetrics(view: number, content: number, track: number): { size: number; travel: number; range: number } | null {
  const range = content - view;
  if (range < 1 || view <= 0 || track <= 0) return null;
  const size = Math.min(track, Math.max(MIN_THUMB, Math.round((track * view) / content)));
  return { size, travel: track - size, range };
}

/** Where the thumb sits (px from the track's start) at a scroll offset. */
export function thumbOffset(scroll: number, m: { travel: number; range: number }): number {
  const f = m.range > 0 ? Math.min(1, Math.max(0, scroll / m.range)) : 0;
  return f * m.travel;
}

/** The scroll offset that centres the thumb on a press `at` px along the track. */
export function scrollForTrackPress(at: number, m: { size: number; travel: number; range: number }): number {
  if (m.travel <= 0) return 0;
  const f = Math.min(1, Math.max(0, (at - m.size / 2) / m.travel));
  return f * m.range;
}

/**
 * The hook behind `GameScroll`: wires a scroll view, its track and its thumb. Exported so a scroll area whose markup
 * cannot take the wrapper can still adopt the bar.
 */
export function useGameScrollbar(view: RefObject<HTMLElement>, track: RefObject<HTMLElement>, thumb: RefObject<HTMLElement>, outer: RefObject<HTMLElement>, axis: ScrollAxis = 'y'): {
  onTrackDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onThumbDown: (e: ReactPointerEvent<HTMLElement>) => void;
} {
  const metrics = useRef<ReturnType<typeof thumbMetrics>>(null);
  const drag = useRef<{ id: number; start: number; scroll: number; perPx: number } | null>(null);
  const y = axis === 'y';

  useEffect(() => {
    const v = view.current;
    const t = track.current;
    const th = thumb.current;
    const o = outer.current;
    if (!v || !t || !th || !o) return undefined;
    const pos = (): number => (y ? v.scrollTop : v.scrollLeft);
    const paint = (): void => {
      const m = metrics.current;
      if (!m) return;
      const at = thumbOffset(pos(), m);
      th.style.transform = y ? `translateY(${at}px)` : `translateX(${at}px)`;
    };
    const measure = (): void => {
      const m = y ? thumbMetrics(v.clientHeight, v.scrollHeight, t.clientHeight) : thumbMetrics(v.clientWidth, v.scrollWidth, t.clientWidth);
      metrics.current = m;
      o.classList.toggle('over', !!m);
      if (!m) return;
      if (y) th.style.height = `${m.size}px`; else th.style.width = `${m.size}px`;
      paint();
    };
    v.addEventListener('scroll', paint, { passive: true });
    measure();
    if (typeof ResizeObserver === 'undefined') return () => v.removeEventListener('scroll', paint);
    const ro = new ResizeObserver(measure);
    const watch = (): void => {
      ro.disconnect();
      ro.observe(v);
      ro.observe(t);
      for (const c of Array.from(v.children)) ro.observe(c);
    };
    watch();
    // Children come and go (a message, a friend row): watch the new ones (their size is the content's size).
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => { watch(); measure(); });
    mo?.observe(v, { childList: true });
    return () => { v.removeEventListener('scroll', paint); ro.disconnect(); mo?.disconnect(); };
  }, [view, track, thumb, outer, y]);

  const setPos = (n: number): void => {
    const v = view.current;
    if (!v) return;
    if (y) v.scrollTop = n; else v.scrollLeft = n;
  };
  const start = (e: ReactPointerEvent<HTMLElement>, el: HTMLElement): void => {
    const m = metrics.current;
    const t = track.current;
    const v = view.current;
    if (!m || !t || !v) return;
    // One rect read per press: screen px per track px (the stage and the panels may be scaled or zoomed).
    const r = t.getBoundingClientRect();
    const screenLen = y ? r.height : r.width;
    const len = y ? t.clientHeight : t.clientWidth;
    const scale = len > 0 && screenLen > 0 ? screenLen / len : 1;
    drag.current = { id: e.pointerId, start: y ? e.clientY : e.clientX, scroll: y ? v.scrollTop : v.scrollLeft, perPx: m.travel > 0 ? m.range / (m.travel * scale) : 0 };
    try { el.setPointerCapture(e.pointerId); } catch { /* the pointer already went */ }
    outer.current?.classList.add('dragging');
    const move = (ev: PointerEvent): void => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.id) return;
      setPos(d.scroll + ((y ? ev.clientY : ev.clientX) - d.start) * d.perPx);
    };
    const up = (ev: PointerEvent): void => {
      if (drag.current && ev.pointerId !== drag.current.id) return;
      drag.current = null;
      outer.current?.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  };
  const guard = (e: ReactPointerEvent<HTMLElement>): boolean => {
    // The bar never starts a window move or presses what sits under it.
    e.stopPropagation();
    if (e.button !== 0) return false;
    e.preventDefault();
    return true;
  };
  return {
    onThumbDown: (e) => { if (guard(e)) start(e, e.currentTarget); },
    onTrackDown: (e) => {
      if (!guard(e) || e.target !== e.currentTarget) return;
      const m = metrics.current;
      const t = track.current;
      if (!m || !t) return;
      const r = t.getBoundingClientRect();
      const len = y ? t.clientHeight : t.clientWidth;
      const screenLen = y ? r.height : r.width;
      const at = screenLen > 0 ? (((y ? e.clientY - r.top : e.clientX - r.left) * len) / screenLen) : 0;
      setPos(scrollForTrackPress(at, m));
      // Keep holding to drag on from there.
      if (thumb.current) start(e, e.currentTarget);
    },
  };
}

type Props = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
  /** The outer box's class: it takes the list's place in its parent's layout. */
  outerClassName?: string;
  /** The scroll view itself (for a caller that scrolls it, e.g. "stay at the newest message"). */
  viewRef?: Ref<HTMLDivElement>;
  axis?: ScrollAxis;
};

export function GameScroll({ children, outerClassName, viewRef, axis = 'y', className, ...rest }: Props): JSX.Element {
  const outer = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const { onTrackDown, onThumbDown } = useGameScrollbar(view, track, thumb, outer, axis);
  const setView = useCallback((el: HTMLDivElement | null): void => {
    view.current = el;
    if (typeof viewRef === 'function') viewRef(el);
    else if (viewRef) (viewRef as { current: HTMLDivElement | null }).current = el;
  }, [viewRef]);
  return (
    <div ref={outer} className={`gscroll gscroll-${axis}${outerClassName ? ` ${outerClassName}` : ''}`}>
      <div ref={setView} className={`gscroll-view${className ? ` ${className}` : ''}`} {...rest}>{children}</div>
      <div ref={track} className="gscroll-track" aria-hidden="true" onPointerDown={onTrackDown}>
        <div ref={thumb} className="gscroll-thumb" onPointerDown={onThumbDown} />
      </div>
    </div>
  );
}
