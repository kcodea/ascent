import { describe, expect, it } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, EQUIPMENT_FX_ANCHOR, type BoardCard, type RunState } from './index';

/** Dual Rubetta's improves your Rubies from the EQUIPMENT slot, so the Ruby-power flourish anchors there, not over
 *  the hand (owner report 2026-09-27: "ruby buff goes over hand instead of the equipment for dual rubettas"). */
const body = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, tribes: ['kobold', 'undead', 'dwarf'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);

describe('an Equipment-driven Ruby power gain anchors on the Equipment slot', () => {
  it("Dual Rubetta's stamps the Equipment anchor; a card play still stamps its own uid", () => {
    let s = run({ hand: [body('ka', 'k3_kaura')], board: [body('l', 'k3_korn'), body('r', 'k_beggy')] });
    s = reduce(s, { type: 'play', uid: 'ka', toIndex: 1 });
    const seq = s.rubyPowerFxSeq ?? 0;
    s = reduce(s, { type: 'activateEquipment' });
    expect(s.rubyPowerFxSeq).toBe(seq + 1);
    expect(s.rubyPowerFxUid).toBe(EQUIPMENT_FX_ANCHOR);
  });
});
