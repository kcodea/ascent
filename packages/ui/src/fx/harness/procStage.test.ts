import { describe, expect, it } from 'vitest';
import { sandbagBoard, SANDBAG_LIMITS } from './procStage';

describe('sandbagBoard', () => {
  it('builds N sandbags at the requested stats', () => {
    const b = sandbagBoard(3, { count: 4, hp: 30, attack: 2 });
    expect(b.wave).toBe(3);
    expect(b.minions).toHaveLength(4);
    expect(b.minions.every((m) => m.cardId === 'sandbag')).toBe(true);
    expect(b.minions[0].health).toBe(30);
    expect(b.minions[0].attack).toBe(2);
  });

  // A board of zero minions is not a fight — combat would end instantly and the harness would report
  // "no moments" for a card that is working perfectly.
  it('clamps the count to at least one', () => {
    expect(sandbagBoard(1, { count: 0, hp: 10, attack: 1 }).minions).toHaveLength(1);
    expect(sandbagBoard(1, { count: -5, hp: 10, attack: 1 }).minions).toHaveLength(1);
  });

  // 0 health is a corpse; 0 attack is legal and useful (a pure punching bag that never kills you).
  it('clamps health to at least one but allows zero attack', () => {
    expect(sandbagBoard(1, { count: 1, hp: 0, attack: 0 }).minions[0].health).toBe(1);
    expect(sandbagBoard(1, { count: 1, hp: 10, attack: 0 }).minions[0].attack).toBe(0);
    expect(sandbagBoard(1, { count: 1, hp: 10, attack: -3 }).minions[0].attack).toBe(0);
  });

  it('clamps to the published limits so the UI and the builder agree', () => {
    const big = sandbagBoard(1, { count: 999, hp: 99999, attack: 99999 });
    expect(big.minions).toHaveLength(SANDBAG_LIMITS.maxCount);
    expect(big.minions[0].health).toBe(SANDBAG_LIMITS.maxHp);
    expect(big.minions[0].attack).toBe(SANDBAG_LIMITS.maxAttack);
  });

  it('stamps the wave it was built for', () => {
    expect(sandbagBoard(7, { count: 1, hp: 1, attack: 1 }).wave).toBe(7);
  });

  // `clamp` has a dedicated non-finite branch, and it must fall to the LOW bound: a NaN that resolved to
  // the maximum would silently stage 7 sandbags at 9999 HP and a fight that never ends.
  it('falls to the low bound for non-finite input', () => {
    const b = sandbagBoard(1, { count: Number.NaN, hp: Number.POSITIVE_INFINITY, attack: Number.NaN });
    expect(b.minions).toHaveLength(1);
    expect(b.minions[0].health).toBe(1);
    expect(b.minions[0].attack).toBe(0);
  });

  it('reports power for the board it actually built — power is now Σ(attack+health) — see stagedBoard', () => {
    const b = sandbagBoard(1, { count: 3, hp: 20, attack: 2 });
    expect(b.power).toBe((2 + 20) * 3); // was hp * n (60) before sandbagBoard routed through stagedBoard
  });
});
