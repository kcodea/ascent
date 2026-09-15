import { afterEach, describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type Action, type BoardCard, type RunState } from '../../../state';
import { reduce } from '../../../reducer';
import { releaseAll } from '../../../productionBots/transition';
import { toBotVisibleState } from '../../../productionBots/visibleState';
import { GENERALIST_BUDGETS } from '../../generalistPilot';
import { pilotFor, PILOT_IDS } from '../../pilots';
import { createOperatorPilot, OPERATORS, operatorForPackage, type OperatorPilot } from './operatorPilot';
import { isSpentOnBoard, keepValue, offerAppeal, wantOf, type OperatorLine } from './types';
import { SPELL_POLICY, spellPolicyOf } from './spells';
import { STRATEGY_PACKAGES } from '../packages';
import { poolFor } from '@game/content';

/**
 * B9 — THE OPERATORS' CURRICULA. For every line a hand-built state where the EXPERT move is the feed, not a body:
 * the operator is driven through the real reducer (a refused action fails the pilot) and must take the line's
 * operation — leave Blart's meal in the row, cast the Ales, put the spell on Mirrorwing, seat the Echo left-most —
 * plus the shared procedure (the tier curve, filler sold for an engine, the pivot, no illegal action, no Gold left
 * on the table). The line is PINNED (`operator:<line>`) on a neutral hero, so each curriculum tests the procedure,
 * not the hero-affinity ranking.
 */
afterEach(() => releaseAll());

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}, seed = 4242, heroId = 'drakko'): RunState =>
  ({ ...createRun(seed, heroId, 'ascent', undefined, 'set2'), phase: 'recruit', spell: undefined, ...over } as RunState);
const offer = (uid: string, cardId: string): RunState['shop'][number] => ({ uid, cardId });

interface Turn { run: RunState; actions: Action[]; routes: string[] }
function playTurn(start: RunState, pilot: OperatorPilot, maxActions = 80): Turn {
  let s = start;
  const actions: Action[] = [];
  const routes: string[] = [];
  for (let i = 0; i < maxActions; i++) {
    const a = pilot.decide(s, { seatId: 'seat', round: s.wave, scoutedOpponent: null });
    routes.push(pilot.lastTrace()?.route ?? '?');
    if (!a) return { run: s, actions, routes };
    const n = reduce(s, a);
    if (n === s) throw new Error(`the operator proposed an action the reducer refused: ${JSON.stringify(a)} (route ${pilot.lastTrace()?.route})`);
    s = n;
    actions.push(a);
  }
  throw new Error(`the operator did not end its turn within ${maxActions} actions`);
}
const op = (line: OperatorLine): OperatorPilot => createOperatorPilot(GENERALIST_BUDGETS.smoke, 7, { line });
const types = (t: Turn): string => t.actions.map((a) => a.type).join(' ');

describe('operators — routing + registry', () => {
  it('every strategist package routes to at most one operator, and the four lines cover ale / demonConsume / dragon / beastSummon', () => {
    for (const p of STRATEGY_PACKAGES) {
      const hits = Object.values(OPERATORS).filter((o) => o.packages.includes(p.id));
      expect(hits.length, `${p.id} routes to ${hits.map((h) => h.id).join('+')}`).toBeLessThanOrEqual(1);
    }
    expect(operatorForPackage('ale')?.id).toBe('dwarf');
    expect(operatorForPackage('demonConsume')?.id).toBe('demon');
    expect(operatorForPackage('dragon')?.id).toBe('dragon');
    expect(operatorForPackage('beastSummon')?.id).toBe('beast');
    expect(operatorForPackage('ruby')).toBeNull();
  });

  it('the registry resolves `operator` and `operator:<line>`; unknown lines throw', () => {
    expect(pilotFor('operator').id).toBe('operator');
    expect(pilotFor('operator:demon').id).toBe('operator:demon');
    expect(() => pilotFor('operator:undead')).toThrow(/unknown pilot/);
    expect(PILOT_IDS()).toContain('operator');
  });

  it('every card the role tables name exists in the set-2 pool, and every drawable set-2 spell has a policy', () => {
    const pool = new Set(poolFor('set2').all.map((d) => d.id));
    for (const o of Object.values(OPERATORS)) for (const id of Object.keys(o.roles)) expect(pool.has(id), `${o.id}: ${id} is not in the set-2 pool`).toBe(true);
    const spells = poolFor('set2').all.filter((d) => d.spell && !d.ruby && !d.token && !d.rewardSpell && !d.gift);
    const unnamed = spells.filter((d) => !SPELL_POLICY[d.id]).map((d) => d.id);
    expect(unnamed, `spells without a policy (treated as never): ${unnamed.join(', ')}`).toEqual([]);
    expect(spellPolicyOf('devour').kind).toBe('never');
  });

  it('a Shout-only body is spent once fielded: Butcher / Tormentor / Agent, never Blart / Brunni / Chorus', () => {
    for (const id of ['dm_butcher', 'dm_tormentor', 'dm_agent', 'd2_broodfire', 'dw_ironlung']) expect(isSpentOnBoard(id), id).toBe(true);
    for (const id of ['dm_gourmand', 'dw_brunni', 'd2_chorus', 'b2_echohorn', 'dm_hank', 'd2_scalefeather']) expect(isSpentOnBoard(id), id).toBe(false);
  });

  it('the natural `operator` follows the strategist’s line and reports it (operator / none) through lineOf', () => {
    const pilot = createOperatorPilot(GENERALIST_BUDGETS.smoke, 7);
    const start = { ...run({ embers: 3, wave: 1, board: [], hand: [] }, 5, 'flint'), shop: [offer('a', 'dw_orin'), offer('b', 'dm_knocked')] };
    playTurn(start, pilot);
    const line = pilot.lineOf()!;
    expect(line.primary).toBeDefined();
    const expected = operatorForPackage(line.primary)?.id ?? 'none';
    expect(line.operator).toBe(expected);
  });
});

