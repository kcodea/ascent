import { describe, expect, it } from 'vitest';
import type { CombatEvent, CombatResult, MinionSnapshot } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { ACHIEVEMENT_HEROES, RUN_METRIC_KEYS, sanitizeRunMetrics } from '@game/progression';
import { createRun, type Action, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { BOTS } from './bots';
import { playableHeroes } from './heroes';
import { withAncientsLive } from './ancientsRelease';
import { emptyAchTally, finalAchMetrics, observeAchAction, observeAchCombat } from './achievementMetrics';
import { beginDerive, deriveRun, observeAction, progressionFactsOf } from './runDerive';

/**
 * ACHIEVEMENT RUN METRICS (achievements batch 1, 2026-09-28). Three layers, like the progression facts test:
 * the combat-log reads against a hand-built log, the shop hooks through the REAL reducer (a Ruby, an Ale, a
 * refresh, a freeze-then-buy), and whole bot runs proving the metrics are deterministic and that the live feed
 * and the replay feed agree (ONE implementation).
 */

const card = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false, ...over });
const snap = (uid: string, cardId: string, attack = 1, health = 1): MinionSnapshot =>
  ({ uid, cardId, name: cardId, tribe: 'neutral', attack, health, keywords: [] }) as MinionSnapshot;
const combat = (events: CombatEvent[], over: Partial<CombatResult> = {}): CombatResult => ({
  events, result: 'win', playerDamage: 0,
  initial: { player: [snap('p1', 'b2_oona', 5, 5), snap('p2', 'k_chipwick')], enemy: [snap('e1', 'stray', 30, 30), snap('e2', 'pup')] },
  ...over,
}) as unknown as CombatResult;
const set2Run = (over: Partial<RunState> = {}): RunState => ({ ...createRun(1, 'warden', 'ascent', undefined, 'set2'), phase: 'recruit', ...over });

describe('the combat-log reads', () => {
  it('summons (by tribe, Golem size, King Oona), Wards, Rubies, Dragonflame, Execute kills, Imps', () => {
    const t = emptyAchTally();
    const beast = { type: 'summon', side: 'player', index: 0, minion: snap('s1', 'b2_trexbaby', 30, 25) } as CombatEvent;
    const golem = { type: 'summon', side: 'player', index: 0, minion: snap('s2', 'gemheart-shard', 20, 21) } as CombatEvent;
    const enemySummon = { type: 'summon', side: 'enemy', index: 0, minion: snap('x1', 'stray') } as CombatEvent;
    const events: CombatEvent[] = [
      beast, golem, enemySummon,
      { type: 'shield', target: 'p1' }, { type: 'wardDowngrade', target: 's1' }, { type: 'shield', target: 'e1' },
      { type: 'buff', target: 'p2', attack: 1, health: 1, source: 'x', ruby: true },
      { type: 'buff', target: 'e1', attack: 1, health: 1, source: 'x', ruby: true },
      { type: 'buff', target: 'p1', attack: 26, health: 24, source: 'x', spellId: 'sp_dragonflame' },
      { type: 'poison', target: 'e1' }, { type: 'death', target: 'e1', side: 'enemy' },
      { type: 'poison', target: 'e2' }, // poisoned, never died: not a kill
    ];
    observeAchCombat(t, combat(events, { playerQuestEvents: [{ step: 1, kind: 'summonImp', tribes: [] }, { step: 2, kind: 'summonImp', tribes: [] }] }), 5);
    expect(t.m).toMatchObject({
      summonsCombatMax: 2, beastSummonsCombatMax: 1, oonaBeastSummonMax: 55, golemStatsCombatMax: 41, wardBlocksCombatMax: 2,
      rubiesLandedCombatMax: 1, dragonflameMax: 24, executeKillsCombatMax: 1, impSummonsCombatMax: 2,
    });
    expect(t.m.feedingFrenzy).toBeUndefined();
  });

  it('Echoes: a friendly body with an onDeath effect (Beast ones counted apart); a Rise first death is not one; the last combat overwrites', () => {
    const echoBeast = Object.values(CARD_INDEX).find((c) => c.tribe === 'beast' && !c.token && c.effects.some((x) => x.on === 'onDeath'))!.id;
    const plain = Object.values(CARD_INDEX).find((c) => c.tribe === 'beast' && c.effects.length === 0)!.id;
    const t = emptyAchTally();
    const initial = { player: [snap('p1', echoBeast), snap('p2', echoBeast), snap('p3', plain)], enemy: [snap('e1', 'stray')] };
    observeAchCombat(t, combat([
      { type: 'death', target: 'p1', side: 'player', rise: true }, { type: 'death', target: 'p1', side: 'player' },
      { type: 'death', target: 'p2', side: 'player' }, { type: 'death', target: 'p3', side: 'player' }, { type: 'death', target: 'e1', side: 'enemy' },
    ], { initial } as Partial<CombatResult>), 3);
    expect(t.m).toMatchObject({ echoesCombatMax: 2, beastEchoesCombatMax: 2, finalCombatEchoes: 2 });
    observeAchCombat(t, combat([], { initial } as Partial<CombatResult>), 4);
    expect(t.m.finalCombatEchoes).toBe(0);
    expect(t.m.echoesCombatMax).toBe(2);
  });

  it('the late-game counters: a clean win from round 10, an underdog win from round 8 (70% or less of the enemy stats)', () => {
    const t = emptyAchTally();
    observeAchCombat(t, combat([]), 9); // clean win, but before round 10; stats 12 vs 62 (underdog, round 9 >= 8)
    expect(t.m.cleanWinLate).toBeUndefined();
    expect(t.m.underdogWinLate).toBe(1);
    observeAchCombat(t, combat([{ type: 'death', target: 'p2', side: 'player' }]), 10);
    expect(t.m.cleanWinLate).toBeUndefined();
    observeAchCombat(t, combat([]), 10);
    expect(t.m.cleanWinLate).toBe(1);
    const lost = emptyAchTally();
    observeAchCombat(lost, combat([], { result: 'lose' }), 12);
    expect(lost.m.cleanWinLate).toBeUndefined();
    expect(lost.m.underdogWinLate).toBeUndefined();
    expect(lost.m.boardStatsCombatMax).toBe(12);
  });
});

