import { readRect } from './layoutRead';

/**
 * CACHED HIT-TESTING FOR AN AIM (perf report 2026-09-30).
 *
 * The hero-power / Equipment aim and the Battlecry / Choose One target aim used to resolve "which minion is
 * under the pointer" with `document.elementFromPoint` on every rAF-coalesced move and on release. A hit test IS
 * a layout read, and inside a move handler it forces a style + layout pass whenever anything wrote a style
 * since the last frame: the owner's 33-minute capture counted 1,813 of them (`layout:read-in-move`).
 *
 * This is the drag path's `insertRectsRef` / `targetRectsRef` pattern for the aims: the candidate cards are
 * measured ONCE when the aim starts, re-measured on `resize` and on a slow timer (a card can still be gliding
 * from a FLIP when the aim is armed, and a roll can replace the tavern mid-aim), and every move hit-tests
 * plain numbers. Every refresh runs from a timer / resize, never inside an `input:` span, so the move path
 * reads no layout at all.
 */
export interface AimRectCache {
  /** The uid of the cached card under the point, or null. Pure arithmetic: no layout read. */
  hit(x: number, y: number): string | null;
  /** Re-measure now (outside any input handler). */
  refresh(): void;
  /** Stop the timer and the resize listener. Idempotent. */
  dispose(): void;
}

interface Entry { uid: string; left: number; top: number; right: number; bottom: number }

/** How often the cache re-measures while an aim is live. Slow enough to be free, fast enough that a card which
 *  was still gliding when the aim armed is hit-testable at its resting place well before a human can reach it. */
export const AIM_RECT_REFRESH_MS = 200;

/** PURE: the uid of the entry containing (x, y). Later entries win, matching paint order for siblings. */
export function hitEntries(entries: readonly Entry[], x: number, y: number): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (x >= e.left && x <= e.right && y >= e.top && y <= e.bottom) return e.uid;
  }
  return null;
}

export function createAimRectCache(selector: string): AimRectCache {
  let entries: Entry[] = [];
  let timer = 0;
  let disposed = false;
  const refresh = (): void => {
    if (disposed || typeof document === 'undefined') return;
    const next: Entry[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const uid = el.getAttribute('data-uid');
      if (!uid) continue;
      const r = readRect(el);
      if (!(r.width > 0) || !(r.height > 0)) continue;
      next.push({ uid, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    entries = next;
  };
  const onResize = (): void => refresh();
  refresh();
  if (typeof window !== 'undefined') {
    timer = window.setInterval(refresh, AIM_RECT_REFRESH_MS);
    window.addEventListener('resize', onResize);
  }
  return {
    hit: (x, y) => hitEntries(entries, x, y),
    refresh,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (typeof window !== 'undefined') {
        window.clearInterval(timer);
        window.removeEventListener('resize', onResize);
      }
      entries = [];
    },
  };
}
