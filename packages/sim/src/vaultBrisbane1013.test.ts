import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, applyGoldSpent, fireRecruitDeathrattlesForTest } from './recruit';

/**
 * THE OWNER'S 2026-10-13 REWORKS, through the real reducer / Gold meter / `simulate` paths:
 *
 *  - Vaultkeeper: see vaultkeeperRunTally1020.test.ts (reworked again 2026-10-20).
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

const DRAGON = 'd2_transcendence', DRAGON2 = 'd2_cinderchef', BEAST = 'b2_trex';
const VAULT = CARD_INDEX['d2_herzog']!;
const base: [number, number] = [VAULT.attack, VAULT.health];
const plus = (n: number): [number, number] => [base[0] + n, base[1] + n];

// Vaultkeeper's own behaviour moved to `vaultkeeperRunTally1020.test.ts` (owner change 2026-10-20: Dwarf/Dragon, and the
// improve is a run-wide "4 Dragons or Dwarves played this game" tally). The rune below rides the same gain.
const tally = (n: number): Partial<RunState> => ({ tribeUnionPlays: { 'dragon+dwarf': n } });

describe('Rune of the Vaultkeeper: "Your Vaultkeepers also give their stats to an adjacent Dragon"', () => {
  it('each gain also lands on an adjacent Dragon, at the same size', () => {
    const s0 = run({ runeVaultkeeper: true, board: [body('n', DRAGON), body('v', 'd2_herzog')], hand: [body('d1', DRAGON2)], ...tally(4) } as Partial<RunState>);
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

// Owner balance 2026-10-20: "change brisbane to just shout and rally, change spend to 40." (Echo removed, 30 -> 40 Gold)
describe('Alchemist Brisbane: "Shout and Rally: Your Rubies gain +1/+1. Spend 40 Gold to improve this."', () => {
  const B = CARD_INDEX['k_alchemist']!;
  const ruby = (s: RunState) => s.rubyBonus ?? { attack: 0, health: 0 };
  const bm = (over: Partial<BoardMinion> = {}): BoardMinion => ({ cardId: 'k_alchemist', attack: 1, health: 4000, sourceUid: 'AB', keywords: ['RL'], ...over } as BoardMinion);
  const wall: BoardMinion = { cardId: 'sandbag', attack: 0, health: 4000 } as BoardMinion;

  it.each([[false, 1], [true, 2]] as const)('Shout (golden=%s): Rubies gain +%i/+%i', (golden, n) => {
    const s = act(run({ hand: [body('ab', 'k_alchemist', { golden })] }), { type: 'play', uid: 'ab' });
    expect(ruby(s)).toEqual({ attack: n, health: n });
  });

  it('40 Gold spent on the board earns one improvement; the meter carries across spends', () => {
    const s = run({ board: [body('ab', 'k_alchemist')] });
    applyGoldSpent(s, 30);
    expect(at(s, 'ab').summonBonus ?? 0, '30 Gold: not yet').toBe(0);
    applyGoldSpent(s, 10);
    expect(at(s, 'ab').summonBonus, '40 Gold: one improvement').toBe(1);
    applyGoldSpent(s, 85);
    expect(at(s, 'ab').summonBonus, 'a big spend can cross the meter twice (5 left over)').toBe(3);
    expect(at(s, 'ab').goldTick).toBe(5);
  });

  it('a Brisbane in hand earns nothing', () => {
    const s = run({ hand: [body('ab', 'k_alchemist')] });
    applyGoldSpent(s, 90);
    expect(s.hand[0]!.summonBonus ?? 0).toBe(0);
  });

  it('the Echo is gone: a Shop death pays nothing', () => {
    const s = run({ board: [body('ab', 'k_alchemist', { summonBonus: 2 })] });
    fireRecruitDeathrattlesForTest(s, at(s, 'ab'));
    expect(ruby(s)).toEqual({ attack: 0, health: 0 });
    expect(B.effects.some((e) => e.on === 'onDeath')).toBe(false);
  });

  it('a re-fired Shout pays the improved value (Shrieker, End of Turn: trigger Shouts)', () => {
    const s = run({ board: [body('sh', 'd2_shrieker'), body('ab', 'k_alchemist', { summonBonus: 2 })] });
    applyEndOfTurn(s);
    expect(ruby(s), 'base 1 + 2 improvements of 1').toEqual({ attack: 3, health: 3 });
  });

  it('Rally in combat: every attack pays the grant, improvements included, and it carries back', () => {
    const fight = (over: Partial<BoardMinion>) => simulate([bm(over)], [wall], makeRng(3), CARD_INDEX, combatSide({ tier: 7, tribes: ['kobold'] }), combatSide({ tier: 1 }));
    // The same seeded fight three times: the Rally fires the same number of times in each, so the totals are the
    // per-Rally grant times one shared count.
    const plain = fight({}).playerRubyBonusGain!;
    const rallies = plain.attack;
    expect(Number.isInteger(rallies) && rallies > 0, 'whole +1/+1 grants, at least one').toBe(true);
    expect(plain).toEqual({ attack: rallies, health: rallies });
    expect(fight({ summonBonus: 1 }).playerRubyBonusGain, '+2/+2 per Rally with one improvement').toEqual({ attack: 2 * rallies, health: 2 * rallies });
    expect(fight({ summonBonus: 3 }).playerRubyBonusGain, '+4/+4 per Rally with three').toEqual({ attack: 4 * rallies, health: 4 * rallies });
    expect(fight({ summonBonus: 1, golden: true }).playerRubyBonusGain, 'Gilded: +4/+4 per Rally with one').toEqual({ attack: 4 * rallies, health: 4 * rallies });
  });

  it('the Echo is gone in combat too: a Brisbane killed before it attacks pays nothing', () => {
    // A 1-Health Brisbane that never gets to attack: the foe swings first and kills it.
    const r = simulate([bm({ attack: 0, health: 1, summonBonus: 1, keywords: [] })], [{ cardId: 'sandbag', attack: 50, health: 4000 } as BoardMinion],
      makeRng(3), CARD_INDEX, combatSide({ tier: 7, tribes: ['kobold'] }), combatSide({ tier: 1 }));
    expect(r.playerRubyBonusGain ?? { attack: 0, health: 0 }).toEqual({ attack: 0, health: 0 });
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
      '**Shout and Rally:** Your Rubies gain **+1/+1**. Spend **40 Gold** to improve this.',
      '**Shout and Rally:** Your Rubies gain **+2/+2**. Spend **40 Gold** to improve this.',
    ]);
  });

  it('other Ruby-strength cards are untouched by the improve fold (no step printed, accrual ignored)', () => {
    const s = run({ board: [body('sc', 'k_faultline', { summonBonus: 5 })] });
    fireRecruitDeathrattlesForTest(s, at(s, 'sc'));
    expect(ruby(s), 'Scrapper: its printed +1/+1').toEqual({ attack: 1, health: 1 });
  });
});
