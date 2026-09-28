import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';
import { mirrorForEnemySeat } from './balance/seatRunner';

/**
 * THE DAMAGE FORMATION's data (owner ask 2026-09-28): the hero damage formation shows the engine's own numbers, so the
 * fight itemizes BOTH sides' blows with the survivors' uids (left to right), and the run loop stamps the round cap and
 * the loss before the cap. All additive: nothing that already read a result changes.
 */
describe('the fight itemizes the blow for the damage formation', () => {
  it('a WIN carries `enemyDamageBreakdown`: the player tier + each survivor, left to right, with uids, summing to `enemyDamage`', () => {
    const player: BoardMinion[] = [
      { cardId: 'stray', attack: 9, health: 40 }, { cardId: 'emissary', attack: 9, health: 40 }, { cardId: 'stray', attack: 9, health: 40 },
    ];
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }];
    const r = simulate(player, enemy, makeRng(5), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 2 }));
    expect(r.result).toBe('win');
    const bd = r.enemyDamageBreakdown!;
    expect(bd.oppTier, 'the STRIKING side is the player here').toBe(5);
    expect(bd.survivorTiers).toEqual(player.map((m) => CARD_INDEX[m.cardId]!.tier));
    expect(bd.oppTier + bd.survivorTiers.reduce((a, b) => a + b, 0)).toBe(r.enemyDamage);
    expect(bd.survivorUids, 'one uid per survivor, index-aligned').toHaveLength(bd.survivorTiers.length);
    expect(new Set(bd.survivorUids).size).toBe(3);
    expect(r.damageBreakdown).toBeUndefined();
  });

  it('a LOSS carries the survivors\' uids on `damageBreakdown`, and no mirror', () => {
    const player: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }];
    const enemy: BoardMinion[] = [{ cardId: 'stray', attack: 9, health: 40 }, { cardId: 'emissary', attack: 9, health: 40 }];
    const r = simulate(player, enemy, makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 4 }));
    expect(r.result).toBe('lose');
    expect(r.damageBreakdown!.survivorUids).toHaveLength(2);
    expect(r.enemyDamageBreakdown).toBeUndefined();
  });

  it('the enemy seat\'s mirror swaps the two breakdowns with the damage they explain', () => {
    const player: BoardMinion[] = [{ cardId: 'stray', attack: 9, health: 40 }];
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }];
    const r = simulate(player, enemy, makeRng(5), CARD_INDEX, combatSide({ tier: 3 }), combatSide({ tier: 2 }));
    const m = mirrorForEnemySeat(r);
    expect(m.result).toBe('lose');
    expect(m.damageBreakdown).toEqual(r.enemyDamageBreakdown);
    expect(m.enemyDamageBreakdown).toBeUndefined();
    expect(m.playerDamage).toBe(r.enemyDamage);
  });
});

describe('the run loop stamps the cap and the blow before it', () => {
  it('a capped loss: `damageCap` is the round cap, `playerDamageUncapped` the full blow, `playerDamage` the capped one', () => {
    // An empty board at tier 6 loses to the whole procedural board: 6 + the survivors' tiers, well past wave 1's cap of 5.
    const s: RunState = { ...createRun(1), wave: 1, tier: 6, board: [] };
    const lc = reduce(s, { type: 'faceOmen' }).lastCombat!;
    expect(lc.result).toBe('lose');
    const bd = lc.damageBreakdown!;
    const full = bd.oppTier + bd.survivorTiers.reduce((a, b) => a + b, 0);
    expect(full).toBeGreaterThan(5);
    expect(lc.damageCap).toBe(5);
    expect(lc.playerDamageUncapped).toBe(full);
    expect(lc.playerDamage).toBe(5);
    expect(bd.survivorUids).toHaveLength(bd.survivorTiers.length);
  });

  it('an uncapped round (16 on) stamps no cap', () => {
    const s: RunState = { ...createRun(1), wave: 16, tier: 3, board: [] };
    const next = reduce(s, { type: 'faceOmen' });
    expect(next.lastCombat!.result).toBe('lose');
    expect(next.lastCombat!.damageCap).toBeUndefined();
    expect(next.lastCombat!.playerDamageUncapped).toBe(next.lastCombat!.playerDamage);
  });
});
