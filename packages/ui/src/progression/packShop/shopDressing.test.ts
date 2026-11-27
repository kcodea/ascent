// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// jsdom has no canvas: Pixi probes one on import
vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
import { TAG_ART, placardBadge, placardCount, tagArtScale } from './shopDressing';

describe('the placard\'s words', () => {
  it('a new or featured offer wears a ribbon chip; a free offer does not (its placard already says "Free")', () => {
    expect(placardBadge('new')).toBe('New');
    expect(placardBadge('featured')).toBe('Featured');
    expect(placardBadge('free')).toBe('Daily');
    expect(placardBadge('featured', 40)).toBe('-40%');
    expect(placardBadge(undefined)).toBeNull();
  });

  it('a box shows its count beside the price; a single pack shows none', () => {
    expect(placardCount(10)).toBe('x10');
    expect(placardCount(2)).toBe('x2');
    expect(placardCount(1)).toBe('');
    expect(placardCount(0)).toBe('');
  });
});

describe('the painted tag', () => {
  it('rests at one size for an ordinary price and grows, whole, only when the price needs the room', () => {
    const rest = tagArtScale(0);
    expect(tagArtScale(108)).toBe(rest); // a gem and three digits
    const wide = tagArtScale(260);
    expect(wide).toBeGreaterThan(rest);
    expect(TAG_ART.innerW * wide).toBeGreaterThanOrEqual(260);
  });
});
