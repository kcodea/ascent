import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, applyGoldSpent, fireRecruitDeathrattlesForTest } from './recruit';

/**
 * THE OWNER'S 2026-10-13 REWORKS, through the real reducer / Gold meter / `simulate` paths:
 *
 *  - Vaultkeeper: "When you play a Dragon, gain +3/+3. Play 3 Dragons or Dwarves to improve this." (+3/+3 per step)
 *  - Rune of the Vaultkeeper: back to "also give their stats to an adjacent Dragon".
 *  - Alchemist Brisbane: "Shout, Echo and Rally: Your Rubies gain +2/+2. Spend 30 Gold to improve this." (+2/+2 per
 *    step; the End of Turn Ruby cast is gone).
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 50, tier: 7, hand: [], board: [], shop: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const stats = (c: BoardCard): [number, number] => [c.attack, c.health];
/** Play hand cards in order; returns the state after the last. */
const playAll = (s: RunState, ...uids: string[]): RunState => uids.reduce((acc, uid) => act(acc, { type: 'play', uid }), s);

const DRAGON = 'd2_transcendence', DRAGON2 = 'd2_cinderchef', DWARF = 'dw_brakka', DWARF2 = 'dw_edward', BEAST = 'b2_trex';
const VAULT = CARD_INDEX['d2_herzog']!;
const base: [number, number] = [VAULT.attack, VAULT.health];
const plus = (n: number): [number, number] => [base[0] + n, base[1] + n];

describe('Vaultkeeper: "When you play a Dragon, gain +3/+3. Play 3 Dragons or Dwarves to improve this."', () => {
  it('a Dragon played pays +3/+3; a Dwarf pays nothing but counts; any other type does neither', () => {
    let s = run({ board: [body('v', 'd2_herzog')], hand: [body('d1', DRAGON), body('w1', DWARF), body('b1', BEAST)] });
    s = playAll(s, 'd1');
    expect(stats(at(s, 'v')), 'a Dragon: +3/+3').toEqual(plus(3));
    expect(at(s, 'v').spiritTally, 'and one count').toBe(1);
    s = playAll(s, 'w1');
    expect(stats(at(s, 'v')), 'a Dwarf: no gain').toEqual(plus(3));
    expect(at(s, 'v').spiritTally, 'but it counts').toBe(2);
    s = playAll(s, 'b1');
    expect(stats(at(s, 'v')), 'a Beast: nothing').toEqual(plus(3));
    expect(at(s, 'v').spiritTally).toBe(2);
  });

  it('every 3 Dragons or Dwarves played add +3/+3 to the gain: grant first, then count', () => {
    let s = run({ board: [body('v', 'd2_herzog')], hand: [body('d1', DRAGON), body('w1', DWARF), body('d2', DRAGON2), body('d3', DRAGON), body('w2', DWARF2), body('w3', DWARF)] });
    s = playAll(s, 'd1', 'w1');
    expect(stats(at(s, 'v'))).toEqual(plus(3));
    s = playAll(s, 'd2');
    expect(stats(at(s, 'v')), 'the play that completes the 3 still pays the old +3/+3').toEqual(plus(6));
    expect(at(s, 'v').spiritTally).toBe(3);
    s = playAll(s, 'd3');
    expect(stats(at(s, 'v')), 'the next Dragon pays the improved +6/+6').toEqual(plus(12));
    s = playAll(s, 'w2', 'w3');
    expect(at(s, 'v').spiritTally, 'two Dwarves finish the second set').toBe(6);
    expect(stats(at(s, 'v')), 'Dwarves never pay').toEqual(plus(12));
  });

  it('the third step: +9/+9 after six counted plays', () => {
    const s0 = run({ board: [body('v', 'd2_herzog', { spiritTally: 6 })], hand: [body('d1', DRAGON)] });
    expect(stats(at(playAll(s0, 'd1'), 'v'))).toEqual(plus(9));
  });

  it('Gilded doubles the gain, base and steps alike', () => {
    let s = run({ board: [body('v', 'd2_herzog', { golden: true })], hand: [body('d1', DRAGON), body('d2', DRAGON2), body('d3', DRAGON), body('d4', DRAGON2)] });
    s = playAll(s, 'd1');
    expect(stats(at(s, 'v'))).toEqual(plus(6));
    s = playAll(s, 'd2', 'd3');
    expect(stats(at(s, 'v'))).toEqual(plus(18));
    s = playAll(s, 'd4');
    expect(stats(at(s, 'v')), '(3 + 3) x 2 = +12/+12').toEqual(plus(30));
  });

  it('a Dragon/Dwarf dual type is ONE play: it pays (it is a Dragon) and counts once', () => {
    const s = playAll(run({ board: [body('v', 'd2_herzog')], hand: [body('m', 'dw_brisbane')] }), 'm');
    expect(stats(at(s, 'v'))).toEqual(plus(3));
    expect(at(s, 'v').spiritTally).toBe(1);
  });

  it('its own play never counts, and a Vaultkeeper in hand is asleep', () => {
    let s = run({ hand: [body('v', 'd2_herzog'), body('v2', 'd2_herzog'), body('d1', DRAGON)] });
    s = playAll(s, 'v');
    expect([stats(at(s, 'v')), at(s, 'v').spiritTally ?? 0], 'playing it pays and counts nothing').toEqual([base, 0]);
    s = playAll(s, 'd1');
    expect(stats(at(s, 'v'))).toEqual(plus(3));
    const inHand = s.hand.find((c) => c.uid === 'v2')!;
    expect([stats(inHand), inHand.spiritTally ?? 0], 'the copy still in hand heard nothing').toEqual([base, 0]);
  });

  it('two Vaultkeepers each keep their own count; the second sees the first one played as nothing (it was not there)', () => {
    let s = run({ board: [body('v', 'd2_herzog', { spiritTally: 3 })], hand: [body('v2', 'd2_herzog'), body('d1', DRAGON)] });
    s = playAll(s, 'v2');
    expect(stats(at(s, 'v')), 'a Vaultkeeper is a Dragon: the fielded one gains at its level 2').toEqual(plus(6));
    s = playAll(s, 'd1');
    expect(stats(at(s, 'v2')), 'the new copy is at level 1').toEqual(plus(3));
    expect([at(s, 'v').spiritTally, at(s, 'v2').spiritTally]).toEqual([5, 1]);
  });

  it('the text matches, plain and Gilded', () => {
    expect([VAULT.text, VAULT.goldenText]).toEqual([
      'When you play a **Dragon**, gain **+3/+3**. Play **3 Dragons or Dwarves** to improve this.',
      'When you play a **Dragon**, gain **+6/+6**. Play **3 Dragons or Dwarves** to improve this.',
    ]);
    expect([VAULT.tier, VAULT.attack, VAULT.health], 'the body is unchanged').toEqual([6, 6, 10]);
  });
});

