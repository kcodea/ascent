import { describe, it, expect } from 'vitest';
import { ALL_CARDS, CARD_INDEX } from '@game/content';
import type { CardDef } from '@game/core';
import { chooseOneBranchText, chooseOneBranchTextFor, effectFoldsSpellPower, createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * THE CHOOSE ONE WINDOW PRINTS LIVE NUMBERS (owner ask 2026-09-12: "if a Choose One spell is buffed, it should
 * show the buffed spell numbers in the Choose One windows as well").
 *
 * A spell Choose One casts its branch through the same factories as any spell, so a branch whose factory folds
 * spell power grants more than its authored number. `chooseOneBranchText` rewrites exactly those magnitudes as
 * green `{{…}}` markers, using the fold rule the factories follow (`effectFoldsSpellPower`), and leaves every
 * flat / excused / Battlecry branch as authored. The last block is the sabotage guard: the number the marker
 * prints must EQUAL the delta the real reducer lands.
 */

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => ({
  uid, cardId, tribe: CARD_INDEX[cardId]!.tribe,
  attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health,
  keywords: [], golden: false, ...extra,
});

/** The live number inside the first `{{+A/+H}}` marker of a branch text. */
const marker = (t: string): [number, number] => {
  const m = /\{\{\+(\d+)\/\+(\d+)\}\}/.exec(t);
  if (!m) throw new Error(`no {{+A/+H}} marker in "${t}"`);
  return [Number(m[1]), Number(m[2])];
};

describe('chooseOneBranchText — a spell branch prints the number its factory will grant', () => {
  it("Aspect's Blessing under +1/+1 greens BOTH branches (+3/+1 → +4/+2, +1/+3 → +2/+4)", () => {
    expect(chooseOneBranchText('aspectsblessing', 0, false, 1, 1)).toContain('{{+4/+2}}');
    expect(chooseOneBranchText('aspectsblessing', 1, false, 1, 1)).toContain('{{+2/+4}}');
    // Attack-only power folds only Attack (the factory adds each stat's own bonus).
    expect(chooseOneBranchText('aspectsblessing', 0, false, 2, 0)).toContain('{{+5/+1}}');
  });

  it('with no spell power the authored text stands, un-greened', () => {
    expect(chooseOneBranchText('aspectsblessing', 0, false, 0, 0)).toBe(CARD_INDEX['aspectsblessing']!.chooseOne![0]!.text);
    expect(chooseOneBranchText('aspectsblessing', 0, false, 0, 0)).not.toContain('{{');
  });

  it('Crest of the Climb (flat: true) never greens — its +4 lands exactly as printed', () => {
    for (const i of [0, 1]) {
      const t = chooseOneBranchText('crestclimb', i, false, 3, 3);
      expect(t).toBe(CARD_INDEX['crestclimb']!.chooseOne![i]!.text);
      expect(t).not.toContain('{{');
    }
  });

  it('Apples: the shop branch (documented flat) never greens; the random-friendlies branch does, since its factory folds', () => {
    const apples = CARD_INDEX['apples']!;
    // The factory truth, read from the same predicate the helper uses: spellBuffTavern is excused (flat),
    // spellBuffRandomFriendlies folds (the owner's 2026-08-02 Defensive Ale fix).
    expect(effectFoldsSpellPower(apples.chooseOne![0]!.effects[0]!)).toBe(false);
    expect(effectFoldsSpellPower(apples.chooseOne![1]!.effects[0]!)).toBe(true);
    const shop = chooseOneBranchText('apples', 0, false, 2, 2);
    expect(shop).toBe(apples.chooseOne![0]!.text);
    expect(shop).toContain('+2/+4');
    expect(chooseOneBranchText('apples', 1, false, 2, 2)).toContain('{{+3/+3}}');
  });

  it('a single-stat grant: Attack-only power greens only the Attack; Health power turns it into the live pair', () => {
    // No live spell Choose One prints a non-flat single-stat branch (Crest opts out), so this pins the SHAPE
    // on a synthetic def wired to the real `spellBuffTarget` factory — the one the factories would grant.
    const def = {
      ...CARD_INDEX['crestclimb']!, id: 'synthetic_single',
      chooseOne: [
        { text: 'Give **+4 Attack**.', effects: [{ on: 'cast', do: 'spellBuffTarget', params: { attack: 4, health: 0 } }] },
        { text: 'Give **+4 Health**.', effects: [{ on: 'cast', do: 'spellBuffTarget', params: { attack: 0, health: 4 } }] },
      ],
    } as unknown as CardDef;
    expect(chooseOneBranchTextFor(def, 0, false, 1, 0)).toBe('Give **{{+5 Attack}}**.');
    expect(chooseOneBranchTextFor(def, 1, false, 0, 1)).toBe('Give **{{+5 Health}}**.');
    // The factory adds BOTH bonuses to any non-flat grant (`spellBuffTarget`), so under +1/+1 the printed
    // "+4 Attack" is really +5/+1 — the same full-pair shape the Ales use in `spellDisplayText`.
    expect(chooseOneBranchTextFor(def, 0, false, 1, 1)).toBe('Give **{{+5/+1}}**.');
    expect(chooseOneBranchTextFor(def, 1, false, 1, 1)).toBe('Give **{{+1/+5}}**.');
  });

  it('golden reads the goldenText (doubled magnitude) and greens that', () => {
    const def = {
      ...CARD_INDEX['aspectsblessing']!, id: 'synthetic_golden',
      chooseOne: [{
        text: 'Give a random minion in your hand **+3/+1**.', goldenText: 'Give a random minion in your hand **+6/+2**.',
        effects: [{ on: 'cast', do: 'spellBuffRandomHand', params: { attack: 3, health: 1 } }],
      }],
    } as unknown as CardDef;
    expect(chooseOneBranchTextFor(def, 0, true, 1, 1)).toBe('Give a random minion in your hand **{{+7/+3}}**.');
    expect(chooseOneBranchTextFor(def, 0, true, 0, 0)).toBe(def.chooseOne![0]!.goldenText);
    expect(chooseOneBranchTextFor(def, 0, false, 1, 1)).toBe('Give a random minion in your hand **{{+4/+2}}**.');
  });

  it('a MINION Choose One (a Battlecry, never a cast) is untouched under any spell power', () => {
    let seen = 0;
    for (const def of ALL_CARDS) {
      if (def.spell || !def.chooseOne?.length) continue;
      seen++;
      def.chooseOne.forEach((opt, i) => {
        expect(chooseOneBranchText(def.id, i, false, 5, 5), `${def.id}[${i}]`).toBe(opt.text);
        expect(chooseOneBranchText(def.id, i, true, 5, 5), `${def.id}[${i}] golden`).toBe(opt.goldenText ?? opt.text);
      });
    }
    expect(seen, 'the sweep found minion Choose Ones (Wildwood Shaper, Dealer, …)').toBeGreaterThan(3);
  });

  it('TRIPWIRE: every live spell Choose One branch whose factory folds spell power actually greens', () => {
    // A future branch authored in a shape the helper does not recognise ("+3 Attack and +1 Health", say) would
    // silently print its base — exactly the defect this helper exists to prevent. Catch it at authoring time.
    const stale: string[] = [];
    for (const def of ALL_CARDS) {
      if (!def.spell || !def.chooseOne?.length) continue;
      def.chooseOne.forEach((opt, i) => {
        const folds = (opt.effects ?? []).some((e) => effectFoldsSpellPower(e)
          && (Number((e.params as { attack?: number } | undefined)?.attack ?? 0) > 0 || Number((e.params as { health?: number } | undefined)?.health ?? 0) > 0));
        const t = chooseOneBranchText(def.id, i, false, 2, 2);
        if (folds && !t.includes('{{')) stale.push(`${def.id}[${i}]: "${opt.text}" folds spell power but did not green`);
        if (!folds && t !== opt.text) stale.push(`${def.id}[${i}]: greened a branch that does not fold`);
      });
    }
    expect(stale).toEqual([]);
  });
});

describe('SABOTAGE — the greened number equals what the reducer actually grants', () => {
  const run = (hand: BoardCard[], board: BoardCard[] = []): RunState => ({
    ...createRun(1), phase: 'recruit', embers: 0, shop: [], setId: 'set3',
    board, hand, spellBonus: { attack: 1, health: 1 },
  } as RunState);

  it.each([0, 1])("Aspect's Blessing branch %i: the hand minion gains exactly the printed live pair", (index) => {
    const printed = marker(chooseOneBranchText('aspectsblessing', index, false, 1, 1));
    let s = run([card('m', 'drummer'), card('sp', 'aspectsblessing')]);
    const before = s.hand.find((c) => c.uid === 'm')!;
    const [a0, h0] = [before.attack, before.health];
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.chooseOne?.cardId).toBe('aspectsblessing');
    s = reduce(s, { type: 'chooseOne', index });
    expect(s.hand.map((c) => c.uid), 'the spell resolved out of hand').toEqual(['m']);
    const after = s.hand.find((c) => c.uid === 'm')!;
    expect([after.attack - a0, after.health - h0]).toEqual(printed);
  });

  it("Apples' random-friendlies branch: each buffed minion gains exactly the printed live pair", () => {
    const printed = marker(chooseOneBranchText('apples', 1, false, 1, 1));
    let s = run([card('sp', 'apples')], [card('a', 'drummer'), card('b', 'joker')]);
    s = reduce(s, { type: 'play', uid: 'sp' });
    s = reduce(s, { type: 'chooseOne', index: 1 });
    expect(s.hand).toHaveLength(0);
    for (const uid of ['a', 'b']) {
      const m = s.board.find((c) => c.uid === uid)!;
      expect([m.attack - CARD_INDEX[m.cardId]!.attack, m.health - CARD_INDEX[m.cardId]!.health], uid).toEqual(printed);
    }
  });

  it("Apples' shop branch stays flat in the reducer too — the un-greened +2/+4 is the truth", () => {
    let s = run([card('sp', 'apples')]);
    s = { ...s, shop: [{ uid: 'o', cardId: 'drummer', cost: 3 } as never] };
    s = reduce(s, { type: 'play', uid: 'sp' });
    s = reduce(s, { type: 'chooseOne', index: 0 });
    const o = s.shop[0]! as { atk?: number; hp?: number };
    expect([o.atk ?? 0, o.hp ?? 0], 'the offer buff (`addOfferBuff` → atk/hp) is the authored +2/+4, no spell power').toEqual([2, 4]);
    expect(chooseOneBranchText('apples', 0, false, 1, 1)).not.toContain('{{');
  });
});