describe('the shop hooks, through the real reducer', () => {
  const step = (t: ReturnType<typeof emptyAchTally>, s: RunState, a: Action): RunState => {
    const next = reduce(s, a);
    observeAchAction(t, s, a, next, 0);
    return next;
  };

  it('a special Ruby played on a Kobold counts a facet and a Ruby play; on a non-Kobold only the play', () => {
    const t = emptyAchTally();
    let s = set2Run({ board: [card('k', 'k_chipwick', { tribe: 'kobold' }), card('d', 'dw_orin', { tribe: 'dwarf' })], hand: [card('r1', 'warding-ruby'), card('r2', 'golden-ruby')] });
    s = step(t, s, { type: 'play', uid: 'r1', targetUid: 'k' });
    step(t, s, { type: 'play', uid: 'r2', targetUid: 'd' });
    expect(t.facets).toEqual(['warding-ruby']);
    expect(t.m.rubyFacetsOnKobolds).toBe(1);
    expect(t.m.rubyPlays).toBe(2);
    expect(t.m.rubyPlaysTurnMax).toBe(2);
    expect(t.m.playsTurnMax).toBe(2);
  });

  it('Ales: the per-turn count and the distinct kinds', () => {
    const t = emptyAchTally();
    let s = set2Run({ embers: 0, board: [card('u', 'stray', { tribe: 'beast' })], hand: [card('a1', 'wo_mine'), card('a2', 'wo_mine'), card('a3', 'wo_health')] });
    for (const uid of ['a1', 'a2', 'a3']) s = step(t, s, { type: 'play', uid });
    expect(t.m.alesTurnMax).toBe(3);
    expect(t.m.alesCast).toBe(3);
    expect(t.aleKinds.sort()).toEqual(['wo_health', 'wo_mine']);
  });

  it('refreshes per turn; a buy from the Shop frozen last turn counts, a fresh offer does not', () => {
    const t = emptyAchTally();
    let s = set2Run({ embers: 50 });
    s = step(t, s, { type: 'roll' });
    s = step(t, s, { type: 'roll' });
    expect(t.m.refreshesTurnMax).toBe(2);
    s = step(t, s, { type: 'freeze' });
    expect(t.frozenUids.length).toBeGreaterThan(0);
    // next turn: the frozen offers are still there
    const frozenUid = t.frozenUids[0]!;
    const nextTurn: RunState = { ...s, wave: s.wave + 1, embers: 50, frozen: false };
    observeAchAction(t, s, { type: 'settleCombat' } as Action, nextTurn, 0);
    expect(t.rollsThisTurn).toBe(0);
    observeAchAction(t, nextTurn, { type: 'buy', uid: frozenUid }, { ...nextTurn, embers: 47 }, 1);
    observeAchAction(t, nextTurn, { type: 'buy', uid: 'not-frozen' }, { ...nextTurn, embers: 44 }, 2);
    expect(t.m.frozenBuysTurnMax).toBe(1);
    expect(t.m.buysTurnMax).toBe(2);
  });

  it('the per-turn RunState tallies are read as running maxima (the best turn), with the board conditions', () => {
    const t = emptyAchTally();
    const board = [card('d1', 'dw_orin', { tribe: 'dwarf' }), card('d2', 'dw_ironlung', { tribe: 'dwarf' }), card('k', 'k_chipwick', { tribe: 'kobold' })];
    const before = set2Run({ board });
    const hot = { ...before, goldSpentThisTurn: 26, rubyCastsThisTurn: 8, spellsThisTurn: 9, shoutFiresThisTurn: 4 };
    observeAchAction(t, before, { type: 'roll' }, hot, 0);
    observeAchAction(t, hot, { type: 'settleCombat' } as Action, { ...before, wave: before.wave + 1 }, 0);
    expect(t.m).toMatchObject({ goldSpentTurnMax: 26, dwarfPayrollTurnMax: 26, mountainbond: 1, rubyPlaysTurnMax: 8, arcaneFacetsTurnMax: 17, shoutsTurnMax: 4 });
    expect(t.m.dragonShoutsTurnMax).toBeUndefined();
    expect(t.m.liquidCourage).toBeUndefined();
  });
});

describe('the final-state reads', () => {
  it('final board tribes (printed, Neutral and All-types excluded), tribe banners, rune pairs and payouts', () => {
    const t = emptyAchTally();
    t.m.echoesCombatMax = 3;
    const final = set2Run({
      board: [
        card('a', 'k_chipwick', { tribe: 'kobold' }), card('b', 'dw_orin', { tribe: 'dwarf' }), card('c', 'd2_embermouth', { tribe: 'dragon' }),
        card('d', 'dm_butcher', { tribe: 'demon', attack: 90, health: 70 }), card('e', 'stray', { tribe: 'beast' }),
      ],
      runeProcs: { rune_overtime: 6, rune_blart: 11, rune_spending: 5, rune_warding: 1 },
      ownedRunes: ['rune_menagerie_set2'],
    });
    const m = finalAchMetrics(t, final);
    expect(m).toMatchObject({
      echoesCombatMax: 3, finalTribes: 5, finalKobolds: 1, finalDemons: 1, finalDemonStatsMax: 160, runeTriggers: 23, runesFivePlus: 3,
      overtimeProcs: 6, blartProcs: 11, menagerieRuneFinalTribes: 5,
    });
    expect(m.tribalRunePair).toBeUndefined();
    // every value is a positive integer the server will accept as-is
    expect(sanitizeRunMetrics(m)).toEqual(m);
  });
});

