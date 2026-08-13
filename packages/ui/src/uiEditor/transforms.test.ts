import { describe, it, expect } from 'vitest';
import { composeTransform, resizeToPx } from './transforms';

describe('composeTransform', () => {
  it('emits translate then scale, omitting a 1x scale', () => {
    expect(composeTransform({ x: 4, y: -6 }, 1)).toBe('translate(4px, -6px)');
    expect(composeTransform({ x: 0, y: 0 }, 1.08)).toBe('scale(1.08)');
    expect(composeTransform({ x: 4, y: -6 }, 1.08)).toBe('translate(4px, -6px) scale(1.08)');
  });
  it('is the empty string for the identity transform', () => {
    expect(composeTransform({ x: 0, y: 0 }, 1)).toBe('');
  });
});

describe('resizeToPx', () => {
  it('adds deltas to the base box', () => {
    expect(resizeToPx({ w: 100, h: 50 }, 20, 10, false)).toEqual({ width: '120px', height: '60px' });
  });
  it('locks aspect to the width delta when keepAspect', () => {
    expect(resizeToPx({ w: 100, h: 50 }, 20, 999, true)).toEqual({ width: '120px', height: '60px' });
  });
  it('never produces a non-positive dimension', () => {
    expect(resizeToPx({ w: 30, h: 30 }, -100, -100, false)).toEqual({ width: '1px', height: '1px' });
  });
});
