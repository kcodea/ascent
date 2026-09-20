import { describe, it, expect, afterEach } from 'vitest';
import { makeRng, simulate } from '@game/core';
import { CARD_INDEX, poolFor, type SetId } from '@game/content';
import { createRun, type Action, type BoardCard, type RunState } from '../state';
import { reduce } from '../reducer';
import { rebuildEquipment } from '../equipment';
import { DEFAULT_BOT } from '../bots/index';
import { releaseAll, liveHandleCount } from '../productionBots/transition';
import { toBotVisibleState } from '../productionBots/visibleState';
import { friendlyCombatSideOf } from '../productionBots/combatContext';
import { fightScore } from '../productionBots/fightScore';
import { evaluate } from '../productionBots/evaluate';
import { createGeneralistPilot, GENERALIST_BUDGETS, type GeneralistPilot } from './generalistPilot';
import type { PilotBudget } from './types';

/**
 * B3 — THE GENERALIST PILOT: competence scenarios + a held-out benchmark (docs/balance-bot-roadmap.md).
 *
 * Every scenario is a hand-built state where the right move is clear, and the pilot is driven through a
 * miniature seat runner that applies its actions through the REAL reducer and fails the moment one is refused
 * (a pilot that proposes an illegal action is a failed pilot, never a forced end turn — roadmap measurement
 * defect #2).
 */
afterEach(() => releaseAll());

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};

const run = (over: Partial<RunState> = {}, seed = 4242, heroId = 'drakko', setId: SetId = 'set3'): RunState =>
  ({ ...createRun(seed, heroId, 'ascent', undefined, setId), phase: 'recruit', ...over } as RunState);

interface Turn { run: RunState; actions: Action[]; ms: number[] }

/** Drive one recruit turn: decide → reduce until the pilot ends it. Throws on a refused action. */
function playTurn(start: RunState, pilot: GeneralistPilot, maxActions = 80): Turn {
  let s = start;
  const actions: Action[] = [];
  const ms: number[] = [];
  for (let i = 0; i < maxActions; i++) {
    const t0 = performance.now();
    const a = pilot.decide(s, { seatId: 'seat', round: s.wave, scoutedOpponent: null });
    ms.push(performance.now() - t0);
    if (!a) return { run: s, actions, ms };
    const n = reduce(s, a);
    if (n === s) throw new Error(`the pilot proposed an action the reducer refused: ${JSON.stringify(a)} (route ${pilot.lastTrace()?.route})`);
    s = n;
    actions.push(a);
  }
  throw new Error(`the pilot did not end its turn within ${maxActions} actions`);
}

const pilot = (budget: PilotBudget = GENERALIST_BUDGETS.smoke, seed = 7): GeneralistPilot => createGeneralistPilot(budget, seed);

