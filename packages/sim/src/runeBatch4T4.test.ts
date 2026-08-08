import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/** Owner batch 4, tranche 4 (2026-08-07) — the five hard Epic runes. */

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const rune = (id: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.id === id)!;

const sim = (p: BoardMinion[], e: BoardMinion[], side = {}, seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, ...side } as never), combatSide());

const bm = (uid: string, cardId: string, a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });

function withRune(id: string, extra: Partial<RunState> = {}): RunState {
  const s: RunState = { ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 40, runeforgeOffer: [id], ...extra };
  return reduce(s, { type: 'buyRune', index: 0 }) as RunState;
}

describe('the five defs ship as specced', () => {
  it('costs, all Epic, and only the Ruby one is Set-2 scoped', () => {
    const costs: Record<string, number> = {
      rune_ancestral_roar: 5, rune_ruby_shrapnel: 5, rune_shared_scripture: 6,
      rune_banquet_hall: 5, rune_crucible_choir: 6,
    };
    for (const [id, cost] of Object.entries(costs)) {
      expect(rune(id).cost, `${id} cost`).toBe(cost);
      expect(rune(id).epic, `${id} should be Epic`).toBe(true);
    }
    expect(rune('rune_ruby_shrapnel').sets).toEqual(['set2']);
    for (const id of ['rune_ancestral_roar', 'rune_shared_scripture', 'rune_banquet_hall', 'rune_crucible_choir']) {
      expect(rune(id).sets, `${id} should work in either set`).toBeUndefined();
    }
  });
});

describe('Rune of Ancestral Roar', () => {
  const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
  const shouts = (board: BoardMinion[], mods: object) => sim(board, killer, { questMods: mods })
    .events.filter((e) => e.type === 'sc' && (e as { text: string }).text === 'Shout').length;

  it('a dying Dragon with a Shout fires it as an Echo', () => {
    const board: BoardMinion[] = [{ cardId: 'emissary', attack: 2, health: 1 }];
    expect(shouts(board, {}), 'baseline: no Echo-Shout').toBe(0);
    expect(shouts(board, { runeAncestralRoar: true })).toBe(1);
  });

  it('pays per qualifying Dragon rather than once a combat', () => {
    // The rune GRANTS an ability to every Dragon with a Shout — it is not a once-per-fight trigger, so two
    // dying Dragons roar twice. A latch here would be the bug.
    const board: BoardMinion[] = [
      { cardId: 'emissary', attack: 2, health: 1 }, { cardId: 'emissary', attack: 2, health: 1 },
    ];
    expect(shouts(board, { runeAncestralRoar: true })).toBe(2);
  });

  it('a dying Beast with a Shout does not roar — the rune is Dragons only', () => {
    const board: BoardMinion[] = [{ cardId: 'alley', attack: 2, health: 1 }];
    expect(shouts(board, { runeAncestralRoar: true })).toBe(0);
  });
});

describe('Rune of Ruby Shrapnel', () => {
  const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
  /** The stats the rune actually scattered, summed across every share it handed out. */
  const scattered = (board: BoardMinion[], mods: object) => sim(board, killer, { questMods: mods })
    .events.filter((e) => e.type === 'buff' && (e as { source: string }).source === 'Rune of Ruby Shrapnel')
    .reduce((n, e) => n + ((e as { attack: number }).attack + (e as { health: number }).health), 0);

  it('splits a dying Ruby body’s Ruby stats across the survivors', () => {
    // The fragile body carries 4/4 of Ruby; two fat survivors should take 2/2 each = 8 total stats.
    const board: BoardMinion[] = [
      { cardId: 'sandbag', attack: 0, health: 1, buffs: [{ source: 'Ruby', attack: 4, health: 4, count: 1 }] },
      { cardId: 'sandbag', attack: 0, health: 60 }, { cardId: 'sandbag', attack: 0, health: 60 },
    ];
    expect(scattered(board, {}), 'baseline should scatter nothing').toBe(0);
    expect(scattered(board, { runeRubyShrapnel: true })).toBe(8);
  });

  it('a body with no Rubies scatters nothing', () => {
    const board: BoardMinion[] = [
      { cardId: 'sandbag', attack: 0, health: 1 },
      { cardId: 'sandbag', attack: 0, health: 60 },
    ];
    expect(scattered(board, { runeRubyShrapnel: true })).toBe(0);
  });

  it('a share that floors to nothing simply does not land', () => {
    // 1 Attack of Ruby across 3 survivors is 0 each. Topping that up to 1 would make a wide board free value.
    const board: BoardMinion[] = [
      { cardId: 'sandbag', attack: 0, health: 1, buffs: [{ source: 'Ruby', attack: 1, health: 0, count: 1 }] },
      ...Array.from({ length: 3 }, () => ({ cardId: 'sandbag', attack: 0, health: 60 })),
    ];
    expect(scattered(board, { runeRubyShrapnel: true })).toBe(0);
  });
});

