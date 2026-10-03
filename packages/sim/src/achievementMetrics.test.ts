import { describe, expect, it } from 'vitest';
import type { CombatEvent, CombatResult, MinionSnapshot } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { ACHIEVEMENT_HEROES, RUN_METRIC_KEYS, sanitizeRunMetrics } from '@game/progression';
import { createRun, type Action, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { BOTS } from './bots';
import { playableHeroes } from './heroes';
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
  it('ACHIEVEMENT_HEROES (packages/progression) equals playableHeroes(): ids, order and display names', () => {
    expect(ACHIEVEMENT_HEROES.map((h) => ({ ...h }))).toEqual(playableHeroes().map((h) => ({ id: h.id, name: h.name })));
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