describe('whole runs: deterministic, and the live feed equals the replay feed', () => {
  function play(seed: number): { live: ReturnType<typeof beginDerive>; final: RunState; actions: Action[] } {
    let s = createRun(seed, 'warden', 'ascent', undefined, 'set2');
    const live = beginDerive(s);
    const actions: Action[] = [];
    const bot = BOTS[0]!;
    for (let i = 0; i < 4000 && s.phase !== 'gameover' && s.phase !== 'victory'; i++) {
      const a = bot.act(s);
      const next = reduce(s, a);
      observeAction(live, s, a, next);
      if (next !== s) actions.push(a);
      else if (a.type === 'faceOmen') break;
      s = next;
    }
    return { live, final: s, actions };
  }

  it('the same seed yields the same metrics; the observer counted real play; every value passes the server check', () => {
    const a = play(21);
    const b = play(21);
    const fa = progressionFactsOf(a.live, a.final, { runId: 'r', mode: 'practice', patch: 'p' });
    const fb = progressionFactsOf(b.live, b.final, { runId: 'r', mode: 'practice', patch: 'p' });
    expect(fa.metrics).toEqual(fb.metrics);
    expect(fa.version).toBe(2);
    expect(fa.setId).toBe('set2');
    expect(fa.metrics.goldSpentTurnMax ?? 0).toBeGreaterThan(0);
    expect(fa.metrics.buysTurnMax ?? 0).toBeGreaterThan(0);
    expect(fa.metrics.boardStatsCombatMax ?? 0).toBeGreaterThan(0);
    expect(sanitizeRunMetrics(fa.metrics)).toEqual(fa.metrics);
    for (const k of Object.keys(fa.metrics)) expect(RUN_METRIC_KEYS).toContain(k);
  });

  it('observing live and deriving from the replay give identical metrics (ONE implementation)', () => {
    const { live, final, actions } = play(8);
    const replayState = beginDerive(createRun(8, 'warden', 'ascent', undefined, 'set2'));
    let s = createRun(8, 'warden', 'ascent', undefined, 'set2');
    for (const a of actions) { const next = reduce(s, a); observeAction(replayState, s, a, next); s = next; }
    expect(finalAchMetrics(replayState.ach!, s)).toEqual(finalAchMetrics(live.ach!, final));
    expect(replayState.ach).toEqual(live.ach);
    // and the tally survives the save file (JSON round-trip) unchanged
    expect(JSON.parse(JSON.stringify(live.ach))).toEqual(live.ach);
    expect(deriveRun).toBeTypeOf('function');
  });
});

describe('the hero templates stay in step with the roster', () => {
  // The roster WITHOUT the Ancients unpaired-hero archive (owner 2026-11-17): Runesmith and Guardian are withheld only
  // until their pairings are written, so their achievement templates (and every player's progress on them) stay.
  it('ACHIEVEMENT_HEROES (packages/progression) equals playableHeroes() with the Ancients gate off: ids, order and display names', () => {
    expect(ACHIEVEMENT_HEROES.map((h) => ({ ...h }))).toEqual(withAncientsLive(false, () => playableHeroes()).map((h) => ({ id: h.id, name: h.name })));
  });
});

describe('the 2026-10-03 combat and hero metrics (achievements 150)', () => {
  it('flawless wins, last-stand wins, enemy kills, the win streak and the unbeaten flag', () => {
    const t = emptyAchTally();
    const kill = (uid: string): CombatEvent => ({ type: 'death', target: uid, side: 'enemy' } as CombatEvent);
    const lastStand = { enemyDamageBreakdown: { oppTier: 3, survivorTiers: [2] } } as Partial<CombatResult>;
    observeAchCombat(t, combat([kill('e1'), kill('e2')], lastStand), 2); // flawless, 1 survivor
    observeAchCombat(t, combat([{ type: 'death', target: 'p2', side: 'player' } as CombatEvent, kill('e1')]), 3); // a win with a death
    observeAchCombat(t, combat([kill('e1'), { type: 'death', target: 'e2', side: 'enemy', rise: true } as CombatEvent]), 4); // a Rise is no kill
    expect(t.m).toMatchObject({ flawlessWins: 2, lastStandWins: 1, enemyKills: 4, enemyKillsCombatMax: 2, combatWinStreakMax: 3 });
    observeAchCombat(t, combat([], { result: 'draw' }), 5);
    observeAchCombat(t, combat([]), 6);
    expect(t.m.combatWinStreakMax).toBe(3); // a draw ends the run of wins
    expect(finalAchMetrics(t, set2Run()).undefeated).toBe(1); // 5 combats, none lost
    observeAchCombat(t, combat([], { result: 'lose' }), 7);
    expect(finalAchMetrics(t, set2Run()).undefeated).toBeUndefined();
    const short = emptyAchTally();
    for (let w = 1; w <= 4; w++) observeAchCombat(short, combat([]), w);
    expect(finalAchMetrics(short, set2Run()).undefeated).toBeUndefined(); // fewer than 5 combats
  });

  it('hero power uses count accepted actions only; Health at 5 or less (alive) sets the brink flag', () => {
    const t = emptyAchTally();
    const before = set2Run({ resolve: 30 });
    observeAchAction(t, before, { type: 'heroPower' }, before, 0); // refused: the reducer returned the same state
    observeAchAction(t, before, { type: 'heroPower' }, { ...before }, 0);
    observeAchAction(t, before, { type: 'heroPower' }, { ...before }, 0);
    expect(t.m.heroPowerUses).toBe(2);
    expect(t.m.brink).toBeUndefined();
    observeAchAction(t, before, { type: 'roll' }, { ...before, resolve: 5 }, 0);
    expect(t.m.brink).toBe(1);
    const dead = emptyAchTally();
    observeAchAction(dead, before, { type: 'roll' }, { ...before, resolve: 0 }, 0);
    expect(dead.m.brink).toBeUndefined();
  });

  it('knockouts and damage dealt come from the lobby encounters (a ghost stand-in never counts as a knockout)', () => {
    const seat = (id: string, alive: boolean, eliminatedRound?: number) => ({ id, alive, ...(eliminatedRound ? { eliminatedRound } : {}) });
    const lobby = {
      seats: [seat('s0', true), seat('s1', false, 5), seat('s2', false, 6), seat('s3', false, 6), seat('s4', true)],
      encounters: [
        { round: 5, a: 's0', b: 's1', fought: true, damageToA: 0, damageToB: 12 },   // knocked s1 out
        { round: 6, a: 's2', b: 's0', fought: true, damageToA: 7, damageToB: 3 },    // knocked s2 out (s0 is b)
        { round: 6, a: 's3', b: 's4', fought: true, damageToA: 9, damageToB: 0 },    // not ours
        { round: 7, a: 's0', b: 's1', fought: true, damageToA: 0, damageToB: 4, bye: 's0' }, // a ghost of s1: no knockout
        { round: 8, a: 's0', b: 's4', fought: false, damageToA: 0, damageToB: 0 },
      ],
    };
    const m = finalAchMetrics(emptyAchTally(), set2Run({ lobby } as unknown as Partial<RunState>));
    expect(m).toMatchObject({ knockouts: 2, heroDamageDealt: 23, heroDamageCombatMax: 12 });
  });
});

