import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type RunState } from './index';
import { applyEndOfTurn } from './recruit';

/** Rune of Facetwright + Rune of Duplication — the two the owner ruled on 2026-07-30. */
const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const byName = (n: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.name === n);
const FW = 'facetwright';

describe('Rune of Facetwright', () => {
  it("hands over a Facetwright's Choice each turn", () => {
    const s: RunState = { ...set2(), questRecurringEndOfTurn: ['grantFacetwright'], hand: [] };
    applyEndOfTurn(s);
    expect(s.hand.filter((c) => c.cardId === FW).length).toBe(1);
  });

  it('makes the cast give BOTH halves, and skips the prompt entirely', () => {
    // The whole rune: the card is "Choose One: +1 Attack OR +1 Health", and this makes it both. Since
    // 2026-08-28 a card that already does both never ASKS (`chooseBothActive`) — the prompt was a decision with
    // one outcome, and the card now prints a coloured (Both) with both branches instead.
    const play = (rune: boolean): RunState => {
      const base: RunState = { ...set2(), runeFacetwright: rune || undefined, hand: [
        { uid: 'f', cardId: FW, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
      ] };
      const opened = reduce(base, { type: 'play', uid: 'f' });
      if (rune) {
        expect(opened.chooseOne, 'a (Both) card must not prompt').toBeUndefined();
        expect(opened.hand.some((c) => c.uid === 'f'), 'the spell should have been consumed').toBe(false);
        return opened;
      }
      expect(opened.chooseOne?.cardId, 'the Choose One never opened').toBe(FW);
      return reduce(opened, { type: 'chooseOne', index: 0 }); // pick the ATTACK half
    };
    // Without the rune, picking Attack gives Attack only.
    expect(play(false).rubyBonus).toEqual({ attack: 1, health: 0 });
    // With it, the same pick also grants the Health half.
    expect(play(true).rubyBonus, 'the rune did not fold in the other branch').toEqual({ attack: 1, health: 1 });
  });

  it('leaves other Choose One spells alone', () => {
    // Scoped by card id — the rune names Facetwright's Choice, not Choose One in general.
    const other = Object.values(CARD_INDEX).find((c) => c.spell && c.chooseOne?.length && c.id !== FW && !c.target);
    if (!other) return; // no untargeted Choose One spell to contrast with
    const s: RunState = { ...set2(), runeFacetwright: true, hand: [
      { uid: 'o', cardId: other.id, tribe: other.tribe, attack: 0, health: 1, keywords: [], golden: false },
    ] };
    const opened = reduce(s, { type: 'play', uid: 'o' });
    expect(() => reduce(opened, { type: 'chooseOne', index: 0 })).not.toThrow();
  });
});

describe('Rune of Duplication', () => {
  const epic = EPIC_RUNES.find((r) => r.reward.kind === 'grant' && (r.reward as { cards?: string[] }).cards?.length)!;

  const buyEpic = (dup: boolean): RunState => {
    const s: RunState = {
      ...set2(), embers: 40, runeDuplication: dup || undefined,
      runeforgeOffer: [epic.id], runeforgeEpic: true, hand: [],
    };
    return reduce(s, { type: 'buyRune', index: 0 });
  };

  it('applies the Epic rune reward a SECOND time', () => {
    // Owner ruling: "in the case where a rune gives a minion, the player would get 2".
    const card = (epic.reward as { cards: string[] }).cards[0]!;
    const once = buyEpic(false).hand.filter((c) => c.cardId === card).length;
    const twice = buyEpic(true).hand.filter((c) => c.cardId === card).length;
    expect(once, 'the control buy granted nothing').toBeGreaterThan(0);
    expect(twice, 'Duplication did not double the reward').toBe(once * 2);
  });

  it('is spent on use, and records the copy as a held rune', () => {
    const s = buyEpic(true);
    expect(s.runeDuplication, 'the charge was not spent').toBeUndefined();
    expect(s.ownedRunes!.filter((r) => r === epic.id).length, 'the copy should show as a second badge').toBe(2);
  });

  it('a BASIC forge does not consume it', () => {
    // Otherwise the very forge that sold you Duplication would eat its own charge.
    const basic = RUNES.find((r) => !r.epic)!;
    const s: RunState = { ...set2(), embers: 40, runeDuplication: true, runeforgeOffer: [basic.id], runeforgeEpic: undefined };
    expect(reduce(s, { type: 'buyRune', index: 0 }).runeDuplication, 'a basic buy spent the Epic charge').toBe(true);
  });
});

describe('the two runes ship as specced', () => {
  it('exist at 4 Gold, both basic', () => {
    for (const n of ['Rune of Facetwright', 'Rune of Duplication']) {
      const r = byName(n);
      expect(r, `${n} is missing`).toBeDefined();
      expect(r!.cost).toBe(4);
      expect(!!r!.epic).toBe(false);
    }
  });

  it("only Facetwright is set-2 scoped — its spell is a set-2 card", () => {
    expect(byName('Rune of Facetwright')!.sets).toEqual(['set2']);
    expect(byName('Rune of Duplication')!.sets).toBeUndefined();
  });
});
