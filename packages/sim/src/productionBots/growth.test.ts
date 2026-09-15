import { afterEach, describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatResult } from '@game/core';
import { createRun, type BoardCard, type RunState } from '../state';
import { reduce } from '../reducer';
import { __unsafeStateForTests, applyCandidate, createPlanningRoot, liveHandleCount, probeFuture, release, releaseAll, visibleOf } from './transition';
import { toBotVisibleState } from './visibleState';
import { evaluate } from './evaluate';
import { recruitCandidates } from './legalActions';
import { activeGrowth, carryBackOf, CHANNEL_USES, rallyTrial, CREDIT_TURNS, GROWTH_HORIZON, growthKey, growthReference, growthStats, growthTermOf, massOf, probeGrowth, resetGrowthCache, withGrowth } from './growth';
import { GENERALIST_BUDGETS } from '../balance/generalistPilot';
import { createStrategistPilot } from '../balance/strategy/strategistPilot';
import { linePriorBreakdown } from '../balance/strategy/prior';
import { pickLineForRun } from '../balance/strategy/lines';

/**
 * B6 — ENGINE GROWTH: the term is measured by running the engine forward on a private clone, so the tests pin
 * (1) that it measures what it claims (an End-of-Turn engine yields more than a vanilla body of the same stats,
 * in the same imagined future), (2) that the probe is isolated (nothing it does reaches the root, the live run,
 * or the handle store) and player-legal (no state the pilot cannot see is read back), (3) determinism +
 * memoisation, (4) the evaluator wiring (zero outside a scope; the installer's weight inside), and (5) the Ruby
 * cast fix the diagnosis surfaced (a Ruby in hand is generated as a targeted cast and the reducer accepts it).
 */
afterEach(() => { releaseAll(); resetGrowthCache(); });

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}, seed = 4242, heroId = 'drakko'): RunState =>
  ({ ...createRun(seed, heroId, 'ascent', undefined, 'set2'), phase: 'recruit', spell: undefined, ...over } as RunState);

/** A `stray` (vanilla token) buffed to exactly `cardId`'s printed stats. */
const vanillaLike = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return body(uid, 'stray', { attack: d.attack, health: d.health });
};

const PANEL = 0x51ed;

