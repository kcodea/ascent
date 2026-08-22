/**
 * Rune of the Wheel — "Minions in the Shop have +2/+2. Improves every 4 refreshes."
 *
 * A STANDING aura that steps up every 4th refresh — NOT a buff per refresh. It shipped on
 * `shopBuffOnRefresh`, Endless Inventory's engine, which grants a new permanent +2/+2 on EVERY refresh —
 * so ten refreshes made the rune worth ~+24/+24 instead of the printed +6/+6 (owner report 2026-08-21:
 * "it is buffing the shop every refresh").
 */
import { describe, expect, it } from 'vitest';
import type { QuestDef } from '@game/core';
import { RUNE_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';

const bonus = (s: RunState): { atk: number; hp: number } => ({ atk: s.tavernBuyBonus.atk, hp: s.tavernBuyBonus.hp });

/** A run holding the rune, with Gold to burn on rolls. */
function withWheel(): RunState {
  const s: RunState = { ...createRun(1, 'warden'), embers: 99, freeRolls: 0 };
  const rune = RUNE_INDEX['rune_wheel']!;
  // The same path `buyRune` takes (the reward engine reads only reward + name).
  const applied = reduce({ ...s, runeforgeOffer: [rune.id], runeforgeDiscounts: [rune.cost] } as RunState, { type: 'buyRune', index: 0 });
  return { ...applied, embers: 99 };
}

describe('Rune of the Wheel', () => {
  it('grants the base +2/+2 ONCE, at purchase', () => {
    const base = bonus(createRun(1, 'warden'));
    const s = withWheel();
    expect(bonus(s)).toEqual({ atk: base.atk + 2, hp: base.hp + 2 });
    expect(s.shopAuraGrow).toEqual({ step: 2, per: 4, tick: 0, grown: 0 });
  });

  it('three refreshes change NOTHING; the 4th improves the aura by +2/+2', () => {
    let s = withWheel();
    const after = bonus(s);
    for (let i = 0; i < 3; i++) s = { ...reduce(s, { type: 'roll' }), embers: 99 };
    expect(bonus(s)).toEqual(after); // the old engine would already be +6/+6 up here
    s = { ...reduce(s, { type: 'roll' }), embers: 99 };
    expect(bonus(s)).toEqual({ atk: after.atk + 2, hp: after.hp + 2 });
    expect(s.shopAuraGrow).toMatchObject({ tick: 0, grown: 2 });
  });

  it('the meter keeps rolling — the 8th refresh improves it again', () => {
    let s = withWheel();
    const after = bonus(s);
    for (let i = 0; i < 8; i++) s = { ...reduce(s, { type: 'roll' }), embers: 99 };
    expect(bonus(s)).toEqual({ atk: after.atk + 4, hp: after.hp + 4 });
  });

  it('Endless Inventory keeps its own per-refresh semantics', () => {
    // The rune's fix must not bend the quest that legitimately buffs on every refresh.
    let s: RunState = { ...createRun(1, 'warden'), embers: 99, freeRolls: 0 };
    const def: QuestDef = { id: 'q_endless_inventory', name: 'Endless Inventory', tribe: 'demon', tier: 'greater',
      objective: { event: 'shopStats', count: 1 }, reward: { kind: 'shopBuffOnRefresh', attack: 5, health: 5, step: 1, per: 5 } };
    s = { ...s, activeQuests: [{ questId: def.id, progress: 0, completed: false }] };
    // Complete it through the reducer's own advance (progress 0 → 1 on a shopStats tick is fiddly to stage;
    // apply the reward the way settle does — through the shared engine via a rune-shaped buy).
    s = reduce({ ...s, runeforgeOffer: ['__endless__'], runeforgeDiscounts: [0] } as RunState, { type: 'skipRuneforge' });
    // Simplest honest check: set the channel directly and refresh twice — each roll must land +5/+5.
    s = { ...s, shopBuffOnRefresh: { attack: 5, health: 5, step: 1, per: 5, grown: 0, tick: 0 }, embers: 99 };
    const before = bonus(s);
    s = { ...reduce(s, { type: 'roll' }), embers: 99 };
    expect(bonus(s)).toEqual({ atk: before.atk + 5, hp: before.hp + 5 });
    s = { ...reduce(s, { type: 'roll' }), embers: 99 };
    expect(bonus(s)).toEqual({ atk: before.atk + 10, hp: before.hp + 10 });
  });
});
