import { describe, expect, it } from 'vitest';
import { bounceUnits, bounceScenario, SCENARIOS } from './scenarios';
import { pointOnTravel } from './anchors';

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

      // Future-proofs any scenario (present or later-added) that opts into the custom head path.
      if (scenario.headAt) {
        it('returns finite head coordinates across a progress sweep', () => {
          [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1].forEach((progress) => {
            const point = scenario.headAt!(SAMPLE_VIEWPORT, SAMPLE_CURSOR, progress);
            expect(Number.isFinite(point.x), `${scenario.id}.headAt(${progress}).x is not finite`).toBe(true);
            expect(Number.isFinite(point.y), `${scenario.id}.headAt(${progress}).y is not finite`).toBe(true);
          });
        });
      }
    });
  });
});

describe('bounceScenario', () => {
  it('is registered in SCENARIOS', () => {
    expect(SCENARIOS).toContain(bounceScenario);
  });

  it('headAt returns finite coordinates across progress', () => {
    [0, 0.25, 0.5, 0.75, 0.99].forEach((progress) => {
      const point = bounceScenario.headAt!(SAMPLE_VIEWPORT, SAMPLE_CURSOR, progress);
      expect(Number.isFinite(point.x), `headAt(${progress}).x`).toBe(true);
      expect(Number.isFinite(point.y), `headAt(${progress}).y`).toBe(true);
    });
  });

  it('lands on the unit at each leg boundary', () => {
    const units = bounceUnits(SAMPLE_VIEWPORT);
    const headAt = bounceScenario.headAt!;

    // progress 0 -> unit0, progress 0.25 -> unit1, 0.5 -> unit2, 0.75 -> unit3
    [0, 0.25, 0.5, 0.75].forEach((progress, i) => {
      const point = headAt(SAMPLE_VIEWPORT, SAMPLE_CURSOR, progress);
      expect(point.x).toBeCloseTo(units[i].x, 5);
      expect(point.y).toBeCloseTo(units[i].y, 5);
    });
  });

  it('is continuous across leg boundaries (no teleport between bounces)', () => {
    const headAt = bounceScenario.headAt!;
    const EPS = 1e-6;

    // The end of each leg (t -> 1) must match the start of the next leg (t -> 0) at the shared unit.
    [0.25, 0.5, 0.75].forEach((boundary) => {
      const endOfPrevLeg = headAt(SAMPLE_VIEWPORT, SAMPLE_CURSOR, boundary - EPS);
      const startOfNextLeg = headAt(SAMPLE_VIEWPORT, SAMPLE_CURSOR, boundary + EPS);
      expect(endOfPrevLeg.x).toBeCloseTo(startOfNextLeg.x, 2);
      expect(endOfPrevLeg.y).toBeCloseTo(startOfNextLeg.y, 2);
    });
  });

  it('matches pointOnTravel for a point mid-leg', () => {
    const units = bounceUnits(SAMPLE_VIEWPORT);
    // progress 0.125 is halfway through leg 0 (unit0 -> unit1): scaled = 0.125*4 = 0.5, leg 0, t = 0.5.
    const expected = pointOnTravel(units[0], units[1], 0.5, 0.28);
    const actual = bounceScenario.headAt!(SAMPLE_VIEWPORT, SAMPLE_CURSOR, 0.125);
    expect(actual.x).toBeCloseTo(expected.x, 5);
    expect(actual.y).toBeCloseTo(expected.y, 5);
  });
});
