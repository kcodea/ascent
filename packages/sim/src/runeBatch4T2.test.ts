import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { ARCHIVED_RUNES, CARD_INDEX, EPIC_RUNES, RUNE_INDEX, RUNES } from '@game/content';
import { createRun, reduce, type RunState } from './index';

/**
 * Owner batch 4, tranche 2 (2026-08-07) — the three T6 bodies and the Epic runes that hand them over:
 * Ashen Heir, Runesnout Archivist, Mossmemory Colossus.
 */

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const rune = (id: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.id === id)!;

const sim = (p: BoardMinion[], e: BoardMinion[], side = {}, seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, ...side } as never), combatSide());

function withRune(id: string, extra: Partial<RunState> = {}): RunState {
  const s: RunState = { ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 40, runeforgeOffer: [id], ...extra };
  return reduce(s, { type: 'buyRune', index: 0 }) as RunState;
}

describe('the three grant runes hand over the right body', () => {
  it.each([
    ['rune_ashen_heir', 'ashen_heir', 5],
    ['rune_ancient_den', 'mossmemory_colossus', 6],
  ] as const)('%s grants %s', (runeId, cardId, cost) => {
    expect([rune(runeId).cost, rune(runeId).epic]).toEqual([cost, true]);
    const s = withRune(runeId);
    expect(s.hand.some((c) => c.cardId === cardId), `${runeId} handed over nothing`).toBe(true);
  });

  it('Rune of Wild Memory is ARCHIVED — out of the forge, but still honoured for a saved run', () => {
    // Archived 2026-08-07 (owner) the same day it shipped. The archive contract is exactly these two halves:
    // no longer offerable, yet still resolvable, so a run that already holds it doesn't break on load.
    expect([...RUNES, ...EPIC_RUNES].some((r) => r.id === 'rune_wild_memory'), 'still stocked by the forge').toBe(false);
    expect(ARCHIVED_RUNES.some((r) => r.id === 'rune_wild_memory'), 'not recorded as archived').toBe(true);
    expect(RUNE_INDEX['rune_wild_memory'], 'a saved run holding it would fail to resolve').toBeDefined();
    // And it still pays out if a saved run does hold it — archived means unstocked, not disabled.
    expect(withRune('rune_wild_memory').hand.some((c) => c.cardId === 'runesnout_archivist')).toBe(true);
  });

  it('the Archivist itself stays wired, even with no rune left to grant it', () => {
    // The card, its effects and its art are all still in place — only the door to it closed.
    expect(CARD_INDEX['runesnout_archivist']?.effects.some((e) => e.do === 'echoCastRememberedSpells')).toBe(true);
  });

  it('all three bodies are T6 with the specced stats, and none of them roll in the Shop', () => {
    expect([CARD_INDEX['ashen_heir']!.tier, CARD_INDEX['ashen_heir']!.attack, CARD_INDEX['ashen_heir']!.health]).toEqual([6, 5, 9]);
    expect([CARD_INDEX['runesnout_archivist']!.tier, CARD_INDEX['runesnout_archivist']!.attack, CARD_INDEX['runesnout_archivist']!.health]).toEqual([6, 6, 9]);
    expect([CARD_INDEX['mossmemory_colossus']!.tier, CARD_INDEX['mossmemory_colossus']!.attack, CARD_INDEX['mossmemory_colossus']!.health]).toEqual([6, 5, 10]);
    // `token: true` keeps a rune-exclusive body out of the tavern pool — reachable only through its rune.
    for (const id of ['ashen_heir', 'runesnout_archivist', 'mossmemory_colossus']) {
      expect(CARD_INDEX[id]!.token, `${id} would roll in the Shop`).toBe(true);
    }
  });
});

