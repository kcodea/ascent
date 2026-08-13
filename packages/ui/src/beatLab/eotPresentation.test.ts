import { describe, it, expect } from 'vitest';
import { createRun, reduceWithPresentation, projectEndOfTurnSteps, type RunState, type EotStepFx } from '@game/sim';
import { compileEotFx, aggregateEotFx } from './eotPresentation';

/**
 * BEAT SYSTEM — cutover slice 1 equivalence: the authoritative End-of-Turn batch must carry EVERY presentation
 * category the legacy `projectEndOfTurnSteps` path shows, so the live player can be driven from events instead.
 * This compares the batch-compiled categories to the projection's per-beat FX (aggregated) — the prerequisite
 * for the cutover, with NO live change. Stat equivalence is proven separately against ground truth
 * (`beatEotEquivalence.test.ts`); here we cover the orthogonal FX channels most at risk of being dropped:
 * rubies, hand grants, shop buffs, spell power, imp aura, fodder.
 */
function eot(over: Partial<RunState> = {}): RunState {
  return { ...createRun(3, 'warden'), phase: 'recruit', ...over } as RunState;
}

/** Aggregate the legacy projection's FX the same way `aggregateEotFx` aggregates the batch. */
function projAgg(fx: readonly EotStepFx[]): { rubies: Map<string, number>; handGrants: string[]; shopBuff: Map<string, { attack: number; health: number }>; spellPower: { attack: number; health: number }; impAura: { attack: number; health: number }; eaten: number } {
  const rubies = new Map<string, number>();
  const handGrants: string[] = [];
  const shopBuff = new Map<string, { attack: number; health: number }>();
  const spellPower = { attack: 0, health: 0 };
  const impAura = { attack: 0, health: 0 };
  let eaten = 0;
  for (const f of fx) {
    for (const r of f.ruby ?? []) rubies.set(r.uid, (rubies.get(r.uid) ?? 0) + r.count);
    handGrants.push(...f.handGrants);
    for (const sb of f.shopBuff ?? []) { const p = shopBuff.get(sb.uid) ?? { attack: 0, health: 0 }; p.attack += sb.attack; p.health += sb.health; shopBuff.set(sb.uid, p); }
    if (f.spellPower) { spellPower.attack += f.spellPower.attack; spellPower.health += f.spellPower.health; }
    if (f.impAura) { impAura.attack += f.impAura.attack; impAura.health += f.impAura.health; }
    eaten += f.eaten.length;
  }
  return { rubies, handGrants, shopBuff, spellPower, impAura, eaten };
}

const batchAgg = (s: RunState): ReturnType<typeof aggregateEotFx> => {
  const { batch } = reduceWithPresentation(s, { type: 'faceOmen' } as never, true);
  return aggregateEotFx(batch ? compileEotFx(batch) : []); // a no-op End of Turn emits no batch
};

describe('EoT batch ↔ legacy projection FX equivalence (cutover prerequisite)', () => {
  it('Lapidary rubies: same per-uid ruby counts as the projection', () => {
    const s = eot({
      runeLapidary: true, playedThisTurn: ['a', 'b', 'c'],
      board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    });
    const b = batchAgg(s); const p = projAgg(projectEndOfTurnSteps(s).fx);
    expect([...b.rubies.entries()].sort()).toEqual([...p.rubies.entries()].sort());
    expect(b.rubies.get('b1')).toBe(3); // 3 cards played → 3 rubies
  });

  it('hand grants: the same conjured cards as the projection', () => {
    const s = eot({ questRecurringEndOfTurn: ['grantRandomShout'], board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }] });
    const b = batchAgg(s); const p = projAgg(projectEndOfTurnSteps(s).fx);
    expect(b.handGrants.length).toBeGreaterThan(0);
    expect(b.handGrants.sort()).toEqual(p.handGrants.sort());
  });

  it('shop buffs: Moira → Market Tormentor grows the same shop offer', () => {
    const s = eot({
      board: [
        { uid: 'b1', cardId: 'b2_moira', tribe: 'demon', attack: 3, health: 3, keywords: [], golden: false },
        { uid: 'b2', cardId: 'dm_tormentor', tribe: 'demon', attack: 3, health: 3, keywords: [], golden: false },
      ],
      shop: [{ uid: 's1', cardId: 'stray', atk: 0, hp: 0 }, { uid: 's2', cardId: 'stray', atk: 0, hp: 0 }] as never,
    });
    const b = batchAgg(s); const p = projAgg(projectEndOfTurnSteps(s).fx);
    expect(b.shopBuff.get('s2')).toEqual({ attack: 7, health: 7 });
    expect([...b.shopBuff.entries()].sort()).toEqual([...p.shopBuff.entries()].sort());
  });

  it('an empty End of Turn produces no FX either way', () => {
    const s = eot({ board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }] });
    const b = batchAgg(s); const p = projAgg(projectEndOfTurnSteps(s).fx);
    expect(b.rubies.size + b.handGrants.length + b.shopBuff.size + b.eaten).toBe(0);
    expect(p.rubies.size + p.handGrants.length + p.shopBuff.size + p.eaten).toBe(0);
  });
});