describe('operator — demon consume', () => {
  it('leaves Blart’s MEAL in the row: with a Blart fielded and a buffed right-most offer, it buys from the left and never the right-most', () => {
    const start: RunState = {
      ...run({ embers: 6, wave: 7, tier: 4, board: [body('g', 'dm_gourmand', { attack: 20, health: 18 }), body('h', 'dm_hank')], hand: [] }, 31),
      shop: [offer('a', 'dm_knocked'), offer('b', 'dm_leech'), { uid: 'c', cardId: 'impoverseer', atk: 12, hp: 12 }],
    };
    const t = playTurn(start, op('demon'));
    const bought = t.actions.filter((a) => a.type === 'buy').map((a) => (a as { uid: string }).uid);
    expect(bought, types(t)).not.toContain('c');
    // Whatever it rolled into, a meal is left in the row for the End of Turn eat.
    expect(t.run.shop.filter((o) => !CARD_INDEX[o.cardId]?.spell).length, `the row was emptied (${types(t)})`).toBeGreaterThan(0);
  });

  it('never ends on an empty Shop while a Blart is fielded: the row is rolled back before End Turn', () => {
    const start: RunState = { ...run({ embers: 4, wave: 8, tier: 4, board: [body('g', 'dm_gourmand', { attack: 30, health: 30 })], hand: [] }, 32), shop: [] };
    const t = playTurn(start, op('demon'));
    expect(t.run.shop.filter((o) => !CARD_INDEX[o.cardId]?.spell).length, `the Shop was left empty (${types(t)})`).toBeGreaterThan(0);
  });

  it('aims Appetite Agent / Cupcakes at the biggest Blart', () => {
    const start: RunState = {
      ...run({ embers: 0, wave: 7, tier: 4, board: [body('g1', 'dm_gourmand', { attack: 30, health: 30 }), body('g2', 'dm_gourmand', { attack: 8, health: 8 }), body('k', 'dm_knocked')], hand: [body('a', 'dm_agent')] }, 33),
      shop: [offer('x', 'dm_leech'), { uid: 'y', cardId: 'dm_knocked', atk: 10, hp: 10 }],
    };
    const t = playTurn(start, op('demon'));
    const aim = t.actions.find((a) => a.type === 'battlecryTarget') as { targetUid: string } | undefined;
    expect(aim?.targetUid, types(t)).toBe('g1');
  });

  it('Blart outranks a pair bonus and a same-stat Horse when both are on offer at wave 6', () => {
    const start: RunState = {
      ...run({ embers: 3, wave: 6, tier: 3, board: [body('h', 'dm_hank'), body('k', 'dm_knocked')], hand: [] }, 34),
      shop: [offer('a', 'dm_hungerling'), offer('b', 'dm_hank'), offer('c', 'dm_gourmand')],
    };
    const v = toBotVisibleState(start);
    const appeal = (uid: string) => offerAppeal(OPERATORS.demon, v.shop.find((o) => o.uid === uid)!, v);
    expect(appeal('c')).toBeGreaterThan(appeal('b'));
    expect(appeal('c')).toBeGreaterThan(appeal('a'));
    const t = playTurn(start, op('demon'));
    expect((t.actions.find((a) => a.type === 'buy') as { uid: string } | undefined)?.uid, types(t)).toBe('c');
  });

  it('arranges Hank to the FRONT and the Blarts to the BACK', () => {
    const start: RunState = { ...run({ embers: 0, wave: 8, tier: 4, board: [body('g', 'dm_gourmand', { attack: 40, health: 40 }), body('k', 'dm_knocked'), body('h', 'dm_hank')], hand: [] }, 35), shop: [offer('x', 'dm_leech')] };
    const t = playTurn(start, op('demon'));
    expect(t.run.board[0]!.cardId).toBe('dm_hank');
    expect(t.run.board[t.run.board.length - 1]!.cardId).toBe('dm_gourmand');
  });
});