describe('Rune of Shared Scripture', () => {
  it('the warband’s first combat cast fires the left-most Shout and Rally, once', () => {
    // Sporebat's Echo casts the run's stored spell — that is the "Shop spell cast by your warband in combat".
    // Badgington (fat, so it survives to be the Rally) and Twilight Emissary (the Shout) sit in front of it.
    const board: BoardMinion[] = [
      { cardId: 'emissary', attack: 1, health: 60 },
      { cardId: 'badgington', attack: 1, health: 60 },
      { cardId: 'sporebat', attack: 1, health: 1 },
    ];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const fired = (mods: object) => {
      const r = sim(board, killer, { lastSpellCastId: 'growth', questMods: mods });
      const sc = r.events.filter((e) => e.type === 'sc');
      return {
        shouts: sc.filter((e) => (e as { text: string }).text === 'Shout').length,
        rallies: sc.filter((e) => (e as { text: string }).text === 'Rally').length,
      };
    };
    const base = fired({});
    const armed = fired({ runeSharedScripture: true });
    expect(armed.shouts - base.shouts, 'exactly one free Shout').toBe(1);
    expect(armed.rallies - base.rallies, 'exactly one free Rally').toBe(1);
  });
});

describe('Rune of the Banquet Hall', () => {
  /** Buy the single Shop offer and report the total stats the rune handed the board. */
  const buyAndMeasure = (offer: { uid: string; cardId: string; atk?: number; hp?: number }, armed: boolean) => {
    const board = [bm('d', 'emissary', 2, 3), bm('b', 'stray', 1, 1)]; // a Dragon and a Beast — two types
    const base: Partial<RunState> = { board, shop: [offer] as never, embers: 40 };
    const s = armed ? withRune('rune_banquet_hall', base) : ({ ...createRun(3), phase: 'recruit', wave: 7, ...base } as RunState);
    const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    const next = reduce(s, { type: 'buy', uid: offer.uid }) as RunState;
    // Only the two ORIGINAL bodies are compared — the bought minion joins the board and would otherwise
    // dwarf the delta being measured.
    const after = next.board.filter((c) => c.uid === 'd' || c.uid === 'b')
      .reduce((n, c) => n + c.attack + c.health, 0);
    return after - before;
  };

  it('a Shop-buffed buy feeds one friendly minion of each type', () => {
    const buffed = { uid: 'o', cardId: 'stray', atk: 3, hp: 3 };
    expect(buyAndMeasure(buffed, false), 'baseline: a plain buy feeds nobody').toBe(0);
    // Two types on the board (Dragon, Beast), each taking the offer's +3/+3 bonus = 12 total stats.
    expect(buyAndMeasure(buffed, true)).toBe(12);
  });

  it('an UNBUFFED buy does not arm it — "Shop-buffed" is the condition', () => {
    expect(buyAndMeasure({ uid: 'o', cardId: 'stray' }, true)).toBe(0);
  });
});

describe('Rune of the Crucible Choir', () => {
  it('at End of Turn it fires the left-most Shout and then the left-most Echo', () => {
    // Twilight Emissary has the Shout, Alleycat Pack the Echo. Ending the turn should move the board — the
    // Shout grants stats and the Echo summons — where an unarmed run's End of Turn does neither.
    // Measured ARMED vs UNARMED off the same board: the End-of-Turn firing is what has to make the difference,
    // and comparing against a fixed number would pass on any run that happens to end the turn with more bodies.
    const boardOf = () => [bm('d', 'emissary', 2, 3), bm('e', 'pack', 3, 2)];
    const endTurn = (armed: boolean) => {
      const base: Partial<RunState> = { board: boardOf(), embers: 40 };
      const s = armed ? withRune('rune_crucible_choir', base)
        : ({ ...createRun(3), phase: 'recruit', wave: 7, ...base } as RunState);
      const next = reduce(s, { type: 'faceOmen' }) as RunState;
      return next.lastCombat?.initial.player.length ?? 0;
    };
    expect(withRune('rune_crucible_choir').runeCrucibleChoir).toBe(true);
    // Alleycat Pack's Echo summons two Pups, so an armed End of Turn takes MORE bodies into the fight.
    expect(endTurn(true), 'the Choir fired nothing').toBeGreaterThan(endTurn(false));
  });
});
