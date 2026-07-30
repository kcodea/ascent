import { describe, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type Keyword } from '@game/core';
import { CARD_INDEX } from '@game/content';
describe('dbg', () => {
  it('x', () => {
    const fod = (n: number) => Array.from({ length: n }, () => ({ cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] }));
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 600 }];
    const run = (mods: object) => {
      const p: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 600 }, ...fod(6)];
      const r = simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast'], questMods: mods as never }), combatSide());
      // The leader is the first player minion in the initial snapshot.
      const lead = r.initial.player[0]!.uid;
      const byLead = r.events.filter((x) => x.type === 'attack' && x.attacker === lead).length;
      const dmg = r.events.filter((x) => x.type === 'attack' && x.attacker === lead).reduce((n, x) => n + ((x as { swing?: number }).swing ?? 0), 0);
      return `leadAttacks=${byLead} leadDamage=${dmg}`;
    };
    console.log('PLAIN    ', run({}));
    console.log('CTRPOINT ', run({ runeCounterpoint: true }));
  });
});
