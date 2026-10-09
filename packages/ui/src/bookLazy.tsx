import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * LAZY GALLERY CELLS for the Compendium (perf pass 2026-10-09, owner: "performance is horrible still").
 *
 * The book used to mount every card of a tab at once: 144 full plated cards, each about ten large images with
 * drop-shadow and blur filters plus a gilded-name SVG filter whose fitter reads layout. That cost ~150 ms of script on
 * open (prod; ~500 ms in dev) and the same again on every tab switch or search keystroke.
 *
 * Now a cell mounts its card only when it comes within reach of the gallery's viewport (an IntersectionObserver rooted
 * on the scroller, with a margin of two screens), and stays mounted after that. The first rows mount
 * eagerly so the book never opens on empty slots. Mounts are drained a few per frame, so a fast fling never commits
 * twenty cards in one frame. No layout is read: the observer does the geometry off the main thread.
 *
 * A pending cell is an empty box with a reserved height (CSS, `.book-cell.is-pending`), so the scrollbar stays honest
 * and the grid rows keep their shape; Chrome's scroll anchoring absorbs the small height change when it fills.
 */

type Mount = () => void;
interface LazyRoot { observe(el: Element, mount: Mount): () => void }

const LazyRootCtx = createContext<LazyRoot | null>(null);

/** Without IntersectionObserver (jsdom tests, very old engines) every cell simply mounts at once, as before. */
const HAS_IO = typeof IntersectionObserver !== 'undefined';

/** How many pending cells may mount in one frame. A plated card costs ~1-2 ms to mount in prod; two a frame keeps a fast fling under budget even at 240 Hz. */
const MOUNTS_PER_FRAME = 2;

function makeLazyRoot(root: HTMLElement): LazyRoot & { disconnect(): void } {
  const mounts = new Map<Element, Mount>();
  const queue: Mount[] = [];
  let raf = 0;
  const drain = (): void => {
    raf = 0;
    for (const m of queue.splice(0, MOUNTS_PER_FRAME)) m();
    if (queue.length) raf = requestAnimationFrame(drain);
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const m = mounts.get(e.target);
      if (!m) continue;
      mounts.delete(e.target);
      io.unobserve(e.target);
      queue.push(m);
    }
    if (queue.length && !raf) raf = requestAnimationFrame(drain);
  }, { root, rootMargin: '200% 0px 200% 0px' });
  return {
    observe(el, mount) {
      mounts.set(el, mount);
      io.observe(el);
      return () => { mounts.delete(el); io.unobserve(el); const i = queue.indexOf(mount); if (i >= 0) queue.splice(i, 1); };
    },
    disconnect() { io.disconnect(); mounts.clear(); queue.length = 0; if (raf) cancelAnimationFrame(raf); },
  };
}

/** Provides the lazy root for the cells inside `root` (the gallery scroller). */
export function LazyRootProvider({ root, children }: { root: HTMLElement | null; children: ReactNode }) {
  const lazy = useMemo(() => (root && HAS_IO ? makeLazyRoot(root) : null), [root]);
  useEffect(() => () => lazy?.disconnect(), [lazy]);
  return <LazyRootCtx.Provider value={lazy}>{children}</LazyRootCtx.Provider>;
}

/** A gallery cell that renders `children` only once it is near the viewport (or at once when `eager`). */
export function LazyCell({ eager, children, className = 'book-cell' }: { eager: boolean; children: () => ReactNode; className?: string }) {
  const root = useContext(LazyRootCtx);
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(eager || !HAS_IO);
  useEffect(() => {
    if (shown || !root || !ref.current) return undefined;
    return root.observe(ref.current, () => setShown(true));
  }, [shown, root]);
  return (
    <div ref={ref} className={`${className}${shown ? '' : ' is-pending'}`}>
      {shown ? children() : null}
    </div>
  );
}

/** How many cells to mount eagerly: the rows that fill the first screen at the current zoom, from the window size alone (no layout read).
 *  Mirrors `.book-grid`'s column metric: --ch = clamp(233px, 28.6vh, 304px) x zoom, column ≈ 0.752 x --ch + 44px. */
export function eagerCellCount(zoom: number): number {
  if (typeof window === 'undefined') return 12;
  const ch = Math.min(304, Math.max(233, window.innerHeight * 0.286)) * zoom;
  const col = ch * 0.752 + 44;
  const gridW = Math.min(2300, window.innerWidth * 0.95) - 300;
  const cols = Math.max(1, Math.floor(gridW / col));
  // The gallery's visible height is the window's 93% less the header, tier row and frame (~260px); a row is ~1.9 x --ch.
  const rows = Math.max(1, Math.ceil((Math.min(1450, window.innerHeight * 0.93) - 260) / (ch * 1.9)));
  return cols * rows;
}
