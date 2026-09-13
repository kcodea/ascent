import { describe, expect, it } from 'vitest';
import { commonStem, naturalCompare, planCell, planGrid } from './sheetPack';

describe('naturalCompare', () => {
  it('orders numeric runs by value, not by string', () => {
    const names = ['frame_10.png', 'frame_2.png', 'frame_1.png', 'frame_9.png'];
    expect([...names].sort(naturalCompare)).toEqual(['frame_1.png', 'frame_2.png', 'frame_9.png', 'frame_10.png']);
  });
  it('is case-insensitive and stable for plain strings', () => {
    expect(['b.png', 'A.png', 'c.png'].sort(naturalCompare)).toEqual(['A.png', 'b.png', 'c.png']);
    expect(naturalCompare('x', 'x')).toBe(0);
  });
});

describe('commonStem', () => {
  it('strips the extension, the shared numeric suffix and separators', () => {
    expect(commonStem(['explosion_01.png', 'explosion_02.png', 'explosion_12.png'])).toBe('explosion');
    expect(commonStem(['slash-1.png', 'slash-2.png'])).toBe('slash');
    expect(commonStem(['hit 01.png', 'hit 02.png'])).toBe('hit');
  });
  it('falls back sensibly', () => {
    expect(commonStem(['one.png'])).toBe('one');
    expect(commonStem(['a.png', 'b.png'])).toBe('a');
    expect(commonStem([])).toBe('sheet');
  });
});

describe('planGrid', () => {
  it('goes near-square by default and honours frames-per-row', () => {
    expect(planGrid(12)).toEqual({ cols: 4, rows: 3 });
    expect(planGrid(16)).toEqual({ cols: 4, rows: 4 });
    expect(planGrid(5)).toEqual({ cols: 3, rows: 2 });
    expect(planGrid(12, 4)).toEqual({ cols: 4, rows: 3 });
    expect(planGrid(12, 6)).toEqual({ cols: 6, rows: 2 });
    expect(planGrid(3, 8)).toEqual({ cols: 3, rows: 1 }); // per-row larger than count clamps
  });
});

describe('planCell', () => {
  it('keeps the frame size when the sheet already fits, and never upscales', () => {
    expect(planCell(256, 256, 4, 3, 1024)).toEqual({ w: 256, h: 256 });
    expect(planCell(100, 50, 2, 2, 1024)).toEqual({ w: 100, h: 50 });
  });
  it('shrinks the cell so the WHOLE sheet fits within the cap on both axes', () => {
    expect(planCell(512, 512, 4, 3, 1024)).toEqual({ w: 256, h: 256 }); // 4 × 512 = 2048 → halve
    const c = planCell(300, 800, 2, 3, 1024); // rows bind: 3 × 800 = 2400
    expect(c.h * 3).toBeLessThanOrEqual(1024);
    expect(c.w * 2).toBeLessThanOrEqual(1024);
    expect(c.w / c.h).toBeCloseTo(300 / 800, 1);
  });
});
