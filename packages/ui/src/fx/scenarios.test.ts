import { describe, expect, it } from 'vitest';
import { bounceUnits, bounceScenario, clickPlace, pinnedCursor, realBoard, stationary, twoUnits, SCENARIOS } from './scenarios';
import type { FxHeadContext } from './scenarios';
import { pointOnTravel } from './anchors';

const SAMPLE_VIEWPORT = { w: 1280, h: 800 };
const SAMPLE_CURSOR = { x: 640, y: 400 };

function ctxAt(progress: number, overrides: Partial<FxHeadContext> = {}): FxHeadContext {
  return {
    viewport: SAMPLE_VIEWPORT,
    cursor: SAMPLE_CURSOR,
    click: null,
    progress,
    ...overrides,
  };
}

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
            const point = scenario.headAt!(ctxAt(progress));
            expect(Number.isFinite(point.x), `${scenario.id}.headAt(${progress}).x is not finite`).toBe(true);
            expect(Number.isFinite(point.y), `${scenario.id}.headAt(${progress}).y is not finite`).toBe(true);
          });
        });
      }
    });
  });
});

describe('pinnedCursor', () => {
  it('is registered in SCENARIOS', () => {
    expect(SCENARIOS).toContain(pinnedCursor);
  });

  it('headAt returns the live cursor position directly, ignoring progress', () => {
    [0, 0.3, 0.7, 1].forEach((progress) => {
      const point = pinnedCursor.headAt!(ctxAt(progress));
      expect(point).toEqual(SAMPLE_CURSOR);
    });
  });

  it('tracks a moving cursor', () => {
    const moved = { x: 100, y: 900 };
    const point = pinnedCursor.headAt!(ctxAt(0.5, { cursor: moved }));
    expect(point).toEqual(moved);
  });
});

describe('clickPlace', () => {
  it('is registered in SCENARIOS', () => {
    expect(SCENARIOS).toContain(clickPlace);
  });

  it('falls back to viewport centre before any click', () => {
    const point = clickPlace.headAt!(ctxAt(0.5, { click: null }));
    expect(point).toEqual({ x: SAMPLE_VIEWPORT.w / 2, y: SAMPLE_VIEWPORT.h / 2 });
  });

  it('anchors to the last click once one has happened', () => {
    const clicked = { x: 200, y: 150 };
    [0, 0.5, 1].forEach((progress) => {
      const point = clickPlace.headAt!(ctxAt(progress, { click: clicked }));
      expect(point).toEqual(clicked);
    });
  });
});

describe('stationary', () => {
  it('is registered in SCENARIOS', () => {
    expect(SCENARIOS).toContain(stationary);
  });

  it('stays within a small amplitude of viewport centre', () => {
    const amplitude = Math.min(SAMPLE_VIEWPORT.w, SAMPLE_VIEWPORT.h) * 0.06;
    [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].forEach((progress) => {
      const point = stationary.headAt!(ctxAt(progress));
      expect(point.y).toBeCloseTo(SAMPLE_VIEWPORT.h * 0.5, 5);
      expect(Math.abs(point.x - SAMPLE_VIEWPORT.w * 0.5)).toBeLessThanOrEqual(amplitude + 1e-6);
    });
  });

  it('is not perfectly still (sweeps back and forth so a trail still forms)', () => {
    const a = stationary.headAt!(ctxAt(0.25));
    const b = stationary.headAt!(ctxAt(0.75));
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(1);
  });
});

describe('realBoard', () => {
  it('is registered in SCENARIOS', () => {
    expect(SCENARIOS).toContain(realBoard);
  });

  // The suite runs headless (no `document`), so `readBoardAnchors()` returns null and this exercises exactly
  // the degradation path: the scenario must never be broken just because the board isn't up.
  it('falls back to the synthetic two-unit anchors when no board is on screen', () => {
    const anchors = realBoard.anchorsAt(SAMPLE_VIEWPORT, SAMPLE_CURSOR);
    const synthetic = twoUnits.anchorsAt(SAMPLE_VIEWPORT, SAMPLE_CURSOR);
    expect(anchors.source).toEqual(synthetic.source);
    expect(anchors.target).toEqual(synthetic.target);
    expect(anchors.camera).toEqual(synthetic.camera);
  });

  it('stages `slot` and `cursor` too, so every anchor a layer can pick resolves', () => {
    const anchors = realBoard.anchorsAt(SAMPLE_VIEWPORT, SAMPLE_CURSOR);
    expect(anchors.slot).toEqual(anchors.source);
    expect(anchors.cursor).toEqual(SAMPLE_CURSOR);
  });

  it('says in its hint that it is showing the FALLBACK, not the live board', () => {
    expect(realBoard.hint).toMatch(/synthetic/i);
  });
});

