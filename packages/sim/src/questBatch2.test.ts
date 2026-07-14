import { describe, it, expect } from 'vitest';
import type { BoardMinion, CombatResult, QuestCombatMods } from '@game/core';
import { simulate } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { makeRng } from '@game/core';
import { createRun, type RunState } from './state';
import { reduce } from './reducer';

const ALL = ['beast', 'undead', 'mech', 'dragon', 'demon'];
/** Run combat with explicit player quest combat mods (questMods is deep in the positional arg list). */
const runMods = (p: BoardMinion[], e: BoardMinion[], seed: number, mods: QuestCombatMods): CombatResult =>
  simulate(p, e, makeRng(seed), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, ALL, {}, false, false, 0, 0, 0, 0, mods);

const shell = (over: Partial<CombatResult>): CombatResult => ({
  events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, ...over,
});

describe('Leader of the Pack — golden Pack Leader (board-overflow when hand full)', () => {
  const tally = { attack: 18, summonCombat: 0, slaughter: 0, slaughterKeyword: 0, attackByTribe: { beast: 18 }, summonCombatByTribe: {}, slaughterByTribe: {} };
  const setup = (hand: RunState['hand']): RunState => ({
    ...createRun(1), wave: 11, phase: 'combat', combatSettled: false, hand, board: [], embers: 0,
    activeQuests: [{ questId: 'q_leader_of_the_pack', progress: 0, completed: false }],
    lastCombat: shell({ playerQuestTally: tally as never }),
  } as RunState);

  it('with hand room: golden Pack Leader lands in hand + 10 gold banked', () => {
    const s = reduce(setup([]), { type: 'settleCombat' });
    const pl = s.hand.find((c) => c.cardId === 'packleader');
    expect(pl, 'golden Pack Leader in hand').toBeDefined();
    expect(pl!.golden).toBe(true);
    expect(s.bonusEmbersNextTurn).toBe(10);
  });

  it('with a FULL hand: the golden Pack Leader overflows to the board instead of vanishing', () => {
    const full = Array.from({ length: 10 }, (_, i) => ({ uid: 'h' + i, cardId: 'alley', tribe: 'beast' as const, attack: 1, health: 1, keywords: [], golden: false }));
    const s = reduce(setup(full), { type: 'settleCombat' });
    expect(s.hand.some((c) => c.cardId === 'packleader')).toBe(false); // hand was full
    const onBoard = s.board.find((c) => c.cardId === 'packleader');
    expect(onBoard, 'Pack Leader placed on the board').toBeDefined();
    expect(onBoard!.golden).toBe(true); // still golden — not lost
    expect(s.bonusEmbersNextTurn).toBe(10);
  });
});

describe('Passing Spears — Spear Warden death transfers its stats to a friendly minion', () => {
  it('on a Spear Warden death, your strongest other minion gains its stats', () => {
    const player: BoardMinion[] = [
      { cardId: 'knit', attack: 5, health: 1, keywords: [] }, // dies to retaliation
      { cardId: 'sandbag', attack: 0, health: 500 },          // the strongest other → inherits
    ];
    const withFlag = runMods(player, [{ cardId: 'omen', attack: 10, health: 10 }], 1, { passingSpears: true });
    const bagUid = withFlag.initial.player[1]!.uid;
    const got = withFlag.events.find((e) => e.type === 'buff' && (e as { target: string }).target === bagUid && (e as { attack: number }).attack === 5);
    expect(got, 'sandbag inherited the Spear Warden +5 attack').toBeDefined();
    // Without the flag: no transfer.
    const noFlag = runMods(player, [{ cardId: 'omen', attack: 10, health: 10 }], 1, {});
    const bagUid2 = noFlag.initial.player[1]!.uid;
    expect(noFlag.events.some((e) => e.type === 'buff' && (e as { target: string }).target === bagUid2 && (e as { attack: number }).attack === 5)).toBe(false);
  });
});

describe('Cratering Missive — Hulk overflow buffs ALL tribes with the flag', () => {
  // 7-wide board: Imp King (1 HP, leftmost) dies to retaliation → its Deathrattle summons 2 Imps onto a full board
  // → the 2nd overflows → Cratering Hulk's onSummonOverflowBuffTribe fires. The Hulk buffs Undead by default;
  // Cratering Missive drops the tribe filter so the Beast (Alleycat) is buffed too.
  const board = (): BoardMinion[] => [
    { cardId: 'impking', attack: 4, health: 1, keywords: [] },              // demon, dies → summons 2 imps (overflow)
    { cardId: 'thunderingabomination', attack: 4, health: 80, keywords: [] }, // the Cratering Hulk (undead)
    { cardId: 'alley', attack: 1, health: 80, keywords: [] },               // a BEAST — only buffed WITH the flag
    { cardId: 'sandbag', attack: 0, health: 80 }, { cardId: 'sandbag', attack: 0, health: 80 },
    { cardId: 'sandbag', attack: 0, health: 80 }, { cardId: 'sandbag', attack: 0, health: 80 },
  ];
  const alleyBuffed = (r: CombatResult): boolean => {
    const alleyUid = r.initial.player[2]!.uid;
    return r.events.some((e) => e.type === 'buff' && (e as { target: string }).target === alleyUid && (e as { attack: number }).attack === 2);
  };

  it('with the flag the Beast gets the overflow buff; without it, only Undead do', () => {
    const enemy: BoardMinion[] = [{ cardId: 'omen', attack: 5, health: 500 }];
    expect(alleyBuffed(runMods(board(), enemy, 3, { crateringMissive: true })), 'Beast buffed WITH flag').toBe(true);
    expect(alleyBuffed(runMods(board(), enemy, 3, {})), 'Beast NOT buffed without flag').toBe(false);
  });
});

describe('The Godfodder — golden chooseOne text', () => {
  it('both Choose One options carry a goldenText (so a golden Godfodder shows the doubled values)', () => {
    const co = CARD_INDEX['godfodder']!.chooseOne!;
    expect(co[0]!.goldenText).toContain('4'); // add 4 Fodder
    expect(co[1]!.goldenText).toContain('+6/+6'); // Fodder +6/+6
  });
});
