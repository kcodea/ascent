import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatResult, type CombatSideState } from '../index';
import { CARD_INDEX, poolFor } from '@game/content';

/**
 * R-SYMMETRY-01 — the per-card cases behind the mirror test (sideSymmetry.test.ts): every asymmetry the 2026-10-13
 * audit fixed, shown on the ENEMY side. Each case runs the same board as the player and as the enemy (the swapped
 * fight pins `firstSide: 'enemy'`, see the mirror test) and asserts (1) the enemy half now does the thing, and
 * (2) it does it exactly as the player half does. Each of these failed before the fix.
 */

const wall = (hp = 60): BoardMinion[] => [{ cardId: 'sandbag', attack: 3, health: hp, keywords: ['T'], sourceUid: 'W' }];
const set1 = poolFor('set1').all.map((c) => c.id);
const ctx = (over: Partial<CombatSideState> = {}): CombatSideState => combatSide({ tier: 6, tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], poolIds: set1, ...over });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The board fights once as the player and once as the enemy (role-pinned), seed for seed. */
function both(board: BoardMinion[], side: CombatSideState, foe: BoardMinion[] = wall(), seed = 3, cards: Record<string, CardDef> = CARD_INDEX): { asPlayer: CombatResult; asEnemy: CombatResult } {
  const asPlayer = simulate(clone(board), clone(foe), makeRng(seed), cards, clone(side), ctx());
  const asEnemy = simulate(clone(foe), clone(board), makeRng(seed), cards, ctx(), clone(side), { firstSide: 'enemy' });
  return { asPlayer, asEnemy };
}
const swap = (s: string): string => s.replace(/"player"/g, '"@@"').replace(/"enemy"/g, '"player"').replace(/"@@"/g, '"enemy"');
const sameFight = (r: { asPlayer: CombatResult; asEnemy: CombatResult }): void => {
  expect(swap(JSON.stringify(r.asEnemy.events))).toBe(JSON.stringify(r.asPlayer.events));
};

