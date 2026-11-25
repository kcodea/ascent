// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// jsdom has no canvas: Pixi probes one on import
vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
import { placardBadge, placardCount } from './shopDressing';

describe('the placard\'s words', () => {
  it('a new or featured offer wears a ribbon chip; a free offer does not (its placard already says "Free")', () => {
    expect(placardBadge('new')).toBe('New');
    expect(placardBadge('featured')).toBe('Featured');
    expect(placardBadge('free')).toBeNull();
    expect(placardBadge(undefined)).toBeNull();
  });

  it('a box shows its count beside the price; a single pack shows none', () => {
    expect(placardCount(10)).toBe('x10');
    expect(placardCount(2)).toBe('x2');
    expect(placardCount(1)).toBe('');
    expect(placardCount(0)).toBe('');
  });
});
