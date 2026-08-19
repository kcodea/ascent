import { describe, it, expect } from 'vitest';
import { createRun, type RunState } from './index';
import { buffImpsRunWide } from './recruit';

/**
 * THE LIVE IMP STATS FROZE (owner report 2026-08-19: Imp Overseer read "summon an Imp (5/3)" and the (5/3)
 * never moved).
 *
 * Any card that summons an Imp prints the Imp's CURRENT body — base 1/1 plus the run-wide `impBuff` — via
 * `withImpStats`. The UI reaches that value through memos keyed on `run.impBuff` BY REFERENCE (Recruit's
 * `live` and `refViewsByUid` memos, plus the Card/Unit value comparators).
 *
 * `buffImpsRunWide` used to bump `.attack`/`.health` on the existing object. The VALUES were always right —
 * combat applied them correctly — but the object's identity never changed for the whole run, so every one of
 * those memos bailed out and the printed number froze at first render.
 *
 * So the invariant under test is IDENTITY, not arithmetic: a buff must yield a NEW object.
 */
describe('impBuff is replaced, not mutated (live Imp stats)', () => {
  const fresh = (): RunState => ({ ...createRun(1), phase: 'recruit' } as RunState);

  it('accrues the right totals across several buffs', () => {
    const s = fresh();
    buffImpsRunWide(s, 2, 1, 'Imp Overseer');
    buffImpsRunWide(s, 2, 1, 'Imp Overseer');
    expect(s.impBuff).toEqual({ attack: 4, health: 2 });
  });

  it('hands back a NEW object each time — the identity the UI memos depend on', () => {
    const s = fresh();
    buffImpsRunWide(s, 2, 1, 'Imp Overseer');
    const first = s.impBuff;
    buffImpsRunWide(s, 2, 1, 'Imp Overseer');
    // Referential inequality IS the fix: `Object.is(first, s.impBuff)` was true before, so React saw no change.
    expect(s.impBuff).not.toBe(first);
  });

  it('does not retro-mutate a previously captured reference', () => {
    // A memo that closed over the old value must keep seeing the OLD numbers, so a re-render is what reveals
    // the new ones. In-place mutation made the captured object silently change under the memo instead.
    const s = fresh();
    buffImpsRunWide(s, 2, 1, 'Imp Overseer');
    const captured = { ...s.impBuff! };
    const alias = s.impBuff;
    buffImpsRunWide(s, 3, 3, 'Bane');
    expect(alias).toEqual(captured);              // the old reference is frozen in time
    expect(s.impBuff).toEqual({ attack: 5, health: 4 }); // …and the run carries the new total
  });

  it('creates the object on the first buff when the run started with none', () => {
    const s = fresh();
    expect(s.impBuff).toBeUndefined();
    buffImpsRunWide(s, 1, 1, 'Bane');
    expect(s.impBuff).toEqual({ attack: 1, health: 1 });
  });
});
