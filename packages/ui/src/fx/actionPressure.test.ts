import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RAPID_ACTIONS, RAPID_WINDOW_MS, countsAsShopAction, noteShopAction, onShopAction, resetShopActionPressure,
  shopActionEpoch, shopActionPressure, shopInputRapid,
} from './actionPressure';

afterEach(() => resetShopActionPressure());

describe('shop action pressure (R-PERF-APM-01)', () => {
  it('is not rapid at up to two actions a second: authored presentation is untouched', () => {
    // An action every 500 ms: never three inside one second.
    for (let i = 0; i < 20; i++) {
      noteShopAction('buy', i * 500);
      expect(shopInputRapid(i * 500)).toBe(false);
    }
  });

  it('is rapid from the third action inside one second, and stays rapid while the burst lasts', () => {
    noteShopAction('buy', 0);
    noteShopAction('play', 150);
    expect(shopInputRapid(150)).toBe(false);
    noteShopAction('sell', 300);
    expect(shopInputRapid(300)).toBe(true);
    for (let t = 450; t < 5000; t += 150) { noteShopAction('roll', t); expect(shopInputRapid(t)).toBe(true); }
    expect(RAPID_ACTIONS).toBe(3);
  });

  it('ends one window after the input stops', () => {
    for (const t of [0, 100, 200, 300]) noteShopAction('buy', t);
    expect(shopInputRapid(300)).toBe(true);
    // 1.15 s after the first action only the two newest remain inside the window; a second after the last, none.
    expect(shopInputRapid(RAPID_WINDOW_MS + 150)).toBe(false);
    expect(shopActionPressure(300 + RAPID_WINDOW_MS)).toBe(0);
  });

  it('counts only the actions a player repeats at speed', () => {
    for (const t of ['buy', 'sell', 'play', 'roll', 'upgrade', 'heroPower']) expect(countsAsShopAction(t)).toBe(true);
    for (const t of ['reposition', 'reorderHand', 'reorderShop', 'discover', 'faceOmen', 'combatSpellCastPreview']) expect(countsAsShopAction(t)).toBe(false);
    const before = shopActionEpoch();
    noteShopAction('reposition', 0); noteShopAction('reorderHand', 1); noteShopAction('discover', 2);
    expect(shopActionPressure(2)).toBe(0);
    expect(shopActionEpoch()).toBe(before);
  });

  it('End Turn clears it: End of Turn beats and the fight are always presented in full', () => {
    for (const t of [0, 100, 200]) noteShopAction('buy', t);
    expect(shopInputRapid(200)).toBe(true);
    noteShopAction('faceOmen', 250);
    expect(shopInputRapid(250)).toBe(false);
  });

  it('tells listeners about each counted action, with whether input is rapid as of it', () => {
    const heard = vi.fn();
    const off = onShopAction(heard);
    noteShopAction('buy', 0); noteShopAction('buy', 100); noteShopAction('buy', 200); noteShopAction('reposition', 250);
    off();
    noteShopAction('buy', 300);
    expect(heard.mock.calls.map((c) => c[0])).toEqual([false, false, true]);
  });

  it('never grows: a long burst keeps only the last window of stamps', () => {
    for (let i = 0; i < 5000; i++) noteShopAction('buy', i * 10);
    expect(shopActionPressure(5000 * 10)).toBeLessThanOrEqual(RAPID_WINDOW_MS / 10 + 1);
  });
});
