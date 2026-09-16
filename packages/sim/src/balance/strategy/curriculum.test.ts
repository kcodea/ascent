import { afterEach, describe, expect, it } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { createRun, type Action, type BoardCard, type RunState } from '../../state';
import { reduce } from '../../reducer';
import { releaseAll, liveHandleCount } from '../../productionBots/transition';
import { toBotVisibleState } from '../../productionBots/visibleState';
import { evaluate } from '../../productionBots/evaluate';
import { GENERALIST_BUDGETS, createGeneralistPilot } from '../generalistPilot';
import { pilotFor } from '../pilots';
import { createStrategistPilot, type StrategistPilot } from './strategistPilot';
import { pickLineForRun, type LineChoice } from './lines';
import { linePriorBreakdown, packagesOf, cardAffinity } from './prior';
import { STRATEGY_PACKAGES } from './packages';

/**
 * B4 — THE STRATEGIST'S CURRICULA (docs/balance-bot-roadmap.md: "Each specialist needs a curriculum: a ready
 * payoff state, an early setup state, a weak-shop pivot, a contested/poor-offer case").
 *
 * For every set-2 package the strategist is driven through a hand-built state where the line-competent move is
 * clear, through the REAL reducer (a refused action fails the pilot). The line is FORCED through `exploration`
 * on a neutral hero (Drakko) so each curriculum tests the prior, not the hero-affinity ranking — labelled as
 * such: these are exploration-population fixtures, never natural pick rates.
 */
afterEach(() => releaseAll());

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}, seed = 4242, heroId = 'drakko'): RunState =>
  ({ ...createRun(seed, heroId, 'ascent', undefined, 'set2'), phase: 'recruit', spell: undefined, ...over } as RunState);

interface Turn { run: RunState; actions: Action[] }
function playTurn(start: RunState, pilot: StrategistPilot | ReturnType<typeof createGeneralistPilot>, maxActions = 80): Turn {
  let s = start;
  const actions: Action[] = [];
  for (let i = 0; i < maxActions; i++) {
    const a = pilot.decide(s, { seatId: 'seat', round: s.wave, scoutedOpponent: null });
    if (!a) return { run: s, actions };
    const n = reduce(s, a);
    if (n === s) throw new Error(`the pilot proposed an action the reducer refused: ${JSON.stringify(a)} (route ${pilot.lastTrace()?.route})`);
    s = n;
    actions.push(a);
  }
  throw new Error(`the pilot did not end its turn within ${maxActions} actions`);
}

const PILOT_SEED = 7;
/** The exploration index that lands `pkg` as the primary line for this run (forcing the line under test). */
function explorationFor(s: RunState, pkg: string): number {
  for (let k = 0; k < STRATEGY_PACKAGES.length; k++) if (pickLineForRun(s.heroId, s.tribes, s.seed ^ PILOT_SEED, k, 'set2').primary === pkg) return k;
  throw new Error(`no exploration index reaches ${pkg} for hero ${s.heroId}`);
}
function strategistFor(s: RunState, pkg: string): { pilot: StrategistPilot; line: LineChoice } {
  const k = explorationFor(s, pkg);
  return { pilot: createStrategistPilot(GENERALIST_BUDGETS.smoke, PILOT_SEED, { exploration: k }), line: pickLineForRun(s.heroId, s.tribes, s.seed ^ PILOT_SEED, k, 'set2') };
}
/** A vanilla body (the Stray token) offered at exactly `cardId`'s printed stats. */
const vanillaLike = (uid: string, cardId: string): RunState['shop'][number] => {
  const d = CARD_INDEX[cardId]!;
  const stray = CARD_INDEX['stray']!;
  return { uid, cardId: 'stray', atk: d.attack - stray.attack, hp: d.health - stray.health };
};