describe('the secret-title metrics (2026-11-20)', () => {
  const find = (pred: (c: (typeof CARD_INDEX)[string]) => boolean): string => Object.values(CARD_INDEX).find(pred)!.id;
  const minionOf = (tribe: string): string => find((c) => c.tribe === tribe && !c.tribe2 && !c.token && !c.spell && !c.ruby && !c.universalTribe);
  const spellId = find((c) => !!c.spell);
  const seat = (id: string, resolve: number, armor = 0, alive = true, eliminatedRound?: number) =>
    ({ id, resolve, armor, alive, ...(eliminatedRound ? { eliminatedRound } : {}) });
  const lobbyOf = (seats: ReturnType<typeof seat>[], encounters: unknown[] = []) =>
    ({ version: 1, seed: 1, round: 1, rules: { startingResolve: 30 }, seats, encounters }) as unknown as RunState['lobby'];

  it('tribe plays read every card the RunState recorded as played (minions only, by printed tribe)', () => {
    const t = emptyAchTally();
    const before = set2Run({ playedThisTurn: [minionOf('dwarf')] });
    const after = { ...before, playedThisTurn: [minionOf('dwarf'), minionOf('dwarf'), minionOf('dragon'), minionOf('kobold'), spellId] };
    observeAchAction(t, before, { type: 'play', uid: 'x' }, after, 0);
    expect(t.m).toMatchObject({ dwarfPlays: 1, dragonPlays: 1, koboldPlays: 1 });
    // a turn flip never counts the new turn's list as plays of this one
    observeAchAction(t, after, { type: 'settleCombat' } as Action, { ...after, wave: after.wave + 1, playedThisTurn: [minionOf('dwarf')] }, 0);
    expect(t.m.dwarfPlays).toBe(1);
  });

  it('refreshes over the game, discount buys, tiers, the Gold a turn opens with', () => {
    const t = emptyAchTally();
    const base = set2Run({ wave: 3, embers: 10 });
    observeAchAction(t, base, { type: 'roll' }, { ...base }, 0);
    expect(t.rollsTotal).toBe(1);
    const shop = [{ uid: 'cheap', cardId: minionOf('beast'), cost: 1 }, { uid: 'full', cardId: minionOf('beast') }] as RunState['shop'];
    const withShop = { ...base, shop };
    observeAchAction(t, withShop, { type: 'buy', uid: 'cheap' }, { ...withShop, embers: 9 }, 1);
    observeAchAction(t, withShop, { type: 'buy', uid: 'full' }, { ...withShop, embers: 7 }, 2);
    expect(t.m.discountBuys).toBe(1);
    observeAchAction(t, base, { type: 'upgrade' }, { ...base, wave: 6, tier: 6 }, 0);
    expect(t.m.tierSixByRound6).toBe(1);
    expect(t.tierSixWave).toBe(6);
    observeAchAction(t, base, { type: 'resolveCombat' } as Action, { ...base, wave: 4, phase: 'recruit', embers: 31 }, 0);
    expect(t.m.goldTurnStartMax).toBe(31);
    const late = emptyAchTally();
    observeAchAction(late, base, { type: 'upgrade' }, { ...base, wave: 13, tier: 6 }, 0);
    expect(late.m.tierSixByRound6).toBeUndefined();
    expect(finalAchMetrics(late, set2Run({ tier: 6 })).lateTierSix).toBe(1);
  });

  it('the end of a turn: the 0 Gold streak and the full hand from round 5', () => {
    const t = emptyAchTally();
    const hand = Array.from({ length: 10 }, (_, i) => card(`h${i}`, 'stray'));
    for (let w = 5; w <= 10; w++) {
      const before = set2Run({ wave: w, phase: 'recruit', hand });
      observeAchAction(t, before, { type: 'faceOmen' } as Action, { ...before, phase: 'combat', embers: 0 }, 0);
    }
    expect(t.m.zeroGoldStreakMax).toBe(6);
    expect(finalAchMetrics({ ...t, combatsFought: 10 }, set2Run()).fullHandFrom5).toBe(1);
    const before = set2Run({ wave: 11, phase: 'recruit', hand: hand.slice(1) });
    observeAchAction(t, before, { type: 'faceOmen' } as Action, { ...before, phase: 'combat', embers: 2 }, 0);
    expect(t.zeroGoldStreak).toBe(0);
    expect(finalAchMetrics(t, set2Run()).fullHandFrom5).toBeUndefined();
  });

  it('the board: 7 Spirits in distinct rounds, the biggest minion, the most-buffed one', () => {
    const t = emptyAchTally();
    const spirits = Array.from({ length: 7 }, (_, i) => card(`s${i}`, minionOf('spirit'), { tribe: 'spirit' }));
    const r = set2Run({ board: spirits, wave: 4 });
    observeAchAction(t, r, { type: 'roll' }, r, 0);
    observeAchAction(t, r, { type: 'roll' }, { ...r }, 0);
    expect(t.m.spiritFullRounds).toBe(1);
    observeAchAction(t, r, { type: 'roll' }, { ...r, wave: 5 }, 0);
    expect(t.m.spiritFullRounds).toBe(2);
    const big = card('big', 'stray', { attack: 250, health: 210, buffs: [{ source: 'A', attack: 1, health: 1, count: 60 }, { source: 'B', attack: 1, health: 1, count: 45 }] });
    observeAchAction(t, r, { type: 'roll' }, { ...r, board: [big] }, 0);
    expect(t.m.minionStatsMinMax).toBe(210);
    expect(t.m.buffsOnOneMax).toBe(105);
  });

  it('the lobby: the leader knocked out, knockouts in a row, exactly lethal, rounds on 1 Health, last after round 10', () => {
    const t = emptyAchTally();
    type Enc = { a: string; b: string; damageToA: number; damageToB: number };
    const settle = (round: number, before: ReturnType<typeof seat>[], after: ReturnType<typeof seat>[], enc: Enc): void => {
      const s0 = set2Run({ lobby: lobbyOf(before) });
      const s1 = set2Run({ lobby: lobbyOf(after, [{ round, fought: true, outcome: 'win', ...enc }]) });
      observeAchAction(t, s0, { type: 'resolveCombat' } as Action, s1, 0);
    };
    // round 9: s1 leads the table on 12 and you hit it for exactly 12
    settle(9, [seat('s0', 10), seat('s1', 12), seat('s2', 5)], [seat('s0', 1), seat('s1', 0, 0, false, 9), seat('s2', 5)], { a: 's0', b: 's1', damageToA: 0, damageToB: 12 });
    expect(t.m.leaderKnockout).toBe(1);
    expect(t.lastFightExact).toBe(true);
    expect(t.m.oneHealthRounds).toBe(1);
    // round 10: s2 is not the leader, you overkill it; you sit last on 1 Health
    settle(10, [seat('s0', 1), seat('s2', 5), seat('s3', 3)], [seat('s0', 1), seat('s2', 0, 0, false, 10), seat('s3', 3)], { a: 's2', b: 's0', damageToA: 9, damageToB: 0 });
    expect(t.m.knockoutStreakMax).toBe(2);
    expect(t.lastFightExact).toBe(false);
    expect(t.m.oneHealthRounds).toBe(2);
    expect(t.m.lastAtRound10).toBe(1);
    const m = finalAchMetrics(t, set2Run());
    expect(m.exactLethalFinish).toBeUndefined();
    expect(m.leaderKnockout).toBe(1);
  });

  it('the combat log: draws, Echo and Rally triggers, Imps, empty-board and 1-Health wins, the biggest hit, attacks lived through, Undead Rises', () => {
    const undead = minionOf('undead');
    const t = emptyAchTally();
    const initial = { player: [snap('p1', undead, 1, 1), snap('p2', 'stray', 1, 1), snap('p3', 'stray', 1, 1), snap('p4', 'stray', 1, 1)], enemy: [snap('e1', 'stray', 200, 200)] };
    observeAchCombat(t, combat([
      { type: 'attack', attacker: 'e1', defender: 'p2', swing: 1 }, { type: 'shield', target: 'p2' },
      { type: 'attack', attacker: 'e1', defender: 'p2', swing: 2 }, { type: 'dmg', target: 'p2', amount: 0, remainingHp: 1 },
      { type: 'attack', attacker: 'e1', defender: 'p1', swing: 3 }, { type: 'death', target: 'p1', side: 'player', rise: true },
      { type: 'reborn', target: 'p1', hp: 1, attack: 1, keywords: [] },
      { type: 'attack', attacker: 'p3', defender: 'e1', swing: 4 }, { type: 'dmg', target: 'e1', amount: 120, remainingHp: 80, source: 'p3' },
    ] as CombatEvent[], { initial, playerDeathrattles: 52, playerRallies: 31, playerQuestEvents: [{ step: 1, kind: 'summonImp', tribes: [] }] } as Partial<CombatResult>), 6);
    expect(t.m).toMatchObject({ echoTriggersCombatMax: 52, ralliesCombatMax: 31, impSummons: 1, hitDamageMax: 120, attacksSurvivedMax: 2, undeadRises: 1, glassCannonWin: 1 });
    expect(t.m.pacifistWin).toBeUndefined(); // p3 attacked
    observeAchCombat(t, combat([], { result: 'draw' }), 7);
    observeAchCombat(t, combat([{ type: 'summon', side: 'player', index: 0, minion: snap('s1', 'stray') }] as CombatEvent[], { initial: { player: [], enemy: [snap('e1', 'stray')] } } as Partial<CombatResult>), 8);
    expect(t.m).toMatchObject({ combatDraws: 1, emptyBoardWin: 1 });
  });

  it('a comeback from 1 against 7, a win with no friendly attack, and a last survivor on exactly 1 Health', () => {
    const t = emptyAchTally();
    const enemy = Array.from({ length: 7 }, (_, i) => snap(`e${i}`, 'stray', 1, 1));
    const deaths = enemy.map((m) => ({ type: 'death', target: m.uid, side: 'enemy' }) as CombatEvent);
    const lone = { enemyDamageBreakdown: { oppTier: 3, survivorTiers: [1] } };
    observeAchCombat(t, combat([
      { type: 'death', target: 'p2', side: 'player' }, { type: 'dmg', target: 'p1', amount: 4, remainingHp: 1, source: 'e0' }, ...deaths,
    ] as CombatEvent[], { initial: { player: [snap('p1', 'stray', 5, 5), snap('p2', 'stray', 1, 1)], enemy }, ...lone } as Partial<CombatResult>), 9);
    expect(t.m).toMatchObject({ comebackOneVsSeven: 1, pacifistWin: 1, lastStandOneHp: 1 });
    // a buff after the hit lifts it off 1 Health: no longer the feat
    const u = emptyAchTally();
    observeAchCombat(u, combat([
      { type: 'dmg', target: 'p1', amount: 4, remainingHp: 1, source: 'e0' }, { type: 'buff', target: 'p1', attack: 1, health: 2, source: 'x' }, ...deaths,
    ] as CombatEvent[], { initial: { player: [snap('p1', 'stray', 5, 5)], enemy }, ...lone } as Partial<CombatResult>), 9);
    expect(u.m.lastStandOneHp).toBeUndefined();
  });

  it('the final board and whole-game flags', () => {
    const beasts = Object.values(CARD_INDEX).filter((c) => c.tribe === 'beast' && !c.tribe2 && !c.token && !c.spell && !c.universalTribe).slice(0, 7).map((c, i) => card(`b${i}`, c.id, { tribe: 'beast' }));
    const t = { ...emptyAchTally(), combatsFought: 6, combatsWon: 6, rollsTotal: 0, maxTier: 3 };
    const lobby = lobbyOf([seat('s0', 30, 0), seat('s1', 0, 0, false, 5)]);
    const m = finalAchMetrics(t, set2Run({ board: beasts, tier: 3, lobby }));
    expect(m).toMatchObject({ finalBeastPack: 7, finalSameCardMax: 1, noRefreshGame: 1, lowTierGame: 1, perfectRecord: 1, fullHealthFinish: 1 });
    expect(m.finalTribesSpread).toBeUndefined(); // 7 Beasts is one tribe 7 times
    const copies = Array.from({ length: 7 }, (_, i) => card(`c${i}`, minionOf('beast'), { tribe: 'beast' }));
    const m2 = finalAchMetrics(emptyAchTally(), set2Run({ board: copies }));
    expect(m2.finalSameCardMax).toBe(7);
    expect(m2.finalBeastPack).toBe(1);
    const spread = ['kobold', 'kobold', 'dwarf', 'dwarf', 'dragon', 'beast', 'demon'].map((tr, i) => card(`x${i}`, minionOf(tr), { tribe: tr as BoardCard['tribe'] }));
    expect(finalAchMetrics(emptyAchTally(), set2Run({ board: spread })).finalTribesSpread).toBe(5);
    const hurt = finalAchMetrics({ ...t, rollsTotal: 3, combatsWon: 5 }, set2Run({ tier: 4, lobby: lobbyOf([seat('s0', 29, 5)]) }));
    expect([hurt.noRefreshGame, hurt.perfectRecord, hurt.fullHealthFinish, hurt.lowTierGame]).toEqual([undefined, undefined, undefined, undefined]);
    const t1 = Object.values(CARD_INDEX).filter((c) => c.tier === 1 && !c.token && !c.spell && !c.ruby).slice(0, 7).map((c, i) => card(`t${i}`, c.id));
    expect(finalAchMetrics(emptyAchTally(), set2Run({ board: t1 })).finalTierOneOnly).toBe(7);
    // every value is one the server accepts
    expect(sanitizeRunMetrics(m)).toEqual(m);
  });
});

