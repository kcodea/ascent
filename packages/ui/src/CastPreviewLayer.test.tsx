// @vitest-environment jsdom
/**
 * THE CAST PREVIEW LAYER (owner ask 2026-09-23): a cast recorded on the store mounts the spell's card above its
 * source, leaves after the linger, and two casts from two sources stack. Mounted through the store binding the
 * real layer uses (`useSyncExternalStore` over `castPreview.ts`), with a stub view builder in place of the shop's
 * live-text chain so the test needs no game store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useSyncExternalStore } from 'react';
import { CastPreviewLayerView } from './CastPreviewLayer';
import type { CardView } from './Card';
import { CAST_PREVIEW_MS, clearCastPreviews, getCastPreviews, showCastPreview, subscribeCastPreviews } from './castPreview';
import { mount, type Mounted } from './renderedText.mount';

const VIEWS: Record<string, CardView> = {
  staffofguel: { name: 'Staff of Guel', cardId: 'staffofguel', tribe: 'neutral', attack: 0, health: 0, keywords: [], text: 'Minions you buy gain +2/+2.', spell: true, tier: 3 },
  lasso: { name: 'Lasso', cardId: 'lasso', tribe: 'neutral', attack: 0, health: 0, keywords: [], text: 'Steal a Shop minion.', spell: true, tier: 2 },
};
const viewOf = (id: string): CardView | null => VIEWS[id] ?? null;

function Bound() {
  const entries = useSyncExternalStore(subscribeCastPreviews, getCastPreviews, getCastPreviews);
  return <CastPreviewLayerView entries={entries} viewOf={viewOf} />;
}

const anchor = { left: 100, top: 300, width: 80, height: 120 };
let m: Mounted;
beforeEach(() => { vi.useFakeTimers(); clearCastPreviews(); m = mount(<Bound />); });
afterEach(() => { m.unmount(); clearCastPreviews(); vi.useRealTimers(); });

const previews = (): HTMLElement[] => [...m.container.querySelectorAll<HTMLElement>('.castprev')];

describe('CastPreviewLayer', () => {
  it('renders nothing until a cast is recorded', () => {
    expect(m.container.querySelector('.castprev-layer')).toBeNull();
  });

  it('mounts the cast spell\x27s card above its source on the cast, and unmounts after the linger', () => {
    act(() => { showCastPreview({ sourceKey: 'rune:rune_gilded_ledger', spellId: 'staffofguel', anchor }); });
    const [p] = previews();
    expect(p, 'one preview').toBeDefined();
    expect(p!.dataset.spellId).toBe('staffofguel');
    expect(p!.dataset.sourceKey).toBe('rune:rune_gilded_ledger');
    expect(p!.querySelector('.card')?.textContent).toContain('Staff of Guel');
    expect(p!.classList.contains('leaving')).toBe(false);
    // The layer is input-transparent and off the layout: a fixed layer, never a block in the page flow.
    expect(m.container.querySelector('.castprev-layer')?.getAttribute('aria-hidden')).toBe('true');
    act(() => { vi.advanceTimersByTime(CAST_PREVIEW_MS.fadeIn + CAST_PREVIEW_MS.linger); });
    expect(previews()[0]!.classList.contains('leaving'), 'the fade-out class after the linger').toBe(true);
    act(() => { vi.advanceTimersByTime(CAST_PREVIEW_MS.fadeOut); });
    expect(previews()).toEqual([]);
    expect(m.container.querySelector('.castprev-layer')).toBeNull();
  });

  it('stacks two casts from two sources — one card each, both on screen', () => {
    act(() => {
      showCastPreview({ sourceKey: 'rw', spellId: 'lasso', anchor });
      showCastPreview({ sourceKey: 'rune:rune_gilded_ledger', spellId: 'staffofguel', anchor: { ...anchor, left: 500 } });
    });
    expect(previews().map((p) => p.dataset.spellId)).toEqual(['lasso', 'staffofguel']);
    expect(previews().map((p) => p.querySelector('.card')?.textContent?.includes('Lasso'))).toEqual([true, false]);
  });

  it('a same-source recast refreshes the ONE preview and shows the ×N chip', () => {
    act(() => { showCastPreview({ sourceKey: 'gi', spellId: 'lasso', anchor }); });
    act(() => { showCastPreview({ sourceKey: 'gi', spellId: 'staffofguel', anchor }); });
    expect(previews()).toHaveLength(1);
    expect(previews()[0]!.dataset.spellId).toBe('staffofguel');
    expect(previews()[0]!.querySelector('.castprev-count')?.textContent).toBe('×2');
  });

  it('skips a spell the view builder cannot render rather than crashing', () => {
    act(() => { showCastPreview({ sourceKey: 'x', spellId: 'not-a-card', anchor }); });
    expect(previews()).toEqual([]);
  });
});
