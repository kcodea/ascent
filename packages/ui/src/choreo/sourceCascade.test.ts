import { describe, expect, it } from 'vitest';
import { simulate, combatSide, makeRng, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';
import { groupBuffCasts } from './channels/buffCast';
import { SOURCE_CASCADE_MS, sourceCascadeRanks } from './sourceCascade';

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
