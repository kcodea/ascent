import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * LAZY + PAUSED LIST ROWS for the Social pages (perf 2026-10-09, owner: "our social tab takes forever to load and is
 * also laggy").
 *
 * A Career match banner, a Recent Games row and a Hall row each render a full final team: seven real `Card`s with
 * their keyword FX (Reborn wisps, Ward glass, spinning rings, shards), every one a looping CSS animation. The Career
 * mounted all 25 banners at once: 752 running animations, so the page idled at ~24 ms a frame (a blank page is 4.2 ms
 * at 240 Hz), every scroll frame went over 20 ms, and a tab switch back to Match History re-mounted all 175 cards
 * (~55 ms). Recent Games was the same (821 animations).
 *
 * Two things, both driven by ONE IntersectionObserver per list (no layout is read; the observer does the geometry):
 *
 *  - LAZY MOUNT: a row renders its content only once it comes within `MARGIN` of the scroller's viewport (the first
 *    `eager` rows at once, so a page never opens on empty slots). Pending rows are an empty box with a reserved height
 *    (`.lazy-row.is-pending`, `--lazy-h`), so the scrollbar stays honest. Mounts drain one per frame, so a fling
 *    never commits a screenful of cards in one frame. Once mounted a row stays mounted.
 *  - PAUSE WHEN FAR: a mounted row that leaves that margin gets `.is-far` (set on the element directly, never a React
 *    render), which pauses its looping animations; they resume before it scrolls back into view, so nobody sees the
 *    pause. Nothing is contained or hidden, so tooltips and glows paint exactly as before. (`content-visibility:
 *    hidden` was tried first: cheaper at idle, but every row coming back cost a ~290 ms frame on the Hall.)
 *
 * The same pattern as the Compendium's `bookLazy.tsx`, plus the far pause. Without IntersectionObserver (jsdom tests,
 * old engines) every row mounts at once, as before.
 */

const HAS_IO = typeof IntersectionObserver !== 'undefined';
/** How far beyond the visible scroller a row mounts / resumes: just over half a screen either way. */
const MARGIN = '60% 0px 60% 0px';
/** Pending rows mounted per frame. A banner of seven cards costs a few ms to mount in prod. */
const MOUNTS_PER_FRAME = 1;

interface Watch { mount: (() => void) | null; el: HTMLElement }
interface LazyRoot { observe(el: HTMLElement, mount: (() => void) | null): () => void }

const LazyRootCtx = createContext<LazyRoot | null>(null);

function makeLazyRoot(root: Element): LazyRoot & { disconnect(): void } {
  const watched = new Map<Element, Watch>();
  const queue: Array<() => void> = [];
  let raf = 0;
  const drain = (): void => {
    raf = 0;
    for (const m of queue.splice(0, MOUNTS_PER_FRAME)) m();
    if (queue.length) raf = requestAnimationFrame(drain);
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const w = watched.get(e.target);
      if (!w) continue;
      if (e.isIntersecting) {
        w.el.classList.remove('is-far');
        if (w.mount) { queue.push(w.mount); w.mount = null; }
      } else if (!w.mount) {
        w.el.classList.add('is-far');
      }
    }
    if (queue.length && !raf) raf = requestAnimationFrame(drain);
  }, { root, rootMargin: MARGIN });
  return {
    observe(el, mount) {
      const w: Watch = { mount, el };
      watched.set(el, w);
      io.observe(el);
      return () => {
        watched.delete(el);
        io.unobserve(el);
        el.classList.remove('is-far');
        const i = w.mount ? queue.indexOf(w.mount) : -1;
        if (i >= 0) queue.splice(i, 1);
      };
    },
    disconnect() { io.disconnect(); watched.clear(); queue.length = 0; if (raf) cancelAnimationFrame(raf); },
  };
}

/** The nearest element at or above `el` that scrolls vertically (the list may scroll itself, or a page body may,
 *  depending on the layout breakpoint). Read once per list mount and on resize, never per frame. */
function scrollParentOf(el: HTMLElement): Element | null {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if (oy === 'auto' || oy === 'scroll') return n;
  }
  return null;
}

/**
 * Provides the lazy root for the rows inside the list element `list` (pass the element via a callback ref). The
 * observer roots on the list's scroll parent and is rebuilt if a resize moves the scrolling to another element.
 */
export function LazyRowsProvider({ list, children }: { list: HTMLElement | null; children: ReactNode }) {
  const [root, setRoot] = useState<Element | null>(null);
  useEffect(() => {
    if (!list || !HAS_IO) return undefined;
    // `getComputedStyle` right after the list mounted would force a full style recalc of the fresh page (measured
    // 25-46 ms on the Career open). After the frame has painted the styles are clean and the read is free, so the
    // root is picked then; until it exists only the eager rows are mounted, which is what the first frame shows.
    let raf = 0, timer = 0;
    const pick = (): void => setRoot(scrollParentOf(list));
    const later = (): void => { cancelAnimationFrame(raf); window.clearTimeout(timer); raf = requestAnimationFrame(() => { timer = window.setTimeout(pick, 0); }); };
    later();
    window.addEventListener('resize', later);
    return () => { window.removeEventListener('resize', later); cancelAnimationFrame(raf); window.clearTimeout(timer); };
  }, [list]);
  const lazy = useMemo(() => (root && HAS_IO ? makeLazyRoot(root) : null), [root]);
  useEffect(() => () => lazy?.disconnect(), [lazy]);
  return <LazyRootCtx.Provider value={lazy}>{children}</LazyRootCtx.Provider>;
}

/**
 * One list row: renders `children` once near the viewport (or at once when `eager`, or with no observer), and is
 * paused while far away. `className` names the list's row box (its reserved height comes from CSS).
 */
export function LazyRow({ eager, children, className = '' }: { eager: boolean; children: () => ReactNode; className?: string }) {
  const lazy = useContext(LazyRootCtx);
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(eager || !HAS_IO);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    if (!lazy || !ref.current) return undefined;
    // A row stays observed after it mounts, for the far pause; `shown` is read through the ref, not a dep.
    return lazy.observe(ref.current, shownRef.current ? null : () => setShown(true));
  }, [lazy]);
  return (
    <div ref={ref} className={`lazy-row${className ? ` ${className}` : ''}${shown ? '' : ' is-pending'}`}>
      {shown ? children() : null}
    </div>
  );
}
