import { describe, it, expect } from 'vitest';
import type { BoardMinion, CombatSideState, MinionSnapshot } from '@game/core';
import { combatSide } from '@game/core';
import { reduce, playerCombatSideState, playerBoardMinions, playerCombatConfig } from './reducer';
import { DEFAULT_BOT } from './bots/index';
import type { RunState } from './state';
import { createLobbyRun } from './lobby/runLobby';
import { computeCombatOdds } from './odds';
import {
  SHOP_VIEW_EXCLUDED_KEYS, combatFrameOf, expandFrames, oddsInputFromCombatFrame, projectShopView, roundMarks,
  type CombatFrame, type ReplayFrame, type ReplayV2, type ShopView,
} from './replayV2';
import midasFixture from './fixtures/replay-midas-2026-09-16.json';

/**
 * THE REPLAY VIEWER'S WIN % BACKFILL (owner report 2026-09-19).
 *
 * A recording made before the capture layer stamped `odds` gets its rail Win % re-estimated from the recorded
 * rosters. The first backfill fed both sides NEUTRAL run states, so a Beast build whose runes carried the fight
 * (Rune of Beastial Swarm, Rune of Warding) read ~0% on rounds it WON. The fix rebuilds the player's side from
 * the round's last shop frame with the SAME builder the real fight used. Three guards:
 *
 *  1. LIVE PARITY — on a real bot run, the rebuilt player half equals the run's own `oddsInput` (roster,
 *     ~45-scaler side state, config), so the probe over it reproduces the live number EXACTLY.
 *  2. THE FIXTURE — the scrubbed Midas recording from the report: every recorded win now reads well above the
 *     coin flip, every loss below it.
 *  3. THE CONTRACT — the player-side builders read none of the keys a `ShopView` strips, so the view can stand
 *     in for the run.
 */

function captureLobbyRun(seed: number, heroId: string, waves: number): { pairs: { pre: RunState; view: ShopView; combat: CombatFrame; real: NonNullable<RunState['lastCombat']> }[] } {
  let s = createLobbyRun(seed, heroId);
  const pairs: { pre: RunState; view: ShopView; combat: CombatFrame; real: NonNullable<RunState['lastCombat']> }[] = [];
  let guard = 0;
  while (pairs.length < waves && s.phase !== 'gameover' && s.phase !== 'victory' && guard++ < 4000) {
    const action = DEFAULT_BOT.act(s);
    const next = reduce(s, action);
    if (next === s) break;
    if (action.type === 'faceOmen' && next.lastCombat?.oddsInput) {
      // The round's LAST shop frame is the view of the state the End Turn click saw — `s`, before `faceOmen`.
      pairs.push({ pre: s, view: projectShopView(s), combat: combatFrameOf(s, next, 0), real: next.lastCombat });
    }
    s = next;
  }
  return { pairs };
}

const loadBearing = (m: BoardMinion) => ({
  cardId: m.cardId, attack: m.attack, health: m.health, keywords: [...(m.keywords ?? [])].sort(), golden: m.golden ?? false,
  align: m.align, buffs: m.buffs, grantedEffects: m.grantedEffects, bloodlust: m.bloodlust, universalTribe: m.universalTribe,
});

describe('oddsInputFromCombatFrame — live parity with the run\'s own oddsInput', () => {
  const runs = [[11, 'drakko'], [23, 'midas'], [5, 'grim']] as const;
  let exact = 0, total = 0;
  for (const [seed, hero] of runs) {
    it(`seed ${seed} / ${hero}: the rebuilt player half reproduces the live probe, round by round`, () => {
      const { pairs } = captureLobbyRun(seed, hero, 6);
      expect(pairs.length).toBeGreaterThanOrEqual(4);
      for (const { pre, view, combat, real } of pairs) {
        total += 1;
        const rebuilt = oddsInputFromCombatFrame(combat, view);
        const live = real.oddsInput!;
        // Roster: what entered the fight (End of Turn included, live auras backed out), per-instance carries intact.
        expect(rebuilt.player.map(loadBearing)).toEqual(live.player.map(loadBearing));
        expect(rebuilt.config).toEqual(live.config);
        // Enemy roster stats are the recorded `initial` (post Marked Target) — identical to what the fight used.
        expect(rebuilt.enemy.map((m) => [m.cardId, m.attack, m.health, m.golden ?? false])).toEqual(live.enemy.map((m) => [m.cardId, m.attack, m.health, m.golden ?? false]));
        // Side state: every scaler the reducer threads, verbatim off the shop frame. The frame is the state
        // BEFORE End of Turn fired, so the one thing the recording cannot know is what End of Turn itself
        // changed on the run (an End-of-Turn spell cast bumps `spellsThisTurn` / conjures a hand minion).
        expect(rebuilt.playerState).toEqual(playerCombatSideState(pre));
        const stateMatches = JSON.stringify(rebuilt.playerState) === JSON.stringify(live.playerState);
        if (stateMatches) {
          exact += 1;
          // …and then the probe over the rebuilt player half + the fight's real enemy half IS the live number.
          const a = computeCombatOdds({ ...rebuilt, enemy: live.enemy, enemyState: live.enemyState }, seed, combat.wave);
          const b = computeCombatOdds(live, seed, combat.wave);
          expect(a).toEqual(b);
        }
      }
    });
  }
  it('most rounds rebuild the side state EXACTLY (End of Turn touched no run-level scaler)', () => {
    expect(total).toBeGreaterThanOrEqual(12);
    expect(exact / total).toBeGreaterThanOrEqual(0.6);
  });
});

