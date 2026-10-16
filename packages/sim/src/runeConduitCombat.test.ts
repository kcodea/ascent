import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { questCombatMods } from './reducer';

/**
 * RUNE OF THE CONDUIT, the RUN half of the combat fix (owner 2026-10-16: "rune of the conduit should work in combat,
 * and for a case of boulderdash, those rubies that bounce should be permanent"). The engine half is
 * `packages/core/src/combat/runeConduitCombat.test.ts`; this proves the run hands the rune to combat (copy count,
 * so a snapshot of this board carries it too) and that a Boulderdash Ruby's bounce lands on the SHOP card at settle.
 */
const body = (uid: string, cardId: string, attack: number, health: number): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], golden: false });
const asMinion = (c: BoardCard): BoardMinion => ({ ...c, sourceUid: c.uid } as unknown as BoardMinion);
const withConduit = (extra: Partial<RunState>): RunState =>
  reduce({ ...createRun(3, 'runesmith', 'ascent', undefined, 'set2'), wave: 7, phase: 'recruit', embers: 20, runeforgeOffer: ['rune_conduit'], ...extra } as RunState,
    { type: 'buyRune', index: 0 }) as RunState;
const rubyOn = (c: BoardCard): number => (c.buffs ?? []).filter((b) => b.source === 'Ruby').reduce((n, b) => n + b.attack + b.health, 0);

/** Fight the run's board with ITS OWN combat mods, then settle through the real reducer. */
const fightAndSettle = (s: RunState): { settled: RunState; hops: number } => {
  const r = simulate(s.board.map(asMinion), [{ cardId: 'sandbag', attack: 1, health: 2000, keywords: [] } as unknown as BoardMinion], makeRng(5), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['kobold', 'dwarf', 'beast', 'dragon', 'demon'], questMods: questCombatMods(s) }), combatSide({ tier: 6 }));
  const hops = r.events.filter((e) => e.type === 'buff' && e.ruby && e.bounce).length;
  const settled = reduce({ ...s, phase: 'combat', combatSettled: false, lastCombat: r } as unknown as RunState, { type: 'resolveCombat' }) as RunState;
  return { settled, hops };
};

describe('Rune of the Conduit — the run hands it to combat', () => {
  const board = () => [body('d', 'k_boulderdash', 6, 400), body('a', 'k_beggy', 2, 400), body('b', 'k_beggy', 2, 400)];

  it('the combat mods carry the COPY COUNT', () => {
    expect(questCombatMods(withConduit({ board: board() })).runeConduit).toBe(1);
    expect(questCombatMods({ ...createRun(3) } as RunState).runeConduit).toBeUndefined();
  });

  it("Boulderdash's bounced Rubies land PERMANENTLY on the Shop board's other cards at settle", () => {
    const { settled, hops } = fightAndSettle(withConduit({ board: board() }));
    expect(hops).toBeGreaterThan(0);
    const others = settled.board.filter((c) => c.uid !== 'd');
    expect(others.reduce((n, c) => n + rubyOn(c), 0), 'the bystanders kept their bounced Rubies').toBeGreaterThan(0);
  });

  it('without the rune nothing bounces and the bystanders keep no Ruby', () => {
    const s = { ...createRun(3, 'runesmith', 'ascent', undefined, 'set2'), wave: 7, phase: 'recruit', board: board() } as RunState;
    const { settled, hops } = fightAndSettle(s);
    expect(hops).toBe(0);
    expect(settled.board.filter((c) => c.uid !== 'd').reduce((n, c) => n + rubyOn(c), 0)).toBe(0);
  });
});