describe('bounceScenario', () => {
  it('is registered in SCENARIOS', () => {
    expect(SCENARIOS).toContain(bounceScenario);
  });

  it('lays out four units in a left-to-right row', () => {
    const units = bounceUnits(SAMPLE_VIEWPORT);
    expect(units).toHaveLength(4);
    for (let i = 1; i < units.length; i++) {
      expect(units[i].x).toBeGreaterThan(units[i - 1].x);
    }
  });

  it('headAt returns finite coordinates across progress', () => {
    [0, 0.25, 0.5, 0.75, 0.99].forEach((progress) => {
      const point = bounceScenario.headAt!(ctxAt(progress));
      expect(Number.isFinite(point.x), `headAt(${progress}).x`).toBe(true);
      expect(Number.isFinite(point.y), `headAt(${progress}).y`).toBe(true);
    });
  });

  it('ping-pongs across the row instead of looping: 0 -> 1 -> 2 -> 3 -> 2 -> 1 -> 0', () => {
    const units = bounceUnits(SAMPLE_VIEWPORT);
    const headAt = bounceScenario.headAt!;
    // Six legs across progress 0..1, each 1/6 wide, landing exactly on a unit at every leg boundary.
    const expectedUnitAtBoundary = [0, 1, 2, 3, 2, 1, 0];
    expectedUnitAtBoundary.forEach((unitIndex, leg) => {
      const progress = leg / 6;
      const point = headAt(ctxAt(progress));
      expect(point.x).toBeCloseTo(units[unitIndex].x, 5);
      expect(point.y).toBeCloseTo(units[unitIndex].y, 5);
    });
  });

  it('reverses cleanly at the far end (no teleport at the turnaround)', () => {
    const headAt = bounceScenario.headAt!;
    const EPS = 1e-6;
    // The far-end turnaround sits at progress 3/6 = 0.5: approaching from below (leg 2, unit2->unit3) and
    // leaving from above (leg 3, unit3->unit2) must agree on the same point — the head reverses in place.
    const approaching = headAt(ctxAt(0.5 - EPS));
    const leaving = headAt(ctxAt(0.5 + EPS));
    expect(approaching.x).toBeCloseTo(leaving.x, 2);
    expect(approaching.y).toBeCloseTo(leaving.y, 2);
  });

  it('is continuous across every leg boundary (no teleport between bounces)', () => {
    const headAt = bounceScenario.headAt!;
    const EPS = 1e-6;
    [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6].forEach((boundary) => {
      const endOfPrevLeg = headAt(ctxAt(boundary - EPS));
      const startOfNextLeg = headAt(ctxAt(boundary + EPS));
      expect(endOfPrevLeg.x).toBeCloseTo(startOfNextLeg.x, 2);
      expect(endOfPrevLeg.y).toBeCloseTo(startOfNextLeg.y, 2);
    });
  });

  it('loops without a teleport too (end of the cycle meets the start, both unit0)', () => {
    const headAt = bounceScenario.headAt!;
    const nearEnd = headAt(ctxAt(1 - 1e-6));
    const start = headAt(ctxAt(0));
    expect(nearEnd.x).toBeCloseTo(start.x, 2);
    expect(nearEnd.y).toBeCloseTo(start.y, 2);
  });

  it('matches pointOnTravel for a point mid-leg', () => {
    const units = bounceUnits(SAMPLE_VIEWPORT);
    // progress 1/12 is halfway through leg 0 (unit0 -> unit1): scaled = (1/12)*6 = 0.5, leg 0, t = 0.5.
    const expected = pointOnTravel(units[0], units[1], 0.5, 0.22);
    const actual = bounceScenario.headAt!(ctxAt(1 / 12));
    expect(actual.x).toBeCloseTo(expected.x, 5);
    expect(actual.y).toBeCloseTo(expected.y, 5);
  });
});
