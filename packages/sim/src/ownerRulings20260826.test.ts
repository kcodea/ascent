import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { castSpell, fireOnFriendDeath, fireRecruitDeathrattlesForTest } from './recruit';

/**
 * OWNER RULINGS 2026-08-26 (Rulebook triage board) — the shop halves the owner ruled IN, plus the two
 * cross-phase folds. Each test pins the behaviour the ruling asked for; the triage card id is noted so the
 * decision in packages/rules/src/registry/decisions.json stays traceable to its pin.
 */
const mk = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as BoardCard;
};
const state = (board: BoardCard[]): RunState => ({ ...createRun(7), board, hand: [] });

describe('shop-side Echo + death watchers (q-phase-*)', () => {
  it("Malphas' Echo buffs the Shop when fired in the shop phase (deathrattleBuffShopPermanent)", () => {
    const s = state([mk('m', 'dm_malphas')]);
    const before = { ...s.tavernBuyBonus };
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    expect(s.tavernBuyBonus.atk - before.atk, "the owner's '+8/+8 to the Shop' Echo").toBe(8);
    expect(s.tavernBuyBonus.hp - before.hp).toBe(8);
  });

  it("Runesnout Archivist's Echo casts the remembered spells on friendly Beasts (echoCastRememberedSpells)", () => {
    const s = state([mk('a', 'runesnout_archivist'), mk('p', 'pup')]);
    s.rememberedSpellIds = ['bulwark']; // aimed: +0/+1 and Taunt
    const hpBefore = s.board.reduce((n, c) => n + c.health, 0);
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    expect(s.board.reduce((n, c) => n + c.health, 0) - hpBefore, 'the remembered Bulwark landed on a Beast').toBeGreaterThanOrEqual(1);
    expect(s.board.some((c) => c.keywords.includes('T')), "Bulwark's Taunt came with it").toBe(true);
  });

  it("Scavvers' Echo triggers an ADJACENT Rally through the shop dispatcher (deathrattleTriggerAdjacentRally)", () => {
    const s = state([mk('cv', 'k_crownvein'), mk('sc', 'b2_scavenger')]);
    fireRecruitDeathrattlesForTest(s, s.board[1]!);
    expect(s.rubyBonus?.attack ?? 0, "Crownvein's Rally (Rubies +1/+1) fired").toBe(1);
    expect(s.rubyBonus?.health ?? 0).toBe(1);
  });

  it('Ashen Heir hands a shop-destroyed Imp\'s stats to a living Imp (impInheritOnDeath)', () => {
    const s = state([mk('h', 'ashen_heir'), mk('i', 'impscrap', { attack: 3, health: 4 })]);
    const dead = mk('x', 'impscrap', { attack: 2, health: 5 });
    fireOnFriendDeath(s, dead);
    const heir = s.board.find((c) => c.uid === 'h')!;
    const imp = s.board.find((c) => c.uid === 'i')!;
    expect([imp.attack, imp.health], 'the living Imp inherited +2/+5').toEqual([5, 9]);
    expect(heir.impBank, 'nothing banked while an Imp lives').toBeUndefined();
  });

  it('…and BANKS the stats when no Imp is alive (impInheritOnDeath, bank half)', () => {
    const s = state([mk('h', 'ashen_heir')]);
    fireOnFriendDeath(s, mk('x', 'impscrap', { attack: 2, health: 5 }));
    expect(s.board.find((c) => c.uid === 'h')!.impBank, 'no living Imp → banked').toEqual({ attack: 2, health: 5 });
  });

  it('…and the bank pays out to the next Imp entering play (impInheritOnSummon)', () => {
    const s = state([mk('h', 'ashen_heir', { impBank: { attack: 2, health: 5 } }), mk('b', 'brood')]);
    // A friend dies near Brood Matron → she summons an Imp → the bank pays out to it on entry.
    fireOnFriendDeath(s, mk('y', 'pup'));
    const imp = s.board.find((c) => CARD_INDEX[c.cardId]?.imp);
    expect(imp, 'Brood Matron bred an Imp for the death').toBeDefined();
    expect([imp!.attack, imp!.health], 'the newborn Imp collected the bank (1/1 + 2/5)').toEqual([3, 6]);
    expect(s.board.find((c) => c.uid === 'h')!.impBank, 'the bank is spent').toEqual({ attack: 0, health: 0 });
  });

  it('Brood Matron breeds on shop deaths, capped at 3 per turn (onFriendDeathSummon)', () => {
    const s = state([mk('b', 'brood')]);
    for (let i = 0; i < 5; i++) fireOnFriendDeath(s, mk(`d${i}`, 'pup'));
    expect(s.board.filter((c) => c.cardId === 'impscrap').length, 'max 3 per turn').toBe(3);
    expect(s.board.find((c) => c.uid === 'b')!.bredThisTurn).toBe(3);
  });

  it("Echo Mimic copies a shop-dead friend's Echo onto itself (onFriendDeathGainEcho)", () => {
    const s = state([mk('em', 'n2_echomimic')]);
    fireOnFriendDeath(s, mk('m', 'dm_malphas'));
    const mimic = s.board[0]!;
    expect(mimic.grantedEffects?.some((e) => e.do === 'deathrattleBuffShopPermanent'), "gained Malphas' Echo").toBe(true);
  });
});

describe('cross-phase folds', () => {
  it("Veinstorm's Rubies fold the run's spell power (q-spellpower-spellBuffShopByRuby REJECTED as flat)", () => {
    const s = state([]);
    s.shop = [{ uid: 'o1', cardId: 'pup' }];
    s.rubyBonus = { attack: 2, health: 1 };
    s.spellBonus = { attack: 3, health: 0 };
    castSpell(s, CARD_INDEX['veinstorm']!);
    // 1 base + rubyBonus + spell power: (1+2+3)/(1+1+0)
    expect(s.veinstormRubies, 'the banked per-shop stamp folds both bonuses').toEqual({ atk: 6, hp: 2 });
  });

  it("Reflector spreads a mid-combat Ruby to a random friendly, once per combat (onRubyPlayedSpreadRandom)", () => {
    // Gemstorm Instigator's Avenge (2) plays Rubies on friendly Kobolds mid-fight; the Reflector wears the
    // Kobold tribe via addedTribes so the Rubies land on it — its combat half must spread ONE buff and stop.
    const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
      ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra });
    const player = [
      bm('n2_reflector', 'R', 0, 40, { addedTribes: ['kobold'] }),
      bm('pup', 'p1', 1, 1), bm('pup', 'p2', 1, 1),
      bm('k_gemstorm', 'G', 1, 40),
      bm('sandbag', 'W', 0, 40),
    ];
    const wall = { cardId: 'sandbag', attack: 8, health: 400 };
    const r = simulate(player, [wall], makeRng(11), CARD_INDEX, combatSide({ tier: 6, tribes: ['kobold'] }), combatSide({ tier: 1 }));
    const spread = (r.events.filter((e) => e.type === 'buff') as { source: string }[]).filter((b) => b.source === 'Reflector');
    expect(spread.length, 'exactly one spread — the once-per-combat guard held').toBe(1);
  });
});