describe('competence scenarios', () => {
  it('(a) 7 Gold, tier 1, empty board: buys and plays — never ends the turn holding Gold it could use', () => {
    const start = run({ embers: 7, tier: 1, board: [], hand: [] }, 11, 'drakko', 'set2');
    const { run: end, actions } = playTurn(start, pilot());
    expect(end.board.length, 'nothing was fielded').toBeGreaterThan(0);
    expect(actions.some((a) => a.type === 'buy')).toBe(true);
    expect(actions.some((a) => a.type === 'play')).toBe(true);
    const v = toBotVisibleState(end);
    const cheapest = Math.min(...v.shop.map((o) => o.cost), v.economy.upgradeCost);
    const room = v.board.length < 7 && v.hand.length < 10;
    expect(v.economy.gold < cheapest || !room, `ended with ${v.economy.gold} Gold, cheapest offer ${cheapest}, room ${room}`).toBe(true);
  });

  it('(b) a triple one buy away: takes it', () => {
    // Wave 2, not 1 (2026-09-19, the per-wave board model): every recorded wave-1 board is one or two bodies, so
    // the model rates a THIRD body at wave 1 as a top-decile board and the 2/1 beside the third copy ties the
    // triple line within half a point. From wave 2 on the question is unambiguous and the pilot takes it.
    const base = run({ embers: 3, wave: 2, board: [body('a', 'stray'), body('b', 'stray')], hand: [] }, 12, 'drakko', 'set1');
    const start: RunState = { ...base, shop: [{ uid: 'o1', cardId: 'stray' }, ...base.shop.slice(1)] };
    const { run: end, actions } = playTurn(start, pilot());
    expect(actions[0], 'the third copy was not the first thing bought').toEqual({ type: 'buy', uid: 'o1' });
    expect(end.board.some((c) => c.cardId === 'stray' && c.golden), 'the golden was not fielded').toBe(true);
  });

  it('(c) a targeted buff Shout with an obvious best target: targets it', () => {
    // Halfsies' +6/+6 branch onto a two-body board: a 1/1 Stray, and a Taunt body that soaks. The obvious target
    // is whichever the fight-grounded evaluator rates higher, and this pins that the pilot's aim IS that
    // argmax — a pilot that targeted by generation order would land on the first uid.
    const base = run({ embers: 0, board: [body('s', 'stray'), body('t', 'stray', { keywords: ['T'], attack: 3, health: 5 })], hand: [body('h', 'n3_splitboon')] });
    const start = { ...base, shop: [] };
    const { run: end, actions } = playTurn(start, pilot());
    const aim = actions.find((a) => a.type === 'battlecryTarget') as { targetUid: string } | undefined;
    expect(actions.find((a) => a.type === 'chooseOne')).toEqual({ type: 'chooseOne', index: 0 });
    expect(aim, 'the Shout was never aimed').toBeTruthy();
    // The best target by the evaluator, computed independently.
    const scoreOf = (uid: string): number => {
      let s = reduce(start, { type: 'play', uid: 'h', toIndex: 2 });
      s = reduce(s, { type: 'chooseOne', index: 0 });
      s = reduce(s, { type: 'battlecryTarget', targetUid: uid });
      return evaluate(toBotVisibleState(s)).total;
    };
    const best = ['s', 't'].sort((x, y) => scoreOf(y) - scoreOf(x))[0];
    expect(aim!.targetUid).toBe(best);
    expect(end.board.find((c) => c.uid === best)!.attack).toBeGreaterThanOrEqual(CARD_INDEX['stray']!.attack + 6);
  });

  it('(d) Equipment with a charge and the Gold: uses it when it improves the fight', () => {
    const s = run({ embers: 1, board: [body('f', 'e3_frank'), body('t', 'stray')], hand: [] });
    rebuildEquipment(s);
    const start = { ...s, shop: [] };
    const before = fightScore(toBotVisibleState(start), 5);
    const used = reduce(start, { type: 'activateEquipment', targetUid: 't' });
    const after = fightScore(toBotVisibleState(used), 5);
    expect(after.margin, 'the fixture is wrong: Bloodpot did not improve the fight').toBeGreaterThan(before.margin);
    const { run: end, actions } = playTurn(start, pilot());
    expect(actions.some((a) => a.type === 'activateEquipment'), 'the Equipment was never used').toBe(true);
    expect(toBotVisibleState(end).equipment[0]!.charges).toBe(0);
  });

  it('(e) a Choose One: picks the higher-evaluated branch', () => {
    // A lone body on the board: +6/+6 to it (branch 0) beats +3/+3 to its neighbours (branch 1), which on a
    // one-body board buffs only the one neighbour.
    const base = run({ embers: 0, board: [body('s', 'stray')], hand: [body('h', 'n3_splitboon')] });
    const start = { ...base, shop: [] };
    const branch = (index: number): number => {
      let s = reduce(start, { type: 'play', uid: 'h', toIndex: 1 });
      s = reduce(s, { type: 'chooseOne', index });
      if (s.pendingTarget) s = reduce(s, { type: 'battlecryTarget', targetUid: 's' });
      return evaluate(toBotVisibleState(s)).total;
    };
    const better = branch(0) >= branch(1) ? 0 : 1;
    const { actions } = playTurn(start, pilot());
    expect(actions.find((a) => a.type === 'chooseOne')).toEqual({ type: 'chooseOne', index: better });
  });

  it('(f) positioning: puts a Taunt in front of a glass cannon when that wins the sampled fight', () => {
    const cannon = body('c', 'stray', { attack: 9, health: 1 });
    const wall = body('w', 'stray', { keywords: ['T'], attack: 2, health: 8 });
    const start = { ...run({ embers: 0, board: [cannon, wall], hand: [] }), shop: [] };
    const asIs = fightScore(toBotVisibleState(start), 5);
    const swapped = fightScore(toBotVisibleState({ ...start, board: [wall, cannon] }), 5);
    if (swapped.margin <= asIs.margin) return; // the panel does not reward the wall here — nothing to assert
    const { run: end, actions } = playTurn(start, pilot());
    expect(actions.some((a) => a.type === 'reposition')).toBe(true);
    expect(end.board.map((c) => c.uid)).toEqual(['w', 'c']);
  });

  it('answers every mandatory prompt and never proposes a refused action across a scripted turn with a forge', () => {
    const start = run({ embers: 10, runeforgeOffer: ['rune_warding', 'rune_structure', 'rune_slaying'], board: [body('a', 'stray')] }, 13);
    const { run: end, actions } = playTurn(start, pilot());
    expect(['buyRune', 'skipRuneforge', 'rerollRuneforge']).toContain(actions[0]!.type);
    expect(end.runeforgeOffer, 'the forge was left open').toBeFalsy();
  });

  it('is deterministic and never touches the run RNG or leaks a planning handle', () => {
    const start = run({ embers: 8 }, 21, 'drakko', 'set2');
    // Deciding alone — `reduce()` itself stamps its INPUT (the documented hazard), so the mutation check has to
    // wrap the pilot's call and nothing else.
    const before = JSON.stringify({ ...start, lastCombat: undefined });
    const p = pilot(GENERALIST_BUDGETS.smoke, 99);
    const first = p.decide(start, { seatId: 'seat', round: start.wave, scoutedOpponent: null });
    expect(JSON.stringify({ ...start, lastCombat: undefined }), 'the pilot mutated the live run').toBe(before);
    expect(first).toBeTruthy();
    const a = playTurn(structuredClone(start), pilot(GENERALIST_BUDGETS.smoke, 99));
    const b = playTurn(structuredClone(start), pilot(GENERALIST_BUDGETS.smoke, 99));
    expect(b.actions).toEqual(a.actions);
    expect(a.actions[0]).toEqual(first);
    expect(liveHandleCount()).toBe(0);
  });
});