interface Curriculum {
  pkg: string;
  /** (a) an assembled engine on the board + the payoff in hand. */
  ready: { board: string[]; hand: string; };
  /** (b) the engine piece a wave-2 shop offers beside a vanilla body of the same stats. */
  engine: string;
  /** (d) an affine rune and an off-package rune of the SAME cost. */
  forge: { affine: string; off: string };
}

const CURRICULA: Curriculum[] = [
  { pkg: 'ruby', ready: { board: ['k_chipwick', 'k_geode', 'k_kobe'], hand: 'k_frenzied' }, engine: 'k_chipwick', forge: { affine: 'rune_resonance', off: 'rune_window_shopping' } },
  { pkg: 'ale', ready: { board: ['dw_pimm', 'dw_brunni', 'dw_edward'], hand: 'wo_champion' }, engine: 'dw_pimm', forge: { affine: 'rune_flagship', off: 'rune_window_shopping' } },
  { pkg: 'demonConsume', ready: { board: ['dm_knocked', 'dm_butcher', 'dm_glutton'], hand: 'dm_agent' }, engine: 'dm_agent', forge: { affine: 'rune_infernal_ink', off: 'rune_window_shopping' } },
  { pkg: 'beastSummon', ready: { board: ['b2_trex', 'kennel', 'b2_beardsley'], hand: 'b2_wolvie' }, engine: 'b2_trex', forge: { affine: 'rune_brood', off: 'rune_window_shopping' } /* rune_rebirth until 2026-09-16 — it grants the Rebirth keyword now, no summon affinity */ },
  { pkg: 'dragon', ready: { board: ['d2_embermouth', 'karwind', 'd2_skald'], hand: 'd2_broodfire' }, engine: 'd2_embermouth', forge: { affine: 'rune_chorus', off: 'rune_window_shopping' } },
  { pkg: 'spellEngine', ready: { board: ['d2_scalechanter', 'n2_spellsword', 'd2_mirrorwing'], hand: 'growth' }, engine: 'n2_spellsword', forge: { affine: 'rune_recollection', off: 'rune_window_shopping' } },
  { pkg: 'echo', ready: { board: ['dm_knocked', 'sylus', 'b2_trex'], hand: 'n2_lastlight' }, engine: 'dm_knocked', forge: { affine: 'rune_aftershocks', off: 'rune_epic_forge' } },
  { pkg: 'rally', ready: { board: ['b2_packstrider', 'n2_standardbearer', 'k_blazer'], hand: 'rallyoffensive' }, engine: 'b2_packstrider', forge: { affine: 'rune_rallying', off: 'rune_open_enrollment' } },
  { pkg: 'tempo', ready: { board: ['dw_brakka', 'venom', 'dw_orin'], hand: 'spiritfire' }, engine: 'dw_brakka', forge: { affine: 'rune_warding', off: 'rune_window_shopping' } },
  { pkg: 'economy', ready: { board: ['dw_pimm', 'k_pouchpincher', 'buddy'], hand: 'emberpouch' }, engine: 'dw_pimm', forge: { affine: 'rune_vault', off: 'rune_trade_in' } },
];

