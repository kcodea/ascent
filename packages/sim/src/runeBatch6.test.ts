import { describe, it, expect } from 'vitest';
import { ALE_IDS, combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type Keyword } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { RUBY_ID, applyEndOfTurn, noteSpellCast } from './recruit';

/** Rune batch 6 — Hunger, the Shared Table, Redirection (recruit phase) and Gemstorm (Avenge). */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const byName = (n: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.name === n);
const mk = (uid: string, cardId: string, tribe: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: tribe as never, attack: d.attack, health: d.health, keywords: [], golden: false };
};
const shopMinions = (s: RunState) => s.shop.filter((o) => !CARD_INDEX[o.cardId]?.spell && !CARD_INDEX[o.cardId]?.ruby).length;

describe("Rune of Hunger — End of Turn, your Demon eats the Shop", () => {
  it("removes the right-most Shop minion and feeds the left-most Demon", () => {
    const s: RunState = { ...set2(), questRecurringEndOfTurn: ['demonEatsRightmostShop'], board: [mk('d', 'pack', 'demon')] };
    const before = shopMinions(s);
    const atkBefore = s.board[0]!.attack;
    applyEndOfTurn(s);
    expect(shopMinions(s), 'nothing was eaten').toBe(before - 1);
    expect(s.board[0]!.attack, 'the Demon gained nothing from the meal').toBeGreaterThan(atkBefore);
  });

  it("does nothing with no Demon on board", () => {
    const s: RunState = { ...set2(), questRecurringEndOfTurn: ['demonEatsRightmostShop'], board: [mk('b', 'pack', 'beast')] };
    const before = shopMinions(s);
    applyEndOfTurn(s);
    expect(shopMinions(s)).toBe(before);
  });
});

describe("Rune of the Shared Table — one minion of each type per Ale", () => {
  it("buffs ONE body per tribe, not every body", () => {
    // Two Beasts and one Demon: the Demon and exactly one Beast should gain. The tribes come from the CARD
    // DEFS (matching Fatecarver's identical spread), so this needs real cards of each tribe — overriding the
    // instance `tribe` would not change what the rune sees.
    const demonId = Object.values(CARD_INDEX).find((c) => c.tribe === 'demon' && !c.spell && !c.token)!.id;
    const s: RunState = { ...set2(), runeSharedTable: { attack: 2, health: 2 },
      board: [mk('b1', 'pack', 'beast'), mk('b2', 'pack', 'beast'), mk('d1', demonId, 'demon')] };
    const base = s.board.map((c) => c.attack);
    noteSpellCast(s, CARD_INDEX[ALE_IDS[0]!]!);
    const gained = s.board.filter((c, i) => c.attack > base[i]!).length;
    expect(gained, 'expected exactly one Beast and one Demon to gain').toBe(2);
  });

  it("a NON-Ale spell does not trigger it", () => {
    const s: RunState = { ...set2(), runeSharedTable: { attack: 2, health: 2 }, board: [mk('b1', 'pack', 'beast')] };
    const base = s.board[0]!.attack;
    noteSpellCast(s, CARD_INDEX['growth']!);
    expect(s.board[0]!.attack, 'a Shop spell triggered an Ale-only rune').toBe(base);
  });
});

describe("Rune of Redirection — the Ruby lands twice", () => {
  const board = (): BoardCard[] => [mk('left', 'pack', 'beast'), mk('mid', 'pack', 'beast'), mk('right', 'pack', 'beast')];
  const playRuby = (s: RunState, target: string): RunState => {
    const withRuby: RunState = { ...s, hand: [{ uid: 'r', cardId: RUBY_ID, tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }] };
    return reduce(withRuby, { type: 'play', uid: 'r', targetUid: target });
  };
  const base = () => CARD_INDEX['pack']!.attack;

  it("a Ruby on the LEFT-most also casts on the right-most", () => {
    const next = playRuby({ ...set2(), runeRedirection: true, board: board() }, 'left');
    expect(next.board.find((c) => c.uid === 'left')!.attack).toBeGreaterThan(base());
    expect(next.board.find((c) => c.uid === 'right')!.attack, 'the right-most never received the redirect').toBeGreaterThan(base());
    expect(next.board.find((c) => c.uid === 'mid')!.attack, 'the middle should be untouched').toBe(base());
  });

  it("a Ruby on any OTHER minion does not redirect", () => {
    const next = playRuby({ ...set2(), runeRedirection: true, board: board() }, 'mid');
    expect(next.board.find((c) => c.uid === 'right')!.attack, 'a non-left-most Ruby redirected').toBe(base());
  });

  it("a one-minion board does not double-dip", () => {
    // Left-most IS right-most; without the guard the single body would take the Ruby twice.
    const next = playRuby({ ...set2(), runeRedirection: true, board: [mk('only', 'pack', 'beast')] }, 'only');
    expect(next.board[0]!.attack).toBe(base() + 1);
  });
});

