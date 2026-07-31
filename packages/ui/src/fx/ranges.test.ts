import { describe, expect, it } from 'vitest';
import { settleParam } from './paramTransform';
// Side-effect import: every built-in primitive self-registers at load, which is what lets `getPrimitive`
// below see them (same mechanism and reason as `defs.test.ts`).
import './primitives';
import { getPrimitive } from './registry';

/**
 * The proof that WIDENING A SLIDER'S RANGE changed nothing that already existed.
 *
 * The 2026-07-30 headroom pass moved 42 slider bounds (burst speed 800 → 3000, gravity 800 → 4000, and so
 * on) because the specs capped below what the owner needed — `coins` wanted `gravity 1700` and had to trade
 * launch speed for arc height; `strike-impact`'s sparks sat exactly on the `speed` ceiling of 800. Widening
 * a range is a change to every def that uses the param, so it needs an argument, and the argument has two
 * halves. `defs.test.ts` owns the first (no committed def is being clamped today). This file owns the second.
 *
 * ── half one: STORED values are untouched ──────────────────────────────────────────────────────────────
 * `coerceParams` clamps a slider to `[min, max]` and does NOTHING else — it never snaps to `step`. So a
 * stored `v` is rewritten only when it falls outside the range. A def's values were written under the OLD
 * spec, so `v ∈ [oldMin, oldMax]`; if the new range CONTAINS the old one, `v` is still inside it and comes
 * back out identical. That is `contains the pre-widening range` below, and it is why the frozen table exists:
 * "widened" and "narrowed" are the same one-character edit, and only one of them is safe.
 *
 * ── half two: SCALED values are untouched too ──────────────────────────────────────────────────────────
 * The stored value is not the only thing a range reaches. `settleParam` (`scaleDef`'s per-call `scale` /
 * `intensity` / `time`, and the preset gallery's variant axes) clamps to the range AND snaps to
 * `min + round((v - min) / step) * step`. That grid is anchored on `min`, so moving a `min` by anything other
 * than a whole number of steps would silently re-quantise every scaled call on an existing def — a look
 * change with no diff to point at. Hence `aligns every widened min to the step grid`, and hence no `step`
 * moved in that pass at all (the sliders are drag-driven, so `step` is the keyboard/fine granularity, not
 * what makes a range crossable).
 *
 * Add a row here whenever you move a bound. A row that no longer matches its spec's `min`/`max` is not a
 * failure to delete — it is the test telling you the edit did more than widen.
 */

/** A bound as it stood BEFORE the widening pass. Frozen on purpose: the point is to compare against history,
 *  so this table must never be regenerated from the live specs. */
interface FrozenRange {
  primitive: string;
  key: string;
  min: number;
  max: number;
}

const PRE_WIDENING: readonly FrozenRange[] = [
  // burst
  { primitive: 'burst', key: 'count', min: 4, max: 120 },
  { primitive: 'burst', key: 'interval', min: 100, max: 2000 },
  { primitive: 'burst', key: 'speed', min: 20, max: 800 },
  { primitive: 'burst', key: 'gravity', min: -400, max: 800 },
  { primitive: 'burst', key: 'life', min: 120, max: 1500 },
  { primitive: 'burst', key: 'turbulence', min: 0, max: 400 },
  { primitive: 'burst', key: 'emitRadius', min: 0, max: 120 },
  { primitive: 'burst', key: 'size', min: 2, max: 40 },
  { primitive: 'burst', key: 'stretchX', min: 0.2, max: 4 },
  { primitive: 'burst', key: 'stretchY', min: 0.2, max: 4 },
  // emitter
  { primitive: 'emitter', key: 'rate', min: 5, max: 300 },
  { primitive: 'emitter', key: 'life', min: 200, max: 2000 },
  { primitive: 'emitter', key: 'speed', min: 0, max: 400 },
  { primitive: 'emitter', key: 'gravity', min: -400, max: 400 },
  { primitive: 'emitter', key: 'turbulence', min: 0, max: 400 },
  { primitive: 'emitter', key: 'emitRadius', min: 0, max: 120 },
  { primitive: 'emitter', key: 'size', min: 2, max: 30 },
  { primitive: 'emitter', key: 'stretchX', min: 0.2, max: 4 },
  { primitive: 'emitter', key: 'stretchY', min: 0.2, max: 4 },
  // smoke
  { primitive: 'smoke', key: 'rate', min: 5, max: 300 },
  { primitive: 'smoke', key: 'life', min: 200, max: 2000 },
  { primitive: 'smoke', key: 'speed', min: 0, max: 400 },
  { primitive: 'smoke', key: 'gravity', min: -400, max: 400 },
  { primitive: 'smoke', key: 'spin', min: 0, max: 180 },
  { primitive: 'smoke', key: 'turbulence', min: 0, max: 400 },
  { primitive: 'smoke', key: 'emitRadius', min: 0, max: 120 },
  { primitive: 'smoke', key: 'size', min: 2, max: 30 },
  { primitive: 'smoke', key: 'stretchX', min: 0.2, max: 4 },
  { primitive: 'smoke', key: 'stretchY', min: 0.2, max: 4 },
  // shockwave
  { primitive: 'shockwave', key: 'rings', min: 1, max: 5 },
  { primitive: 'shockwave', key: 'speed', min: 0.1, max: 3 },
  { primitive: 'shockwave', key: 'fade', min: 0.3, max: 3 },
  { primitive: 'shockwave', key: 'radius', min: 40, max: 400 },
  { primitive: 'shockwave', key: 'ease', min: 0.3, max: 3 },
  // ribbon
  { primitive: 'ribbon', key: 'length', min: 60, max: 700 },
  { primitive: 'ribbon', key: 'width', min: 8, max: 160 },
  { primitive: 'ribbon', key: 'tail', min: 0.3, max: 4 },
  { primitive: 'ribbon', key: 'waveAmp', min: 0, max: 40 },
  { primitive: 'ribbon', key: 'waveFreq', min: 0.2, max: 8 },
  { primitive: 'ribbon', key: 'waveSpeed', min: 0, max: 12 },
  { primitive: 'ribbon', key: 'drain', min: 0, max: 2000 },
];

