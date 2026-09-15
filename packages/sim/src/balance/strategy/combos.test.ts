import { afterEach, describe, expect, it } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, type Action, type BoardCard, type RunState } from '../../state';
import { reduce } from '../../reducer';
import { liveHandleCount, releaseAll } from '../../productionBots/transition';
import { toBotVisibleState } from '../../productionBots/visibleState';
import { resetGrowthCache } from '../../productionBots/growth';
import { GENERALIST_BUDGETS } from '../generalistPilot';
import { pilotFor } from '../pilots';
import { createStrategistPilot, type StrategistPilot } from './strategistPilot';
import { ENGINE_COMBOS, COMBO_INDEX, comboProgress, combosFor, completionChance, findChance, offerChance } from './combos';
import { packageById } from './packages';
import { OPERATORS } from './operators/operatorPilot';

/**
 * B11 — THE ENGINE-COMBO MACROS' CURRICULA. Hand-built states where the strong move is ASSEMBLING an engine over
 * turns — buy the feeder for the payoff already fielded, roll for the missing piece rather than buy a body, hold
 * the payoff's pair, feed the engine, pivot when the piece never shows — driven through the real reducer (a refused
 * action fails the pilot). Macros are ON through `macroWeight`; the same fixtures under weight 0 reproduce the
 * pre-B11 strategist (the registry's default).
 */
afterEach(() => { releaseAll(); resetGrowthCache(); });

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}, seed = 4242, heroId = 'drakko'): RunState =>
  ({ ...createRun(seed, heroId, 'ascent', undefined, 'set2'), phase: 'recruit', spell: undefined, ...over } as RunState);
const offer = (uid: string, cardId: string): RunState['shop'][number] => ({ uid, cardId });
/** A vanilla body (the Stray token) offered at exactly `cardId`'s printed stats. */
const vanillaLike = (uid: string, cardId: string): RunState['shop'][number] => {
  const d = CARD_INDEX[cardId]!;
  const stray = CARD_INDEX['stray']!;
  return { uid, cardId: 'stray', atk: d.attack - stray.attack, hp: d.health - stray.health };
};

interface Turn { run: RunState; actions: Action[]; routes: string[] }
function playTurn(start: RunState, pilot: StrategistPilot, maxActions = 80): Turn {
  let s = start;
  const actions: Action[] = [];
  const routes: string[] = [];
  for (let i = 0; i < maxActions; i++) {
    const a = pilot.decide(s, { seatId: 'seat', round: s.wave, scoutedOpponent: null });
    routes.push(pilot.lastTrace()?.route ?? '?');
    if (!a) return { run: s, actions, routes };
    const n = reduce(s, a);
    if (n === s) throw new Error(`the pilot proposed an action the reducer refused: ${JSON.stringify(a)} (route ${pilot.lastTrace()?.route})`);
    s = n;
    actions.push(a);
  }
  throw new Error(`the pilot did not end its turn within ${maxActions} actions`);
}
const MACRO = { macroWeight: 20, macroFightWeight: 13, growthWeight: 20 };
const macroPilot = (extra: Partial<Parameters<typeof createStrategistPilot>[2]> = {}): StrategistPilot =>
  createStrategistPilot(GENERALIST_BUDGETS.smoke, 7, { exploration: 0, ...MACRO, ...extra });
const cardIds = (s: RunState): string[] => [...s.board, ...s.hand].map((c) => c.cardId);
const bought = (t: Turn): string[] => t.actions.filter((a): a is Extract<Action, { type: 'buy' }> => a.type === 'buy').map((a) => a.uid);