describe('growth probe — measures engine yield by running the engine', () => {
  it('an End-of-Turn engine (Arnold: cast Beefy on this) yields more than a vanilla body of the same stats in the same imagined future', () => {
    const arnold = run({ wave: 8, tier: 4, embers: 8, maxEmbers: 8, board: [body('b0', 'dw_arnold'), body('b1', 'stray'), body('b2', 'stray')] });
    const vanilla = run({ wave: 8, tier: 4, embers: 8, maxEmbers: 8, board: [vanillaLike('b0', 'dw_arnold'), body('b1', 'stray'), body('b2', 'stray')] });
    const ra = createPlanningRoot(arnold);
    const rv = createPlanningRoot(vanilla);
    const pa = probeGrowth(visibleOf(ra), PANEL)!;
    const pv = probeGrowth(visibleOf(rv), PANEL)!;
    expect(pa).not.toBeNull();
    expect(pv).not.toBeNull();
    expect(massOf(visibleOf(ra))).toBe(massOf(visibleOf(rv)));
    // Same imagined shop, same script (the bought bodies are subtracted): the difference is Beefy's buff.
    expect(pa.delta, `arnold ${JSON.stringify(pa)} vs vanilla ${JSON.stringify(pv)}`).toBeGreaterThan(pv.delta);
    expect(pa.steps).toBeGreaterThanOrEqual(2); // at least End of Turn + the next turn
    release(ra); release(rv);
  });

  it('a bought body is not its own growth: the script subtracts the printed stats of what it buys', () => {
    const s = run({ wave: 6, tier: 3, embers: 8, maxEmbers: 8, board: [body('b0', 'stray')] });
    const root = createPlanningRoot(s);
    const p = probeGrowth(visibleOf(root), PANEL)!;
    expect(p.buys).toBeGreaterThan(0);
    expect(p.bought).toBeGreaterThan(0);
    expect(p.after - p.before - p.bought).toBe(p.delta);
    release(root);
  });

  it('a blocked state (an open Discover) is answered by the script, never thrown on; a state that cannot end its turn probes null', () => {
    const blocked = run({ wave: 7, tier: 3, embers: 7, maxEmbers: 7, board: [body('b0', 'dw_brunni')], discover: ['stray', 'dw_orin', 'k_kobe'] });
    const root = createPlanningRoot(blocked);
    expect(visibleOf(root).mandatoryDecision?.kind).toBe('discover');
    const p = probeGrowth(visibleOf(root), PANEL);
    expect(p).not.toBeNull();
    expect(p!.steps).toBeGreaterThanOrEqual(3); // the Discover answer + End of Turn + the next turn
    release(root);
    const fighting = createPlanningRoot({ ...run({ board: [body('b0', 'stray')] }), phase: 'combat' } as RunState);
    expect(probeGrowth(visibleOf(fighting), PANEL)).toBeNull();
    expect(growthTermOf(visibleOf(fighting), PANEL)).toBe(0);
    release(fighting);
  });

  it('is deterministic in (state, panel seed) and memoised on the composition', () => {
    const s = run({ wave: 7, tier: 3, embers: 7, maxEmbers: 7, board: [body('b0', 'dw_brunni'), body('b1', 'stray')] });
    const root = createPlanningRoot(s);
    const v = visibleOf(root);
    const a = probeGrowth(v, PANEL);
    const before = growthStats();
    const b = probeGrowth(v, PANEL);
    expect(b).toBe(a); // the cached object, not a re-run
    expect(growthStats().probes).toBe(before.probes);
    expect(growthStats().hits).toBe(before.hits + 1);
    // A second projection of the same composition (a fresh root over the same run) is a cache hit, no probe.
    const twin = createPlanningRoot(s);
    expect(growthKey(visibleOf(twin))).toBe(growthKey(v));
    const c = probeGrowth(visibleOf(twin), PANEL);
    expect(c).toEqual(a);
    expect(growthStats().probes).toBe(before.probes);
    // A frozen shop is NOT part of the composition: the probe always imagines a fresh shop (never the real offers).
    const frozen = applyCandidate(root, { type: 'freeze' });
    expect(growthKey(frozen.visible)).toBe(growthKey(v));
    // Board ORDER is part of the composition (adjacency engines read neighbours), as is what is on it.
    const moved = applyCandidate(root, { type: 'reposition', uid: 'b1', toIndex: 0 });
    expect(growthKey(moved.visible)).not.toBe(growthKey(v));
    const sold = applyCandidate(root, { type: 'sell', uid: 'b1' });
    expect(growthKey(sold.visible)).not.toBe(growthKey(v));
    release(twin); release(frozen.child); release(moved.child); release(sold.child); release(root);
    // The same state rebuilt from scratch probes to the same numbers.
    resetGrowthCache();
    const again = createPlanningRoot(run({ wave: 7, tier: 3, embers: 7, maxEmbers: 7, board: [body('b0', 'dw_brunni'), body('b1', 'stray')] }));
    expect(probeGrowth(visibleOf(again), PANEL)).toEqual(a);
    release(again);
  });
});

