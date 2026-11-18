import { afterEach, describe, expect, it } from 'vitest';
import { noteShopAction, resetShopActionPressure } from './actionPressure';
import { admit, registerLivePlay, resetFxBudget } from './fxBudget';
import { RAPID_FX } from './rapidConfig';
import { rapidPlay } from './rapidPlay';

const DEFAULTS = { ...RAPID_FX };
afterEach(() => { resetShopActionPressure(); resetFxBudget(); Object.assign(RAPID_FX, DEFAULTS); });

/** `n` accepted actions evenly spread over the second before `at`: the player is acting `n` times a second. */
function acting(n: number, at: number): void {
  resetShopActionPressure();
  for (let i = n - 1; i >= 0; i--) noteShopAction('play', at - (i * 1000) / n);
}

describe('how an effect plays under rapid input (R-PERF-APM-01)', () => {
  it('is untouched at up to two actions a second', () => {
    acting(1, 5000);
    expect(rapidPlay({ uids: { target: 'b1' } }, 5000)).toBeNull();
    acting(2, 5000);
    expect(rapidPlay({ uids: { target: 'b1' } }, 5000)).toBeNull();
  });

  it('at three actions a second it is keyed by its recipient and otherwise exactly as authored', () => {
    acting(3, 5000);
    const r = rapidPlay({ uids: { source: 'b0', target: 'b1' } }, 5000);
    expect(r).toEqual({ key: 'rapid:b1', coalesceMs: RAPID_FX.coalesceMs, speed: 1, intensity: 1 });
    // Two buffers on one recipient share the key (one trail per card); two recipients never do.
    expect(rapidPlay({ uids: { source: 'b9', target: 'b1' } }, 5000)?.key).toBe('rapid:b1');
    expect(rapidPlay({ uids: { source: 'b0', target: 'b2' } }, 5000)?.key).toBe('rapid:b2');
  });

  it('plays faster and thinner the faster the player acts, up to the caps', () => {
    acting(4, 5000);
    const four = rapidPlay({ uids: { target: 'b1' } }, 5000)!;
    expect(four.speed).toBeCloseTo(4 / 3, 5);
    expect(four.intensity).toBeCloseTo(3 / 4, 5);
    acting(8, 5000);
    const eight = rapidPlay({ uids: { target: 'b1' } }, 5000)!;
    expect(eight.speed).toBe(RAPID_FX.maxSpeed);
    expect(eight.intensity).toBe(RAPID_FX.minIntensity);
    // Never slower or thicker than authored, whatever the dials say.
    Object.assign(RAPID_FX, { maxSpeed: 0.5, minIntensity: 3 });
    const odd = rapidPlay({ uids: { target: 'b1' } }, 5000)!;
    expect(odd.speed).toBe(1);
    expect(odd.intensity).toBe(1);
  });

  it('keys a play with no recipient by where it lands, on a 16 px grid', () => {
    acting(4, 5000);
    const a = rapidPlay({ target: { x: 1600, y: 700 } }, 5000)?.key;
    expect(a).toBe(rapidPlay({ target: { x: 1603, y: 698 } }, 5000)?.key);
    expect(a).not.toBe(rapidPlay({ target: { x: 900, y: 700 } }, 5000)?.key);
    expect(rapidPlay({}, 5000)?.key).toBeUndefined();
  });

  it('gives no key when the dedupe dial is off, and keeps the pace', () => {
    acting(6, 5000);
    RAPID_FX.dedupe = false;
    const r = rapidPlay({ uids: { target: 'b1' } }, 5000)!;
    expect(r.key).toBeUndefined();
    expect(r.speed).toBeGreaterThan(1);
  });

  it('with that key the budget keeps ONE live play of an effect per recipient across a burst', () => {
    // 8 actions a second for 5 seconds, each landing the same trail on the same seven cards.
    let live = 0; let peak = 0; let spawned = 0; let dropped = 0;
    let t = 0;
    const readers = { liveParticles: () => 0, activeFilters: () => 0, now: () => t };
    for (let i = 0; i < 40; i++) {
      t = i * 125;
      noteShopAction('play', t);
      for (let c = 0; c < 7; c++) {
        const r = rapidPlay({ uids: { target: `b${c}` } }, t);
        const a = admit('tendril-trail-dragon', { particles: 40, filters: 0 }, { key: r?.key, coalesceMs: r?.coalesceMs }, undefined, readers, 'shop');
        if (a.skip) { dropped++; continue; }
        spawned++; live++;
        let gone = false;
        const unregister = registerLivePlay({ id: 'tendril-trail-dragon', load: { particles: 40, filters: 0 }, retire: () => { if (!gone) { gone = true; live--; unregister(); } }, protected: false, bornAt: t, key: r?.key });
      }
      peak = Math.max(peak, live);
    }
    // The first two actions are not rapid yet (two un-keyed plays a card); from the third on each card has one.
    expect(peak).toBeLessThanOrEqual(7 * 3);
    expect(live).toBeLessThanOrEqual(7 * 3);
    // Without the key this is 280 plays, a second's worth of them alive at any moment.
    expect(spawned).toBeLessThan(280 * 0.6);
    expect(dropped).toBeGreaterThan(0);
  });
});
