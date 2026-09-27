import { describe, expect, it } from 'vitest';
import { SETS, activeSet } from '@game/content';
import { newRunSurgeTribes } from './index';

/** Practice's "Tribe surge" offers only the tribes of the set a new run uses (owner 2026-09-27: "practice tribe
 *  surge should only have the active set's tribes"). */
describe('Practice tribe surge options', () => {
  it('are exactly the active set tribes (no other set tribe, no neutral)', () => {
    const set = activeSet();
    expect(newRunSurgeTribes()).toEqual(set.tribes.filter((t) => t !== 'neutral'));
  });
  it('a set 2 run never offers Spirit; set 3 does', () => {
    expect(newRunSurgeTribes('set2')).not.toContain('spirit');
    expect(newRunSurgeTribes('set2')).toEqual([...SETS.set2.tribes]);
    expect(newRunSurgeTribes('set3')).toContain('spirit');
  });
});