describe('the secret-title tribe batch metrics (2026-11-20, "add 5 more titles per tribe")', () => {
  const pick = (tribe: string): string => Object.values(CARD_INDEX).find((c) => c.tribe === tribe && !c.tribe2 && !c.token && !c.spell && !c.ruby && !c.universalTribe)!.id;

  it('per tribe on the board: Gilded count and the strongest Attack; 7 Undead in distinct rounds; Kobebes; Dwarf payroll at 5; Celestial spells at 3', () => {
    const t = emptyAchTally();
    const dwarves = Array.from({ length: 5 }, (_, i) => card(`d${i}`, pick('dwarf'), { tribe: 'dwarf', golden: i < 4, attack: i === 0 ? 120 : 5 }));
    const r = set2Run({ board: dwarves, goldSpentThisTurn: 31 });
    observeAchAction(t, r, { type: 'roll' }, { ...r }, 0);
    expect(t.m).toMatchObject({ dwarfGildedMax: 4, dwarfHallSpendTurnMax: 31 });
    // 7 Undead at once: one count per ROUND, however many actions see it
    const undead = Array.from({ length: 7 }, (_, i) => card(`u${i}`, pick('undead'), { tribe: 'undead', attack: i === 0 ? 1_000 : 2 }));
    observeAchAction(t, r, { type: 'roll' }, { ...r, board: undead }, 0);
    observeAchAction(t, r, { type: 'roll' }, { ...r, board: undead }, 0);
    expect(t.m).toMatchObject({ undeadFullRounds: 1, undeadAttackMax: 1_000 });
    observeAchAction(t, r, { type: 'roll' }, { ...r, wave: r.wave + 1, board: undead }, 0);
    expect(t.m.undeadFullRounds).toBe(2);
    observeAchAction(t, r, { type: 'roll' }, { ...r, wave: r.wave + 2, board: undead.slice(1) }, 0);
    expect(t.m.undeadFullRounds).toBe(2);
    const kobs = Array.from({ length: 3 }, (_, i) => card(`k${i}`, 'k_kobabyboldies', { tribe: 'kobold' }));
    observeAchAction(t, r, { type: 'roll' }, { ...r, board: kobs }, 0);
    expect(t.m.kobebesMax).toBe(3);
    const cel = Array.from({ length: 3 }, (_, i) => card(`c${i}`, pick('celestial'), { tribe: 'celestial' }));
    observeAchAction(t, r, { type: 'roll' }, { ...r, board: cel, spellsThisTurn: 16 }, 0);
    expect(t.m.celestialSpellsTurnMax).toBe(16);
    // 4 Dwarves are not a payroll of 5
    const u = emptyAchTally();
    observeAchAction(u, r, { type: 'roll' }, { ...r, board: dwarves.slice(1), goldSpentThisTurn: 40 }, 0);
    expect(u.m.dwarfHallSpendTurnMax).toBeUndefined();
  });

  it('Spirit and Celestial plays, and Revelers sold', () => {
    const t = emptyAchTally();
    const before = set2Run({ playedThisTurn: [] });
    observeAchAction(t, before, { type: 'play', uid: 'x' }, { ...before, playedThisTurn: [pick('spirit'), pick('celestial'), pick('celestial')] }, 0);
    expect(t.m).toMatchObject({ spiritPlays: 1, celestialPlays: 2 });
    const rev = set2Run({ board: [card('r1', 'sp3_flamereveler', { tribe: 'spirit' }), card('x1', pick('beast'))] });
    observeAchAction(t, rev, { type: 'sell', uid: 'r1' }, { ...rev, board: [rev.board[1]!] }, 0);
    observeAchAction(t, rev, { type: 'sell', uid: 'x1' }, { ...rev, board: [rev.board[0]!] }, 0);
    expect(t.m.revelerSells).toBe(1);
  });

  it('the combat log: Gold banked, Demon damage, Undead Rises, Skeletons and summons from hand, per combat', () => {
    const demon = pick('demon');
    const undead = pick('undead');
    const t = emptyAchTally();
    const initial = { player: [snap('p1', demon, 50, 50), snap('p2', undead, 1, 1)], enemy: [snap('e1', 'stray', 500, 500)] };
    observeAchCombat(t, combat([
      { type: 'bonusGold', side: 'player', amount: 6 }, { type: 'bonusGold', side: 'enemy', amount: 9 }, { type: 'bonusGold', side: 'player', amount: 5 },
      { type: 'dmg', target: 'e1', amount: 200, remainingHp: 300, source: 'p1' }, { type: 'dmg', target: 'e1', amount: 120, remainingHp: 180, source: 'p1' },
      { type: 'death', target: 'p2', side: 'player', rise: true }, { type: 'reborn', target: 'p2', hp: 1, attack: 1, keywords: [] },
      { type: 'summon', side: 'player', index: 0, minion: snap('s1', 'u3_skeleton') }, { type: 'summon', side: 'player', index: 0, minion: snap('s2', 'u3_skeleton') },
      { type: 'summon', side: 'player', index: 0, minion: snap('h1', pick('spirit')), fromHandUid: 'hand1' },
      { type: 'summon', side: 'enemy', index: 0, minion: snap('x1', 'u3_skeleton') },
    ] as CombatEvent[], { initial } as Partial<CombatResult>), 7);
    expect(t.m).toMatchObject({ combatGoldMax: 11, demonDamageCombatMax: 320, undeadRisesCombatMax: 1, skeletonSummonsCombatMax: 2, handSummonsCombatMax: 1 });
    // per combat: a quieter fight does not lower the best
    observeAchCombat(t, combat([{ type: 'bonusGold', side: 'player', amount: 2 }] as CombatEvent[], { initial } as Partial<CombatResult>), 8);
    expect(t.m.combatGoldMax).toBe(11);
  });
});

