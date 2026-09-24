/**
 * THE CAST PREVIEW store + placement (owner ask 2026-09-23): fade in, linger ~2 s, fade out; a same-source
 * recast REPLACES its live preview (and restarts the linger), different sources stack side by side; a
 * newcomer is nudged off a live neighbour and clamped on-screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { castSourceKey, clearCastPreviews, getCastPreviews, placeCastPreview, showCastPreview, subscribeCastPreviews } from './castPreview';
import { castPreviewTimings, resetCastPreviewConfig, setCastPreviewValue } from './castPreviewConfig';

const anchor = { left: 100, top: 300, width: 80, height: 120 };
const { fadeIn, linger, fadeOut } = castPreviewTimings('shop');

beforeEach(() => { vi.useFakeTimers(); clearCastPreviews(); resetCastPreviewConfig(); });
afterEach(() => { clearCastPreviews(); resetCastPreviewConfig(); vi.useRealTimers(); });

describe('showCastPreview — the clock', () => {
  it('a cast shows its spell, lingers ~2 s, then fades out and leaves', () => {
    showCastPreview({ sourceKey: 'rw', spellId: 'lasso', anchor });
    expect(getCastPreviews()).toMatchObject([{ sourceKey: 'rw', spellId: 'lasso', count: 1, leaving: false }]);
    vi.advanceTimersByTime(fadeIn + linger - 1);
    expect(getCastPreviews()[0]!.leaving).toBe(false);
    vi.advanceTimersByTime(1);
    expect(getCastPreviews()[0]!.leaving).toBe(true); // the fade-out has begun
    vi.advanceTimersByTime(fadeOut);
    expect(getCastPreviews()).toEqual([]);
  });

  it('the linger is about two seconds (the owner\x27s number), with a hover-style fade either side', () => {
    expect(linger).toBe(2000);
    expect(fadeIn).toBeGreaterThan(0);
    expect(fadeOut).toBeGreaterThan(0);
  });

  it('casts from DIFFERENT sources stack side by side — one preview each', () => {
    showCastPreview({ sourceKey: 'rw', spellId: 'lasso', anchor });
    showCastPreview({ sourceKey: 'rune:rune_gilded_ledger', spellId: 'staffofguel', anchor: { ...anchor, left: 400 } });
    expect(getCastPreviews().map((e) => [e.sourceKey, e.spellId])).toEqual([['rw', 'lasso'], ['rune:rune_gilded_ledger', 'staffofguel']]);
  });

  it('a second cast from the SAME source REPLACES its live preview: card swaps, count ticks, linger restarts', () => {
    const id = showCastPreview({ sourceKey: 'gi', spellId: 'ruby', anchor });
    vi.advanceTimersByTime(1000);
    expect(showCastPreview({ sourceKey: 'gi', spellId: 'ruby', anchor })).toBe(id);
    expect(getCastPreviews()).toMatchObject([{ id, spellId: 'ruby', count: 2, leaving: false }]);
    vi.advanceTimersByTime(fadeIn + linger - 1000 + 1); // where the FIRST linger would have ended
    expect(getCastPreviews()[0]!.leaving, 'the linger restarted at the second cast').toBe(false);
    vi.advanceTimersByTime(1000 - 1);
    expect(getCastPreviews()[0]!.leaving).toBe(true);
  });

  it('a cast during a source\x27s FADE-OUT starts a fresh preview rather than reviving the leaving one', () => {
    const first = showCastPreview({ sourceKey: 'rw', spellId: 'lasso', anchor });
    vi.advanceTimersByTime(fadeIn + linger);
    expect(getCastPreviews()[0]!.leaving).toBe(true);
    const second = showCastPreview({ sourceKey: 'rw', spellId: 'lasso', anchor });
    expect(second).not.toBe(first);
    expect(getCastPreviews()).toHaveLength(2);
    vi.advanceTimersByTime(fadeOut);
    expect(getCastPreviews().map((e) => e.id)).toEqual([second]);
  });

  it('notifies subscribers on every change and clearCastPreviews drops everything', () => {
    const seen = vi.fn();
    const off = subscribeCastPreviews(seen);
    showCastPreview({ sourceKey: 'rw', spellId: 'lasso', anchor });
    expect(seen).toHaveBeenCalledTimes(1);
    clearCastPreviews();
    expect(getCastPreviews()).toEqual([]);
    vi.advanceTimersByTime(fadeIn + linger + fadeOut);
    expect(seen).toHaveBeenCalledTimes(2); // the cleared timers never fire
    off();
  });

  it('the clock reads the TUNED timings per context (shop vs combat), applied to the next preview', () => {
    setCastPreviewValue('combatFadeIn', 100);
    setCastPreviewValue('combatLinger', 500);
    setCastPreviewValue('combatFadeOut', 50);
    showCastPreview({ sourceKey: 'fc', spellId: 'growth', anchor, context: 'combat' });
    showCastPreview({ sourceKey: 'rw', spellId: 'lasso', anchor });
    expect(getCastPreviews().map((e) => e.context)).toEqual(['combat', 'shop']);
    vi.advanceTimersByTime(600);
    expect(getCastPreviews().map((e) => [e.sourceKey, e.leaving])).toEqual([['fc', true], ['rw', false]]);
    vi.advanceTimersByTime(50);
    expect(getCastPreviews().map((e) => e.sourceKey)).toEqual(['rw']);
  });

  it('keys a minion by uid and a rune by id', () => {
    expect(castSourceKey({ kind: 'minion', uid: 'u1' })).toBe('u1');
    expect(castSourceKey({ kind: 'rune', id: 'rune_gilded_ledger' })).toBe('rune:rune_gilded_ledger');
  });
});

describe('placeCastPreview — where it sits', () => {
  const vp = { viewportW: 1000, viewportH: 800 };
  it('centres above the anchor with a gap', () => {
    expect(placeCastPreview({ anchor, w: 200, h: 200, ...vp, occupied: [] })).toEqual({ left: 40, top: 300 - 8 - 200 });
  });
  it('clamps to the viewport edges', () => {
    expect(placeCastPreview({ anchor: { ...anchor, left: 0 }, w: 200, h: 300, ...vp, occupied: [] }).left).toBe(6);
    expect(placeCastPreview({ anchor: { ...anchor, left: 950 }, w: 200, h: 300, ...vp, occupied: [] }).left).toBe(1000 - 200 - 6);
  });
  it('nudges RIGHT off a live neighbour it would lap', () => {
    const p = placeCastPreview({ anchor, w: 200, h: 300, ...vp, occupied: [{ left: 0, right: 150 }] });
    expect(p.left).toBe(158);
  });
  it('goes LEFT of the neighbour when there is no room on the right', () => {
    const p = placeCastPreview({ anchor: { ...anchor, left: 900 }, w: 200, h: 300, ...vp, occupied: [{ left: 780, right: 1000 }] });
    expect(p.left).toBe(780 - 8 - 200);
  });
  it('falls BELOW the anchor when there is no room above', () => {
    const p = placeCastPreview({ anchor: { ...anchor, top: 20 }, w: 200, h: 300, ...vp, occupied: [] });
    expect(p.top).toBe(20 + 120 + 8);
  });

  // THE TUNER'S KNOBS (owner 2026-09-23: "adjust size, positioning …"). Size arrives as the measured w/h (the
  // scale is a layout zoom), so a smaller scale → a smaller footprint that still centres over the source.
  it('a smaller measured size (the Size knob) stays centred just above the source', () => {
    const small = placeCastPreview({ anchor, w: 120, h: 240, ...vp, occupied: [] });
    expect(small).toEqual({ left: 100 + 40 - 60, top: 300 - 8 - 240 });
  });
  it('Offset X / Offset Y shift the seat', () => {
    expect(placeCastPreview({ anchor, w: 120, h: 240, ...vp, occupied: [], offsetX: 30, offsetY: -20 }))
      .toEqual({ left: 80 + 30, top: 300 - 8 - 240 - 20 });
  });
  it('Side: below / left / right seat the preview on that side of the source (centred on the other axis)', () => {
    const a = { left: 400, top: 300, width: 80, height: 120 };
    expect(placeCastPreview({ anchor: a, w: 120, h: 240, ...vp, occupied: [], side: 'below' })).toEqual({ left: 380, top: 428 });
    expect(placeCastPreview({ anchor: a, w: 120, h: 240, ...vp, occupied: [], side: 'left' })).toEqual({ left: 400 - 8 - 120, top: 360 - 120 });
    expect(placeCastPreview({ anchor: a, w: 120, h: 240, ...vp, occupied: [], side: 'right' })).toEqual({ left: 488, top: 240 });
  });
  it('a side with no room flips to the opposite side', () => {
    expect(placeCastPreview({ anchor: { left: 10, top: 300, width: 80, height: 120 }, w: 120, h: 240, ...vp, occupied: [], side: 'left' }).left).toBe(98);
    expect(placeCastPreview({ anchor: { left: 400, top: 700, width: 80, height: 90 }, w: 120, h: 240, ...vp, occupied: [], side: 'below' }).top).toBe(700 - 8 - 240);
  });
});