describe('growth probe — isolation and the information boundary', () => {
  it('leaves the root byte-identical, the live run untouched, and no handle behind', () => {
    const live = run({ wave: 6, tier: 3, embers: 6, maxEmbers: 6, board: [body('b0', 'dw_brunni'), body('b1', 'stray')] });
    const liveBefore = JSON.stringify({ ...live, lastCombat: undefined });
    const root = createPlanningRoot(live);
    const rootBefore = JSON.stringify(__unsafeStateForTests(root));
    const handles = liveHandleCount();
    const p = probeGrowth(visibleOf(root), PANEL);
    expect(p).not.toBeNull();
    expect(JSON.stringify(__unsafeStateForTests(root)), 'the probe mutated the root').toBe(rootBefore);
    expect(JSON.stringify({ ...live, lastCombat: undefined }), 'the probe mutated the live run').toBe(liveBefore);
    expect(liveHandleCount(), 'the probe leaked a handle').toBe(handles);
    // The root's wave is still the same wave — the probe's turn advance happened on its own clone only.
    expect(visibleOf(root).wave).toBe(6);
    expect(visibleOf(root).phase).toBe('recruit');
    release(root);
  });

  it('runs on a clone whose hidden future is REPLACED and whose table is gone (never the run’s real next shop or the lobby)', () => {
    const live = run({ wave: 5, tier: 2, embers: 5, maxEmbers: 5, board: [body('b0', 'stray')] });
    const root = createPlanningRoot(live);
    const raw = __unsafeStateForTests(root)!;
    // Inside the probe: no lobby, the served board for this wave pinned to NONE, and the RNG replaced.
    const seen = probeFuture(visibleOf(root), PANEL, (p) => {
      p.apply({ type: 'faceOmen', deferFight: true });
      return p.visible();
    })!;
    expect(seen.phase).toBe('combat');
    // The real run's own servedBoards / seed / cursor are as they were.
    expect(__unsafeStateForTests(root)!.seed).toBe(raw.seed);
    expect(__unsafeStateForTests(root)!.rngCursor).toBe(raw.rngCursor);
    // Two different panel seeds imagine two different futures for the same state: the projection's shop after the
    // probe's next turn differs (or the probe would be reading ONE future — the run's real one).
    const shopUnder = (seed: number): string => probeFuture(visibleOf(root), seed, (p) => {
      p.apply({ type: 'faceOmen', deferFight: true });
      p.apply({ type: 'resolveCombat', fight: { result: { result: 'draw', playerDamage: 0, enemyDamage: 0, playerDeaths: 0, enemyDeaths: 0, playerDeathrattles: 0, events: [], initial: { player: [], enemy: [] } } as unknown as CombatResult, damageTaken: 0 } });
      return p.visible().shop.map((o) => o.cardId).join(',');
    })!;
    const futures = new Set([shopUnder(1), shopUnder(2), shopUnder(3), shopUnder(4)]);
    expect(futures.size).toBeGreaterThan(1);
    release(root);
  });

  it('a projection this module did not produce has no state behind it — the probe returns null, never guesses', () => {
    const foreign = toBotVisibleState(run());
    expect(probeFuture(foreign, PANEL, () => 1)).toBeNull();
    expect(probeGrowth(foreign, PANEL)).toBeNull();
    expect(growthTermOf(foreign, PANEL)).toBe(0);
  });
});