describe('operator — dwarf ale', () => {
  it('casts every Ale in hand, Golden Ale first, Champion’s Ale last — after seating the champion on the left', () => {
    const start: RunState = {
      ...run({ embers: 2, wave: 7, tier: 4, board: [body('b', 'dw_brunni'), body('c', 'dw_coinfire', { attack: 14, health: 9 }), body('o', 'dw_orin')], hand: [body('a1', 'wo_champion'), body('a2', 'wo_mine'), body('a3', 'wo_attack')] }, 41),
      shop: [offer('x', 'dm_leech')],
    };
    const t = playTurn(start, op('dwarf'));
    const casts = t.actions.filter((a) => a.type === 'play').map((a) => (a as { uid: string }).uid);
    expect(casts, types(t)).toEqual(expect.arrayContaining(['a1', 'a2', 'a3']));
    expect(casts.indexOf('a2')).toBeLessThan(casts.indexOf('a1'));
    // The champion (the biggest non-Brunni Dwarf) holds the left seat when Champion's Ale lands.
    const champIdx = t.actions.findIndex((a) => a.type === 'play' && (a as { uid: string }).uid === 'a1');
    const seat = t.actions.slice(0, champIdx).find((a) => a.type === 'reposition') as { uid: string; toIndex: number } | undefined;
    expect(seat?.uid).toBe('c');
    expect(seat?.toIndex).toBe(0);
    expect(t.run.hand.some((h) => h.cardId.startsWith('wo_')), 'an Ale was left in hand').toBe(false);
  });

  it('spends EVERY coin under a Coinfire: leftover Gold goes into refreshes, none is left on the table', () => {
    const full = ['dw_coinfire', 'dw_brunni', 'dw_orin', 'dw_pimm', 'dw_gangplank', 'dw_brakka', 'dw_wardkeeper'].map((id, i) => body(`b${i}`, id, { attack: 20, health: 20 }));
    const start: RunState = { ...run({ embers: 4, wave: 8, tier: 4, board: full, hand: [] }, 42), shop: [offer('x', 'k_pouchpincher'), offer('y', 'venom')] };
    const t = playTurn(start, op('dwarf'));
    expect(t.actions.filter((a) => a.type === 'roll').length, types(t)).toBeGreaterThanOrEqual(2);
    expect(t.run.embers).toBeLessThan(2);
  });

  it('buys Brunni over a bigger vanilla body at wave 4 (the brewery is the engine)', () => {
    const start: RunState = { ...run({ embers: 3, wave: 4, tier: 3, board: [body('p', 'dw_pimm')], hand: [] }, 43), shop: [{ uid: 'v', cardId: 'stray', atk: 4, hp: 4 }, offer('b', 'dw_brunni')] };
    const t = playTurn(start, op('dwarf'));
    expect((t.actions.find((a) => a.type === 'buy') as { uid: string } | undefined)?.uid, types(t)).toBe('b');
  });
});

