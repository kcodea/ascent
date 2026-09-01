import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A DRAG SURVIVES OUR OWN RE-RENDERS, AND A CANCEL IS NOT A DROP.
 *
 * Owner report 2026-09-01: *"occasionally, dragging a shop minion around in the shop will have it snap back
 * into place, and im not sure why it does it. it's very jarring when it happens."*
 *
 * Two defects, either of which produces exactly that:
 *
 *  1. **Capture was taken on the CARD.** Pointer capture dies with its element, so any re-render that
 *     replaces that node — the shop row swaps a `<Card>` for a held-slot `<div>` under the same key, a card
 *     is consumed out from under the gesture — releases it and fires `pointercancel`. The gesture ended
 *     through no fault of the player's.
 *  2. **`pointercancel` was wired straight to `onUp`,** so that interruption ran the FULL drop resolution:
 *     it picked a zone from wherever the pointer happened to be and either committed an action the player
 *     never finished, or — over the shop, which is not a drop target — played the invalid-drop SNAP. That
 *     snap is the jarring bounce, arriving with no release to explain it.
 *
 * Both are read from source because the failure is structural: no unit test of the handlers can see which
 * ELEMENT holds the capture or which listener a browser event is wired to, and those are the two facts.
 */
const RECRUIT = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');

describe('drag robustness', () => {
  it('captures the pointer on a node React never replaces', () => {
    const line = RECRUIT.split('\n').find((l) => l.includes('.setPointerCapture('));
    expect(line, 'the drag still captures the pointer').toBeTruthy();
    expect(line!.includes('document.body.setPointerCapture'),
      `capture must not ride an element a re-render can unmount: ${line!.trim()}`).toBe(true);
  });

  it('treats pointercancel as an ABORT, never as a drop', () => {
    expect(RECRUIT.includes("window.addEventListener('pointercancel', onCancel)"),
      'cancel has its own handler').toBe(true);
    expect(RECRUIT.includes("window.addEventListener('pointercancel', onUp)"),
      'and is NOT wired to the drop resolver').toBe(false);
  });

  it('the abort dispatches nothing and animates no snap', () => {
    const i = RECRUIT.indexOf('const onCancel = ()');
    expect(i, 'the abort exists').toBeGreaterThan(-1);
    const body = RECRUIT.slice(i, RECRUIT.indexOf('};', i));
    expect(/dispatch\(/.test(body), 'an interrupted gesture must not commit an action').toBe(false);
    expect(/setSnapping\(/.test(body),
      'and must not play the invalid-drop bounce — the card never went anywhere').toBe(false);
    expect(body.includes('setDrag(null)'), 'but it does end the drag cleanly').toBe(true);
  });

  it('the cleanup unregisters the same handler it registered', () => {
    // A mismatched remove leaves a live listener on every drag — the leak this pair is easy to get wrong in.
    expect(RECRUIT.includes("window.removeEventListener('pointercancel', onCancel)")).toBe(true);
  });
});
