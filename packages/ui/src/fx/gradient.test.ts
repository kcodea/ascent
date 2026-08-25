import { describe, it, expect } from 'vitest';
import { addStop, removeStop, moveStop, type GradientStop } from './gradient';

const g: GradientStop[] = [{ at: 0, color: 0x000000 }, { at: 1, color: 0xffffff }];

describe('gradient stops', () => {
  it('adds a stop, kept sorted by position', () => {
    const out = addStop(g, 0.5, 0xff0000);
    expect(out.map((s) => s.at)).toEqual([0, 0.5, 1]);
    expect(out[1].color).toBe(0xff0000);
  });
  it('never mutates the input', () => {
    addStop(g, 0.5, 1); expect(g.length).toBe(2);
  });
  it('removes but always keeps at least two stops', () => {
    expect(removeStop([{ at: 0, color: 1 }, { at: 1, color: 2 }], 0).length).toBe(2);
    expect(removeStop([{ at: 0, color: 1 }, { at: 0.5, color: 2 }, { at: 1, color: 3 }], 1).map((s) => s.at)).toEqual([0, 1]);
  });
  it('moves a stop and re-sorts, clamping to 0..1', () => {
    expect(moveStop(g, 0, 2).find((s) => s.color === 0x000000)!.at).toBe(1);
  });
});
