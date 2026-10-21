import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type Keyword } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { heroOfferPrice } from './recruit';

/**
 * R-ALL-TYPES-EVERYWHERE-01 (owner 2026-10-21, "yes"): an All-types minion counts as EVERY tribe in the remaining
 * places that still read the printed tribe and second tribe by hand. The tribe card pools (offers and grants) take
 * an All-types card into every tribe's pool; the tribe counters and checks see it as that tribe.
 *
 * Every test below fails on the old code (the raw `c.tribe === t || c.tribe2 === t` reads).
 */

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const card = (uid: string, cardId: string, a = 2, h = 2, extra: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false, ...extra });
const isAllTypes = (id: string): boolean => !!CARD_INDEX[id]?.universalTribe;
const PARAGON = 'n2_paragon';

describe('All types counts as every tribe: the Shop', () => {
  it('fixture: Paragon is printed All types and neutral', () => {
    expect(CARD_INDEX[PARAGON]?.universalTribe).toBe(true);
    expect(CARD_INDEX[PARAGON]?.tribe).toBe('neutral');
  });

  it('Hoardflame counts an All-types minion played this turn as a Dragon', () => {
    const cast = (played: string[]): number => {
      const s: RunState = {
        ...createRun(4), phase: 'recruit', embers: 20,
        board: [card('t', 'sandbag', 0, 10)],
        hand: [card('h1', 'hoardflame', 0, 1)],
        playedThisTurn: played,
      } as RunState;
      const after = reduce(s, { type: 'play', uid: 'h1', targetUid: 't' } as never) as RunState;
      return after.board.find((c) => c.uid === 't')!.attack;
    };
    expect(cast([PARAGON]) - cast([]), 'the Paragon added the per-Dragon +1 Attack').toBe(1);
  });

  it('Sigil of Kinship refills a Dragon Shop with an All-types minion', () => {
    const base = createRun(9, undefined, 'ascent', undefined, 'set2');
    const pool: Record<string, number> = {};
    for (const id of Object.keys(base.pool)) pool[id] = 0;
    pool[PARAGON] = 3; // the only copies left anywhere
    const dragon = Object.values(CARD_INDEX).find((c) => c.tribe === 'dragon' && !c.tribe2 && !c.spell && !c.token && !c.universalTribe)!;
    const s: RunState = {
      ...base, phase: 'recruit', embers: 20, tier: 6, pool, shop: [],
      board: [card('d', dragon.id)],
      hand: [card('h1', 'sigilkinship', 0, 1)],
    } as RunState;
    const after = reduce(s, { type: 'play', uid: 'h1', targetUid: 'd' } as never) as RunState;
    expect(after.shop.map((o) => o.cardId), 'the All-types Paragon is a Dragon for the refill').toContain(PARAGON);
  });

  it('Rune of Basic Dragons can hand you an All-types minion', () => {
    const granted = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const s: RunState = {
        ...createRun(seed, 'runesmith', 'ascent', undefined, 'set2'), wave: 7, tier: 6, phase: 'recruit', embers: 40,
        hand: [], runeforgeOffer: ['rune_basic_dragon'],
      } as RunState;
      const after = reduce(s, { type: 'buyRune', index: 0 }) as RunState;
      for (const c of after.hand) granted.add(c.cardId);
    }
    expect([...granted].some(isAllTypes), `drip grants over 60 seeds: ${[...granted].join(', ')}`).toBe(true);
  });

  it('Rune of Spellhide banks a stat spell cast on an All-types minion (its Beast check)', () => {
    let s: RunState = {
      ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 40, gold: 0, shop: [],
      runeforgeOffer: ['rune_spellhide'],
      board: [card('p', PARAGON, 5, 5), card('other', 'sandbag', 0, 50)],
      hand: [card('sf0', 'spiritfire')],
    } as RunState;
    s = reduce(s, { type: 'buyRune', index: 0 }) as RunState;
    s = reduce(s, { type: 'play', uid: 'sf0', targetUid: 'p' } as never) as RunState;
    expect(s.spellhidePending).toEqual([{ spellId: 'spiritfire', uid: 'p' }]);
  });

  it("Flint's Company Rate prices an All-types offer as a Dwarf", () => {
    const s = createRun(5, 'flint');
    expect(heroOfferPrice(s, { cardId: PARAGON })).toBe(2);
  });
});

describe('All types counts as every tribe: combat', () => {
  const sim = (p: BoardMinion[], e: BoardMinion[], mods: object) =>
    simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods as never }), combatSide());
  const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
  // A Beast with a Shout, marked All types per instance (the Anomaly Reactor's "All").
  const allShout: BoardMinion = { cardId: 'alley', attack: 2, health: 1, universalTribe: true };

  it('Rune of Ancestral Roar gives a dying All-types minion its Shout as an Echo (Dragon check)', () => {
    const shouts = (b: BoardMinion[]) => sim(b, killer, { runeAncestralRoar: true }).events.filter((e) => e.type === 'shout').length;
    expect(shouts([{ cardId: 'alley', attack: 2, health: 1 }]), 'a plain Beast never roars').toBe(0);
    expect(shouts([allShout])).toBe(1);
  });

  it('Candlelight Toll pays a Ruby for a dying All-types minion (Kobold check)', () => {
    const r = sim([allShout, { cardId: 'sandbag', attack: 0, health: 9000 }], killer, { candlelightToll: true });
    expect(r.playerRubyGrants ?? 0).toBeGreaterThan(0);
  });

  it('Rune of Gemstorm plays its Rubies on an All-types minion (Kobold check)', () => {
    const board: BoardMinion[] = [
      { cardId: 'sandbag', attack: 1, health: 300, universalTribe: true },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] },
    ];
    const rubies = sim(board, killer, { runeGemstorm: 2 }).events.filter((e) => e.type === 'buff' && (e as { ruby?: boolean }).ruby === true);
    expect(rubies.length, 'the rune skipped the All-types body').toBeGreaterThan(0);
  });
});