describe.each(CURRICULA)('curriculum — $pkg', ({ pkg, ready, engine, forge }) => {
  it('(a) ready payoff: with the engine assembled it takes the payoff line from hand', () => {
    const board = ready.board.map((id, i) => body(`b${i}`, id));
    const hand = [body('p', ready.hand)];
    const start = { ...run({ embers: 0, wave: 6, tier: 4, board, hand }), shop: [] };
    const { pilot } = strategistFor(start, pkg);
    const { actions } = playTurn(start, pilot);
    expect(actions.some((a) => a.type === 'play' && a.uid === 'p'), `${ready.hand} was never played (${actions.map((a) => a.type).join(' ')})`).toBe(true);
    expect(actions.some((a) => a.type === 'sell'), 'the engine was sold').toBe(false);
  });

  it('(b) early setup: buys the engine piece over a vanilla body of equal stats — strictly, by utility', () => {
    const d = CARD_INDEX[engine]!;
    const start: RunState = { ...run({ embers: 3, wave: 2, tier: d.tier, board: [], hand: [] }, 11), shop: [vanillaLike('v', engine), { uid: 'e', cardId: engine }] };
    const { pilot, line } = strategistFor(start, pkg);
    expect(cardAffinity(d, packagesOf(line)), 'fixture: the engine is not a member of its own line').toBeGreaterThan(0);
    const { actions } = playTurn(start, pilot);
    const buy = actions.find((a) => a.type === 'buy') as { uid: string } | undefined;
    expect(buy?.uid, `bought ${buy?.uid ?? 'nothing'}`).toBe('e');
    // Not a tie broken by luck: the first decision's search ranked the engine buy strictly above the vanilla buy.
    const first = createStrategistPilot(GENERALIST_BUDGETS.smoke, PILOT_SEED, { exploration: explorationFor(start, pkg) });
    first.decide(start, { seatId: 'seat', round: 2, scoutedOpponent: null });
    const alts = first.lastTrace()!.search!.alternatives;
    const utilityOf = (uid: string): number => Math.max(...alts.filter((a) => a.tag.startsWith(`buy ${uid === 'e' ? engine : 'stray'}`)).map((a) => a.utility));
    expect(utilityOf('e')).toBeGreaterThan(utilityOf('v'));
  });

  it('(c) weak-shop pivot: with nothing on-package offered it still develops instead of passing', () => {
    // Three off-package bodies (a Spirit-less neutral, a Beast, a Kobold — whichever is not this line's tribe).
    const offPackage = ['venom', 'b2_wolvie', 'k_geode', 'dw_orin', 'dm_knocked', 'arenaheckler'].filter((id) => cardAffinity(CARD_INDEX[id], packagesOf(pickLineForRun('drakko', ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], 0, 0))) >= 0 && STRATEGY_PACKAGES.find((p) => p.id === pkg)!.member(CARD_INDEX[id]!) === 0).slice(0, 3);
    expect(offPackage.length, 'fixture: fewer than 3 off-package bodies').toBe(3);
    const start: RunState = { ...run({ embers: 6, wave: 3, tier: 2, board: [body('a', 'k_geode')], hand: [] }, 12), shop: offPackage.map((id, i) => ({ uid: `o${i}`, cardId: id })) };
    const { pilot } = strategistFor(start, pkg);
    const { run: end, actions } = playTurn(start, pilot);
    expect(actions.length, 'the turn was passed').toBeGreaterThan(0);
    const developed = actions.some((a) => a.type === 'buy' || a.type === 'upgrade' || a.type === 'roll');
    expect(developed, `no development in: ${actions.map((a) => a.type).join(' ')}`).toBe(true);
    // Never ends the turn holding Gold it could still spend — the generalist's own rule survives the prior.
    const v = toBotVisibleState(end);
    const cheapest = Math.min(...v.shop.map((o) => o.cost), v.economy.upgradeCost);
    const room = v.board.length < 7 && v.hand.length < 10;
    expect(v.economy.gold < cheapest || !room).toBe(true);
  });

  it('(d) Runeforge: offered an affine rune and an off-package one of equal cost, it takes the affine one (either order)', () => {
    const a = RUNE_INDEX[forge.affine]!;
    const o = RUNE_INDEX[forge.off]!;
    expect(a.cost, 'fixture: costs differ').toBe(o.cost);
    for (const offer of [[forge.affine, forge.off], [forge.off, forge.affine]]) {
      const start = { ...run({ embers: 10, wave: 6, tier: 3, runeforgeOffer: offer, board: [body('a', 'k_geode'), body('b', 'dw_orin')], hand: [] }, 13), shop: [] };
      const { pilot } = strategistFor(start, pkg);
      const { run: end, actions } = playTurn(start, pilot);
      const first = actions[0]!;
      expect(first.type, `first action was ${first.type}`).toBe('buyRune');
      expect(offer[(first as { index: number }).index]).toBe(forge.affine);
      expect(end.ownedRunes ?? []).toContain(forge.affine);
      releaseAll();
    }
  });
});