describe('the secret titles v2 metrics (2026-11-20: Dwarven, Hocus Pocus, Yazzus Himself)', () => {
  const pick = (tribe: string): string => Object.values(CARD_INDEX).find((c) => c.tribe === tribe && !c.tribe2 && !c.token && !c.spell && !c.ruby && !c.universalTribe)!.id;

  it('Dwarf damage to enemy minions adds up across the game; other sources and the enemy side do not count', () => {
    const dwarf = pick('dwarf');
    const t = emptyAchTally();
    const initial = { player: [snap('p1', dwarf, 50, 50), snap('p2', pick('beast'), 9, 9)], enemy: [snap('e1', dwarf, 500, 500)] };
    const fight = combat([
      { type: 'dmg', target: 'e1', amount: 200, remainingHp: 300, source: 'p1' },
      { type: 'dmg', target: 'e1', amount: 40, remainingHp: 260, source: 'p2' },
      { type: 'dmg', target: 'p1', amount: 30, remainingHp: 20, source: 'e1' },
    ] as CombatEvent[], { initial } as Partial<CombatResult>);
    observeAchCombat(t, fight, 5);
    observeAchCombat(t, fight, 6);
    expect(t.m.dwarfDamage).toBe(400);
  });

  it('spell buffs: combat buffs carrying a spell on your minions, plus the Shop spell-buff records; an Ancient grant and a preview do not count', () => {
    const t = emptyAchTally();
    observeAchCombat(t, combat([
      { type: 'buff', target: 'p1', attack: 3, health: 3, source: 'x', spellId: 'sp_dragonflame' },
      { type: 'buff', target: 'p2', attack: 3, health: 3, source: 'x', spellId: 'sp_dragonflame' },
      { type: 'buff', target: 'e1', attack: 3, health: 3, source: 'x', spellId: 'sp_dragonflame' }, // the enemy's
      { type: 'buff', target: 'p1', attack: 2, health: 2, source: 'x' }, // not a spell
    ] as CombatEvent[]), 5);
    expect(t.m.spellBuffs).toBe(2);
    const r = set2Run();
    const fx = (over: object) => ({ targetUid: 'b1', attack: 2, health: 2, sourceCardId: '', sourceTribe: 'neutral', kind: 'spell', ...over });
    const after = { ...r, recruitBuffFx: [fx({}), fx({ targetUid: 'b2' }), fx({ kind: 'minion', spellId: 'sp_growth' }), fx({ kind: 'minion' }), fx({ fromHeroPower: true })] } as unknown as RunState;
    observeAchAction(t, { ...r, recruitBuffFx: [] }, { type: 'play', uid: 'x' }, after, 0);
    expect(t.m.spellBuffs).toBe(5);
    // a combat preview keeps the prior action's records (the same array): nothing new
    observeAchAction(t, after, { type: 'combatEscalationPreview', attack: 1, health: 1 } as unknown as Action, { ...after }, 0);
    expect(t.m.spellBuffs).toBe(5);
  });

  it('Front to Back: the lower of its two halves, the best ever reached', () => {
    const t = emptyAchTally();
    const r = set2Run();
    observeAchAction(t, r, { type: 'roll' }, { ...r, frontToBackBonus: 520, frontToBackBonusH: 480 }, 0);
    expect(t.m.frontToBackMin).toBe(480);
    observeAchAction(t, r, { type: 'roll' }, { ...r, frontToBackBonus: 0, frontToBackBonusH: 0 }, 0);
    expect(t.m.frontToBackMin).toBe(480);
  });
});

