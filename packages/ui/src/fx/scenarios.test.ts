import { describe, expect, it } from 'vitest';
import { SCENARIOS } from './scenarios';

const SAMPLE_VIEWPORT = { w: 1280, h: 800 };
const SAMPLE_CURSOR = { x: 640, y: 400 };

describe('SCENARIOS', () => {
  it('has unique ids', () => {
    const ids = SCENARIOS.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  SCENARIOS.forEach((scenario) => {
    describe(scenario.id, () => {
      it('has a non-empty label', () => {
        expect(scenario.label).toBeTruthy();
        expect(typeof scenario.label).toBe('string');
      });

      it('has a non-empty hint', () => {
        expect(scenario.hint).toBeTruthy();
        expect(typeof scenario.hint).toBe('string');
      });

      it('returns finite anchor coordinates', () => {
        const anchors = scenario.anchorsAt(SAMPLE_VIEWPORT, SAMPLE_CURSOR);
        Object.entries(anchors).forEach(([name, point]) => {
          // The label carried into the message via the matcher's context, so a failure names the offender.
          expect(point.x, `${scenario.id}.${name}.x`).toBeTypeOf('number');
          expect(Number.isFinite(point.x), `${scenario.id}.${name}.x is not finite`).toBe(true);
          expect(Number.isFinite(point.y), `${scenario.id}.${name}.y is not finite`).toBe(true);
        });
      });
    });
  });
});