describe('combos — the roster is derived from the content', () => {
  it('every piece is in the set-2 pool and is an ENGINE or PAYOFF member (score ≥ 2) of one of the combo\'s packages', () => {
    const pool = new Set(poolFor('set2').buyable.map((d) => d.id));
    for (const combo of ENGINE_COMBOS) {
      for (const piece of combo.pieces) {
        for (const id of piece.ids) {
          const def = CARD_INDEX[id];
          expect(pool.has(id), `${combo.id}: ${id} is not in the set-2 pool`).toBe(true);
          // The package predicate (engine / payoff), or the line operator's own role table (want ≥ 2, the B7
          // finding: Gangplank is a Dwarf core the `ale` predicate scores 1).
          const score = Math.max(...combo.packages.map((p) => packageById(p).member(def!)));
          const want = combo.line === 'none' ? 0 : (OPERATORS[combo.line].roles[id]?.want ?? 0);
          expect(Math.max(score, want), `${combo.id}: ${id} scores ${score} in ${combo.packages.join('/')} and wants ${want} in the ${combo.line} operator`).toBeGreaterThanOrEqual(2);
        }
      }
      expect(combo.pieces.some((p) => p.role === 'payoff'), `${combo.id} has no payoff`).toBe(true);
      expect(combo.pieces.length).toBeGreaterThanOrEqual(2);
      expect(combo.pieces.length).toBeLessThanOrEqual(3);
    }
    expect(new Set(ENGINE_COMBOS.map((c) => c.id)).size).toBe(ENGINE_COMBOS.length);
  });

  it('combosFor filters by the run\'s tribes; the tribe-agnostic combos are always available', () => {
    const demonOnly = combosFor('set2', ['demon']);
    expect(demonOnly.some((c) => c.id === 'demon-blart-hank')).toBe(true);
    expect(demonOnly.some((c) => c.id === 'dwarf-brunni-gangplank')).toBe(false);
    expect(demonOnly.some((c) => c.id === 'rally-paragon')).toBe(true);
  });

  it('comboProgress reads held / fielded / on-offer / missing pieces (a golden counts as two copies; alternatives satisfy a piece)', () => {
    const s = run({ wave: 5, board: [body('b1', 'dm_gourmand'), body('b2', 'b2_echohorn')], hand: [body('h1', 'b2_bullseye', { golden: true })], shop: [offer('s1', 'dm_hank'), offer('s2', 'dm_hungerling')], embers: 3, tier: 3 });
    const v = toBotVisibleState(s);
    const demon = comboProgress(COMBO_INDEX['demon-blart-hank']!, v);
    expect(demon.heldPieces).toBe(1);
    expect(demon.payoffFielded).toBe(true);
    expect(demon.complete).toBe(false);
    expect(demon.missing).toEqual(['dm_hank', 'dm_hungerling']);
    // Both feeders are on offer; only one is affordable at 3 Gold — each piece lists its own affordable offers.
    expect(demon.pieces.find((p) => p.piece.ids[0] === 'dm_hank')!.offers.map((o) => o.cardId)).toEqual(['dm_hank']);
    const beast = comboProgress(COMBO_INDEX['beast-echohorn-echo']!, v);
    expect(beast.complete).toBe(true);
    expect(beast.pieces.find((p) => p.piece.role === 'feeder')!.held).toBe(2);
  });

  it('findChance is honest about the draw: rises with rolls and turns, is 0 two tiers up, and completionChance multiplies', () => {
    const p1 = offerChance('set2', ['demon', 'dwarf', 'dragon', 'beast', 'kobold'], 'dm_hank', 3);
    expect(p1).toBeGreaterThan(0.05);
    expect(p1).toBeLessThan(0.6);
    const one = findChance('set2', ['demon'], 'dm_hank', 3, { rollsPerTurn: 1, turns: 1 });
    const many = findChance('set2', ['demon'], 'dm_hank', 3, { rollsPerTurn: 3, turns: 3 });
    expect(many).toBeGreaterThan(one);
    expect(findChance('set2', ['demon'], 'dm_tormentor', 2, { rollsPerTurn: 3, turns: 3 })).toBe(0); // T4, shop at 2
    expect(findChance('set2', ['demon'], 'dm_tormentor', 3, { rollsPerTurn: 3, turns: 1 })).toBe(0); // one tier up needs a second turn
    expect(findChance('set2', ['demon'], 'dm_tormentor', 3, { rollsPerTurn: 3, turns: 2 })).toBeGreaterThan(0);
    const both = completionChance('set2', ['demon'], ['dm_hank', 'dm_hungerling'], 3, { rollsPerTurn: 3, turns: 3 });
    expect(both).toBeLessThan(many);
    expect(both).toBeGreaterThan(0);
  });
});

