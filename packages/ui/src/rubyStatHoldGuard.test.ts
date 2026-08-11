import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * REGRESSION PIN — the Ruby stat-hold effect must advance its own guard ref.
 *
 * The bug this exists to prevent (shipped in #947, reported by the owner as "unit stats reset to 0 and roll
 * on every action, seems Ruby related"):
 *
 * `Recruit.tsx` withholds a Ruby's stat change from the badge in a `useLayoutEffect`, guarded by
 * `seq === prevRubyLandedSeq.current` so it fires once per Ruby event. Its dependency array includes
 * `run.board` (the effect reads the board to find each Ruby buff). If the guard ref is never ADVANCED, the
 * guard passes forever after the first Ruby, and every later board change — buy, sell, freeze, any action —
 * re-enters the effect and re-places the SAME hold. `holdStat` carries the unrevealed remainder and restarts
 * the roll (see `fx/statHold.ts`), so a re-placed hold grows without bound and the badge collapses toward 0
 * and rolls on every action. Because the hold store is module-global and keyed by uid, the stuck hold rides
 * into combat too, so combat numbers read wrong as well.
 *
 * #947 replaced the old cue effect that used to own the `prevRubyLandedSeq.current = seq` advance and deleted
 * the line with it, orphaning the guard. There is no render harness for `Recruit`, which is why CI stayed
 * green through the regression — so this pins the invariant at the source level, the same technique the fx
 * primitives use when the runtime can't be exercised headlessly.
 */
const SRC = readFileSync(new URL('./Recruit.tsx', import.meta.url), 'utf8');

/** The Ruby stat-hold effect body: from its guard line to its own dependency array. Isolating it keeps the
 *  assertions about THIS effect, not about some other use of the same identifiers elsewhere in the file. */
function rubyHoldEffect(): string {
  const start = SRC.indexOf('const seq = run.rubyLandedFxSeq;');
  expect(start, 'the Ruby stat-hold effect must still exist').toBeGreaterThan(-1);
  const end = SRC.indexOf('[run.rubyLandedFxSeq, run.rubyLandedFx, run.board]', start);
  expect(end, 'the effect must still key off rubyLandedFxSeq + rubyLandedFx + board').toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe('Ruby stat-hold guard', () => {
  it('reads prevRubyLandedSeq as a guard', () => {
    expect(rubyHoldEffect()).toContain('seq === prevRubyLandedSeq.current');
  });

  /** THE line #947 deleted. Reading a guard it never writes is the whole bug. */
  it('advances prevRubyLandedSeq, so it fires once per Ruby event and not once per board change', () => {
    expect(rubyHoldEffect()).toContain('prevRubyLandedSeq.current = seq');
  });

  /** The advance must sit BEFORE the placement, or a hold is placed on the re-entrant pass before the guard
   *  is closed. (Advancing after the loop would still leave the effect re-placeable within a single React
   *  batch that re-ran it before the ref committed.) */
  it('advances the guard before placing any hold', () => {
    const body = rubyHoldEffect();
    expect(body.indexOf('prevRubyLandedSeq.current = seq'))
      .toBeLessThan(body.indexOf('holdStat('));
  });
});