// ───────────────────────────────────────────── held-out benchmark ─────────────────────────────────────────────

/** Advance a fresh run to `wave` with the legacy greedy policy — the shared scripted scenario. */
function advance(seed: number, setId: SetId, wave: number): RunState {
  let s = createRun(seed, 'drakko', 'ascent', undefined, setId);
  let guard = 0;
  while (s.wave < wave && s.phase !== 'gameover' && guard++ < 3000) {
    const n = reduce(s, DEFAULT_BOT.act(s));
    if (n === s) break;
    s = n;
  }
  return s;
}

/** The legacy greedy policy's version of the same turn, stopped just before it ends the turn. */
function greedyTurn(start: RunState): RunState {
  let s = start;
  for (let i = 0; i < 80; i++) {
    const a = DEFAULT_BOT.act(s);
    if (a.type === 'faceOmen') break;
    const n = reduce(s, a);
    if (n === s) break;
    s = n;
  }
  return s;
}

/** A direct fight between two end-of-turn boards, each prepared as the real fight would prepare it. */
function duel(a: RunState, b: RunState): 1 | 0 | -1 {
  const pa = friendlyCombatSideOf(a);
  const pb = friendlyCombatSideOf(b);
  const poolIds = poolFor(a.setId ?? 'set1').all.map((c) => c.id);
  const r = simulate(pa.bodies, pb.bodies, makeRng(a.seed * 31 + 7), CARD_INDEX, { ...pa.side, poolIds }, { ...pb.side, poolIds });
  return r.result === 'win' ? 1 : r.result === 'lose' ? -1 : 0;
}

