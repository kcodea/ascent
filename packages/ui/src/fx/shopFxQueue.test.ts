import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noteShopAction, resetShopActionPressure } from './actionPressure';
import { cancelShopFx, clearShopFx, shopFxLater, shopFxPending } from './shopFxQueue';
import { heldFor, holdStat, releaseAllStats } from './statHold';

/**
 * THE BACKLOG GUARD (R-PERF-APM-01). The Shop's paced presentation must stay bounded under a burst of input and be
 * back to idle shortly after the input stops, whatever the board fires per action. `npm run perf:apm -- --guard` is
 * the same check on the real game in a real browser.
 */

/** One action's paced presentation on an engine board: `waves` later waves `gap` ms apart, each a callback. */
function presentAction(ran: { n: number }, waves = 6, gap = 150): void {
  for (let w = 1; w <= waves; w++) shopFxLater(() => { ran.n++; }, w * gap);
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] }); vi.setSystemTime(0); });
afterEach(() => { clearShopFx(); releaseAllStats(); resetShopActionPressure(); vi.useRealTimers(); });

describe('the shop FX queue under a burst (R-PERF-APM-01)', () => {
  it('at normal speed every paced step plays: nothing is dropped', () => {
    const ran = { n: 0 };
    for (let i = 0; i < 10; i++) {
      noteShopAction('play');           // one action every 1.5 s
      presentAction(ran);
      vi.advanceTimersByTime(1500);
    }
    expect(ran.n).toBe(60);
    expect(shopFxPending()).toBe(0);
  });

  it('at two actions a second every paced step still plays', () => {
    const ran = { n: 0 };
    for (let i = 0; i < 20; i++) { noteShopAction('play'); presentAction(ran); vi.advanceTimersByTime(500); }
    vi.advanceTimersByTime(2000);
    expect(ran.n).toBe(120);
  });

  it('under 8 actions a second the queue never holds more than a few actions of paced steps, and does not grow', () => {
    const ran = { n: 0 };
    let peak = 0;
    for (let i = 0; i < 240; i++) {     // 30 seconds at 8 actions a second
      noteShopAction(i % 3 === 0 ? 'buy' : i % 3 === 1 ? 'play' : 'sell');
      presentAction(ran);
      peak = Math.max(peak, shopFxPending());
      vi.advanceTimersByTime(125);
    }
    // The first two actions of the burst are not rapid yet, so at most they and the newest are pending together.
    expect(peak).toBeLessThanOrEqual(18);
    // No growth: after 30 seconds only the newest action's steps are waiting.
    expect(shopFxPending()).toBeLessThanOrEqual(6);
  });

  it('is back to idle within one action of presentation after the input stops', () => {
    const ran = { n: 0 };
    for (let i = 0; i < 80; i++) { noteShopAction('play'); presentAction(ran); vi.advanceTimersByTime(125); }
    // The last action's own six waves (900 ms) are all that is left, and they play out.
    const before = ran.n;
    vi.advanceTimersByTime(1000);
    expect(shopFxPending()).toBe(0);
    expect(ran.n - before).toBeGreaterThan(0);
  });

  it('a new rapid action delivers the numbers the earlier actions were still rolling in', () => {
    noteShopAction('play'); holdStat('a', { attack: 4, health: 4 }, { origin: 'cue', startAt: 600 });
    expect(heldFor('a')).toEqual({ attack: 4, health: 4 });
    vi.advanceTimersByTime(125);
    noteShopAction('play'); // the second action: not rapid yet, the hold stands
    expect(heldFor('a')).not.toBeNull();
    vi.advanceTimersByTime(125);
    noteShopAction('play'); // the third inside a second: rapid, so the badge tells the truth
    expect(heldFor('a')).toBeNull();
    // ...and a change that arrives while input is rapid is not withheld at all.
    holdStat('a', { attack: 2 }, { origin: 'intrinsic' });
    expect(heldFor('a')).toBeNull();
  });

  it('once the burst is over a stat change rolls again as authored', () => {
    for (let i = 0; i < 5; i++) { noteShopAction('play'); vi.advanceTimersByTime(125); }
    vi.advanceTimersByTime(1100);
    noteShopAction('play');
    holdStat('a', { attack: 3, health: 3 }, { origin: 'intrinsic' });
    expect(heldFor('a')).toEqual({ attack: 3, health: 3 });
  });

  it('a cancelled step never runs and is not counted as pending', () => {
    const fn = vi.fn();
    const id = shopFxLater(fn, 100);
    cancelShopFx(id);
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    expect(shopFxPending()).toBe(0);
  });
});
