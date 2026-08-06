import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  anySummonHeld, holdSummon, isSummonHeld, releaseAllSummons, releaseSummon, releaseSummons,
  subscribeSummonHolds, summonHoldVersion, SUMMON_HOLD_TTL_MS,
} from './summonHold';

beforeEach(() => releaseAllSummons());
afterEach(() => { releaseAllSummons(); vi.restoreAllMocks(); });

describe('summonHold', () => {
  it('withholds a unit and shows it again on release', () => {
    expect(isSummonHeld('cub')).toBe(false);
    holdSummon('cub');
    expect(isSummonHeld('cub')).toBe(true);
    releaseSummon('cub');
    expect(isSummonHeld('cub')).toBe(false);
  });

  /** The render path checks this before filtering at all, so the common case (every fight with no bound
   *  Rally in it) must cost one property read and no allocation. */
  it('reports nothing held when nothing is held', () => {
    expect(anySummonHeld()).toBe(false);
    holdSummon('cub');
    expect(anySummonHeld()).toBe(true);
    releaseAllSummons();
    expect(anySummonHeld()).toBe(false);
  });

  it('releases a whole litter with one notification', () => {
    holdSummon('cub1'); holdSummon('cub2');
    let fires = 0;
    const stop = subscribeSummonHolds(() => { fires++; });
    releaseSummons(['cub1', 'cub2']);
    expect(fires).toBe(1);                       // one, not two — the cubs appear together, not as a ripple
    expect(isSummonHeld('cub1')).toBe(false);
    expect(isSummonHeld('cub2')).toBe(false);
    stop();
  });

  /** Releasing something not held is the COMMON case, not an error: the cue releases every land whether or
   *  not the layout effect got there first. It must not notify, or every land re-renders the board. */
  it('is silent when releasing something that was never held', () => {
    let fires = 0;
    const stop = subscribeSummonHolds(() => { fires++; });
    releaseSummon('nobody');
    releaseSummons(['nobody', 'also-nobody']);
    expect(fires).toBe(0);
    stop();
  });

  /**
   * THE failure this module must be immune to. A release timer lives in the cue's teardown, so a seek, a
   * speed change or a moment advance can cancel it — and a stranded hold doesn't show a wrong number, it
   * hides a live minion. The TTL is what guarantees the unit comes back.
   */
  it('fails OPEN — an unclaimed hold expires and the unit reappears', () => {
    // The clock is stubbed rather than advanced with fake timers: this module has no timer of its own (it
    // sweeps on read), so only `performance.now` moving matters. Same approach as statHold.test.ts.
    const t0 = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => t0);
    holdSummon('orphan');
    expect(isSummonHeld('orphan')).toBe(true);
    vi.spyOn(performance, 'now').mockImplementation(() => t0 + SUMMON_HOLD_TTL_MS - 1);
    expect(isSummonHeld('orphan')).toBe(true);
    vi.spyOn(performance, 'now').mockImplementation(() => t0 + SUMMON_HOLD_TTL_MS + 1);
    expect(isSummonHeld('orphan')).toBe(false);
  });

  /** Swept on read, not merely reported as absent — an expired entry must not accumulate. */
  it('sweeps an expired hold out of the map rather than leaking it', () => {
    const t0 = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => t0);
    holdSummon('orphan');
    vi.spyOn(performance, 'now').mockImplementation(() => t0 + SUMMON_HOLD_TTL_MS + 1);
    expect(isSummonHeld('orphan')).toBe(false);   // the read is what sweeps…
    expect(anySummonHeld()).toBe(false);          // …so the entry is genuinely gone, not just reported absent
  });

  it('re-holding refreshes the expiry instead of stacking', () => {
    const t0 = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => t0);
    holdSummon('cub');
    vi.spyOn(performance, 'now').mockImplementation(() => t0 + SUMMON_HOLD_TTL_MS - 100);
    holdSummon('cub');                                                                    // refreshed
    vi.spyOn(performance, 'now').mockImplementation(() => t0 + SUMMON_HOLD_TTL_MS + 100);  // past the ORIGINAL expiry
    expect(isSummonHeld('cub')).toBe(true);
  });

  it('bumps a version on every change, for useSyncExternalStore', () => {
    const before = summonHoldVersion();
    holdSummon('cub');
    expect(summonHoldVersion()).toBeGreaterThan(before);
    const held = summonHoldVersion();
    releaseSummon('cub');
    expect(summonHoldVersion()).toBeGreaterThan(held);
  });

  it('releaseAll is silent when there is nothing to drop', () => {
    let fires = 0;
    const stop = subscribeSummonHolds(() => { fires++; });
    releaseAllSummons();
    expect(fires).toBe(0);
    stop();
  });
});