interface Stat { mean: number; lo: number; hi: number; n: number }
function ci95(xs: number[]): Stat {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const half = 1.96 * sd / Math.sqrt(n);
  return { mean, lo: mean - half, hi: mean + half, n };
}
const tally = (xs: number[]): string => `W${xs.filter((x) => x === 1).length} L${xs.filter((x) => x === -1).length} T${xs.filter((x) => x === 0).length}`;
const fmt = (s: Stat): string => `${s.mean.toFixed(2)} [${s.lo.toFixed(2)}, ${s.hi.toFixed(2)}] n=${s.n}`;

describe('held-out benchmark — generalist vs the legacy greedy policy, dev vs smoke', () => {
  it('reports win/loss/tie of the end-of-turn boards in a direct fight (a PROXY for run strength), and dev does not regress smoke', () => {
    // PROXY, stated plainly: one turn from a shared greedy-built wave-6 state, then the two resulting boards
    // fight each other directly. It measures the quality of ONE turn's shopping, targeting and positioning under
    // a fair prep — not a run's placement, which needs the B1 lobby runner. Paired by seed; 20 seeds per set.
    const seeds = Array.from({ length: 20 }, (_, i) => 100 + i);
    const report: string[] = [];
    const latency: Record<string, number[]> = { smoke: [], dev: [] };
    const devVsSmokeAll: number[] = [];
    for (const setId of ['set2', 'set3'] as SetId[]) {
      const smokeVsGreedy: number[] = [];
      const devVsGreedy: number[] = [];
      const devVsSmoke: number[] = [];
      for (const seed of seeds) {
        const base = advance(seed, setId, 6);
        const g = greedyTurn(base);
        const sm = playTurn(base, pilot(GENERALIST_BUDGETS.smoke, seed));
        const dv = playTurn(base, pilot(GENERALIST_BUDGETS.dev, seed));
        latency.smoke!.push(...sm.ms);
        latency.dev!.push(...dv.ms);
        smokeVsGreedy.push(duel(sm.run, g));
        devVsGreedy.push(duel(dv.run, g));
        devVsSmoke.push(duel(dv.run, sm.run));
      }
      devVsSmokeAll.push(...devVsSmoke);
      report.push(`${setId}: smoke vs greedy ${tally(smokeVsGreedy)} mean ${fmt(ci95(smokeVsGreedy))}; dev vs greedy ${tally(devVsGreedy)} mean ${fmt(ci95(devVsGreedy))}; dev vs smoke ${tally(devVsSmoke)} mean ${fmt(ci95(devVsSmoke))}`);
      // The generalist must at least not LOSE to greedy on balance: its interval must not sit wholly below 0.
      expect(ci95(smokeVsGreedy).hi, `${setId}: the smoke generalist is significantly weaker than legacy greedy`).toBeGreaterThanOrEqual(0);
    }
    const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!;
    report.push(`decision latency: smoke mean ${avg(latency.smoke!).toFixed(1)} ms (p95 ${p95(latency.smoke!).toFixed(1)}), dev mean ${avg(latency.dev!).toFixed(1)} ms (p95 ${p95(latency.dev!).toFixed(1)})`);
    console.log(`[generalist benchmark]\n${report.join('\n')}`);
    // NO DEPTH REGRESSION (the old handoff measured deeper search playing WORSE). Over both sets, dev vs smoke
    // must not be significantly negative: the 95% interval of the paired margin must reach 0. If this fails, do
    // not widen the budget or the seeds to hide it — diagnose why depth hurts.
    const ds = ci95(devVsSmokeAll);
    expect(ds.hi, `DEPTH REGRESSION: dev scored ${fmt(ds)} against smoke — deeper search is playing worse`).toBeGreaterThanOrEqual(0);
  }, 300_000);

  it('the deep budget decides within a sane latency', () => {
    const base = advance(7, 'set3', 6);
    const { ms } = playTurn(base, pilot(GENERALIST_BUDGETS.deep, 7));
    const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
    console.log(`[generalist benchmark] deep mean ${mean.toFixed(1)} ms over ${ms.length} decisions (max ${Math.max(...ms).toFixed(1)})`);
    expect(mean).toBeLessThan(2000);
  }, 120_000);
});
