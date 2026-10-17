import { describe, it, expect } from 'vitest';
import type { BoardMinion, CombatSideState } from '@game/core';
import { createRun, type BoardCard, type RunState } from './state';
import { playerBoardMinions, playerCombatSideState } from './reducer';
import { snapshotBoard, type BoardSnapshot } from './snapshot';
import { sideFromSnapshot, snapshotRubyPower } from './boardSide';
import { opponentBoard } from './opponents';

/**
 * SNAPSHOT PARITY: EVERY FIELD, BY CONSTRUCTION (R-SNAPSHOT-RUBY-01, owner 2026-10-17: "we need the game serving
 * integrity to be literally perfect").
 *
 * `snapshotFidelity.test.ts` diffs the reducer's player side against a served snapshot, but only over the fields its
 * staged state happens to set: a field left at its default compares neutral = neutral and passes, which is how Rune of
 * the Spellstone's folded Ruby strength slipped through (the staged run did not own the rune). This test closes that
 * hole twice over:
 *
 *  1. The two tables below are EXHAUSTIVE over `CombatSideState` and `BoardMinion` (a mapped type: adding a field to
 *     either fails `npm run typecheck` until it is classified here as carried or excluded-with-a-reason).
 *  2. Every CARRIED field must be NON-DEFAULT in the staged run (so the diff can see it) AND survive the round trip
 *     `snapshotBoard` -> `sideFromSnapshot` / `opponentBoard` unchanged.
 */

type Carried = 'carried';
/** Why a field is deliberately not compared. */
type Excluded = { excluded: string };

const SIDE_FIELDS: { [K in keyof Required<CombatSideState>]: Carried | Excluded } = {
  poolIds: { excluded: "both sides draw from the LIVE run's pinned pool by design (see sideFromSnapshot's doc)" },
  wildHuntGrown: 'carried', whisperImprove: 'carried', spellsThisTurn: 'carried', firstSpellThisTurnId: 'carried',
  spellsCast: 'carried', deathrattles: 'carried', spellPowerAtk: 'carried', spellPowerHp: 'carried',
  undeadAtk: 'carried', undeadHp: 'carried', undeadBuyAtk: 'carried', impAtk: 'carried', impHp: 'carried',
  conductorBuff: 'carried', fodderConsumedAtk: 'carried', fodderConsumedHp: 'carried', beastBuyAtk: 'carried',
  beastsPlayed: 'carried', spiritsPlayed: 'carried', tribesPlayed: 'carried', cardTribes: 'carried', rubyCasts: 'carried',
  revelerX: 'carried', cardsBoughtThisTurn: 'carried', magneticAtk: 'carried', magneticHp: 'carried', rubyBonus: 'carried',
  handSpellIds: 'carried', alesLastTurn: 'carried', spellEscalation: 'carried', lastSpellCastId: 'carried',
  rememberedSpellIds: 'carried', spellhide: 'carried', growthBonus: 'carried', goldSpentThisTurn: 'carried',
  lastSpellThisTurnId: 'carried', squirlScoutBuff: 'carried', handMinions: 'carried', beastHuntExtra: 'carried',
  beastRitualExtra: 'carried', tier: 'carried', tribes: 'carried', cardBuffs: 'carried', questMods: 'carried',
  pendingQuests: 'carried',
};

