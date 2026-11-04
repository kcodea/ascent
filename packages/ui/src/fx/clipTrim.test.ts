import { describe, expect, it } from 'vitest';
import { CLIP_OFFSET_MAX_MS, clampTrimMs, offsetMsToPct, offsetPctToMs } from './clipTrim';
import { soundPrimitive } from './primitives/sound';
import { coerceParams } from './params';

describe('sound trim offsets read as % of the clip (R-FX-CLIP-TRIM-PCT-01)', () => {
  it('converts stored ms to a percent of the clip and back', () => {
    expect(offsetMsToPct(500, 2000)).toBe(25);
    expect(offsetPctToMs(25, 2000)).toBe(500);
    expect(offsetPctToMs(99.5, 4000)).toBe(3980);
  });

  it('reads 0 % while the clip length is unknown', () => {
    expect(offsetMsToPct(500, 0)).toBe(0);
    expect(offsetPctToMs(50, 0)).toBe(0);
  });

  it('reaches the very end of a clip longer than the old 2000 ms ceiling', () => {
    const dur = 6000;
    expect(clampTrimMs(offsetPctToMs(99, dur), 0, dur)).toBe(5940);
    const spec = soundPrimitive.params.endOffset as { max: number };
    expect(spec.max).toBe(CLIP_OFFSET_MAX_MS);
    expect((coerceParams(soundPrimitive.params, { endOffset: 5940 }) as { endOffset: number }).endOffset).toBe(5940);
  });

  it('never lets Start and End cross', () => {
    expect(clampTrimMs(1800, 400, 2000)).toBe(1600);
    expect(clampTrimMs(-10, 0, 2000)).toBe(0);
  });

  it('keeps every saved ms offset as it was (nothing is migrated)', () => {
    const p = coerceParams(soundPrimitive.params, { startOffset: 130, endOffset: 1040 }) as { startOffset: number; endOffset: number };
    expect([p.startOffset, p.endOffset]).toEqual([130, 1040]);
  });
});