describe('the tribes and mechanics metrics (2026-11-20: "another 100 achievements ... across tribes and mechanics")', () => {
  const pick = (tribe: string): string => Object.values(CARD_INDEX).find((c) => c.tribe === tribe && !c.tribe2 && !c.token && !c.spell && !c.ruby && !c.universalTribe)!.id;

  it('Demon, Beast and Undead plays; the strongest Dwarf and Beast Attack; Spirits, Undead and Celestials on the final board', () => {
    const t = emptyAchTally();
    const before = set2Run({ playedThisTurn: [] });
    observeAchAction(t, before, { type: 'play', uid: 'x' }, { ...before, playedThisTurn: [pick('demon'), pick('beast'), pick('beast'), pick('undead')] }, 0);
    expect(t.m).toMatchObject({ demonPlays: 1, beastPlays: 2, undeadPlays: 1 });
    const board = [card('d1', pick('dwarf'), { tribe: 'dwarf', attack: 640 }), card('b1', pick('beast'), { tribe: 'beast', attack: 510 })];
    observeAchAction(t, before, { type: 'roll' }, { ...before, board }, 0);
    expect(t.m).toMatchObject({ dwarfAttackMax: 640, beastAttackMax: 510 });
    const final = set2Run({ board: [
      ...Array.from({ length: 3 }, (_, i) => card(`s${i}`, pick('spirit'), { tribe: 'spirit' })),
      ...Array.from({ length: 2 }, (_, i) => card(`u${i}`, pick('undead'), { tribe: 'undead' })),
      card('c1', pick('celestial'), { tribe: 'celestial' }),
    ] });
    expect(finalAchMetrics(emptyAchTally(), final)).toMatchObject({ finalSpirits: 3, finalUndead: 2, finalCelestials: 1 });
  });

  it('accepted actions only: refreshes, Discover and Choose One picks, freezes once per turn, End of Turn fires, Shouts and sells summed', () => {
    const t = emptyAchTally();
    const r = set2Run({ wave: 4 });
    observeAchAction(t, r, { type: 'roll' }, { ...r }, 0);
    observeAchAction(t, r, { type: 'roll' }, r, 0); // refused (the same state): not a refresh
    expect(t.m.refreshes).toBe(1);
    const disc = { ...r, discover: {} } as unknown as RunState;
    observeAchAction(t, disc, { type: 'discover', index: 0 }, { ...r }, 0);
    observeAchAction(t, r, { type: 'discover', index: 0 }, { ...r }, 0); // nothing on offer
    const co = { ...r, chooseOne: {} } as unknown as RunState;
    observeAchAction(t, co, { type: 'chooseOne', index: 1 }, { ...r }, 0);
    expect(t.m).toMatchObject({ discovers: 1, chooseOnes: 1 });
    observeAchAction(t, r, { type: 'freeze' }, { ...r, frozen: true }, 0);
    observeAchAction(t, { ...r, frozen: true }, { type: 'freeze' }, { ...r, frozen: false }, 0);
    observeAchAction(t, r, { type: 'freeze' }, { ...r, frozen: true }, 0); // the same turn again
    expect(t.m.freezes).toBe(1);
    const next = { ...r, wave: 5 };
    observeAchAction(t, next, { type: 'freeze' }, { ...next, frozen: true }, 0);
    expect(t.m.freezes).toBe(2);
    observeAchAction(t, r, { type: 'roll' }, { ...r, lastEotFires: 6, shoutFiresThisTurn: 4, soldThisTurn: ['a', 'b'] } as RunState, 0);
    const mid = { ...r, lastEotFires: 6, shoutFiresThisTurn: 4, soldThisTurn: ['a', 'b'] } as RunState;
    observeAchAction(t, mid, { type: 'sell', uid: 'c' }, { ...mid, lastEotFires: 0, shoutFiresThisTurn: 5, soldThisTurn: ['a', 'b', 'c'] } as RunState, 0);
    expect(t.m).toMatchObject({ eotFires: 6, shouts: 5, sells: 3 });
    // a combat preview spreads the prior state: nothing counts again
    observeAchAction(t, mid, { type: 'combatEscalationPreview', attack: 1, health: 1 } as unknown as Action, { ...mid }, 0);
    expect(t.m.eotFires).toBe(6);
  });

  it('the combat log: Echo and Rally triggers, Ward blocks, Execute kills, Beast and hand summons summed; Pummel payouts; kills before the first attack', () => {
    const t = emptyAchTally();
    const fight = combat([
      { type: 'pummelTrigger', source: 'p1', side: 'player', marker: 'm' }, { type: 'pummelTrigger', source: 'p1', side: 'player', marker: 'm' },
      { type: 'pummelTrigger', source: 'e1', side: 'enemy', marker: 'm' },
      { type: 'death', target: 'e2', side: 'enemy' }, // before any attack: a Start of Combat kill
      { type: 'summon', side: 'player', index: 0, minion: snap('h1', pick('beast')), fromHandUid: 'hand1' },
      { type: 'shield', target: 'p1' },
      { type: 'attack', attacker: 'p1', defender: 'e1' },
      { type: 'poison', target: 'e1' }, { type: 'death', target: 'e1', side: 'enemy' }, // after the first attack: not an opening kill
    ] as CombatEvent[], { playerDeathrattles: 7, playerRallies: 3 } as Partial<CombatResult>);
    observeAchCombat(t, fight, 6);
    observeAchCombat(t, fight, 7);
    expect(t.m).toMatchObject({
      echoTriggers: 14, rallies: 6, wardBlocks: 2, executeKills: 2, beastSummons: 2, handSummons: 2, pummels: 4, pummelsCombatMax: 2, openingKillsCombatMax: 1,
    });
  });
});