const MINION_FIELDS: { [K in keyof Required<BoardMinion>]: Carried | Excluded } = {
  cardId: 'carried', attack: 'carried', health: 'carried', keywords: 'carried', golden: 'carried',
  align: { excluded: 'Celestial alignment: no Celestial is in a live set (owner 2026-10-17: "not a problem right now"); capture it when Set 4 goes live' },
  critChance: { excluded: "card-definition data: neither the player's mapping nor the snapshot sets it per instance" },
  addedTribes: 'carried', rallyMechAtk: 'carried', rallySpellWeld: 'carried', copiedEcho: 'carried', seedEchoes: 'carried',
  grantedEffects: 'carried', echoStripped: 'carried', impBank: 'carried', universalTribe: 'carried', bloodbinderMode: 'carried',
  bloodlust: 'carried', bloodlustRally: 'carried', chosenOption: 'carried', taughtSpellId: 'carried', chefGrantedLast: 'carried',
  summonBonus: 'carried', eotBonus: 'carried', sellBonus: 'carried', eotTick: 'carried', whisperTick: 'carried',
  overflowBonus: 'carried', hpGrantBonus: 'carried', ascendProgress: 'carried', spellProgress: 'carried', spiritTally: 'carried',
  damageDealt: 'carried', soldProgress: 'carried', boardFirstSpellId: 'carried', sourceUid: 'carried', resummon: 'carried',
  partingCry: 'carried', closedCasket: 'carried', buffs: 'carried',
  text: { excluded: 'display-only, baked on the final leaderboard / Career board, never on a combat board' },
  goldenText: { excluded: 'display-only (see text)' },
  name: { excluded: 'display-only (see text)' },
  tribe: { excluded: 'display-only (see text)' },
};

const neutral = (v: unknown): boolean =>
  v === undefined || v === null || v === 0 || v === false || v === ''
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(neutral));

/** One board card with EVERY per-instance field the player's combat mapping reads set to a distinctive value. */
const fullCard = (): BoardCard => ({
  uid: 'a', cardId: 'gnash', tribe: 'beast', attack: 9, health: 8, keywords: ['T', 'DS'], golden: true,
  addedTribes: ['dragon'], allTribes: true, chosenOption: 1, taughtSpellId: 'growth', summonBonus: 2, chefGranted: 3,
  overflowBonus: 2, hpGrantBonus: 4, ascendProgress: 5, spellProgress: 6, spiritTally: 2, damageDealt: 33, soldProgress: 3,
  boardFirstSpellId: 'growth', eotBonus: 2, sellBonus: 1, eotTick: 2, rallyMechAtk: 3, rallySpellWeld: 1, resummon: true,
  partingCry: true, closedCasket: true, bloodlust: true, bloodlustRally: true, bloodbinderMode: 'hp', echoStripped: true,
  copiedEcho: [{ on: 'onDeath', do: 'dsSummon', params: { cardId: 'pup' } }],
  grantedEffects: [{ on: 'onDeath', do: 'dsSummon', params: { cardId: 'pup' } }],
  impBank: { attack: 2, health: 1 }, seedEchoes: 1, seedEchoesTemp: 1, whisperTick: 2,
  buffs: [{ source: 'Growth', attack: 1, health: 1, count: 1 }],
} as unknown as BoardCard);

const staged = (): RunState => ({
  ...createRun(7, 'drakko'),
  phase: 'recruit', embers: 0, shop: [], tier: 4,
  board: [fullCard(), { uid: 'b', cardId: 'alley', tribe: 'beast', attack: 2, health: 4, keywords: [], golden: false }],
  hand: [
    { uid: 'h1', cardId: 'growth', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false },
    { uid: 'h2', cardId: 'stray', tribe: 'beast', attack: 4, health: 5, keywords: ['T'], golden: true },
  ],
  spellsThisTurn: 3, spellsCast: 17, deathrattlesTriggered: 5, spellBonus: { attack: 2, health: 3 },
  undeadAttackBonus: 4, undeadHealthBonus: 2, undeadBuyAtk: 1, impBuff: { attack: 2, health: 1 },
  fodderConsumedThisTurn: { attack: 3, health: 3 }, beastBuyAtk: 2, playedThisTurn: ['gnash', 'stray', 'sp3_tidebud'],
  rubyCasts: 6, revelerX: 3, cardsBoughtThisTurn: 4, magneticBuyAtk: 1, magneticBuyHp: 2,
  rubyBonus: { attack: 4, health: 4 },
  runeSpellstone: true, // the reported case: the owner's fight folds spell power into its Rubies (R-SNAPSHOT-RUBY-01)
  runeWildHuntGrown: 6, cardBuffs: { whelpling: { attack: 2, health: 2 } }, beastHuntExtra: 1, beastRitualExtra: 1,
  firstSpellThisTurnId: 'growth', spellhidePending: [{ spellId: 'growth', uid: 'a' }],
  activeQuests: [{ questId: 'q_foragers_trail', progress: 4, completed: false }],
  whisperImprove: { growth: 2 }, conductorBuff: 2, cardTribes: { gnash: ['dragon'] }, alesCastThisTurn: 2,
  frontToBackBonus: 2, frontToBackBonusH: 1, lastSpellCastId: 'growth', rememberedSpellIds: ['growth'], growthBonus: 3,
  goldSpentThisTurn: 9, lastSpellThisTurnId: 'growth', squirlScoutBuff: 2,
} as unknown as RunState);