describe('Rune of the Vaultkeeper: "Your Vaultkeepers also give their stats to an adjacent Dragon"', () => {
  it('each gain also lands on an adjacent Dragon, at the same size', () => {
    const s0 = run({ runeVaultkeeper: true, board: [body('n', DRAGON), body('v', 'd2_herzog', { spiritTally: 3 })], hand: [body('d1', DRAGON2)] } as Partial<RunState>);
    const before = stats(at(s0, 'n'));
    const s = act(s0, { type: 'play', uid: 'd1', index: 2 } as Action);
    expect(stats(at(s, 'v'))).toEqual(plus(6));
    expect(stats(at(s, 'n')), 'the neighbour gets the same +6/+6').toEqual([before[0] + 6, before[1] + 6]);
  });
  it('a non-Dragon neighbour gets nothing, and without the rune nobody else does', () => {
    const withRune = run({ runeVaultkeeper: true, board: [body('n', BEAST), body('v', 'd2_herzog')], hand: [body('d1', DRAGON)] } as Partial<RunState>);
    const s = act(withRune, { type: 'play', uid: 'd1', index: 0 } as Action);
    expect(stats(at(s, 'n')), 'a Beast neighbour').toEqual([CARD_INDEX[BEAST]!.attack, CARD_INDEX[BEAST]!.health]);
    const noRune = run({ board: [body('n', DRAGON), body('v', 'd2_herzog')], hand: [body('d1', DRAGON2)] });
    const t = act(noRune, { type: 'play', uid: 'd1', index: 2 } as Action);
    expect(stats(at(t, 'n')), 'no rune: the Dragon neighbour is untouched').toEqual([CARD_INDEX[DRAGON]!.attack, CARD_INDEX[DRAGON]!.health]);
  });
});

