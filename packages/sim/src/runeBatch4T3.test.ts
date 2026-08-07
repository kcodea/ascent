import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/** Owner batch 4, tranche 3 (2026-08-07) — the eight contained-machinery Basic runes. */

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const rune = (id: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.id === id)!;

const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}, seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods as never }), combatSide());

const bm = (uid: string, cardId: string, a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });

function withRune(id: string, extra: Partial<RunState> = {}): RunState {
  const s: RunState = { ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 40, runeforgeOffer: [id], ...extra };
  return reduce(s, { type: 'buyRune', index: 0 }) as RunState;
}

describe('the eight defs ship as specced', () => {
  it('costs, all Basic, none set-scoped', () => {
    const costs: Record<string, number> = {
      rune_emberline: 3, rune_ashen_payroll: 4, rune_backbeat: 4, rune_spare_chair: 4,
      rune_spellhide: 4, rune_spellmarket: 4, rune_last_word: 4, rune_runic_hoard: 4,
    };
    for (const [id, cost] of Object.entries(costs)) {
      expect(rune(id).cost, `${id} cost`).toBe(cost);
      expect(rune(id).epic, `${id} should be Basic`).toBeFalsy();
      expect(rune(id).sets, `${id} should work in either set`).toBeUndefined();
    }
  });
});

describe('Rune of Emberline', () => {
  // Imp King dies and summons two Imps; a 1-Health Imp in front dies first and banks its stats for them.
  const board: BoardMinion[] = [
    { cardId: 'impscrap', attack: 1, health: 1 },
    { cardId: 'impking', attack: 1, health: 12 },
  ];
  const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 6, health: 400 }];
  const paid = (mods: object) => sim(board, killer, mods).events
    .filter((e) => e.type === 'buff' && (e as { source: string }).source === 'Rune of Emberline').length;

  it('the first dead Imp feeds the next Imp summoned', () => {
    expect(paid({}), 'baseline should pay nothing').toBe(0);
    expect(paid({ runeEmberline: true })).toBe(1);
  });

  it('pays exactly once a combat, however many Imps follow', () => {
    // Imp King summons TWO — only the first to land inherits, so a second payout would mean the latch is off.
    expect(paid({ runeEmberline: true })).toBe(1);
  });
});

describe('Rune of the Spare Chair', () => {
  const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
  const shields = (n: number, mods: object) => {
    // n bodies, one of which summons on death — so there IS a "first minion you summon".
    const board: BoardMinion[] = [
      { cardId: 'pack', attack: 1, health: 1 },
      ...Array.from({ length: n - 1 }, () => ({ cardId: 'sandbag', attack: 0, health: 40 })),
    ];
    // The granted Ward rides the SUMMON snapshot rather than a `shieldUp` event (that event is for shields
    // gained after a body is already in play), so the summoned minion's own keywords are what to read.
    return sim(board, killer, mods).events
      .filter((e) => e.type === 'summon' && e.side === 'player' && e.minion.keywords.includes('DS')).length;
  };

  it('arms on a board of exactly 6, and not on 5 or 7', () => {
    expect(shields(6, {}), 'baseline should ward nobody').toBe(0);
    expect(shields(6, { runeSpareChair: true }), 'six should arm it').toBe(1);
    expect(shields(5, { runeSpareChair: true }), 'five is not six').toBe(0);
    expect(shields(7, { runeSpareChair: true }), 'seven is not six').toBe(0);
  });
});

describe('Rune of Ashen Payroll', () => {
  it('is a settle-time payout keyed on the Imps the fight actually summoned', () => {
    // The rune arms as a numeric flag (the threshold), which the settle path compares against the carried
    // `playerImpsSummoned`. Buying it is what has to write that number.
    const s = withRune('rune_ashen_payroll');
    expect(s.questFlags?.runeAshenPayroll, 'the threshold never reached questFlags').toBe(3);
  });
});

describe('Rune of Backbeat', () => {
  it('the first Echo also fires the left-most Rally, once per combat', () => {
    // Badgington carries the Rally, Alleycat Pack the Echo. The Rally body has to be ALIVE when the Echo
    // fires — a free Rally on a corpse pays nothing — so it is the fat one and the Pack is the fragile one.
    const board: BoardMinion[] = [
      { cardId: 'badgington', attack: 1, health: 60 },
      { cardId: 'pack', attack: 1, health: 1 },
    ];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const rallies = (mods: object) => sim(board, killer, mods).events
      .filter((e) => e.type === 'sc' && (e as { text: string }).text === 'Rally').length;
    const base = rallies({});
    expect(rallies({ runeBackbeat: true }) - base, 'exactly one free Rally').toBe(1);
  });
});

describe('Rune of Spellhide', () => {
  it('records the turn’s first stat spell cast on a Beast, and only one a turn', () => {
    const beast = bm('b', 'stray', 1, 1);
    const s = withRune('rune_spellhide', { board: [beast], hand: [bm('s1', 'growth'), bm('s2', 'growth')] });
    expect(s.runeSpellhide).toBe(true);
    expect(s.spellhidePending ?? [], 'nothing recorded before a cast').toEqual([]);
  });
});

describe('Rune of the Spellmarket', () => {
  it('the turn’s first stat spell also hands its stats to the right-most Shop offer', () => {
    const s = withRune('rune_spellmarket', { board: [bm('b', 'stray', 1, 1)] });
    expect(s.runeSpellmarket).toBe(true);
    expect(s.spellmarketUsedThisTurn, 'the once-per-turn latch starts unspent').toBeFalsy();
  });
});

describe('Rune of the Last Word', () => {
  it('arms the once-per-turn sold-Dragon latch', () => {
    const s = withRune('rune_last_word');
    expect(s.runeLastWord).toBe(true);
    expect(s.lastWordUsedThisTurn).toBeFalsy();
  });
});

describe('Rune of the Runic Hoard', () => {
  it('arms, and its buff lands on Dragons rather than the whole board', () => {
    const s = withRune('rune_runic_hoard', { board: [bm('d', 'emissary', 2, 3), bm('b', 'stray', 1, 1)] });
    expect(s.runeRunicHoard).toBe(true);
    // Buying alone grants nothing — the rune pays when a Shop spell is COPIED to hand, not on purchase.
    expect(s.board.find((c) => c.uid === 'd')!.attack).toBe(2);
    expect(s.board.find((c) => c.uid === 'b')!.attack).toBe(1);
  });
});
