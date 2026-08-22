import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import { echoWaves, echoWaveDamagedCount } from './useCombatReplay';

/**
 * `echoWaves` finds the spray(s) a dying unit's Echo throws AFTER its death — the targets the spike volley,
 * launched from the dying body, flies at. A `dmg` carries its source; a `shield` (ward pop) belongs to the wave
 * by its shared wave id; golden Fel Spikes sprays twice, so two waves come back in order.
 */
const dmg = (target: string, source: string, wave: number): CombatEvent =>
  ({ type: 'dmg', target, amount: 4, remainingHp: 1, source, wave }) as CombatEvent;
const ward = (target: string, wave: number): CombatEvent =>
  ({ type: 'shield', target, wave }) as CombatEvent;
const death = (target: string): CombatEvent => ({ type: 'death', target, side: 'player' }) as CombatEvent;

describe('echoWaves', () => {
  it('returns the units its ONE wave struck (damaged + warded), in order', () => {
    const events = [death('fs'), ward('e1', 0), dmg('e2', 'fs', 0), dmg('e3', 'fs', 0)];
    expect(echoWaves(events, 'fs', 0)).toEqual([{ wave: 0, uids: ['e1', 'e2', 'e3'] }]);
  });

  it('splits a GOLDEN double-spray into two waves, in order', () => {
    const events = [
      death('fs'),
      dmg('e1', 'fs', 0), dmg('e2', 'fs', 0), // pass 1
      dmg('e1', 'fs', 1), dmg('e2', 'fs', 1), // pass 2 (same targets, its own wave id)
    ];
    expect(echoWaves(events, 'fs', 0)).toEqual([
      { wave: 0, uids: ['e1', 'e2'] },
      { wave: 1, uids: ['e1', 'e2'] },
    ]);
  });

  it('de-dupes a unit that both popped a Ward and took a hit in one wave', () => {
    const events = [death('fs'), ward('e1', 0), dmg('e1', 'fs', 0)];
    expect(echoWaves(events, 'fs', 0)).toEqual([{ wave: 0, uids: ['e1'] }]);
  });

  it('ignores an unrelated wave (a different sprayer)', () => {
    const events = [death('fs'), dmg('x', 'other', 5)];
    expect(echoWaves(events, 'fs', 0)).toEqual([]);
  });

  it('returns nothing for a death with no wave (a plain Deathrattle)', () => {
    const events = [death('fs')];
    expect(echoWaves(events, 'fs', 0)).toEqual([]);
  });
});

/**
 * `echoWaveDamagedCount` counts how many DISTINCT units a given wave actually DAMAGED (a `dmg` fires a number).
 * The land cue gates on this being > 0 (one play per volley); a fully ward-absorbed volley pops no number and
 * stays silent (owner ask 2026-08-22).
 */
describe('echoWaveDamagedCount', () => {
  it('counts the distinct damaged units in a wave', () => {
    const events = [death('fs'), dmg('e1', 'fs', 0), dmg('e2', 'fs', 0), dmg('e3', 'fs', 0)];
    expect(echoWaveDamagedCount(events, 'fs', 0, 0)).toBe(3);
  });

  it('EXCLUDES a ward-absorbed strike (no damage number fired)', () => {
    const events = [death('fs'), ward('e1', 0), dmg('e2', 'fs', 0)];
    expect(echoWaveDamagedCount(events, 'fs', 0, 0)).toBe(1);
  });

  it('counts a unit ONCE even if it took two hits in the wave', () => {
    const events = [death('fs'), dmg('e1', 'fs', 0), dmg('e1', 'fs', 0)];
    expect(echoWaveDamagedCount(events, 'fs', 0, 0)).toBe(1);
  });

  it('scopes to the given wave id, ignoring another wave', () => {
    const events = [death('fs'), dmg('e1', 'fs', 0), dmg('e2', 'fs', 1)];
    expect(echoWaveDamagedCount(events, 'fs', 0, 0)).toBe(1);
    expect(echoWaveDamagedCount(events, 'fs', 1, 0)).toBe(1);
  });
});