describe('curriculum — (e) tier timing follows the line’s economy profile', () => {
  const weakShop: RunState['shop'] = [{ uid: 'x', cardId: 'venom' }, { uid: 'y', cardId: 'k_pouchpincher' }, { uid: 'z', cardId: 'dw_orin' }];
  const at = (wave: number, tier: number, upgradeCost: number, gold: number): RunState =>
    ({ ...run({ embers: gold, wave, tier, upgradeCost, board: [body('a', 'k_geode'), body('b', 'dw_orin')], hand: [] }, 21), shop: weakShop });

  it('the player curve: wave 3, 5 Gold, still tier 1 — tiers rather than buying a second body (every profile)', () => {
    // Real players hold 1–2 bodies at waves 2–3 and reach T2 by wave 2–3; the generalist spent every coin on bodies.
    for (const pkg of ['ruby', 'tempo', 'economy']) {
      const start: RunState = { ...run({ embers: 5, wave: 3, tier: 1, upgradeCost: 3, board: [body('a', 'k_geode')], hand: [] }, 23), shop: [{ uid: 'x', cardId: 'dw_orin' }, { uid: 'y', cardId: 'dm_knocked' }, { uid: 'z', cardId: 'b2_packstrider' }] };
      const { pilot } = strategistFor(start, pkg);
      const { run: end, actions } = playTurn(start, pilot);
      expect(actions.map((a) => a.type), `${pkg}: ${actions.map((a) => a.type).join(' ')}`).toContain('upgrade');
      expect(end.tier).toBe(2);
      releaseAll();
    }
  });

  it('economy profile: tier 2 → 3 at wave 4 (the 6-Gold threshold), when the upgrade takes every Gold', () => {
    const start = at(4, 2, 6, 6);
    const { pilot, line } = strategistFor(start, 'economy');
    expect(line.primary).toBe('economy');
    const { actions } = playTurn(start, pilot);
    expect(actions.map((a) => a.type)).toContain('upgrade');
  });

  it('tempo profile: does NOT tier at wave 4 with tier 2 (the lagged curve wants tier 3 by wave 6) — it buys instead', () => {
    const start = at(4, 2, 6, 6);
    const { pilot, line } = strategistFor(start, 'tempo');
    expect(line.primary).toBe('tempo');
    const { actions } = playTurn(start, pilot);
    expect(actions.map((a) => a.type)).not.toContain('upgrade');
    expect(actions.some((a) => a.type === 'buy')).toBe(true);
  });

  it('tempo profile: tiers when the curve is due (tier 2 at wave 6 wants 3)', () => {
    const start = at(6, 2, 7, 8);
    const { pilot } = strategistFor(start, 'tempo');
    const { actions } = playTurn(start, pilot);
    expect(actions.map((a) => a.type)).toContain('upgrade');
  });

  it('the prior reads the profile: behind < on-curve > ahead', () => {
    const line = pickLineForRun('drakko', ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], 1, explorationFor(run({}, 1), 'tempo'), 'set2');
    const v = (tier: number) => toBotVisibleState({ ...run({ wave: 6, tier }), shop: [] });
    const behind = linePriorBreakdown(v(2), line).timing;
    const on = linePriorBreakdown(v(3), line).timing;
    const ahead = linePriorBreakdown(v(4), line).timing;
    expect(behind).toBeLessThan(on);
    expect(ahead).toBeLessThan(on);
  });
});

