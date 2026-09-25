import { describe, expect, it } from 'vitest';
import { simulate, combatSide, makeRng, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';
import { groupBuffCasts } from './channels/buffCast';
import { SOURCE_CASCADE_MS, sourceCascadeRanks, steppedRevealPlan } from './sourceCascade';
import { heldFor, holdStat, releaseAllStats, revealStat, revealedForShown, withheldFraction } from '../fx/statHold';

describe('sourceCascadeRanks — left-most source fires first (owner 2026-09-24, two King Oonas)', () => {
  const cast = (source: string, target: string) => ({ source, target });
  const all = () => true;

  it('ranks distinct sources left to right by screen x, whatever order the log fired them in', () => {
    const xs: Record<string, number> = { right: 900, left: 100, mid: 500 };
    const ranks = sourceCascadeRanks([cast('right', 't'), cast('left', 't'), cast('mid', 't')], (u) => xs[u] ?? null, all);
    expect([...ranks.entries()]).toEqual([['left', 0], ['mid', 1], ['right', 2]]);
    expect(SOURCE_CASCADE_MS).toBe(200);
  });

  it('every cast from one source shares its rank', () => {
    const ranks = sourceCascadeRanks([cast('a', 't1'), cast('b', 't1'), cast('a', 't2')], (u) => (u === 'a' ? 1 : 2), all);
    expect(ranks.get('a')).toBe(0);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.size).toBe(2);
  });

  it('skips casts that do not take part, and puts an unmeasurable source last in log order', () => {
    const ranks = sourceCascadeRanks(
      [cast('ghost', 't'), cast('spell', 't'), cast('a', 't')],
      (u) => (u === 'a' ? 10 : null),
      (c) => c.source !== 'spell',
    );
    expect([...ranks.entries()]).toEqual([['a', 0], ['ghost', 1]]);
  });

  it('a REAL fight with two Oonas puts both doublings in ONE beat, and the left Oona ranks first', () => {
    const p: BoardMinion[] = [
      { cardId: 'b2_oona', attack: 1, health: 60 }, { cardId: 'b2_trex', attack: 1, health: 1 }, { cardId: 'b2_oona', attack: 1, health: 60 },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 60 }];
    const r = simulate(p, e, makeRng(1), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast'] }));
    const board = r.initial.player.map((m) => m.uid);
    const oonas = r.initial.player.filter((m) => m.cardId === 'b2_oona').map((m) => m.uid);
    const wave = compileMoments(r.events).find((m) => {
      const srcs = new Set(groupBuffCasts(m, r.events).map((c) => c.source));
      return oonas.every((u) => srcs.has(u));
    });
    expect(wave, 'both Oonas fire in the same beat — the case the cascade exists for').toBeTruthy();
    // Board slot index stands in for screen x (the player row runs left to right).
    const ranks = sourceCascadeRanks(groupBuffCasts(wave!, r.events), (u) => board.indexOf(u), (c) => oonas.includes(c.source));
    expect(ranks.get(oonas[0]!)).toBe(0);
    expect(ranks.get(oonas[1]!)).toBe(1);
  });
});

describe('steppedRevealPlan — each doubling rolls in on its own banana (owner 2026-09-24)', () => {
  it('revealedForShown is the exact inverse of the badge curve', () => {
    for (const shown of [0, 0.1, 1 / 3, 0.5, 0.9, 1]) expect(1 - withheldFraction(revealedForShown(shown))).toBeCloseTo(shown, 10);
  });

  it('orders steps by strike TIME and assigns gains in LOG order, the last landing exactly on 1', () => {
    const plan = steppedRevealPlan([2, 4], [1100, 700]);
    expect(plan.map((p) => p.atMs)).toEqual([700, 1100]);
    expect(plan[0]!.from).toBe(0);
    expect(1 - withheldFraction(plan[0]!.to)).toBeCloseTo(2 / 6, 10);
    expect(plan[1]).toEqual({ atMs: 1100, from: plan[0]!.to, to: 1 });
  });

  it('a single strike is one full roll at that strike; no gain still resolves on the first strike', () => {
    expect(steppedRevealPlan([3], [700])).toEqual([{ atMs: 700, from: 0, to: 1 }]);
    expect(steppedRevealPlan([0, 0], [700, 1100])).toEqual([{ atMs: 700, from: 0, to: 1 }]);
    expect(steppedRevealPlan([], [])).toEqual([]);
  });

  it('the badge prints every true value: 2/2 doubled twice shows 2 → 4 → 8', () => {
    try {
      // The beat's whole gain (+6/+6) is held; the badge shows current (8) minus what is withheld.
      holdStat('beast', { attack: 6, health: 6 }, { origin: 'effect', ttlMs: 60_000 });
      expect(heldFor('beast')).toEqual({ attack: 6, health: 6 });   // shows 2/2
      const [first, second] = steppedRevealPlan([2 + 2, 4 + 4], [700, 1100]);
      revealStat('beast', first!.to);
      expect(heldFor('beast')).toEqual({ attack: 4, health: 4 });   // shows 4/4 after the first banana
      revealStat('beast', second!.to);
      expect(heldFor('beast')).toBeNull();                          // shows 8/8 after the second
    } finally { releaseAllStats(); }
  });

  it('in a REAL two-Oona fight the second doubling gains twice what the first did (so the steps differ)', () => {
    const p: BoardMinion[] = [
      { cardId: 'b2_oona', attack: 1, health: 60 }, { cardId: 'b2_trex', attack: 1, health: 1 }, { cardId: 'b2_oona', attack: 1, health: 60 },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 60 }];
    const r = simulate(p, e, makeRng(1), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast'] }));
    const oonas = new Set(r.initial.player.filter((m) => m.cardId === 'b2_oona').map((m) => m.uid));
    const wave = compileMoments(r.events).find((m) => groupBuffCasts(m, r.events).filter((c) => oonas.has(c.source)).length === 2);
    const [a, b] = groupBuffCasts(wave!, r.events).filter((c) => oonas.has(c.source));
    expect(b!.attack).toBe(2 * a!.attack);
    expect(b!.health).toBe(2 * a!.health);
  });
});
