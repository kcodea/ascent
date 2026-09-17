import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE POINTER PATH MUST NOT READ LAYOUT OR RE-RENDER `Recruit` (perf 2026-09-17, handoff PR 2).
 *
 * `Recruit` has no render harness, so — like `handRowViews.test.ts` and `chooseOnePreview.test.ts` — this is a
 * SOURCE contract on the drag session in `Recruit.tsx`:
 *
 *   1. The move flush (`flushMove`) and the raw `pointermove` listener (`onMove`) contain NO layout read —
 *      no `getBoundingClientRect`, `elementFromPoint`, `offsetLeft/Top/Width/Height`, `getComputedStyle`.
 *      They hit-test against the rect cache the session measured ONCE at pointerdown (`insertRectsRef`,
 *      `targetRectsRef`, the zone rects). PR 1's `layout:read-in-move` counter must read 0 during a drag; this
 *      is the static half of that guarantee.
 *   2. The move flush writes the decision to `dragStore` and never to React state in `Recruit`: no `useState`
 *      setter is called from it. A pointermove re-renders the row whose gap moved, not the shop screen.
 *   3. The session measures its caches (and the FLIP baseline) at start, where the reads belong.
 */
const RECRUIT = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');
const LAYOUT_READS = /getBoundingClientRect|elementFromPoint|\.offset(?:Left|Top|Width|Height)|getComputedStyle|getClientRects/;

function block(src: string, startMarker: string, endMarker: string): string {
  const i = src.indexOf(startMarker);
  expect(i, `${startMarker} exists`).toBeGreaterThan(-1);
  const j = src.indexOf(endMarker, i);
  expect(j, `${endMarker} follows`).toBeGreaterThan(i);
  return src.slice(i, j);
}

describe('the drag session (Recruit.tsx source contract)', () => {
  const session = block(RECRUIT, 'const startDragSession = (drag: DragState, touch: boolean): void => {', 'startDragSessionRef.current = startDragSession;');
  const flush = block(session, "const flushMove = (): void => { perfMonitor.measure('drag:flushMove', () => {", 'const onMove = (e: PointerEvent): void => {');
  const onMove = block(session, 'const onMove = (e: PointerEvent): void => {', '/** Tear the session down');

  it('the move flush reads no layout — it hit-tests the per-drag rect cache', () => {
    expect(LAYOUT_READS.test(flush), 'no layout read inside flushMove').toBe(false);
    expect(flush.includes('zoneAtCached('), 'the zone comes from the cached zone rects').toBe(true);
    expect(flush.includes('decOf('), 'the decision is the pure derivation over the cache-backed geometry').toBe(true);
    expect(session.includes('deriveDragDecision({')).toBe(true);
  });

  it('the raw pointermove listener reads no layout and only schedules the flush', () => {
    expect(LAYOUT_READS.test(onMove)).toBe(false);
    expect(onMove.includes('dragStore.pos = { x: e.clientX, y: e.clientY }')).toBe(true);
    expect(onMove.includes('requestAnimationFrame(flushMove)')).toBe(true);
  });

  it('the move flush publishes to dragStore, never to Recruit state', () => {
    expect(flush.includes('publish(')).toBe(true);
    // A bare `setX(` is a React setter; `pixiFx.setAimLine(` / `dragStore.set(` are method calls and allowed.
    expect(/(?<![.\w])set[A-Z]\w*\(/.test(flush), 'no React setState from the move flush').toBe(false);
  });

  it('the session measures its caches once, at start', () => {
    const start = session.slice(0, session.indexOf('const flushMove'));
    expect(start.includes('insertRectsRef.current = {')).toBe(true);
    expect(start.includes('targetRectsRef.current =')).toBe(true);
    expect(start.includes('flipStateRef.current = Flip.getState(FLIP_SELECTOR, { simple: true })')).toBe(true);
    expect(start.includes("document.querySelectorAll<HTMLElement>('[data-zone]')")).toBe(true);
  });

  it('the pointer state lives in dragStore: Recruit holds no useState for it', () => {
    for (const decl of ['[drag, setDrag]', '[overZone, setOverZone]', '[sellTop, setSellTop]', '[buyTop, setBuyTop]', '[snapping, setSnapping]', '[magSlide, setMagSlide]', '[magTargetUid, setMagTargetUid]', '[aimTargetUid, setAimTargetUid]']) {
      expect(RECRUIT.includes(decl), `${decl} is gone`).toBe(false);
    }
    expect(RECRUIT.includes('useState<DragState')).toBe(false);
    expect(RECRUIT.includes("useDragSlice(selectTavernDrag)")).toBe(true);
    expect(RECRUIT.includes("useDragSlice(selectWarbandDrag)")).toBe(true);
    expect(RECRUIT.includes("useDragSlice(selectHandDrag)")).toBe(true);
  });

  it('the FLIP animation calls take the simple path (no per-card global matrix)', () => {
    const froms = RECRUIT.match(/Flip\.from\([^;]*?\);/gs) ?? [];
    expect(froms.length).toBeGreaterThanOrEqual(2);
    for (const f of froms) {
      if (f.includes('absolute: true')) continue; // the Choose One coalesce crosses containers — full path by design
      expect(f.includes('simple: true'), `simple on: ${f.slice(0, 60)}`).toBe(true);
    }
  });
});
