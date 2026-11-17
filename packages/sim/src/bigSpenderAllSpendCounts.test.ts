/**
 * BIG SPENDER x EVERY SPEND COUNT (owner ruling 2026-11-17, R-BIG-SPENDER-ALL-01): "i think all "spend" mechanics should
 * function in the same way, so yes it should." With Big Spender held, EVERY mechanic that counts Gold spent counts each
 * Gold twice (three times with two copies): the "spend N Gold" triggers, the "for each Gold spent this turn" readers, the
 * run-long counts, the hero-power thresholds and the "Spend N Gold" quests. The Gold actually paid stays real.
 *
 * Each row spends REAL Gold through the reducer (Refreshes, the one `spendGold` chokepoint) at x1 / x2 / x3 and reads
 * the mechanic's own count.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_IDS, ancientCombatMods, countedGoldSpent, countedGoldSpentThisTurn, createRun, enableAncients, eotTickCount, heroPowerText,
  projectEndOfTurnSteps, reduce, type AncientId, type BoardCard, type RunState,
} from './index';
import { handCardLocked } from './recruit';
import { playerCombatSideState } from './reducer';
import { snapshotBoard } from './snapshot';
import { runeTally } from '../../ui/src/runeTally';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const PLAIN = Object.values(CARD_INDEX).filter((c) => !c.spell && !c.ruby && !c.token && !c.universalTribe && c.tribe === 'neutral'
  && !c.tribe2 && !c.henchman && c.effects.length === 0 && c.keywords.length === 0).map((c) => c.id);
const plain = (uid: string, over: Partial<BoardCard> = {}) => body(uid, PLAIN[0]!, over);

/** Big Spender copies held: 0 (x1), 1 (x2), 2 (x3). Set on the run exactly as the rune's reward arms it. */
const holding = (s: RunState, copies: number): RunState => copies === 0 ? s : {
  ...s, questFlags: { ...(s.questFlags ?? {}), runeBigSpender: true }, runeStacks: { ...(s.runeStacks ?? {}), rune_big_spender: copies },
};
const run = (copies: number, over: Partial<RunState> = {}, hero?: string): RunState => holding({
  ...createRun(5, hero), phase: 'recruit', wave: 6, embers: 200, freeRolls: 0, hand: [], board: [], goldSpent: 0, goldSpentThisTurn: 0, ...over,
} as RunState, copies);
/** Spend `n` REAL Gold through the reducer (one Refresh at a time) and prove it cost exactly that. */
function spend(s: RunState, n: number): RunState {
  const before = s.embers;
  while (before - s.embers < n) s = reduce(s, { type: 'roll' });
  expect(before - s.embers, 'the Gold actually paid is real').toBe(n);
  return s;
}
const MULTS = [[0, 1], [1, 2], [2, 3]] as const;