/** The live slider spec behind a frozen row, or a readable problem string. */
function liveSpec(row: FrozenRange): { min: number; max: number; step: number } | string {
  const prim = getPrimitive(row.primitive);
  if (!prim) return `${row.primitive}: not a registered primitive`;
  const spec = prim.params[row.key];
  if (!spec) return `${row.primitive}.${row.key}: no such param`;
  if (spec.kind !== 'slider') return `${row.primitive}.${row.key}: is a '${spec.kind}', not a slider`;
  return { min: spec.min, max: spec.max, step: spec.step };
}

describe('slider range widening', () => {
  // The vacuous-pass guard `defs.test.ts` also carries: if the registry ever came up empty, every loop below
  // would iterate a list of misses rather than silently reporting green.
  it('resolves every frozen row to a live slider spec', () => {
    const problems = PRE_WIDENING.map(liveSpec).filter((r): r is string => typeof r === 'string');
    expect(problems).toEqual([]);
    expect(PRE_WIDENING.length).toBeGreaterThan(0);
  });

  it('contains the pre-widening range — nothing narrowed, so no stored value can start being clamped', () => {
    const problems: string[] = [];
    for (const row of PRE_WIDENING) {
      const live = liveSpec(row);
      if (typeof live === 'string') continue; // already reported above
      if (live.min > row.min) problems.push(`${row.primitive}.${row.key}: min ${row.min} → ${live.min} NARROWED`);
      if (live.max < row.max) problems.push(`${row.primitive}.${row.key}: max ${row.max} → ${live.max} NARROWED`);
    }
    expect(problems).toEqual([]);
  });

  // Every widened bound is dead weight if it isn't actually wider — this catches a row added to the table
  // without the edit it is meant to document.
  it('actually widened something on every row', () => {
    const problems: string[] = [];
    for (const row of PRE_WIDENING) {
      const live = liveSpec(row);
      if (typeof live === 'string') continue;
      if (live.min === row.min && live.max === row.max) {
        problems.push(`${row.primitive}.${row.key}: identical to the frozen range — nothing was widened`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('aligns every widened min to the step grid, so scaled calls re-quantise nowhere', () => {
    const problems: string[] = [];
    for (const row of PRE_WIDENING) {
      const live = liveSpec(row);
      if (typeof live === 'string') continue;
      const shift = row.min - live.min;
      if (shift === 0) continue;
      // Float dust: 0.30000000000000004 % 0.05 is not 0. Compare in step units instead.
      const steps = shift / live.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        problems.push(
          `${row.primitive}.${row.key}: min moved ${row.min} → ${live.min}, which is ${steps} steps ` +
            `of ${live.step} — a fractional shift moves settleParam's snap grid`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  /**
   * The half-two claim, exercised rather than only argued: for every value the OLD range could hold,
   * `settleParam` returns exactly what it returned before. Ten samples across each old range is enough — the
   * function is piecewise-linear in `value` with breakpoints only at the two clamps and the step grid, all
   * three of which this walk crosses.
   */
  it('settleParam is unchanged for every value inside the old range', () => {
    const problems: string[] = [];
    for (const row of PRE_WIDENING) {
      const live = liveSpec(row);
      if (typeof live === 'string') continue;
      for (let i = 0; i <= 10; i++) {
        const v = row.min + ((row.max - row.min) * i) / 10;
        const before = settleParam(v, row.min, row.max, live.step);
        const after = settleParam(v, live.min, live.max, live.step);
        if (before !== after) {
          problems.push(`${row.primitive}.${row.key}: settleParam(${v}) was ${before}, is now ${after}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
