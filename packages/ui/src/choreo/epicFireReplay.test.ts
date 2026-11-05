import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import { epicFiresOf, replayOrder } from './replayOrder';
import { CARD_EVENT_SLOTS } from '../fx/ui/cardEventSlots';
import { bindingFor } from './bindings';
import { EPIC_UNITS } from '../epicMedallion';

describe('the replay pins each epic fire to the trigger it multiplied (R-FX-EPIC-FIRE-01)', () => {
  it('the marker is never its own event (no beat, no screen time) and rides the next real event', () => {
    const shout = { type: 'shout', source: 'dc', target: 'wk' } as unknown as CombatEvent;
    const events = [{ type: 'epicFire', source: 'drakko' }, shout, { type: 'buff', target: 'wk' }] as unknown as CombatEvent[];
    const ord = replayOrder(events);
    expect(ord.some((e) => e.type === 'epicFire')).toBe(false);
    expect(ord).toHaveLength(2);
    expect(epicFiresOf(ord[0])).toEqual(['drakko']);
    expect(epicFiresOf(ord[1])).toEqual([]);
  });

  it('every epic card offers On Watcher, and every one but Keg-hands plays drakko-effect', () => {
    const slot = CARD_EVENT_SLOTS.find((s) => s.id === 'watcher')!;
    for (const id of EPIC_UNITS) {
      expect(slot.kindFor({ cardId: id, name: '', tribe: '', spell: false, defId: null } as never), id).toBe('watcher');
      if (id === 'dw_edward' || id === 'ce3_constellationprime') continue;
      expect(bindingFor(id, 'watcher')?.def, id).toBe('drakko-effect');
    }
  });
});
