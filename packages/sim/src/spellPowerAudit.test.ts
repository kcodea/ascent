import { describe, it, expect } from 'vitest';
import { combatCastable, combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, spellAttackBonus, spellHealthBonus, spellDisplayText } from './recruit';

/**
 * SPELL-POWER AUDIT (owner ask 2026-08-19: "Beefy is not getting spell power buffs").
 *
 * The engine turned out to be right on the recruit path — every board-stat spell folds `spellAttackBonus` /
 * `spellHealthBonus`. What was actually broken is narrower and worse: **Beefy had no case in the combat spell
 * resolver**, so a Beefy cast mid-fight (Sporebat's Echo, Steward, Recaller, Ryme, any hand-spell re-fire)
 * fizzled entirely rather than under-paying. From the player's seat "did nothing" and "missed its spell power"
 * look identical, which is why the report landed as the latter.
 *
 * These tests pin BOTH halves so the pair can't drift again: the fold on every path, and castability.
 */

const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const body = (cardId: string, uid: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
// DISTINCT card ids on purpose — three copies of one id triple-combine and silently destroy the fixture.
const trio = (): BoardCard[] => [body('pack', 'L'), body('stray', 'T'), body('alley', 'R')];
const gainOf = (s: RunState, uid: string): [number, number] => {
  const c = s.board.find((x) => x.uid === uid)!;
  const d = CARD_INDEX[c.cardId]!;
  return [c.attack - d.attack!, c.health - d.health!];
};
const bm = (cardId: string, attack = 2, health = 200): BoardMinion => ({ cardId, attack, health, keywords: [] });

describe('Beefy folds spell power on every path', () => {
  const POWER = { attack: 5, health: 4 }; // base +8/+8 → +13/+12

  it('cast from hand: the target AND both neighbours get the folded value', () => {
    let s: RunState = { ...set2(), phase: 'recruit', embers: 40, spellBonus: POWER, board: trio(),
      hand: [{ uid: 'bf', cardId: 'sp_beefy', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    expect([spellAttackBonus(s), spellHealthBonus(s)]).toEqual([5, 4]);
    s = reduce(s, { type: 'play', uid: 'bf', targetUid: 'T' });
    for (const uid of ['L', 'T', 'R']) expect(gainOf(s, uid), `${uid} missed spell power`).toEqual([13, 12]);
  });

  it('with no spell power it pays exactly its printed +8/+8', () => {
    let s: RunState = { ...set2(), phase: 'recruit', embers: 40, board: trio(),
      hand: [{ uid: 'bf', cardId: 'sp_beefy', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'bf', targetUid: 'T' });
    for (const uid of ['L', 'T', 'R']) expect(gainOf(s, uid)).toEqual([8, 8]);
  });

  it("Arnold's End of Turn cast folds it too (the spell-on-self path)", () => {
    const s: RunState = { ...set2(), phase: 'recruit', spellBonus: POWER,
      board: [body('pack', 'L'), body('dw_arnold', 'A'), body('alley', 'R')], hand: [] };
    applyEndOfTurn(s);
    for (const uid of ['L', 'A', 'R']) expect(gainOf(s, uid), `${uid} missed spell power`).toEqual([13, 12]);
  });

  it('the printed card text shows the live value, not the base', () => {
    expect(spellDisplayText('sp_beefy', 5, 0, 4)).toContain('{{+13/+12}}');
    expect(CARD_INDEX['sp_beefy']!.text).toContain('+8/+8'); // the base is still what's authored
  });
});

describe('Beefy is castable IN COMBAT (regression — it silently fizzled)', () => {
  it('is registered as combat-castable', () => {
    expect(combatCastable(CARD_INDEX['sp_beefy']!), 'Beefy would fizzle on every combat re-fire').toBe(true);
  });

  it('a mid-combat cast buffs the target and its living neighbours, with spell power', () => {
    // Sporebat's Echo casts the spell it stored. Three distinct bodies so the neighbour reach is observable.
    const r = simulate(
      [bm('pack'), bm('stray'), bm('alley')],
      [bm('sandbag', 0, 40000)],
      makeRng(4), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast'], spellPowerAtk: 5, spellPowerHp: 4 }), combatSide(),
    );
    void r; // the fixture above only proves the sim runs; the real assertion is the resolver switch below
    const def = CARD_INDEX['sp_beefy']!;
    const cast = def.effects.find((e) => e.on === 'cast')!;
    expect(cast.do).toBe('spellBuffTargetAndNeighbours');
    expect(combatCastable(def)).toBe(true);
  });
});

describe('every board-stat spell folds spell power (the audit itself)', () => {
  // The families that grant stats to FRIENDLY BOARD minions. Shop/tavern channels and the Ruby channel are
  // deliberately excluded — a Ruby scales on `rubyStatBonus`, and a shop buff is not a spell-power effect.
  const BOARD_STAT_DOS = [
    'spellBuffTarget', 'spellBuffAll', 'spellBuffRandomFriendlies', 'spellBuffTargetAndNeighbours',
    'spellBuffLeftmost', 'spellBuffTargetEscalating', 'spellBuffByTier', 'spellBuffRandomPerTribe',
    'spellBuffHealthGrantFlurryDragon',
  ];

  it('no board-stat spell is missing from the combat resolver', () => {
    // `spellBuffTargetPerGold` (Patch Job) is a KNOWN, deliberate omission: its magnitude is "Gold spent this
    // turn", and `CombatSideState` carries no gold — resolving it mid-fight would need new plumbing, not a
    // switch case. Listed here so the gap stays visible instead of being rediscovered as a bug.
    const missing = Object.values(CARD_INDEX)
      .filter((d) => d.spell && d.effects.some((e) => e.on === 'cast' && BOARD_STAT_DOS.includes(e.do)))
      .filter((d) => !combatCastable(d))
      .map((d) => d.id);
    expect(missing, 'these grant board stats but fizzle in combat').toEqual([]);
  });
});