describe('growth term — normalisation, horizon, and the combat carry-back', () => {
  it('credits one turn’s yield relative to the wave reference, decaying to the horizon', () => {
    const s = run({ wave: 8, tier: 4, embers: 8, maxEmbers: 8, board: [body('b0', 'dw_arnold'), body('b1', 'stray')] });
    const root = createPlanningRoot(s);
    const v = visibleOf(root);
    const p = probeGrowth(v, PANEL)!;
    const expected = Math.max(-0.5, Math.min(2.5, p.delta / growthReference(8))) * (Math.min(CREDIT_TURNS, GROWTH_HORIZON - 8) / CREDIT_TURNS);
    expect(growthTermOf(v, PANEL)).toBeCloseTo(expected, 9);
    // A carry-back adds straight into the per-turn yield.
    expect(growthTermOf(v, PANEL, 20)).toBeGreaterThan(growthTermOf(v, PANEL));
    release(root);
    // Near the horizon the same yield is worth a fraction.
    const late = createPlanningRoot(run({ wave: GROWTH_HORIZON - 1, tier: 6, embers: 10, maxEmbers: 10, board: [body('b0', 'dw_arnold'), body('b1', 'stray')] }));
    const lv = visibleOf(late);
    const lp = probeGrowth(lv, PANEL)!;
    if (lp.delta > 0) expect(growthTermOf(lv, PANEL)).toBeLessThan(lp.delta / growthReference(GROWTH_HORIZON - 1));
    release(late);
  });

  it('the Rally trial: a permanent-Rally engine leaves stats behind against the wall; a vanilla board leaves none', () => {
    const vanilla = createPlanningRoot(run({ wave: 9, tier: 4, board: ['stray', 'stray', 'stray'].map((id, i) => body(`b${i}`, id)) }));
    const paragon = createPlanningRoot(run({ wave: 9, tier: 4, board: ['n2_paragon', 'n2_standardbearer', 'stray'].map((id, i) => body(`b${i}`, id)) }));
    expect(rallyTrial(visibleOf(vanilla))).toBe(0);
    expect(rallyTrial(visibleOf(paragon))).toBeGreaterThan(0);
    // The probe carries it, and the term reads the larger of the trial and a realised carry-back — never both.
    const p = probeGrowth(visibleOf(paragon), PANEL)!;
    expect(p.trial).toBe(rallyTrial(visibleOf(paragon)));
    expect(growthTermOf(visibleOf(paragon), PANEL, p.trial)).toBeCloseTo(growthTermOf(visibleOf(paragon), PANEL, 0), 9);
    expect(growthTermOf(visibleOf(paragon), PANEL, p.trial + 40)).toBeGreaterThan(growthTermOf(visibleOf(paragon), PANEL, 0));
    release(vanilla); release(paragon);
  });

  it('carryBackOf reads the engine’s own permanent-gain fields; a fight that leaves nothing behind is 0', () => {
    const v = toBotVisibleState(run({ board: [body('b0', 'stray'), body('b1', 'stray')] }));
    const nothing = { result: 'win', playerDamage: 0, enemyDamage: 3, playerDeaths: 0, enemyDeaths: 2, playerDeathrattles: 0, events: [], initial: { player: [], enemy: [] } } as unknown as CombatResult;
    expect(carryBackOf(nothing, v)).toBe(0);
    const rich = {
      ...nothing,
      playerPermaBuffs: [{ sourceUid: 'b0', attack: 3, health: 3, engraved: true }],
      playerTavernBuyGain: { attack: 1, health: 1 },
      playerCardBuffs: [{ cardId: 'stray', attack: 1, health: 0 }],
      playerRubyGrants: 2,
    } as unknown as CombatResult;
    expect(carryBackOf(rich, v)).toBe(6 + 2 * CHANNEL_USES + 1 * 2 + 2 * 6);
  });
});

