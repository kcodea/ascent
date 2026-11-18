import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A DROP READS ITS RECTS BEFORE THE DRAG'S BODY CLASS COMES OFF (R-PERF-APM-03, perf 2026-11-18).
 *
 * `body.dragging` gates a set of descendant rules, so taking it off dirties style for the whole page. The release
 * handler already knew that (the 2026-10-09 note on `placeBox`): it reads the row snapshot and the drag card's box
 * first. But `applyDrop`, which runs AFTER the class is removed, read two more rects (the played card's plate for its
 * dissolve, the Gold pill for a sale's coins), and each of those reads forced that whole restyle synchronously inside
 * the pointerup handler: 4 to 5 ms on an engine board, on every play and every sale (CPU profile of
 * `npm run perf:apm`, 2026-11-18).
 *
 * `Recruit` has no render harness, so this is a SOURCE contract, like `dragSession.test.ts`: both rects are read into
 * `dropRectsRef` before the class removal, and the two consumers take them from there.
 */
const RECRUIT = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');

describe('a drop reads layout before the drag class comes off (Recruit.tsx source contract)', () => {
  const up = RECRUIT.indexOf("const onUp = (e: PointerEvent): void => perfMonitor.measure('input:pointerup', () => {");
  const classOff = RECRUIT.indexOf("document.body.classList.remove('dragging'); // cursor reverts on release", up);
  const apply = RECRUIT.indexOf('const acted = applyDropRef.current(d, zone, e.clientX, e.clientY);', up);

  it('finds the release handler, the class removal and the drop', () => {
    expect(up).toBeGreaterThan(-1);
    expect(classOff).toBeGreaterThan(up);
    expect(apply).toBeGreaterThan(classOff);
  });

  it('reads the plate and the Gold pill into dropRectsRef BEFORE the class comes off', () => {
    const before = RECRUIT.slice(up, classOff);
    expect(before.includes('dropRectsRef.current = {'), 'the pre-read sits before the class removal').toBe(true);
    expect(before.includes("document.querySelector<HTMLElement>('.dragcard .cardplate')?.getBoundingClientRect()")).toBe(true);
    expect(before.includes("document.querySelector<HTMLElement>('.goldpill')?.getBoundingClientRect()")).toBe(true);
  });

  it('reads no layout between the class removal and the drop', () => {
    const between = RECRUIT.slice(classOff, apply);
    // The magnetic merge's own target read is inside its `if (magMech ...)` branch, a different (rare) drop.
    const beforeMagnet = between.slice(0, between.indexOf('// Magnetic merge:'));
    expect(/getBoundingClientRect|getComputedStyle|offset(?:Left|Top|Width|Height)/.test(beforeMagnet)).toBe(false);
  });

  it('the sale and the play take their rect from the pre-read, and only measure when there is none (a spectator)', () => {
    expect(RECRUIT.includes("dropRectsRef.current.gold !== undefined ? dropRectsRef.current.gold : document.querySelector('.goldpill')?.getBoundingClientRect() ?? null")).toBe(true);
    expect(RECRUIT.includes("dropRectsRef.current.plate !== undefined ? dropRectsRef.current.plate : document.querySelector<HTMLElement>('.dragcard .cardplate')?.getBoundingClientRect() ?? null")).toBe(true);
    // ...and the pre-read is spent once the drop has resolved, so it can never serve a later action.
    const after = RECRUIT.slice(apply, apply + 400);
    expect(after.includes('dropRectsRef.current = NO_DROP_RECTS;')).toBe(true);
  });
});