describe('R-SYMMETRY-01 — the enemy side is live, exactly like the player side', () => {
  it('the Undead (Lantern) aura reaches the ENEMY\'s starting Undead too', () => {
    const r = both([{ cardId: 'knit', attack: 4, health: 2, sourceUid: 'K' }], ctx({ undeadAtk: 3, undeadHp: 2 }));
    expect(r.asEnemy.initial.enemy[0]).toMatchObject({ attack: 7, health: 4 }); // 4/2 + the +3/+2 aura (was 4/2)
    expect(r.asPlayer.initial.player[0]).toMatchObject({ attack: 7, health: 4 });
    sameFight(r);
  });

  it('an enemy Echo-tally scaler reads the LIVE tally (run total + this fight), not its frozen snapshot value', () => {
    // The legacy "+1/+1 per Echo this game" body (deathrattleBuffTribeByTally): run tally 5, its own death is Echo #6.
    const cards = { ...CARD_INDEX, test_tally: { ...CARD_INDEX.grim!, id: 'test_tally', effects: [{ on: 'onDeath', do: 'deathrattleBuffTribeByTally', params: { tribe: 'any', per: 1 } }] } as CardDef };
    const board: BoardMinion[] = [{ cardId: 'test_tally', attack: 1, health: 1, sourceUid: 'G' }, { cardId: 'sandbag', attack: 0, health: 50, sourceUid: 'S' }];
    const r = both(board, ctx({ deathrattles: 5 }), wall(), 3, cards);
    const grant = (res: CombatResult): number | undefined => (res.events.find((e) => e.type === 'buff' && e.source === res.initial[res === r.asPlayer ? 'player' : 'enemy'][0]!.uid) as { attack?: number } | undefined)?.attack;
    expect(grant(r.asEnemy), 'the enemy reads 5 + this Echo = 6 (was the frozen 5)').toBe(6);
    expect(grant(r.asPlayer)).toBe(6);
    sameFight(r);
  });

  it('an enemy Pack Mentality grows live and carries back', () => {
    const board: BoardMinion[] = [{ cardId: 'manasaber', attack: 4, health: 1, sourceUid: 'P1' }, { cardId: 'manasaber', attack: 4, health: 1, sourceUid: 'P2' }];
    const r = both(board, ctx({ questMods: { beastSummonScale: { per: 1, stepAttack: 1, stepHealth: 1, progress: 0 } } }));
    expect(r.asEnemy.events.some((e) => e.type === 'buff' && e.source === 'Pack Mentality')).toBe(true);
    expect(r.asEnemy.enemyCarry!.beastBuyAtkGain ?? 0).toBeGreaterThan(0);
    expect(r.asEnemy.enemyCarry!.beastBuyAtkGain).toBe(r.asPlayer.playerBeastBuyAtkGain);
    sameFight(r);
  });

  it('an enemy Blood Trail marks its left-most body and its kills conjure Beasts (side-tagged)', () => {
    const board: BoardMinion[] = [{ cardId: 'alley', attack: 20, health: 30, sourceUid: 'B' }];
    const foe: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 2, sourceUid: 'X1' }, { cardId: 'sandbag', attack: 1, health: 2, sourceUid: 'X2' }];
    const r = both(board, ctx({ questMods: { bloodTrail: true } }), foe);
    const beasts = (res: CombatResult, side: 'player' | 'enemy'): number => res.events.filter((e) => e.type === 'toHand' && e.side === side).length;
    expect(beasts(r.asEnemy, 'enemy'), 'each kill conjures a Beast to the enemy hand (it conjured none)').toBeGreaterThan(0);
    expect(r.asEnemy.enemyCarry!.handGrants?.length).toBe(beasts(r.asEnemy, 'enemy'));
    expect(beasts(r.asPlayer, 'player')).toBe(beasts(r.asEnemy, 'enemy'));
    sameFight(r);
  });

  it('enemy spell power grows mid-fight (an Avenge that improves spells) and carries back, exactly like the player side', () => {
    const board: BoardMinion[] = [
      { cardId: 'knit', attack: 1, health: 1, sourceUid: 'A' }, { cardId: 'knit', attack: 1, health: 1, sourceUid: 'B' },
      { cardId: 'sandbag', attack: 0, health: 80, sourceUid: 'S' },
    ];
    const r = both(board, ctx({ spellPowerAtk: 2, spellPowerHp: 2, questMods: { ancientAvengeSpells: { every: 1, attack: 1, health: 1, label: 'Hunch' } } }));
    expect(r.asEnemy.events.some((e) => e.type === 'sc' && e.side === 'enemy' && /Spell Power$/.test(e.text))).toBe(true);
    expect(r.asEnemy.enemyCarry!.spellPower?.attack ?? 0).toBeGreaterThan(0);
    expect(r.asEnemy.enemyCarry!.spellPower).toEqual(r.asPlayer.playerSpellPower);
    sameFight(r);
  });

  it('an enemy Rune of the Cinder Ledger raises its LIVE Imp Aura (not only the carry-back)', () => {
    const board: BoardMinion[] = [
      { cardId: 'knit', attack: 1, health: 1, sourceUid: 'A' }, { cardId: 'knit', attack: 1, health: 1, sourceUid: 'B' },
      { cardId: 'knit', attack: 1, health: 1, sourceUid: 'C' }, { cardId: 'sandbag', attack: 0, health: 80, sourceUid: 'S' },
    ];
    const r = both(board, ctx({ questMods: { runeCinderLedger: 3 } }));
    expect(r.asEnemy.events.some((e) => e.type === 'tribeAura' && e.side === 'enemy' && e.aura === 'imp')).toBe(true);
    expect(r.asEnemy.enemyCarry!.impBuffGain).toEqual(r.asPlayer.playerImpBuffGain);
    sameFight(r);
  });

  it('an enemy Echo Warden doubles the enemy\'s summons', () => {
    const board: BoardMinion[] = [{ cardId: 'manasaber', attack: 4, health: 1, sourceUid: 'P' }, { cardId: 'echowarden', attack: 4, health: 50, sourceUid: 'E' }];
    const r = both(board, ctx());
    const cubs = (res: CombatResult, side: 'player' | 'enemy'): number => res.events.filter((e) => e.type === 'summon' && e.side === side && e.minion.cardId === 'sabercub').length;
    expect(cubs(r.asEnemy, 'enemy'), 'two cubs, each doubled').toBe(4);
    expect(cubs(r.asPlayer, 'player')).toBe(4);
    sameFight(r);
  });

  it('an enemy Rune of the Herald folds the enemy\'s Echo multipliers (Sylus)', () => {
    const board: BoardMinion[] = [{ cardId: 'spore', attack: 2, health: 30, sourceUid: 'S' }, { cardId: 'sylus', attack: 1, health: 30, sourceUid: 'Y' }];
    const r = both(board, ctx({ questMods: { runeHerald: true } }));
    expect(r.asEnemy.enemyCarry!.deathrattles, 'Herald x (1 + Sylus) = 2 Echoes at Start of Combat').toBeGreaterThanOrEqual(2);
    expect(r.asEnemy.enemyCarry!.deathrattles).toBe(r.asPlayer.playerDeathrattles);
    sameFight(r);
  });

  it('an enemy hand card buffed mid-fight grows live (handBuff event, side-tagged) and the caller\'s hand is never mutated', () => {
    const hand = [{ uid: 'h1', cardId: 'alley', attack: 2, health: 2, keywords: [], golden: false }];
    const side = ctx({ handMinions: hand, questMods: { runePallbearer: true } });
    const board: BoardMinion[] = [{ cardId: 'knit', attack: 1, health: 1, sourceUid: 'K' }, { cardId: 'sandbag', attack: 0, health: 80, sourceUid: 'S' }];
    const enemyRun = simulate(wall(), board, makeRng(3), CARD_INDEX, ctx(), side);
    expect(enemyRun.events.some((e) => e.type === 'handBuff' && e.side === 'enemy' && e.uid === 'h1')).toBe(true);
    expect(enemyRun.enemyCarry!.handBuffs?.length).toBeGreaterThan(0);
    expect(hand[0]).toMatchObject({ attack: 2, health: 2 }); // the served snapshot's hand stays as captured
  });
});