describe('Big Spender: every Gold-spent count counts each Gold twice (x3 with two copies)', () => {
  it('the counted tallies double; the real Gold paid and the real tallies do not', () => {
    for (const [copies, m] of MULTS) {
      const s = spend(run(copies), 20);
      expect([countedGoldSpentThisTurn(s), countedGoldSpent(s)], `x${m}`).toEqual([20 * m, 20 * m]);
      expect([s.goldSpentThisTurn, s.goldSpent], `x${m}: real Gold`).toEqual([20, 20]);
      expect(s.embers, `x${m}: the Gold paid`).toBe(180);
    }
  });

  it('Rope Wrangler: 20 Gold spent casts 3 / 5 / 7 Lassos (1 + floor(counted / 10))', () => {
    const eff = CARD_INDEX['ropewrangler']!.effects.find((e) => e.on === 'endOfTurn')!;
    const casts = MULTS.map(([copies]) => eotTickCount(spend(run(copies), 20), eff));
    expect(casts).toEqual([3, 5, 7]);
  });

  it('Baby Gastrid: +2 Health for each Gold spent this turn reads the counted Gold', () => {
    const health = MULTS.map(([copies]) => {
      let s = spend(run(copies, { board: [body('dw', 'dw_brunni', { health: 1 })], hand: [body('g', 'dw_dorrin')] }), 5);
      s = reduce(s, { type: 'play', uid: 'g' });
      if (s.pendingTarget) s = reduce(s, { type: 'battlecryTarget', targetUid: 'dw' });
      return s.board.find((c) => c.uid === 'dw')!.health - 1;
    });
    expect(health).toEqual([10, 20, 30]);
  });

  it('Patch Job: +2/+2 for every 6 Gold spent this turn reads the counted Gold', () => {
    const gain = MULTS.map(([copies]) => {
      let s = spend(run(copies, { board: [plain('m', { attack: 2, health: 3 })], hand: [body('p', 'patchjob')] }), 12);
      s = reduce(s, { type: 'play', uid: 'p', targetUid: 'm' });
      return s.board.find((c) => c.uid === 'm')!.attack - 2;
    });
    // +1/+1 baseline, plus +2/+2 per 6 counted Gold: 12 / 24 / 36 counted.
    expect(gain).toEqual([1 + 2 * 2, 1 + 2 * 4, 1 + 2 * 6]);
  });

  it('Rune of Spending: End of Turn +2/+3 for each Gold spent this turn, and its badge prints the counted Gold', () => {
    for (const [copies, m] of MULTS) {
      const s = spend(run(copies, { questRecurringEndOfTurn: ['runeSpending'], board: [plain('a')] }), 4);
      const { fx } = projectEndOfTurnSteps(s);
      expect(fx[0]!.buffFx.filter((e) => e.targetUid === 'a'), `x${m}`).toHaveLength(4 * m);
      expect(runeTally(s, 'rune_spending')).toBe(`${4 * m}g`);
    }
  });

  it('Ancient Wanderer: +1/+1 for every 3 Gold spent this game reads the counted run total', () => {
    const gain = MULTS.map(([copies]) => {
      const s = spend(run(copies, { board: [body('aw', 'n2_wanderer')] }), 9);
      return s.board.find((c) => c.uid === 'aw')!.attack - CARD_INDEX['n2_wanderer']!.attack;
    });
    expect(gain).toEqual([3, 6, 9]);
  });

  it('Summit\'s lock ("locked until you spend 70 Gold") opens on the counted run total', () => {
    const locked = MULTS.map(([copies]) => {
      const s = spend(run(copies, { hand: [plain('t7', { lockedUntilGoldSpent: 70 })] }), 35);
      return handCardLocked(s, s.hand[0]!);
    });
    expect(locked).toEqual([true, false, false]);
  });

  it('Indy: "Recharges after you spend 75 Gold" counts the counted Gold', () => {
    const recharged = MULTS.map(([copies]) => {
      let s = run(copies, { board: [plain('a')] }, 'indy');
      s = reduce(s, { type: 'heroPower', uid: 'a' });
      expect(s.heroPowerSpent, 'the Gild spent its charge').toBe(true);
      s = spend(s, 38);
      return !s.heroPowerSpent;
    });
    expect(recharged).toEqual([false, true, true]);
  });

  it('a "Spend N Gold" quest objective counts the counted Gold', () => {
    const progress = MULTS.map(([copies]) => {
      const s = spend(run(copies, { activeQuests: [{ questId: 'q_merchants_mark', progress: 0, completed: false }] as RunState['activeQuests'] }), 15);
      return s.activeQuests![0]!.progress;
    });
    expect(progress).toEqual([15, 30, 45]);
  });

  it('a "spend N Gold" trigger meter (Spellslinging) still hears the counted Gold', () => {
    const ticks = MULTS.map(([copies]) => spend(run(copies, { spellDripPer: 1000, spellDripTick: 0 }), 7).spellDripTick);
    expect(ticks).toEqual([7, 14, 21]);
  });

  it('combat: the live combat side and the recorded snapshot carry the counted Gold (Baby Gastrid / Rope Wrangler mid-fight)', () => {
    for (const [copies, m] of MULTS) {
      const s = spend(run(copies, { board: [plain('a')] }), 6);
      expect(playerCombatSideState(s).goldSpentThisTurn, `x${m}: combat side`).toBe(6 * m);
      expect(snapshotBoard(s).goldSpentThisTurn, `x${m}: snapshot`).toBe(6 * m);
    }
  });

  const picked = (hero: string, id: AncientId, copies: number): RunState => {
    let s = enableAncients(run(copies, { board: [plain('a', { health: 50 })] }, hero));
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
    s = reduce(s, { type: 'pickAncient', id });
    expect(s.ancients!.picked).toBe(id);
    return { ...s, goldSpentThisTurn: 0, goldSpentExtraThisTurn: 0 };
  };

  it('Nadja x War: the Rally gives +2 Attack for each counted Gold, and the power text prints the counted Gold', () => {
    for (const [copies, m] of MULTS) {
      const s = spend(picked('nadja', 'war', copies), 3);
      expect(ancientCombatMods(s).ancientSocRally?.attack, `x${m}`).toBe(2 * 3 * m);
      expect(heroPowerText(s)).toContain(`(**${3 * m}** spent: **+${6 * m}** Attack.)`);
    }
  });

  it('Rayse x Fortune: summons gain +1 Attack for each counted Gold', () => {
    for (const [copies, m] of MULTS) {
      const s = spend(picked('rayse', 'fortune', copies), 4);
      expect(ancientCombatMods(s).ancientSummonGain?.attack, `x${m}`).toBe(4 * m);
    }
  });

  it('the per-turn count resets each turn; the run total keeps the extra', () => {
    let s = spend(run(1, { board: [plain('a')] }), 5);
    s = { ...s, goldSpentThisTurn: 0, goldSpentExtraThisTurn: 0 }; // the wave-advance reset (reducer, with the real tally)
    expect(countedGoldSpentThisTurn(s)).toBe(0);
    expect(countedGoldSpent(s)).toBe(10);
  });
});