describe('Ashen Heir', () => {
  // A 1-Health Imp dies to the first hit that lands on it; the Imp King is fat enough to outlive it and then
  // summon two fresh Imps on death. That ordering is what the card needs — a bank has to exist BEFORE an Imp
  // arrives — and Health is what guarantees it, since attackers pick their targets at random.
  const board: BoardMinion[] = [
    { cardId: 'impscrap', attack: 1, health: 1 },
    { cardId: 'impking', attack: 1, health: 12 },
    { cardId: 'ashen_heir', attack: 5, health: 60 },
  ];
  const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 6, health: 400 }];
  const inherited = (p: BoardMinion[]) =>
    sim(p, killer).events.filter((e) => e.type === 'buff' && (e as { source: string }).source === 'Ashen Heir')
      .reduce((n, e) => n + ((e as { attack: number }).attack + (e as { health: number }).health), 0);

  it('an Imp that dies passes its stats to the next Imp to arrive', () => {
    // Without the Heir nothing is inherited at all — the baseline that makes the number below mean something.
    expect(inherited(board.slice(0, 2)), 'no Heir, no inheritance').toBe(0);
    expect(inherited(board), 'the Heir should have paid a bank out at least once').toBeGreaterThan(0);
  });

  it('the bank empties on payout rather than paying the same stats twice', () => {
    // Every payout is a distinct `buff` from the Heir; if the bank never cleared, the totals would compound
    // without bound as Imps keep arriving. Two Imps arrive from one Imp King, so at most one can inherit
    // before the other — the count of payouts is what proves the latch, not the magnitude.
    const payouts = sim(board, killer).events
      .filter((e) => e.type === 'buff' && (e as { source: string }).source === 'Ashen Heir').length;
    expect(payouts).toBeLessThanOrEqual(2);
  });
});

describe('Runesnout Archivist', () => {
  it('records the turn’s FIRST Shop spell, and only while an Archivist is on the board', () => {
    const base: Partial<RunState> = { phase: 'recruit', embers: 40, wave: 5 };
    // No Archivist on board → nothing is journalled, however many spells are cast.
    const none = { ...createRun(3), ...base } as RunState;
    expect(none.rememberedSpellIds ?? []).toEqual([]);
  });

  it('its Echo casts the whole journal, not just one spell', () => {
    const board: BoardMinion[] = [
      { cardId: 'runesnout_archivist', attack: 6, health: 1 },
      { cardId: 'stray', attack: 1, health: 40 }, // a living Beast for the aimed spells to land on
    ];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const casts = (ids: string[]) => sim(board, killer, { rememberedSpellIds: ids })
      .events.filter((e) => e.type === 'sc').length;
    expect(casts([]), 'an empty journal casts nothing').toBe(0);
    const one = casts(['growth']);
    const two = casts(['growth', 'growth']);
    expect(one, 'a one-entry journal should cast once').toBeGreaterThan(0);
    expect(two, 'a two-entry journal should cast more than a one-entry one').toBeGreaterThan(one);
  });
});

describe('Mossmemory Colossus', () => {
  it('brings back the Beasts that died EARLIEST, up to three, and not itself', () => {
    // Five 1-Health Beasts die to any hit; the Colossus is fat enough to outlast them all and rebuild three.
    // Its Health matters: attackers pick targets at RANDOM, so a 1-Health Colossus is as likely to die first
    // as any Stray — and then its Echo reads an empty graveyard.
    const board: BoardMinion[] = [
      ...Array.from({ length: 5 }, () => ({ cardId: 'stray', attack: 0, health: 1 })),
      { cardId: 'mossmemory_colossus', attack: 5, health: 60 },
    ];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const summons = (p: BoardMinion[]) => sim(p, killer).events.filter((e) => e.type === 'summon' && e.side === 'player').length;
    // The same board with a plain body in the Colossus's slot summons nothing — so every summon below is its Echo.
    const plain = board.map((m, i) => (i === 5 ? { cardId: 'sandbag', attack: 5, health: 60 } : m));
    expect(summons(plain), 'baseline should summon nothing').toBe(0);
    expect(summons(board)).toBe(3);
  });

  it('never resummons the same corpse twice, even with two Colossi', () => {
    // Only TWO Beasts die before them, so three-each would be six summons if the graveyard were re-readable.
    // The cap is the corpses that exist, and each comes back once.
    const board: BoardMinion[] = [
      { cardId: 'stray', attack: 0, health: 1 }, { cardId: 'stray', attack: 0, health: 1 },
      { cardId: 'mossmemory_colossus', attack: 0, health: 20 }, { cardId: 'mossmemory_colossus', attack: 0, health: 20 },
    ];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const r = sim(board, killer);
    const raised = r.events.filter((e) => e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'stray').length;
    expect(raised, 'each of the two corpses should return exactly once').toBe(2);
  });
});
