import { describe, expect, it } from 'vitest';
import { ALE_IDS } from '@game/core';
import { aleWatcherUids } from './aleWatcher';

describe('Keg-hands plays his On Watcher effect when an Ale is cast (R-FX-KEGHANDS-WATCH-01)', () => {
  const board = [{ uid: 'k1', cardId: 'dw_edward' }, { uid: 'x', cardId: 'dw_chef' }, { uid: 'k2', cardId: 'dw_edward' }];
  it('fires on every Keg-hands on board for an Ale', () => {
    expect(aleWatcherUids(ALE_IDS[0]!, board)).toEqual(['k1', 'k2']);
  });
  it('stays quiet for a non-Ale spell, or with no Keg-hands', () => {
    expect(aleWatcherUids('not_an_ale', board)).toEqual([]);
    expect(aleWatcherUids(ALE_IDS[0]!, [{ uid: 'x', cardId: 'dw_chef' }])).toEqual([]);
  });
});
