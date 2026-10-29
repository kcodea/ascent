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
 *   3. The session measures its caches at start, where the reads belong.
 *   4. A drag commit (a slot crossing, the lift collapse) runs no GSAP Flip and reads no layout in `RowFlip`
 *      (R-PHONE-DRAG-02, owner 2026-10-29: "stuttering trying to catch up"): the parting is the cards' own CSS
 *      transition. The old per-crossing `Flip.from` + `Flip.getState` never showed (the capture completed the flip
 *      it had just started) and cost two forced style + layout passes per crossing.
 */
const RECRUIT = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');
const STAGE_FLIP = readFileSync(join(__dirname, 'stageFlip.ts'), 'utf8');
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
  const flush = block(session, "const flushMove = (): void => { perfMonitor.measure('drag:flushMove', () => {", 'const onMove = (e: PointerEvent): void => ');
  const onMove = block(session, 'const onMove = (e: PointerEvent): void => ', '/** Tear the session down');

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
    // No FLIP baseline: the drag's parting is CSS (R-PHONE-DRAG-02), so nothing is captured for it.
    expect(start.includes('getSimpleState('), 'no Flip capture at drag start').toBe(false);
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
    // The row slides go through stageFlip's `fromSimpleState` (Flip.from simple at EVERY scale; a scaled stage only
    // rescales the recorded offsets to layout px); any direct Flip.from left must still be simple, bar the coalesce.
    expect((RECRUIT.match(/fromSimpleState\(/g) ?? []).length).toBeGreaterThanOrEqual(1);
    const froms = RECRUIT.match(/Flip\.from\([^;]*?\);/gs) ?? [];
    for (const f of froms) {
      if (f.includes('absolute: true')) continue; // the Choose One coalesce crosses containers — full path by design
      expect(f.includes('simple: true'), `simple on: ${f.slice(0, 60)}`).toBe(true);
    }
    expect(STAGE_FLIP.includes('Flip.getState(targets, { simple: true })')).toBe(true);
    expect(STAGE_FLIP.includes('Flip.from(state, { ...vars, simple: true })')).toBe(true);
  });
});

describe('R-PHONE-DRAG-02: a drag commit runs no Flip and reads no layout (Recruit.tsx source contract)', () => {
  const rowFlip = block(RECRUIT, 'const RowFlip = memo(function RowFlip(', '\nconst selectOverlayDrag');
  const flipEffect = block(rowFlip, "perfMonitor.measure('layout:flip', () => {", '}, [flipKey]);');
  const dragBranch = block(flipEffect, 'if (draggingNow) {', '} else if (handPlaySnapRef.current) {');

  it('the dragging branch of the row FLIP writes and reads nothing', () => {
    // Comments may NAME the old calls; the branch must hold no statement at all.
    const code = dragBranch.slice('if (draggingNow) {'.length).split(/\r?\n/)
      .map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean);
    expect(code, 'only comments inside the dragging branch').toEqual([]);
  });

  it('no Flip state is captured for the drag anywhere in the row runner', () => {
    expect(rowFlip.includes('getSimpleState('), 'no Flip.getState capture in RowFlip').toBe(false);
    expect(rowFlip.includes('fromSimpleState('), 'no Flip.from in RowFlip').toBe(false);
    expect(RECRUIT.includes('flipStateRef'), 'the drag FLIP baseline ref is gone').toBe(false);
  });

  it('the offsetLeft sweep stays off during a drag (it is the committed-move baseline only)', () => {
    expect(flipEffect.includes("if (!draggingNow) perfMonitor.measure('layout:flip:read'")).toBe(true);
  });

  it("the parting is the cards' own CSS transition while body.dragging is on", () => {
    const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');
    expect(css).toMatch(/body\.dragging \.zone\[data-zone='warband'\] \.card,\s*body\.dragging \.zone\[data-zone='tavern'\] \.card \{ transition: transform [^}]*!important; \}/);
  });
});