describe('growth term — the evaluator wiring', () => {
  it('is zero outside a scope and the installer’s weight inside; an engine outscores the vanilla body it ties on stats', () => {
    const arnold = run({ wave: 8, tier: 4, embers: 8, maxEmbers: 8, board: [body('b0', 'dw_arnold'), body('b1', 'stray'), body('b2', 'stray')] });
    const vanilla = run({ wave: 8, tier: 4, embers: 8, maxEmbers: 8, board: [vanillaLike('b0', 'dw_arnold'), body('b1', 'stray'), body('b2', 'stray')] });
    const ra = createPlanningRoot(arnold);
    const rv = createPlanningRoot(vanilla);
    expect(activeGrowth()).toBeNull();
    expect(evaluate(visibleOf(ra)).growth).toBe(0);
    const inside = withGrowth({ weight: 12, panelSeed: PANEL }, () => {
      expect(activeGrowth()).toEqual({ weight: 12, panelSeed: PANEL });
      return { a: evaluate(visibleOf(ra)), v: evaluate(visibleOf(rv)) };
    });
    expect(activeGrowth()).toBeNull();
    expect(inside.a.growth).toBeGreaterThan(inside.v.growth);
    expect(inside.a.total - inside.v.total).toBeCloseTo((inside.a.growth - inside.v.growth) * 12 + (inside.a.fightStrength - inside.v.fightStrength) * 26 + (inside.a.learnedStrength - inside.v.learnedStrength) * 12, 6);
    // Weight 0 installs nothing — no probe runs at all.
    resetGrowthCache();
    withGrowth({ weight: 0, panelSeed: PANEL }, () => { expect(activeGrowth()).toBeNull(); evaluate(visibleOf(ra)); });
    expect(growthStats().probes).toBe(0);
    release(ra); release(rv);
  });

  it('the strategist installs the scope per decision at its growthWeight and plays a legal turn (probes cached across the turn)', () => {
    const s = run({ wave: 6, tier: 3, embers: 8, maxEmbers: 8, board: [body('b0', 'dw_brunni'), body('b1', 'stray')] });
    resetGrowthCache();
    const pilot = createStrategistPilot(GENERALIST_BUDGETS.smoke, 7, { exploration: 0, growthWeight: 12 });
    let cur = s;
    for (let i = 0; i < 40; i++) {
      const a = pilot.decide(cur, { seatId: 'seat', round: cur.wave, scoutedOpponent: null });
      if (!a) break;
      const next = reduce(cur, a);
      expect(next, `refused ${JSON.stringify(a)}`).not.toBe(cur);
      cur = next;
    }
    expect(activeGrowth()).toBeNull(); // the scope never leaks past a decision
    const stats = growthStats();
    expect(stats.probes).toBeGreaterThan(0);
    expect(stats.hits).toBeGreaterThan(0);
    // growthWeight 0: no probe runs.
    resetGrowthCache();
    const off = createStrategistPilot(GENERALIST_BUDGETS.smoke, 7, { exploration: 0, growthWeight: 0 });
    off.decide(s, { seatId: 'seat', round: s.wave, scoutedOpponent: null });
    expect(growthStats().probes).toBe(0);
  });
});

describe('the Ruby cast fix (B6 diagnosis: hands of six Rubies held to elimination)', () => {
  it('a Ruby in hand is generated as a targeted cast, and the reducer accepts it', () => {
    const s = run({ wave: 5, tier: 2, embers: 5, maxEmbers: 5, board: [body('b0', 'stray'), body('b1', 'stray')], hand: [body('h0', 'ruby')] });
    const v = toBotVisibleState(s);
    const casts = recruitCandidates(v).filter((c) => c.action.type === 'play' && c.action.uid === 'h0');
    expect(casts.length).toBeGreaterThan(0);
    expect(casts.every((c) => c.action.type === 'play' && c.action.targetUid !== undefined), 'a Ruby needs a target').toBe(true);
    const onBoard = casts.find((c) => c.action.type === 'play' && c.action.targetUid === 'b0')!;
    const next = reduce(s, onBoard.action);
    expect(next).not.toBe(s);
    expect(next.hand.find((c) => c.uid === 'h0')).toBeUndefined();
    const target = next.board.find((c) => c.uid === 'b0')!;
    expect(target.attack + target.health).toBe(s.board[0]!.attack + s.board[0]!.health + 2);
  });

  it('two held Rubies (or spells) are not a pair — the prior no longer pays the pilot to hold them', () => {
    const s = run({ wave: 5, tier: 2, board: [body('b0', 'stray')], hand: [body('h0', 'ruby'), body('h1', 'ruby')] });
    const line = pickLineForRun(s.heroId, s.tribes, s.seed, 0, 'set2');
    const withRubies = linePriorBreakdown(toBotVisibleState(s), line);
    const cast = linePriorBreakdown(toBotVisibleState({ ...s, hand: [] }), line);
    expect(withRubies.pairs).toBe(0);
    expect(withRubies.pairs).toBe(cast.pairs);
    expect(evaluate(toBotVisibleState(s)).pairsHeld).toBe(0);
    // A real minion pair still counts.
    const pair = run({ wave: 5, tier: 2, board: [body('b0', 'dw_orin')], hand: [body('h0', 'dw_orin')] });
    expect(linePriorBreakdown(toBotVisibleState(pair), line).pairs).toBeGreaterThan(0);
  });
});