describe('the strategist keeps the generalist’s competence', () => {
  const strategist = (seed = PILOT_SEED, exploration: number | 'rotate' = 0): StrategistPilot => createStrategistPilot(GENERALIST_BUDGETS.smoke, seed, { exploration });

  it('7 Gold, tier 1, empty board: buys and plays — never ends the turn holding Gold it could use', () => {
    const start = { ...createRun(11, 'drakko', 'ascent', undefined, 'set2'), phase: 'recruit' as const, embers: 7, tier: 1, board: [], hand: [] } as RunState;
    const { run: end, actions } = playTurn(start, strategist());
    expect(end.board.length).toBeGreaterThan(0);
    expect(actions.some((a) => a.type === 'buy')).toBe(true);
    const v = toBotVisibleState(end);
    const cheapest = Math.min(...v.shop.map((o) => o.cost), v.economy.upgradeCost);
    const room = v.board.length < 7 && v.hand.length < 10;
    expect(v.economy.gold < cheapest || !room).toBe(true);
  });

  it('a triple one buy away: takes it', () => {
    const base = run({ embers: 3, board: [body('a', 'k_geode'), body('b', 'k_geode')], hand: [] }, 12);
    const start: RunState = { ...base, shop: [{ uid: 'o1', cardId: 'k_geode' }, ...base.shop.slice(1)] };
    const { run: end, actions } = playTurn(start, strategist());
    expect(actions[0]).toEqual({ type: 'buy', uid: 'o1' });
    expect(end.board.some((c) => c.cardId === 'k_geode' && c.golden)).toBe(true);
  });

  it('answers every mandatory prompt across a scripted forge turn', () => {
    const start = run({ embers: 10, runeforgeOffer: ['rune_warding', 'rune_window_shopping', 'rune_slaying'], board: [body('a', 'k_geode')] }, 13);
    const { run: end, actions } = playTurn(start, strategist());
    expect(['buyRune', 'skipRuneforge', 'rerollRuneforge']).toContain(actions[0]!.type);
    expect(end.runeforgeOffer).toBeFalsy();
  });

  it('is deterministic, never mutates the run, leaks no handle, and the prior is scoped to its own decisions', () => {
    const start = run({ embers: 8 }, 21);
    const before = JSON.stringify({ ...start, lastCombat: undefined });
    const baseline = evaluate(toBotVisibleState(start)).total;
    const p = strategist(99);
    const first = p.decide(start, { seatId: 'seat', round: start.wave, scoutedOpponent: null });
    expect(JSON.stringify({ ...start, lastCombat: undefined })).toBe(before);
    expect(first).toBeTruthy();
    // After the decision the evaluator is back to the shipped config: no prior leaks out of the call.
    expect(evaluate(toBotVisibleState(start)).total).toBe(baseline);
    const a = playTurn(structuredClone(start), strategist(99));
    const b = playTurn(structuredClone(start), strategist(99));
    expect(b.actions).toEqual(a.actions);
    expect(a.actions[0]).toEqual(first);
    expect(liveHandleCount()).toBe(0);
    expect(p.lineOf('seat')).toBeDefined();
  });

  it('is registered: strategist / strategist:rotate / strategist:explore<k>, and the generalist is untouched', () => {
    expect(pilotFor('strategist').id).toBe('strategist');
    expect(pilotFor('strategist:rotate').id).toBe('strategist:rotate');
    expect(pilotFor('strategist:explore3').id).toBe('strategist:explore3');
    expect(pilotFor('generalist').id).toBe('generalist');
    expect((pilotFor('generalist') as { lineOf?: unknown }).lineOf).toBeUndefined();
    expect(() => pilotFor('strategist:nope')).toThrow(/unknown pilot/);
  });

  it('rotate: the line is a function of the run seed, and 30 seeds on one hero play several distinct primaries', () => {
    const lines = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const start = run({ embers: 3 }, seed, 'fibbsy');
      const p = strategist(1, 'rotate');
      p.decide(start, { seatId: 'seat', round: 1, scoutedOpponent: null });
      const line = p.lineOf('seat')!;
      expect(line.primary).not.toBe('mechAttach');
      lines.add(line.primary);
      releaseAll();
    }
    expect(lines.size).toBeGreaterThanOrEqual(5);
  });
});