describe("Rune of Gemstorm — Avenge (2): PLAY Rubies onto your Kobolds", () => {
  // The rune routes through the real Ruby-play primitive (`playRubyOn`) as of 2026-08-06 — it used to
  // hand-roll a `ctx.buff` labelled 'Rune of Gemstorm', which skipped Deepdelve Paragon, `onRubyPlayed`
  // and the `rubyGain` ledger (owner report: "paragon is not amplifying gems played from the rune").
  // Its buffs are therefore RUBY-TAGGED events now, attributed to the receiving Kobold like any Ruby play.
  const kobold = Object.values(CARD_INDEX).find((c) => c.tribe === 'kobold' && !c.token && !c.spell && c.effects.length === 0)
    ?? Object.values(CARD_INDEX).find((c) => c.tribe === 'kobold' && !c.token && !c.spell)!;
  const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
  const gemBuffs = (board: BoardMinion[], mods: object, rubyBonus?: { attack: number; health: number }) =>
    simulate(board, enemy, makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods as never, rubyBonus }), combatSide())
      .events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.ruby === true);

  const plainBoard: BoardMinion[] = [
    { cardId: kobold.id, attack: 1, health: 300 },
    { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] },
    { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] },
  ];

  it("fires on Kobolds and scales with the run's Ruby strength", () => {
    expect(gemBuffs(plainBoard, {}).length, 'baseline should never fire').toBe(0);
    const plain = gemBuffs(plainBoard, { runeGemstorm: 2 });
    expect(plain.length, 'the rune never fired').toBeGreaterThan(0);
    // A stronger run mints stronger Rubies — a flat 1/1 would ignore rubyBonus entirely.
    expect(gemBuffs(plainBoard, { runeGemstorm: 2 }, { attack: 4, health: 4 })[0]!.attack).toBeGreaterThan(plain[0]!.attack);
  });

  it("Deepdelve Paragon DOUBLES the rune's Rubies (owner report 2026-08-06)", () => {
    // Identical board with the Paragon standing behind the Kobold. Its marker (`rubyStatMultiplier`) makes
    // every Ruby played on this side worth 2× — including the rune's, now that they are real Ruby plays.
    const withParagon: BoardMinion[] = [
      { cardId: kobold.id, attack: 1, health: 300 },
      { cardId: 'k_deepdelve', attack: 1, health: 300 },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] },
    ];
    const plain = gemBuffs(plainBoard, { runeGemstorm: 2 });
    const amplified = gemBuffs(withParagon, { runeGemstorm: 2 });
    expect(plain.length, 'fixture: the rune fired without the Paragon').toBeGreaterThan(0);
    expect(amplified.length, 'fixture: the rune fired with the Paragon').toBeGreaterThan(0);
    expect(amplified[0]!.attack, 'the Paragon doubled the Ruby').toBe(plain[0]!.attack * 2);
    expect(amplified[0]!.health).toBe(plain[0]!.health * 2);
  });
});

describe("the four runes ship as specced", () => {
  it("exist at the sheet costs and tiers", () => {
    const want: [string, number, boolean][] = [
      ['Rune of Hunger', 5, false], ['Rune of Gemstorm', 2, true], // Hunger 2 → 5 (owner balance 2026-08-04)
      ['Rune of the Shared Table', 3, true], ['Rune of Redirection', 4, true],
    ];
    for (const [name, cost, epic] of want) {
      const r = byName(name);
      expect(r, `${name} is missing`).toBeDefined();
      expect(r!.cost, `${name} cost`).toBe(cost);
      expect(!!r!.epic, `${name} epic`).toBe(epic);
    }
  });

  it("all four are set-2 scoped — each names a set-2 mechanic", () => {
    for (const n of ['Rune of Hunger', 'Rune of Gemstorm', 'Rune of the Shared Table', 'Rune of Redirection']) {
      expect(byName(n)!.sets, `${n} leaks into set 1`).toEqual(['set2']);
    }
  });
});