describe('Alchemist Brisbane: "Shout, Echo and Rally: Your Rubies gain +2/+2. Spend 30 Gold to improve this."', () => {
  const B = CARD_INDEX['k_alchemist']!;
  const ruby = (s: RunState) => s.rubyBonus ?? { attack: 0, health: 0 };
  const bm = (over: Partial<BoardMinion> = {}): BoardMinion => ({ cardId: 'k_alchemist', attack: 1, health: 4000, sourceUid: 'AB', keywords: ['RL'], ...over } as BoardMinion);
  const wall: BoardMinion = { cardId: 'sandbag', attack: 0, health: 4000 } as BoardMinion;

  it.each([[false, 2], [true, 4]] as const)('Shout (golden=%s): Rubies gain +%i/+%i', (golden, n) => {
    const s = act(run({ hand: [body('ab', 'k_alchemist', { golden })] }), { type: 'play', uid: 'ab' });
    expect(ruby(s)).toEqual({ attack: n, health: n });
  });

  it('30 Gold spent on the board earns one improvement; the meter carries across spends', () => {
    const s = run({ board: [body('ab', 'k_alchemist')] });
    applyGoldSpent(s, 20);
    expect(at(s, 'ab').summonBonus ?? 0, '20 Gold: not yet').toBe(0);
    applyGoldSpent(s, 10);
    expect(at(s, 'ab').summonBonus, '30 Gold: one improvement').toBe(1);
    applyGoldSpent(s, 65);
    expect(at(s, 'ab').summonBonus, 'a big spend can cross the meter twice (5 left over)').toBe(3);
    expect(at(s, 'ab').goldTick).toBe(5);
  });

  it('a Brisbane in hand earns nothing', () => {
    const s = run({ hand: [body('ab', 'k_alchemist')] });
    applyGoldSpent(s, 90);
    expect(s.hand[0]!.summonBonus ?? 0).toBe(0);
  });

  it.each([[false, 1, 4], [false, 2, 6], [true, 1, 8]] as const)('Echo in the Shop (golden=%s, %i improvement(s)): Rubies gain +%i/+%i', (golden, steps, n) => {
    const s = run({ board: [body('ab', 'k_alchemist', { golden, summonBonus: steps })] });
    fireRecruitDeathrattlesForTest(s, at(s, 'ab'));
    expect(ruby(s)).toEqual({ attack: n, health: n });
  });

  it('a re-fired Shout pays the improved value (Shrieker, End of Turn: trigger Shouts)', () => {
    const s = run({ board: [body('sh', 'd2_shrieker'), body('ab', 'k_alchemist', { summonBonus: 2 })] });
    applyEndOfTurn(s);
    expect(ruby(s), 'base 2 + 2 improvements of 2').toEqual({ attack: 6, health: 6 });
  });

  it('Rally in combat: every attack pays the grant, improvements included, and it carries back', () => {
    const fight = (over: Partial<BoardMinion>) => simulate([bm(over)], [wall], makeRng(3), CARD_INDEX, combatSide({ tier: 7, tribes: ['kobold'] }), combatSide({ tier: 1 }));
    // The same seeded fight three times: the Rally fires the same number of times in each, so the totals are the
    // per-Rally grant times one shared count.
    const plain = fight({}).playerRubyBonusGain!;
    const rallies = plain.attack / 2;
    expect(Number.isInteger(rallies) && rallies > 0, 'whole +2/+2 grants, at least one').toBe(true);
    expect(plain).toEqual({ attack: 2 * rallies, health: 2 * rallies });
    expect(fight({ summonBonus: 1 }).playerRubyBonusGain, '+4/+4 per Rally with one improvement').toEqual({ attack: 4 * rallies, health: 4 * rallies });
    expect(fight({ summonBonus: 3 }).playerRubyBonusGain, '+8/+8 per Rally with three').toEqual({ attack: 8 * rallies, health: 8 * rallies });
    expect(fight({ summonBonus: 1, golden: true }).playerRubyBonusGain, 'Gilded: +8/+8 per Rally with one').toEqual({ attack: 8 * rallies, health: 8 * rallies });
  });

  it('Echo in combat pays the improved grant too', () => {
    // A 1-Health Brisbane that never gets to attack: the foe swings first and kills it.
    const r = simulate([bm({ attack: 0, health: 1, summonBonus: 1, keywords: [] })], [{ cardId: 'sandbag', attack: 50, health: 4000 } as BoardMinion],
      makeRng(3), CARD_INDEX, combatSide({ tier: 7, tribes: ['kobold'] }), combatSide({ tier: 1 }));
    const g = r.playerRubyBonusGain ?? { attack: 0, health: 0 };
    expect(g.attack % 4, 'whole +4/+4 grants only').toBe(0);
    expect(g.attack, 'the Echo paid').toBeGreaterThanOrEqual(4);
    expect(g.health).toBe(g.attack);
  });

  it('the End of Turn Ruby cast is gone', () => {
    const s = run({ board: [body('ab', 'k_alchemist'), body('k', 'k_beggy')] });
    applyEndOfTurn(s);
    for (const uid of ['ab', 'k']) expect((at(s, uid).buffs ?? []).filter((b) => b.source === 'Ruby'), uid).toEqual([]);
    expect(B.effects.some((e) => e.on === 'endOfTurn')).toBe(false);
  });

  it('the card: Rally keyword, same body, matching text', () => {
    expect(B.keywords).toContain('RL');
    expect([B.tier, B.attack, B.health]).toEqual([7, 9, 6]);
    expect([B.text, B.goldenText]).toEqual([
      '**Shout, Echo and Rally:** Your Rubies gain **+2/+2**. Spend **30 Gold** to improve this.',
      '**Shout, Echo and Rally:** Your Rubies gain **+4/+4**. Spend **30 Gold** to improve this.',
    ]);
  });

  it('other Ruby-strength cards are untouched by the improve fold (no step printed, accrual ignored)', () => {
    const s = run({ board: [body('sc', 'k_faultline', { summonBonus: 5 })] });
    fireRecruitDeathrattlesForTest(s, at(s, 'sc'));
    expect(ruby(s), 'Scrapper: its printed +1/+1').toEqual({ attack: 1, health: 1 });
  });
});