describe('operator — dragon spell', () => {
  it('casts the targeted spell on MIRRORWING first (the once-per-turn recast), the second on the Vaultkeeper', () => {
    const start: RunState = {
      ...run({ embers: 0, wave: 10, tier: 6, board: [body('m', 'd2_mirrorwing'), body('v', 'd2_herzog', { attack: 40, health: 40 }), body('c', 'd2_chorus')], hand: [body('s1', 'sp_blessing'), body('s2', 'spiritfire')] }, 51),
      shop: [offer('x', 'dm_leech')],
    };
    const t = playTurn(start, op('dragon'));
    const casts = t.actions.filter((a) => a.type === 'play' && (a as { targetUid?: string }).targetUid) as { uid: string; targetUid: string }[];
    expect(casts.length, types(t)).toBe(2);
    expect(casts[0]!.targetUid).toBe('m');
    expect(casts[1]!.targetUid).toBe('v');
  });

  it('buys the Shop spell slot once a Dragon engine is fielded, and casts it', () => {
    const start: RunState = {
      ...run({ embers: 3, wave: 8, tier: 4, board: [body('c', 'd2_chorus'), body('e', 'd2_scalechanter'), body('m', 'd2_mirrorwing')], hand: [] }, 52),
      shop: [offer('x', 'k_pouchpincher')],
      spell: { uid: 'sp', cardId: 'growth' },
    };
    const t = playTurn(start, op('dragon'));
    expect(t.actions.some((a) => a.type === 'buy' && (a as { uid: string }).uid === 'sp'), types(t)).toBe(true);
    expect(t.run.hand.some((h) => h.cardId === 'growth'), 'the spell was bought and held').toBe(false);
  });

  it('seats the Transcendant BETWEEN the two Chorus Drakes and the Vaultkeeper at the back', () => {
    const start: RunState = {
      ...run({ embers: 0, wave: 10, tier: 6, board: [body('v', 'd2_herzog', { attack: 40, health: 40 }), body('t', 'd2_transcendence'), body('c1', 'd2_chorus'), body('c2', 'd2_chorus')], hand: [] }, 53),
      shop: [offer('x', 'dm_leech')],
    };
    const t = playTurn(start, op('dragon'));
    const ids = t.run.board.map((c) => c.cardId);
    expect(ids.slice(0, 3)).toEqual(['d2_chorus', 'd2_transcendence', 'd2_chorus']);
    expect(ids[ids.length - 1]).toBe('d2_herzog');
  });

  it('never casts a `never` spell on its engine: Channeling the Devourer stays in hand', () => {
    const start: RunState = { ...run({ embers: 0, wave: 9, tier: 5, board: [body('v', 'd2_herzog', { attack: 40, health: 40 })], hand: [body('d', 'devour')] }, 54), shop: [] };
    const t = playTurn(start, op('dragon'));
    expect(t.run.hand.some((h) => h.cardId === 'devour'), types(t)).toBe(true);
    expect(t.run.board.some((c) => c.cardId === 'd2_herzog')).toBe(true);
  });
});

describe('operator — beast summon / echo', () => {
  it('seats the best Echo LEFT-MOST, Echohorn behind it, the payoffs at the back', () => {
    const start: RunState = {
      ...run({ embers: 0, wave: 9, tier: 5, board: [body('k', 'kennel'), body('e', 'b2_echohorn'), body('t', 'b2_trex'), body('m', 'b2_mammoth'), body('h', 'b2_hawkus')], hand: [] }, 61),
      shop: [offer('x', 'dm_leech')],
    };
    const t = playTurn(start, op('beast'));
    const ids = t.run.board.map((c) => c.cardId);
    expect(ids[0], types(t)).toBe('b2_mammoth');
    expect(ids[1]).toBe('b2_trex');
    expect(ids[2]).toBe('b2_echohorn');
    expect(ids.slice(-2)).toEqual(expect.arrayContaining(['kennel', 'b2_hawkus']));
  });

  it('buys Echohorn over a bigger vanilla body', () => {
    const start: RunState = { ...run({ embers: 3, wave: 6, tier: 4, board: [body('t', 'b2_trex'), body('k', 'kennel')], hand: [] }, 62), shop: [{ uid: 'v', cardId: 'stray', atk: 6, hp: 6 }, offer('e', 'b2_echohorn')] };
    const t = playTurn(start, op('beast'));
    expect((t.actions.find((a) => a.type === 'buy') as { uid: string } | undefined)?.uid, types(t)).toBe('e');
  });

  it('Jensen’s Dynamite Dig is used while it is cheap, and the Discover takes the line’s piece', () => {
    const start: RunState = { ...run({ embers: 3, wave: 2, tier: 2, board: [body('t', 'b2_trex')], hand: [] }, 63, 'jenkins'), shop: [offer('x', 'k_pouchpincher')] };
    const t = playTurn(start, op('beast'));
    expect(t.actions.some((a) => a.type === 'heroPower'), types(t)).toBe(true);
    expect(t.actions.some((a) => a.type === 'discover')).toBe(true);
  });
});

