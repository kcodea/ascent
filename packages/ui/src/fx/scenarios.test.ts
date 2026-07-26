import { describe, expect, it } from 'vitest';
import { bounceSpots, bounceScenario, pinnedCursor, realBoard, stationary, SCENARIOS } from './scenarios';
import type { FxHeadContext } from './scenarios';
import { FX_ANCHOR_IDS, pointOnTravel, resolveAnchor } from './anchors';

const SAMPLE_VIEWPORT = { w: 1280, h: 800 };
const SAMPLE_CURSOR = { x: 640, y: 400 };

function ctxAt(progress: number, overrides: Partial<FxHeadContext> = {}): FxHeadContext {
  return {
    viewport: SAMPLE_VIEWPORT,
    cursor: SAMPLE_CURSOR,
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

      // THE regression this suite exists for. An anchor a scenario doesn't stage resolves to (0,0) — the
      // top-left corner of the page, off-stage — which is indistinguishable from "the effect is broken".
      // That is exactly what happened: only `pinnedCursor` and `realBoard` staged `cursor`, so a
      // cursor-anchored layer drew nothing in every other mode. Every anchor a layer can PICK must resolve
      // somewhere on the stage in every mode that can be picked alongside it.
      it('stages every pickable anchor, so no layer can silently resolve to the off-stage origin', () => {
        const anchors = scenario.anchorsAt(SAMPLE_VIEWPORT, SAMPLE_CURSOR);
        FX_ANCHOR_IDS.forEach((id) => {
          // `travel` is derived from source→target rather than staged, so it's covered by them resolving.
          if (id === 'travel') return;
          const point = resolveAnchor(anchors, id, 0.5);
          expect(point, `${scenario.id} left '${id}' unstaged`).not.toEqual({ x: 0, y: 0 });
          expect(point.x, `${scenario.id}.${id}.x off-stage`).toBeGreaterThan(0);
          expect(point.y, `${scenario.id}.${id}.y off-stage`).toBeGreaterThan(0);
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

        it('keeps the head on-stage across a progress sweep', () => {
          [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1].forEach((progress) => {
            const point = scenario.headAt!(ctxAt(progress));
            expect(point.x, `${scenario.id}.headAt(${progress}).x`).toBeGreaterThan(0);
            expect(point.x, `${scenario.id}.headAt(${progress}).x`).toBeLessThan(SAMPLE_VIEWPORT.w);
            expect(point.y, `${scenario.id}.headAt(${progress}).y`).toBeGreaterThan(0);
            expect(point.y, `${scenario.id}.headAt(${progress}).y`).toBeLessThan(SAMPLE_VIEWPORT.h);
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

describe('stationary', () => {
  it('is registered in SCENARIOS', () => {
    expect(SCENARIOS).toContain(stationary);
  });

  // Deliberately DEAD still. The earlier version crept along a sine sweep so the ribbon primitive (a motion
  // trail) would still draw something — an honest "stationary" matters more than one primitive's convenience.
  it('never moves, at any progress', () => {
    const centre = { x: SAMPLE_VIEWPORT.w * 0.5, y: SAMPLE_VIEWPORT.h * 0.5 };
    [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].forEach((progress) => {
      expect(stationary.headAt!(ctxAt(progress))).toEqual(centre);
    });
  });

  it('warns in its hint that a ribbon needs a moving scenario', () => {
    expect(stationary.hint).toMatch(/ribbon/i);
  });
});

describe('realBoard', () => {
  it('is registered in SCENARIOS', () => {
    expect(SCENARIOS).toContain(realBoard);
  });

  // The suite runs headless (no `document`), so `readBoardAnchors()` returns null and this exercises exactly
  // the degradation path: the scenario must never be broken just because the board isn't up.
  it('falls back to the synthetic bounce anchors when no board is on screen', () => {
    const anchors = realBoard.anchorsAt(SAMPLE_VIEWPORT, SAMPLE_CURSOR);
    const [a, b] = bounceSpots(SAMPLE_VIEWPORT);
    expect(anchors.source).toEqual(a);
    expect(anchors.target).toEqual(b);
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

  it('stages exactly two spots, left then right', () => {
    const [a, b] = bounceSpots(SAMPLE_VIEWPORT);
    expect(bounceSpots(SAMPLE_VIEWPORT)).toHaveLength(2);
    expect(b.x).toBeGreaterThan(a.x);
    expect(a.y).toBeCloseTo(b.y, 5);
  });

  it('lands exactly on spot A at the start, spot B at the turnaround, and A again at the end', () => {
    const [a, b] = bounceSpots(SAMPLE_VIEWPORT);
    const headAt = bounceScenario.headAt!;
    expect(headAt(ctxAt(0)).x).toBeCloseTo(a.x, 5);
    expect(headAt(ctxAt(0)).y).toBeCloseTo(a.y, 5);
    expect(headAt(ctxAt(0.5)).x).toBeCloseTo(b.x, 5);
    expect(headAt(ctxAt(0.5)).y).toBeCloseTo(b.y, 5);
    expect(headAt(ctxAt(1)).x).toBeCloseTo(a.x, 5);
    expect(headAt(ctxAt(1)).y).toBeCloseTo(a.y, 5);
  });

  it('reverses cleanly at the far end (no teleport at the turnaround)', () => {
    const headAt = bounceScenario.headAt!;
    const EPS = 1e-6;
    const approaching = headAt(ctxAt(0.5 - EPS));
    const leaving = headAt(ctxAt(0.5 + EPS));
    expect(approaching.x).toBeCloseTo(leaving.x, 2);
    expect(approaching.y).toBeCloseTo(leaving.y, 2);
  });

  it('loops without a teleport (end of the cycle meets the start, both on spot A)', () => {
    const headAt = bounceScenario.headAt!;
    const nearEnd = headAt(ctxAt(1 - 1e-6));
    const start = headAt(ctxAt(0));
    expect(nearEnd.x).toBeCloseTo(start.x, 2);
    expect(nearEnd.y).toBeCloseTo(start.y, 2);
  });

  it('arcs the return leg along the opposite side, so it reads as a bounce and not a retrace', () => {
    const headAt = bounceScenario.headAt!;
    const out = headAt(ctxAt(0.25)); // mid-outbound
    const back = headAt(ctxAt(0.75)); // mid-return, same x
    expect(out.x).toBeCloseTo(back.x, 2);
    // Opposite sides of the straight line between the two spots (which is flat in y).
    expect(Math.sign(out.y - SAMPLE_VIEWPORT.h * 0.5)).toBe(-Math.sign(back.y - SAMPLE_VIEWPORT.h * 0.5));
  });

  it('matches pointOnTravel mid-leg', () => {
    const [a, b] = bounceSpots(SAMPLE_VIEWPORT);
    // progress 0.25 is halfway through the outbound leg: t = 0.5, bow = +0.22.
    const expected = pointOnTravel(a, b, 0.5, 0.22);
    const actual = bounceScenario.headAt!(ctxAt(0.25));
    expect(actual.x).toBeCloseTo(expected.x, 5);
    expect(actual.y).toBeCloseTo(expected.y, 5);
  });
});