const carried = <T extends object>(t: T): (keyof T)[] => (Object.keys(t) as (keyof T)[]).filter((k) => t[k] === 'carried');

describe('R-SNAPSHOT-RUBY-01: every carried combat field is staged non-default and survives the round trip', () => {
  it('side: the served snapshot rebuilds the owner\'s own combat side, field for field', () => {
    const s = staged();
    const player = playerCombatSideState(s);
    const rebuilt = sideFromSnapshot(snapshotBoard(s), s.tier, player.poolIds ? [...player.poolIds] : []);
    const unstaged = carried(SIDE_FIELDS).filter((k) => neutral(player[k]));
    expect(unstaged, 'carried fields the staged run leaves at their default (stage them, or the diff cannot see a drop)').toEqual([]);
    const drops = carried(SIDE_FIELDS).filter((k) => JSON.stringify(player[k]) !== JSON.stringify(rebuilt[k]))
      .map((k) => `${String(k)}: player=${JSON.stringify(player[k])} served=${JSON.stringify(rebuilt[k])}`);
    expect(drops, 'fields dropped or changed between capture and serve').toEqual([]);
  });

  it('minions: the served board restores every per-instance field the owner\'s own fight carries', () => {
    const s = staged();
    const mine = playerBoardMinions(s.board)[0]!;
    const served = opponentBoard(snapshotBoard(s))[0]!;
    const unstaged = carried(MINION_FIELDS).filter((k) => neutral(mine[k]));
    expect(unstaged, 'carried minion fields the staged card leaves at their default').toEqual([]);
    const drops = carried(MINION_FIELDS).filter((k) => JSON.stringify(mine[k]) !== JSON.stringify(served[k]))
      .map((k) => `${String(k)}: player=${JSON.stringify(mine[k])} served=${JSON.stringify(served[k])}`);
    expect(drops, 'minion fields dropped or changed between capture and serve').toEqual([]);
  });

  it('R-SNAPSHOT-RUBY-01: a Spellstone board serves its Rubies at the owner\'s folded strength (+7/+7, not +4/+4)', () => {
    const s = { ...staged(), spellBonus: { attack: 3, health: 3 } } as RunState;
    const player = playerCombatSideState(s);
    const snap = snapshotBoard(s);
    expect(snap.rubyBonus, 'the raw run value still rides for the "Ruby power" readout').toEqual({ attack: 4, health: 4 });
    expect(sideFromSnapshot(snap, 4, []).rubyBonus).toEqual(player.rubyBonus);
    // A capture from BEFORE the fix (no `rubyPower`) is recomputed on read from what it did store.
    const legacy: BoardSnapshot = { ...snap };
    delete legacy.rubyPower;
    expect(sideFromSnapshot(legacy, 4, []).rubyBonus).toEqual(player.rubyBonus);
    // …and a non-Spellstone legacy board keeps its raw value.
    expect(snapshotRubyPower({ rubyBonus: { attack: 4, health: 4 }, spellPower: { attack: 5, health: 5 } })).toEqual({ attack: 4, health: 4 });
  });
});