describe('oddsInputFromCombatFrame — the Midas recording from the 2026-09-19 report', () => {
  const rep = midasFixture as unknown as ReplayV2;
  const frames = expandFrames(rep.frames as ReplayFrame[]);
  const marks = roundMarks(frames);
  const rows = marks.flatMap((m) => {
    const combat = frames[m.combatIndex!];
    const shop = frames[m.lastShopIndex!];
    if (combat?.kind !== 'combat' || shop?.kind !== 'shop' || !m.result) return [];
    const win = Math.round(computeCombatOdds(oddsInputFromCombatFrame(combat, shop.view), rep.seed, m.wave).win * 100);
    return [{ wave: m.wave, result: m.result, win }];
  });

  it('covers the recorded 14 rounds (11 wins, 3 losses)', () => {
    expect(rows.map((r) => r.result)).toEqual(['win', 'win', 'win', 'loss', 'loss', 'loss', 'win', 'win', 'win', 'win', 'win', 'win', 'win', 'win']);
  });

  it('every recorded win reads well above the coin flip — never ~0%', () => {
    for (const r of rows.filter((r) => r.result === 'win')) expect(r.win, `R${r.wave}`).toBeGreaterThanOrEqual(90);
  });

  it('every recorded loss reads below the coin flip', () => {
    for (const r of rows.filter((r) => r.result === 'loss')) expect(r.win, `R${r.wave}`).toBeLessThan(50);
  });

  it('the rounds the report named (R9, R12, R13, R14 wins that read ~0%) are fixed by the player\'s runes', () => {
    const view = (frames.find((f) => f.kind === 'shop' && f.wave === 12) as Extract<ReplayFrame, { kind: 'shop' }>).view;
    expect(view.questFlags?.runeBeastialSwarm).toBe(true);
    expect(view.questFlags?.runeWarding).toBe(true);
    const combat = frames.find((f) => f.kind === 'combat' && f.wave === 12) as CombatFrame;
    const state = oddsInputFromCombatFrame(combat, view).playerState;
    expect(state.questMods.runeBeastialSwarm).toBe(true);
    expect(state.questMods.runeWarding).toBe(true);
    // The NEUTRAL matchup the old backfill fed (rosters alone, both sides at the recorded tier) — the report's ~0%.
    const bare = (m: MinionSnapshot): BoardMinion => ({ cardId: m.cardId, attack: m.attack, health: m.health, keywords: [...m.keywords], golden: m.golden });
    const neutral = { player: combat.initial.player.map(bare), enemy: combat.initial.enemy.map(bare), playerState: combatSide({ tier: view.tier }), enemyState: combatSide({ tier: view.tier }), config: {} };
    expect(Math.round(computeCombatOdds(neutral, rep.seed, 12).win * 100)).toBeLessThanOrEqual(5);
    for (const w of [9, 12, 13, 14]) expect(rows.find((r) => r.wave === w)!.win).toBeGreaterThanOrEqual(90);
  });
});