describe('operator — the shared procedure', () => {
  it('tiers on the line’s curve: wave 4, tier 2, 6 Gold, a weak shop — upgrades (every line)', () => {
    for (const line of Object.keys(OPERATORS) as OperatorLine[]) {
      const start: RunState = { ...run({ embers: 6, wave: 4, tier: 2, upgradeCost: 5, board: [body('a', 'k_geode')], hand: [] }, 71), shop: [offer('x', 'venom'), offer('y', 'k_pouchpincher')] };
      const t = playTurn(start, op(line));
      expect(types(t), line).toContain('upgrade');
      releaseAll();
    }
  });

  it('delays a due tier-up only for a CORE engine it could not otherwise afford (Blart at wave 4)', () => {
    const start: RunState = { ...run({ embers: 6, wave: 4, tier: 2, upgradeCost: 5, board: [body('a', 'dm_knocked')], hand: [] }, 72), shop: [offer('g', 'dm_gourmand'), offer('y', 'k_pouchpincher')] };
    const t = playTurn(start, op('demon'));
    expect((t.actions.find((a) => a.type === 'buy') as { uid: string } | undefined)?.uid, types(t)).toBe('g');
    expect(t.run.board.some((c) => c.cardId === 'dm_gourmand')).toBe(true);
  });

  it('sells filler for an engine piece from wave 6: a full board of Whelps and Knocked makes a seat for Blart', () => {
    const fillers = ['d2_embermouth', 'dm_knocked', 'dm_leech', 'k_pouchpincher', 'dw_orin', 'b2_packstrider', 'manasaber'].map((id, i) => body(`f${i}`, id));
    const start: RunState = { ...run({ embers: 3, wave: 7, tier: 4, board: fillers, hand: [] }, 73), shop: [offer('g', 'dm_gourmand'), offer('x', 'venom')] };
    const t = playTurn(start, op('demon'));
    expect(types(t)).toContain('sell');
    expect(t.run.board.some((c) => c.cardId === 'dm_gourmand'), types(t)).toBe(true);
    expect(t.run.board.length).toBe(7);
  });

  it('never sells a core engine to seat a body: keepValue(Blart) beats any incoming filler', () => {
    const start: RunState = { ...run({ embers: 0, wave: 9, tier: 5, board: [body('g', 'dm_gourmand', { attack: 30, health: 30 })], hand: [] }, 74), shop: [] };
    const v = toBotVisibleState(start);
    expect(keepValue(OPERATORS.demon, v.board[0]!, v)).toBeGreaterThan(100);
    expect(wantOf(OPERATORS.demon, 'd2_embermouth', v)).toBe(0);
  });

  it('pivots to the strategist when no engine piece has been fielded by the pivot wave, and reports it', () => {
    const pilot = op('dwarf');
    const start: RunState = { ...run({ embers: 9, wave: 7, tier: 3, board: [body('a', 'k_geode'), body('b', 'venom')], hand: [] }, 75), shop: [offer('x', 'venom'), offer('y', 'k_pouchpincher')] };
    playTurn(start, pilot);
    expect(pilot.lineOf()?.operator).toBe('pivoted');
    expect(pilot.lastTrace()?.route.startsWith('strategist:')).toBe(true);
  });

  it('does not pivot while an engine is fielded', () => {
    const pilot = op('dwarf');
    const start: RunState = { ...run({ embers: 9, wave: 8, tier: 4, board: [body('a', 'dw_brunni'), body('b', 'venom')], hand: [] }, 76), shop: [offer('x', 'venom'), offer('y', 'dw_orin')] };
    playTurn(start, pilot);
    expect(pilot.lineOf()?.operator).toBe('dwarf');
  });

  it('ends no turn holding Gold that could still buy a body while the board has room', () => {
    for (const line of Object.keys(OPERATORS) as OperatorLine[]) {
      const start: RunState = { ...run({ embers: 9, wave: 5, tier: 3, board: [body('a', 'k_geode')], hand: [] }, 77), shop: [offer('x', 'venom'), offer('y', 'dw_orin'), offer('z', 'dm_knocked')] };
      const t = playTurn(start, op(line));
      const room = t.run.board.length < 7;
      expect(t.run.embers < 3 || !room, `${line}: ended with ${t.run.embers} Gold (${types(t)})`).toBe(true);
      releaseAll();
    }
  });

  it('is deterministic: the same fixture twice gives the same action list', () => {
    const fixture = (): RunState => ({ ...run({ embers: 8, wave: 7, tier: 4, board: [body('g', 'dm_gourmand', { attack: 12, health: 12 }), body('h', 'dm_hank')], hand: [body('s', 'growth')] }, 78), shop: [offer('a', 'dm_knocked'), offer('b', 'dm_hungerling'), offer('c', 'dm_leech')] });
    const a = playTurn(fixture(), op('demon'));
    releaseAll();
    const b = playTurn(fixture(), op('demon'));
    expect(a.actions).toEqual(b.actions);
  });
});