describe('the assemble macro — curricula through the real reducer', () => {
  it('(a) Blart fielded, Hank on offer beside a stat-identical vanilla: the macro BUYS THE FEEDER and fields it', () => {
    const s = run({ wave: 4, tier: 3, embers: 6, board: [body('b1', 'dm_gourmand'), body('b2', 'dm_knocked')], shop: [vanillaLike('s0', 'dm_hank'), offer('s1', 'dm_hank'), offer('s2', 'dm_leech')] }, 11, 'drakko');
    const t = playTurn(s, macroPilot());
    expect(bought(t)).toContain('s1');
    expect(cardIds(t.run)).toContain('dm_hank');
    expect(t.run.board.some((c) => c.cardId === 'dm_hank')).toBe(true);
    expect(t.routes.some((r) => r === 'assemble' || r === 'macroBuy')).toBe(true);
  });

  it('(b) one piece held at wave 4 with 6 Gold and no piece on offer: the committed macro REFRESHES rather than buying a body', () => {
    const s = run({ wave: 4, tier: 3, embers: 6, board: [body('b1', 'dm_gourmand')], shop: [vanillaLike('s0', 'dm_knocked'), vanillaLike('s1', 'dm_leech'), vanillaLike('s2', 'dm_hank')] }, 12, 'drakko');
    const pilot = macroPilot({ macroReserve: 4 });
    const t = playTurn(s, pilot);
    const rolls = t.actions.filter((a) => a.type === 'roll').length;
    expect(t.routes.filter((r) => r === 'macroRoll').length).toBeGreaterThanOrEqual(1);
    expect(rolls).toBeGreaterThanOrEqual(1);
    expect(pilot.commitmentOf()?.comboId).toMatch(/^demon-/);
    // The reserve is honoured: at most reserve / refresh cost macro rolls.
    expect(t.routes.filter((r) => r === 'macroRoll').length).toBeLessThanOrEqual(4);
  });

  it('(b′) the same fixture with macros OFF (the registry default) refreshes for no reason of the macro\'s — no macro route appears', () => {
    const s = run({ wave: 4, tier: 3, embers: 6, board: [body('b1', 'dm_gourmand')], shop: [vanillaLike('s0', 'dm_knocked'), vanillaLike('s1', 'dm_leech'), vanillaLike('s2', 'dm_hank')] }, 12, 'drakko');
    const pilot = pilotFor('strategist', { ...GENERALIST_BUDGETS.smoke, growthWeight: 20 }) as StrategistPilot;
    const t = playTurn(s, pilot);
    expect(t.routes.some((r) => r.startsWith('macro') || r === 'assemble')).toBe(false);
    expect(pilot.commitmentOf()).toBeUndefined();
  });

  it('(c) a second copy of the payoff on offer is taken (a pair toward the golden) and never sold by the replace macro', () => {
    const board = [body('b1', 'dm_gourmand'), body('b2', 'dm_hank'), body('b3', 'dm_knocked'), body('b4', 'dm_leech'), body('b5', 'impoverseer'), body('b6', 'dm_knocked'), body('b7', 'dm_leech')];
    const s = run({ wave: 6, tier: 3, embers: 6, board, shop: [offer('s1', 'dm_gourmand'), vanillaLike('s2', 'dm_butcher'), offer('s3', 'dm_leech')] }, 13, 'drakko');
    const t = playTurn(s, macroPilot());
    expect(bought(t)).toContain('s1');
    const blarts = [...t.run.board, ...t.run.hand].filter((c) => c.cardId === 'dm_gourmand').length;
    expect(blarts).toBe(2);
    expect(t.actions.some((a) => a.type === 'sell' && (a as { uid: string }).uid === 'b1')).toBe(false);
  });

  it('(d) the pivot: at the pivot wave an incomplete commitment is dropped and never re-committed', () => {
    const pilot = macroPilot({ macroPivotWave: 7 });
    const s4 = run({ wave: 4, tier: 3, embers: 6, board: [body('b1', 'dm_gourmand')], shop: [vanillaLike('s0', 'dm_knocked'), vanillaLike('s1', 'dm_leech'), vanillaLike('s2', 'dm_hank')] }, 14, 'drakko');
    playTurn(s4, pilot);
    expect(pilot.commitmentOf()?.comboId).toMatch(/^demon-/);
    const s7 = run({ wave: 7, tier: 4, embers: 9, board: [body('b1', 'dm_gourmand', { attack: 12, health: 14 })], shop: [vanillaLike('s0', 'dm_knocked'), vanillaLike('s1', 'dm_leech'), vanillaLike('s2', 'dm_hank'), vanillaLike('s3', 'dm_butcher')] }, 14, 'drakko');
    const t = playTurn(s7, pilot);
    expect(pilot.commitmentOf()).toBeUndefined();
    expect(t.routes.some((r) => r === 'macroRoll')).toBe(false);
  });

  it('(e) the engine is FED: a Dwarf combo fielded with Ales in hand casts them through the operator\'s procedure', () => {
    const s = run({ wave: 6, tier: 3, embers: 4, board: [body('b1', 'dw_brunni'), body('b2', 'dw_gangplank'), body('b3', 'dw_brakka')], hand: [body('h1', 'wo_champion'), body('h2', 'wo_attack')], shop: [vanillaLike('s0', 'dw_pimm'), offer('s1', 'dw_orin')] }, 15, 'drakko');
    const t = playTurn(s, macroPilot());
    const cast = t.actions.filter((a): a is Extract<Action, { type: 'play' }> => a.type === 'play').map((a) => a.uid);
    expect(cast).toContain('h1');
    expect(cast).toContain('h2');
    expect(t.run.hand.some((c) => c.cardId === 'wo_champion' || c.cardId === 'wo_attack')).toBe(false);
  });

  it('(f) no planning handle leaks and the decision is deterministic', () => {
    const s = run({ wave: 4, tier: 3, embers: 6, board: [body('b1', 'dm_gourmand'), body('b2', 'dm_knocked')], shop: [vanillaLike('s0', 'dm_hank'), offer('s1', 'dm_hank'), offer('s2', 'dm_leech')] }, 11, 'drakko');
    const a = playTurn(s, macroPilot());
    releaseAll(); resetGrowthCache();
    const b = playTurn(s, macroPilot());
    expect(a.actions).toEqual(b.actions);
    expect(liveHandleCount()).toBe(0);
  });
});