describe('oddsInputFromCombatFrame — what the rebuilt input carries', () => {
  const snap = (cardId: string, attack: number, health: number, extra: Partial<MinionSnapshot> = {}): MinionSnapshot =>
    ({ uid: 'x', cardId, name: cardId, tribe: 'neutral', attack, health, keywords: [], ...extra });
  const baseView = (over: Partial<RunState>): ShopView => {
    const run = createLobbyRun(3, 'drakko');
    return projectShopView({ ...run, ...over });
  };
  const frame = (player: MinionSnapshot[], enemy: MinionSnapshot[], extra: Partial<CombatFrame> = {}): Pick<CombatFrame, 'initial' | 'enemyScalers' | 'opponent'> =>
    ({ initial: { player, enemy }, opponent: { author: 'Seat 2', heroId: 'grim' }, ...extra });

  it('stats, keywords and gilding come from `initial` (post-End-of-Turn), the per-instance carries from the board', () => {
    const view = baseView({
      tier: 4,
      board: [{ uid: 'b1', cardId: 'gnash', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false, buffs: [{ source: 'Test', attack: 2, health: 2, count: 1 }], bloodlust: true }],
    });
    const f = frame([snap('gnash', 9, 9, { keywords: ['T'], golden: true })], [snap('alley', 2, 4)]);
    const input = oddsInputFromCombatFrame(f, view);
    expect(input.player).toHaveLength(1);
    expect(input.player[0]).toMatchObject({ cardId: 'gnash', attack: 9, health: 9, keywords: ['T'], golden: true, bloodlust: true, buffs: [{ source: 'Test', attack: 2, health: 2, count: 1 }] });
    expect(input.playerState.tier).toBe(4);
    expect(input.enemy).toEqual([{ cardId: 'alley', attack: 2, health: 4, keywords: [], golden: false }]);
  });

  it('a body with no board match (an appended token) is built from the snapshot alone; matching is by position then id', () => {
    const view = baseView({
      board: [
        { uid: 'b1', cardId: 'gnash', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false, summonBonus: 3 },
        { uid: 'b2', cardId: 'alley', tribe: 'beast', attack: 2, health: 4, keywords: [], golden: false, summonBonus: 5 },
      ],
    });
    // End of Turn reordered nothing, but a token was summoned between them.
    const f = frame([snap('gnash', 6, 6), snap('impscrap', 1, 1), snap('alley', 2, 4)], []);
    const input = oddsInputFromCombatFrame(f, view);
    expect(input.player.map((m) => [m.cardId, m.summonBonus])).toEqual([['gnash', 3], ['impscrap', undefined], ['alley', 5]]);
  });

  it('the run\'s scalers reach the side state: spell power, Undead aura, Ruby strength, quest mods, hand spells', () => {
    const view = baseView({
      spellBonus: { attack: 2, health: 3 },
      undeadAttackBonus: 4, undeadHealthBonus: 2,
      rubyBonus: { attack: 5, health: 6 },
      questFlags: { runeWarding: true, runeFury: true },
      hand: [{ uid: 'h1', cardId: 'growth', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false }],
    });
    const st = oddsInputFromCombatFrame(frame([snap('gnash', 6, 6)], []), view).playerState;
    expect(st.spellPowerAtk).toBe(2);
    expect(st.spellPowerHp).toBe(3);
    expect(st.undeadAtk).toBe(4);
    expect(st.undeadHp).toBe(2);
    expect(st.rubyBonus).toEqual({ attack: 5, health: 6 });
    expect(st.questMods.runeWarding).toBe(true);
    expect(st.questMods.runeFury).toBe(true);
    expect(st.handSpellIds).toEqual(['growth']);
    expect(st.poolIds?.length ?? 0).toBeGreaterThan(0);
  });

  it('backs the live auras out of `initial` (the probe re-applies them): Undead Lantern + Imp aura', () => {
    const view = baseView({
      undeadAttackBonus: 4, undeadHealthBonus: 2, impBuff: { attack: 3, health: 1 },
      board: [
        { uid: 'b1', cardId: 'lazarus', tribe: 'undead', attack: 5, health: 4, keywords: [], golden: false },
        { uid: 'b2', cardId: 'impscrap', tribe: 'demon', attack: 1, health: 1, keywords: [], golden: false },
      ],
    });
    // `initial` holds what simulate applied: Undead +4/+2, Imp +3/+1.
    const f = frame([snap('lazarus', 9, 6), snap('impscrap', 4, 2)], []);
    const input = oddsInputFromCombatFrame(f, view);
    expect(input.player.map((m) => [m.cardId, m.attack, m.health])).toEqual([['lazarus', 5, 4], ['impscrap', 1, 1]]);
  });

  it('puts a banked Fleeting Vigor back (enterCombat rewinds it out of `initial`), doubled under Rune of Twilight', () => {
    const board: RunState['board'] = [{ uid: 'b1', cardId: 'gnash', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false }];
    const plain = oddsInputFromCombatFrame(frame([snap('gnash', 6, 6)], []), baseView({ board, fleetingVigor: { attack: 2, health: 3 } }));
    expect(plain.player[0]).toMatchObject({ attack: 8, health: 9 });
    const twilight = oddsInputFromCombatFrame(frame([snap('gnash', 6, 6)], []), baseView({ board, fleetingVigor: { attack: 2, health: 3 }, questFlags: { runeTwilight: true } }));
    expect(twilight.player[0]).toMatchObject({ attack: 10, health: 12 });
  });

  it('threads the frame\'s enemyScalers into the enemy side and tolerates an older recording\'s partial shape', () => {
    const view = baseView({ tier: 3 });
    const full = oddsInputFromCombatFrame(frame([snap('gnash', 6, 6)], [snap('alley', 2, 4)], {
      enemyScalers: {
        spellPower: { attack: 1, health: 2 }, spellsThisTurn: 1, beastsPlayed: 2, deathrattles: 3, conductorBuff: 0, spellsCast: 4, rubyCasts: 0,
        spiritsPlayed: 0, tribesPlayed: { beast: 2 }, revelerX: 0, impAura: { attack: 5, health: 6 }, fodderConsumed: { attack: 0, health: 0 },
        undeadBuyAtk: 0, cardBuffs: {}, alesLastTurn: 0, rememberedSpellIds: [], spellEscalation: { attack: 0, health: 0 }, growthBonus: 0,
        rubyBonus: { attack: 7, health: 8 },
      },
    }), view).enemyState;
    expect(full).toMatchObject({ spellPowerAtk: 1, spellPowerHp: 2, beastsPlayed: 2, deathrattles: 3, spellsCast: 4, impAtk: 5, impHp: 6, rubyBonus: { attack: 7, health: 8 } });
    expect(full.tier).toBe(3); // no paired seat in a synthetic lobby → the player's tier stands in
    // A 2026-08 recording: `enemyScalers` before `spellPower` / `rubyBonus` existed.
    const partial = oddsInputFromCombatFrame(frame([snap('gnash', 6, 6)], [snap('alley', 2, 4)], {
      enemyScalers: { spellsThisTurn: 2, beastsPlayed: 0, deathrattles: 0 } as unknown as CombatFrame['enemyScalers'],
    }), view).enemyState;
    expect(partial.spellsThisTurn).toBe(2);
    expect(partial.spellPowerAtk).toBe(0);
    expect(partial.rubyBonus).toEqual({ attack: 0, health: 0 });
    // No scalers at all (a procedural foe) → the neutral enemy side, still runnable.
    const none = oddsInputFromCombatFrame(frame([snap('gnash', 6, 6)], [snap('alley', 2, 4)]), view);
    expect(() => computeCombatOdds(none, 1, 3)).not.toThrow();
  });

  it('a round with no shop frame falls back to the neutral estimate at tier 1', () => {
    const input = oddsInputFromCombatFrame(frame([snap('gnash', 6, 6)], [snap('alley', 2, 4)]), null);
    expect(input.playerState.tier).toBe(1);
    expect(input.player).toEqual([{ cardId: 'gnash', attack: 6, health: 6, keywords: [], golden: false }]);
  });
});

describe('the player-side builders read none of the keys a ShopView strips', () => {
  it('playerBoardMinions / playerCombatSideState / playerCombatConfig never touch SHOP_VIEW_EXCLUDED_KEYS', () => {
    const run = createLobbyRun(9, 'midas');
    const excluded = new Set<string>(SHOP_VIEW_EXCLUDED_KEYS);
    const touched: string[] = [];
    const guarded = new Proxy(run, {
      get(target, key, receiver) {
        if (typeof key === 'string' && excluded.has(key)) touched.push(key);
        return Reflect.get(target, key, receiver);
      },
    });
    const state: CombatSideState = playerCombatSideState(guarded);
    playerBoardMinions(guarded.board);
    playerCombatConfig(guarded);
    expect(touched).toEqual([]);
    expect(state.tier).toBe(run.tier);
  });
});
