/**
 * The owner's Kobold / Dwarf card batch (2026-09-24) — every change except Goldilox (its own file,
 * `goldilox.test.ts`) and Striker's repeat form (`repeatPerTick.test.ts` / `set3Dwarves.test.ts`).
 *
 *  - Pickles T2 3/3 · Flagrunner T3 5/4 · Tromboneer T3 4/3 · Brunni T2 (stats unchanged).
 *  - Gemsmith and Double Dealer ARCHIVED (no set, still resolvable by id).
 *  - Beggy back in Set 3 (shared with Set 2).
 *  - Kurse is Kobold/Undead: every tribe count, the Undead channels and the rune board-fit see both halves.
 */
import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '@game/core';
import { ARCHIVED_CARDS, CARD_INDEX, poolFor } from '@game/content';
import { boardSynergyTags, boardTribeCounts, createRun, defIsTribe, isTribe, playedThisTurnFor, type BoardCard, type RunState } from './index';

const body = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};

describe('stat / tier changes (owner 2026-09-24)', () => {
  it.each([
    ['k3_splitpick', 'Pickles', 2, 3, 3],
    ['k3_forksong', 'Flagrunner', 3, 5, 4],
    ['dw3_tromboneer', 'Tromboneer', 3, 4, 3],
    ['dw_brunni', 'Brunni', 2, 3, 2],
  ] as const)('%s (%s) is Tier %i, %i/%i', (id, name, tier, attack, health) => {
    expect(CARD_INDEX[id]).toMatchObject({ name, tier, attack, health });
  });
  it('Brunni is shared, so the change lands in Set 2 AND Set 3', () => {
    expect(poolFor('set2').buyable.some((c) => c.id === 'dw_brunni')).toBe(true);
    expect(poolFor('set3').buyable.some((c) => c.id === 'dw_brunni')).toBe(true);
  });
});

describe('archives and set membership (owner 2026-09-24)', () => {
  it.each([['k3_forkvein', 'Gemsmith'], ['k3_forkedcrown', 'Double Dealer']] as const)('%s (%s) is archived: in no set, still resolvable', (id, name) => {
    expect(ARCHIVED_CARDS.some((c) => c.id === id)).toBe(true);
    for (const set of ['set1', 'set2', 'set3'] as const) expect(poolFor(set).all.some((c) => c.id === id), `${name} not in ${set}`).toBe(false);
    expect(CARD_INDEX[id]?.name, 'saved runs and replays still resolve it').toBe(name);
  });
  it('Beggy is drawable in Set 3 again and still in Set 2', () => {
    expect(poolFor('set3').buyable.some((c) => c.id === 'k_beggy')).toBe(true);
    expect(poolFor('set2').buyable.some((c) => c.id === 'k_beggy')).toBe(true);
  });
});

describe('Kurse — Kobold/Undead dual tribe (owner 2026-09-24)', () => {
  const run = (over: Partial<RunState> = {}): RunState => ({ ...createRun(1), setId: 'set3', phase: 'recruit', ...over } as RunState);

  it('the def and a board body count as BOTH tribes', () => {
    const k = CARD_INDEX['k3_kurse']!;
    expect(k).toMatchObject({ tribe: 'kobold', tribe2: 'undead' });
    expect(defIsTribe(k, 'kobold')).toBe(true);
    expect(defIsTribe(k, 'undead')).toBe(true);
    expect(isTribe(body('k', 'k3_kurse'), 'undead')).toBe(true);
    expect(isTribe(body('k', 'k3_kurse'), 'dwarf')).toBe(false);
  });

  it('tribe counting: the board tally, "Undead played this turn" and the rune board-fit all see the Undead half', () => {
    const s = run({ board: [body('k', 'k3_kurse'), body('u', 'u3_noggin'), body('g', 'k3_goldvein')] });
    const counts = boardTribeCounts(s);
    expect(counts.get('kobold')).toBe(2);
    expect(counts.get('undead'), 'Kurse + Noggin').toBe(2);
    // The Basic Runeforge's board-fit is ≥ 2 of a tribe: Kurse makes this an Undead board as well as a Kobold one.
    const tags = boardSynergyTags(s, false);
    expect(tags.has('undead')).toBe(true);
    expect(tags.has('kobold')).toBe(true);
    expect(playedThisTurnFor({ playedThisTurn: ['k3_kurse'] }, 'undead'), 'a Kurse played counts for Undead-played payoffs').toBe(1);
    expect(playedThisTurnFor({ playedThisTurn: ['k3_kurse'] }, 'kobold')).toBe(1);
  });

  it('Set 3 generation pools reach it as an Undead (a Discover / random-Undead pick can produce it)', () => {
    const undead = poolFor('set3').buyable.filter((c) => defIsTribe(c, 'undead')).map((c) => c.id);
    expect(undead).toContain('k3_kurse');
  });

  it('COMBAT: an Undead aura cast mid-fight (Lantern of Souls) reaches Kurse', () => {
    const CASTER: CardDef = {
      id: 'kx_lantern', name: 'Lantern Caster', tribe: 'neutral', tier: 1, attack: 1, health: 60, keywords: ['RL'],
      effects: [{ on: 'onAttack', do: 'rallyCastTribeAttack', params: { tribe: 'undead', amount: 3, spellId: 'lanternofsouls' } }], // Watcher's Rally
      text: '**Rally:** cast **Lantern of Souls**.',
    };
    const CARDS: Record<string, CardDef> = { ...CARD_INDEX, [CASTER.id]: CASTER };
    const bm = (uid: string, cardId: string, attack: number, health: number): BoardMinion =>
      ({ uid, sourceUid: uid, cardId, attack, health, keywords: [...CARDS[cardId]!.keywords], golden: false } as unknown as BoardMinion);
    const r = simulate([bm('cx', 'kx_lantern', 1, 60), bm('ku', 'k3_kurse', 7, 40)], [bm('sb', 'sandbag', 1, 60)], makeRng(11), CARDS,
      combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const kurseUid = r.initial.player.find((m) => m.cardId === 'k3_kurse')!.uid;
    const casts = r.events.filter((e) => e.type === 'spellcast' && e.side === 'player').length;
    expect(casts, 'the Lantern was cast').toBeGreaterThan(0);
    const buffs = r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.target === kurseUid);
    expect(buffs.length, 'Kurse, an Undead, took the Undead aura').toBeGreaterThan(0);
    // The non-Undead caster is never touched by its own Undead aura.
    const casterUid = r.initial.player.find((m) => m.cardId === 'kx_lantern')!.uid;
    expect(r.events.some((e) => e.type === 'buff' && e.target === casterUid)).toBe(false);
  });
});
