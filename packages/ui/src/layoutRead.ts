import { perfMonitor } from './perfMonitor';

/**
 * LAYOUT READS THAT KNOW THEY ARE LAYOUT READS.
 *
 * `getBoundingClientRect`, `offsetLeft` and `elementFromPoint` each force a synchronous style + layout pass
 * when anything has written a style since the last one. Inside a pointer-move handler that is the worst
 * place for it — a 1000 Hz mouse can turn one read into a reflow of the whole shop per event, which is the
 * strongest lead for the unlabelled 60–119 ms tasks in `docs/perf-handoff-2026-09-17.md` (Mode B). The drag
 * path caches its rects once per drag (`insertRectsRef`) for exactly this reason; these wrappers exist so
 * the reads that REMAIN on a move path are counted rather than assumed away.
 *
 * Each wrapper is the raw call plus `perfMonitor.noteLayoutRead()`, which increments the
 * `layout:read-in-move` counter ONLY while an `input:` span is open (see `isInputLabel` in the monitor). Off
 * the move path — a drop, an effect, a resize — the note is a single branch and nothing is counted. PR 2's
 * acceptance is that a shop session reads `layout:read-in-move: 0`.
 *
 * Route a read through here when it can run from a pointer handler. Reads that only ever run from an effect
 * or a drop are fine as they are; wrapping them costs a call for no information.
 */

/** `el.getBoundingClientRect()`, counted when it lands inside a move handler. */
export function readRect(el: Element): DOMRect {
  perfMonitor.noteLayoutRead();
  return el.getBoundingClientRect();
}

/** `el.offsetLeft` — a layout read too, even though it looks like a property. */
export function readOffsetLeft(el: HTMLElement): number {
  perfMonitor.noteLayoutRead();
  return el.offsetLeft;
}

/** `document.elementFromPoint(x, y)` — a hit test IS a layout read (it needs up-to-date geometry). */
export function elementAtPoint(x: number, y: number): Element | null {
  perfMonitor.noteLayoutRead();
  return document.elementFromPoint(x, y);
}
