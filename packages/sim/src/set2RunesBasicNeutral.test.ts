/**
 * SET 2 RUNE BATCH, BASIC NEUTRAL (owner review 2026-11-12, R-SET2-RUNES-BN-01..09):
 *
 *   Piggy Bank        2  "All unspent Gold carries over to next turn. End of Turn: give a minion +1/+3. Repeat for every unspent Gold."
 *   Hazard Pay        0  "After you lose a combat, gain 3 Gold and a free Refresh."
 *   Second Opinion    3  "Your Discovers offer 1 more option. Discover a minion."
 *   Shield Wall       2  "Start of Combat: give your Taunt minions +4/+6."
 *   Shatterproof      2  "When a minion of yours loses Ward, give it +5/+5 permanently."
 *   Warm-Up           2  "Pummel (150): gain 2 Gold next turn. Counts all your minions. Once per combat."
 *   Golden Handshake  1  "When you Gild a minion, give your minions +2/+2."
 *   Late Bloomer      2  "When you upgrade your Shop, gain 2 Gold and give your minions +3/+3."
 *   Loyal Customer    3  "Every 4th minion you buy is free."
 *
 * Every block drives the real engine: the Runeforge `buyRune`, the reducer's `faceOmen` / `resolveCombat` / `buy` /
 * `upgrade` / `play`, and `simulate()` for both sides.
 */
import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult } from '@game/core';
import { CARD_INDEX, RUNES, EPIC_RUNES, RUNE_INDEX, RUNE_DUP_SWEETENER, SETS, poolFor } from '@game/content';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { offerBuyPrice, questCombatMods } from './reducer';
import { gildMinion, offerSpellDiscover, queueDiscover, socRuneReplaysOf } from './recruit';
import { discoverOptionCount } from './set2RunesBasicNeutral';
import { runeTally } from '../../ui/src/runeTally';

// ── Shop helpers ────────────────────────────────────────────────────────────────────────────────────────────────
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
/** A Set 2 run at the Runeforge, each rune bought through the REAL `buyRune` path. */
function withRune(ids: string[], extra: Partial<RunState> = {}, seed = 3): RunState {
  let s = {
    ...createRun(seed, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: [...SETS.set2.tribes], wave: 7, tier: 4, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
  } as RunState;
  for (const id of ids) {
    s = act({ ...s, runeforgeOffer: [id], runeforgeEpic: false }, { type: 'buyRune', index: 0 });
    s = { ...s, discover: undefined, discoverQueue: undefined }; // Second Opinion's own Discover is tested on its own
  }
  return { ...s, ...extra };
}
/** Vanilla neutral bodies. Engine-keyed ids (Drakko doubles Shouts, Uron End of Turn, ...) are not plain. */
const PLAIN = Object.values(CARD_INDEX).filter((c) => !c.spell && !c.token && !c.universalTribe && c.tribe === 'neutral' && !c.tribe2 && c.effects.length === 0 && c.keywords.length === 0)
  .map((c) => c.id).filter((id) => !['sylus', 'chronos', 'yazzus', 'drummer', 'uron', 'zyff'].includes(id) && !id.startsWith('hm_'));
/** Plain bodies, alternating ids, so no three copies ever triple mid-test. */
const plain = (uid: string, i: number, over: Partial<BoardCard> = {}): BoardCard => body(uid, PLAIN[i % 2]!, over);
const sumFrom = (c: BoardCard, source: string) =>
  (c.buffs ?? []).filter((b) => b.source === source).reduce((t, b) => ({ attack: t.attack + b.attack, health: t.health + b.health }), { attack: 0, health: 0 });
const boardSum = (s: RunState, source: string) => s.board.reduce((t, c) => { const g = sumFrom(c, source); return { attack: t.attack + g.attack, health: t.health + g.health }; }, { attack: 0, health: 0 });
const lostFight = (over: Partial<CombatResult> = {}): CombatResult =>
  ({ events: [], result: 'lose', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, ...over }) as CombatResult;

// ── Combat helpers ──────────────────────────────────────────────────────────────────────────────────────────────
const bm = (uid: string, cardId: string, over: Omit<Partial<BoardMinion>, 'keywords'> & { keywords?: string[] } = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { uid, sourceUid: uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as unknown as BoardMinion;
};
const wall = (attack: number, uid = 'w', health = 5000, keywords: string[] = []): BoardMinion => bm(uid, PLAIN[0]!, { attack, health, keywords }); // a vanilla body (the Target Dummy grows when hit)
const TRIBES2 = [...SETS.set2.tribes];
const fight = (p: BoardMinion[], e: BoardMinion[], mods: object, seed = 4, enemyMods: object = {}) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: TRIBES2, questMods: mods }), combatSide({ tier: 6, tribes: TRIBES2, questMods: enemyMods }));
const triggers = (evs: readonly CombatEvent[], flag: string, side?: string) => evs.filter((e) => e.type === 'questTrigger' && e.flag === flag && (!side || e.side === side));
type Buff = Extract<CombatEvent, { type: 'buff' }>;
const buffsFrom = (evs: readonly CombatEvent[], source: string) => evs.filter((e): e is Buff => e.type === 'buff' && e.source === source);
type Fight = ReturnType<typeof fight>;
type Dmg = Extract<CombatEvent, { type: 'dmg' }>;
/** The combat uid simulate gave the i-th input minion of a side (it renumbers every body). */
const cu = (r: Fight, side: 'player' | 'enemy', i: number): string => r.initial[side][i]!.uid;
/** Damage a side's minions LANDED this fight (the hits the Pummel meter counts). */
const landed = (r: Fight, side: 'player' | 'enemy'): number => {
  const mine = new Set(r.initial[side].map((m) => m.uid));
  return r.events.filter((e): e is Dmg => e.type === 'dmg' && !!e.source && mine.has(e.source)).reduce((t, e) => t + e.amount, 0);
};

describe('the nine runes as content', () => {
  it('names, costs, Basic pool, Set 2 only, no tribe gate, text verbatim', () => {
    const rows: [string, string, number, string][] = [
      ['rune_piggy_bank', 'Piggy Bank', 2, 'All unspent Gold carries over to next turn. **End of Turn:** give a minion **+1/+3**. Repeat for every unspent Gold.'],
      ['rune_hazard_pay', 'Hazard Pay', 0, 'After you lose a combat, gain **3 Gold** and a free Refresh.'],
      ['rune_second_opinion', 'Second Opinion', 3, 'Your **Discovers** offer **1** more option. **Discover** a minion.'],
      ['rune_shield_wall', 'Shield Wall', 2, '**Start of Combat:** give your **Taunt** minions **+4/+6**.'],
      ['rune_shatterproof', 'Shatterproof', 2, 'When a minion of yours loses **Ward**, give it **+5/+5** permanently.'],
      ['rune_warm_up', 'Warm-Up', 2, '**Pummel (150):** gain **2 Gold** next turn. Counts all your minions. Once per combat.'],
      ['rune_golden_handshake', 'Golden Handshake', 1, 'When you **Gild** a minion, give your minions **+2/+2**.'],
      ['rune_late_bloomer', 'Late Bloomer', 2, 'When you upgrade your Shop, gain **2 Gold** and give your minions **+3/+3**.'],
      ['rune_loyal_customer', 'Loyal Customer', 3, 'Every **4th** minion you buy is free.'],
    ];
    for (const [id, name, cost, text] of rows) {
      const r = RUNE_INDEX[id]!;
      expect([r.name, r.cost, r.text, r.sets, r.tribes]).toEqual([name, cost, text, ['set2'], undefined]);
      expect(RUNES.some((x) => x.id === id), `${id} is Basic`).toBe(true);
      expect(EPIC_RUNES.some((x) => x.id === id)).toBe(false);
      expect(r.text).not.toMatch(/—|--|Oath|climb/);
    }
  });
});

describe('PIGGY BANK: unspent Gold carries over; End of Turn +1/+3, repeated per unspent Gold', () => {
  it('the Gold left at End Turn opens next turn, uncapped, and the End of Turn ticks base + one per Gold', () => {
    let s = withRune(['rune_piggy_bank'], { board: [plain('a', 0), plain('b', 1)], embers: 4 });
    expect(runeTally(s, 'rune_piggy_bank')).toBe('×5');
    s = act(s, { type: 'faceOmen' });
    expect(s.bonusEmbersNextTurn).toBe(4);
    // 1 + 4 ticks of +1/+3, each on a random friendly.
    expect(boardSum(s, 'Piggy Bank')).toEqual({ attack: 5, health: 15 });
    s = act(s, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    expect(s.embers).toBe(s.maxEmbers + 4);
  });

  it('no cap: 25 unspent Gold carries 25', () => {
    let s = withRune(['rune_piggy_bank'], { board: [plain('a', 0)], embers: 25 });
    s = act(s, { type: 'faceOmen' });
    expect(s.bonusEmbersNextTurn).toBe(25);
    expect(boardSum(s, 'Piggy Bank')).toEqual({ attack: 26, health: 78 });
  });

  it('0 Gold left: one tick, nothing carried; an empty board still carries', () => {
    let s = withRune(['rune_piggy_bank'], { board: [plain('a', 0)], embers: 0 });
    s = act(s, { type: 'faceOmen' });
    expect(s.bonusEmbersNextTurn ?? 0).toBe(0);
    expect(boardSum(s, 'Piggy Bank')).toEqual({ attack: 1, health: 3 });
    let e = withRune(['rune_piggy_bank'], { board: [], embers: 3 });
    e = act(e, { type: 'faceOmen' });
    expect(e.bonusEmbersNextTurn).toBe(3);
  });

  it('without the rune nothing carries', () => {
    let s = withRune([], { board: [plain('a', 0)], embers: 6 });
    s = act(s, { type: 'faceOmen' });
    expect(s.bonusEmbersNextTurn ?? 0).toBe(0);
  });
});

describe('HAZARD PAY: after a lost combat, 3 Gold and a free Refresh', () => {
  const settle = (s: RunState, result: CombatResult): RunState => act({ ...s, phase: 'combat', lastCombat: result, combatSettled: false }, { type: 'resolveCombat' });
  it('a loss opens the next Shop with +3 Gold and a free Refresh, on its own Start of Turn beat', () => {
    const s = withRune(['rune_hazard_pay'], { freeRolls: 0, resolve: 40 });
    const after = settle(s, lostFight());
    expect(after.embers).toBe(after.maxEmbers + 3);
    expect(after.freeRolls).toBe(1);
    expect((after.sotBeatFx ?? []).some((b) => b.source.kind === 'rune' && b.source.id === 'rune_hazard_pay')).toBe(true);
  });
  it('a win or a draw pays nothing', () => {
    for (const result of ['win', 'draw'] as const) {
      const after = settle(withRune(['rune_hazard_pay'], { freeRolls: 0 }), lostFight({ result }));
      expect(after.embers).toBe(after.maxEmbers);
      expect(after.freeRolls).toBe(0);
    }
  });
  it('two copies pay twice', () => {
    const after = settle(withRune(['rune_hazard_pay', 'rune_hazard_pay'], { freeRolls: 0, resolve: 40 }), lostFight());
    expect(after.embers).toBe(after.maxEmbers + 6);
    expect(after.freeRolls).toBe(2);
  });
});

describe('SECOND OPINION: Discovers offer 1 more option; Discover a minion', () => {
  it('taking it opens ONE minion Discover from the Shop Tier, already with 4 options', () => {
    let s = createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2');
    s = { ...s, tribes: [...SETS.set2.tribes], wave: 7, tier: 4, phase: 'recruit', embers: 60, hand: [], board: [], pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])) } as RunState;
    s = act({ ...s, runeforgeOffer: ['rune_second_opinion'], runeforgeEpic: false }, { type: 'buyRune', index: 0 });
    expect(s.discover).toHaveLength(4);
    expect(s.discover!.every((id) => CARD_INDEX[id]!.tier === 4 && !CARD_INDEX[id]!.spell)).toBe(true);
    s = act(s, { type: 'discover', index: 3 });
    expect(s.hand).toHaveLength(1);
    expect(s.discover).toBeUndefined();
  });
  it('every later Discover (minion, spell) offers 4; without the rune 3; two copies 5', () => {
    const count = (s: RunState, kind: 'minion' | 'spell'): number => {
      const t = { ...s, discover: undefined, discoverQueue: undefined } as RunState;
      if (kind === 'spell') offerSpellDiscover(t); else queueDiscover(t, { kind: 'minion', tier: 4 });
      return t.discover!.length;
    };
    const one = withRune(['rune_second_opinion']);
    expect(discoverOptionCount(one)).toBe(4);
    expect(count(one, 'minion')).toBe(4);
    expect(count(one, 'spell')).toBe(4);
    const none = withRune([]);
    expect(count(none, 'minion')).toBe(3);
    expect(count(withRune(['rune_second_opinion', 'rune_second_opinion']), 'minion')).toBe(5);
  });
});

describe('SHIELD WALL: Start of Combat, your Taunt minions +4/+6', () => {
  it('buffs every living friendly Taunt (not the rest), a combat buff, with a badge pulse', () => {
    const r = fight([wall(1, 't1', 50, ['T']), wall(1, 'n', 50), wall(1, 't2', 50, ['T'])], [wall(0, 'e', 5000)], { runeShieldWall: true });
    const b = buffsFrom(r.events, 'Shield Wall');
    expect(b.map((x) => [x.target, x.attack, x.health])).toEqual([[cu(r, 'player', 0), 4, 6], [cu(r, 'player', 2), 4, 6]]);
    expect(triggers(r.events, 'runeShieldWall', 'player')).toHaveLength(1);
    expect(r.playerPermaBuffs ?? []).toEqual([]);
  });
  it('the enemy side holding it is symmetric; no Taunt = no fire; Twilight repeats it; copies stack', () => {
    const r = fight([wall(0, 'p', 5000)], [wall(1, 'et', 50, ['T'])], {}, 4, { runeShieldWall: true });
    expect(buffsFrom(r.events, 'Shield Wall').map((x) => x.target)).toEqual([cu(r, 'enemy', 0)]);
    expect(triggers(r.events, 'runeShieldWall', 'enemy')).toHaveLength(1);
    expect(triggers(fight([wall(1, 'n', 50)], [wall(0)], { runeShieldWall: true }).events, 'runeShieldWall')).toHaveLength(0);
    const tw = fight([wall(1, 't', 50, ['T'])], [wall(0)], { runeShieldWall: true, runeTwilight: true });
    expect(buffsFrom(tw.events, 'Shield Wall').length).toBeGreaterThanOrEqual(2);
    const two = fight([wall(1, 't', 50, ['T'])], [wall(0)], { runeShieldWall: true, flagCopies: { runeShieldWall: 2 } });
    expect(buffsFrom(two.events, 'Shield Wall').map((x) => [x.attack, x.health])).toEqual([[8, 12]]);
  });
  it('Combat Prowess replays it in the Shop: Taunt minions +4/+6, permanent there', () => {
    const s = withRune(['rune_shield_wall'], { board: [plain('t', 0, { keywords: ['T'] }), plain('n', 1)] });
    const replay = socRuneReplaysOf(s).find((x) => x.id === 'rune_shield_wall');
    expect(replay).toBeDefined();
    replay!.fire(s);
    expect(sumFrom(s.board[0]!, 'Shield Wall')).toEqual({ attack: 4, health: 6 });
    expect(sumFrom(s.board[1]!, 'Shield Wall')).toEqual({ attack: 0, health: 0 });
  });
});

describe('SHATTERPROOF: a Ward loss gives that minion +5/+5 permanently', () => {
  it('every friendly Ward loss pays (no cap), and it rides home as a permanent gain', () => {
    const r = fight([wall(1, 'a', 60, ['DS']), wall(1, 'b', 60, ['DS'])], [wall(4, 'e', 5000)], { runeShatterproof: true });
    const b = buffsFrom(r.events, 'Shatterproof');
    expect(b.map((x) => x.target).sort()).toEqual([cu(r, 'player', 0), cu(r, 'player', 1)].sort());
    expect(b.every((x) => x.attack === 5 && x.health === 5)).toBe(true);
    expect(triggers(r.events, 'runeShatterproof', 'player')).toHaveLength(2);
    const home = (r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'a' || p.sourceUid === 'b');
    expect(home.reduce((t, p) => t + p.attack, 0)).toBe(10);
    expect(home.reduce((t, p) => t + p.health, 0)).toBe(10);
  });
  it('an enemy that holds it is symmetric; the enemy losing Ward does not pay the player', () => {
    const r = fight([wall(4, 'p', 5000)], [wall(1, 'e', 60, ['DS'])], { runeShatterproof: true }, 4, { runeShatterproof: true });
    expect(triggers(r.events, 'runeShatterproof', 'enemy')).toHaveLength(1);
    expect(triggers(r.events, 'runeShatterproof', 'player')).toHaveLength(0);
    expect((r.enemyCarry?.permaBuffs ?? []).reduce((t, p) => t + p.attack, 0)).toBe(5);
  });
  it('a re-formed Ward that breaks again pays again (Unbroken Scales on a Dragon)', () => {
    const drag = Object.values(CARD_INDEX).find((c) => c.tribe === 'dragon' && !c.spell && !c.token && c.effects.length === 0)!;
    const r = fight([bm('d', drag.id, { attack: 1, health: 80, keywords: ['DS'] })], [wall(4, 'e', 5000)], { runeShatterproof: true, runeUnbrokenScales: true });
    expect(triggers(r.events, 'runeShatterproof', 'player').length).toBe(3); // the printed Ward + 2 re-forms
  });
});

describe('WARM-UP: a side-wide Pummel (150), 2 Gold next turn, once per combat', () => {
  it('the first crossing this fight banks 2 Gold; later crossings are spent; the lifetime tally rides home', () => {
    const r = fight([wall(20, 'a', 5000), wall(15, 'b', 5000)], [wall(0, 'e', 50000)], { runeWarmUp: true, runeWarmUpDealt: 140 });
    expect(r.playerBonusGold).toBe(2);
    expect(triggers(r.events, 'runeWarmUp', 'player')).toHaveLength(1);
    const dealt = landed(r, 'player');
    expect(dealt).toBeGreaterThan(300);
    expect(r.playerShoutCarry?.warmUpDealt).toBe(140 + dealt);
  });
  it('below the next multiple: nothing; enemy side symmetric; copies double; Heavy Hand doubles the tally', () => {
    const short = fight([wall(5, 'a', 5000)], [wall(0, 'e', 9)], { runeWarmUp: true, runeWarmUpDealt: 0 });
    expect(short.playerBonusGold ?? 0).toBe(0);
    const en = fight([wall(0, 'p', 50000)], [wall(30, 'e', 5000)], {}, 4, { runeWarmUp: true });
    expect(en.enemyCarry?.bonusGold).toBe(2);
    expect(triggers(en.events, 'runeWarmUp', 'enemy')).toHaveLength(1);
    const two = fight([wall(20, 'a', 5000)], [wall(0, 'e', 50000)], { runeWarmUp: true, flagCopies: { runeWarmUp: 2 } });
    expect(two.playerBonusGold).toBe(4);
    const heavy = fight([wall(10, 'a', 5000)], [wall(0, 'e', 25)], { runeWarmUp: true, runeHeavyHand: true });
    expect(heavy.playerShoutCarry?.warmUpDealt).toBe(2 * landed(heavy, 'player')); // every landed point counted double
  });
  it('the run seeds the fight and settle writes the tally back; the badge reads N/150', () => {
    let s = withRune(['rune_warm_up'], { runeWarmUpDealt: 77 });
    expect(questCombatMods(s).runeWarmUpDealt).toBe(77);
    expect(runeTally(s, 'rune_warm_up')).toBe('77/150');
    s = act({ ...s, phase: 'combat', lastCombat: lostFight({ result: 'win', playerShoutCarry: { warmUpDealt: 222 } }), combatSettled: false }, { type: 'resolveCombat' });
    expect(s.runeWarmUpDealt).toBe(222);
    expect(runeTally(s, 'rune_warm_up')).toBe('72/150');
  });
});

describe('GOLDEN HANDSHAKE: a Gild gives your minions +2/+2', () => {
  it('Shop: a Gild effect (the one chokepoint) gives the board +2/+2, permanently; two copies +4/+4', () => {
    const s = withRune(['rune_golden_handshake'], { board: [plain('a', 0), plain('b', 1)] });
    gildMinion(s.board[0]!, s);
    expect(s.board[0]!.golden).toBe(true);
    for (const c of s.board) expect(sumFrom(c, 'Golden Handshake')).toEqual({ attack: 2, health: 2 });
    const two = withRune(['rune_golden_handshake', 'rune_golden_handshake'], { board: [plain('a', 0)] });
    gildMinion(two.board[0]!, two);
    expect(sumFrom(two.board[0]!, 'Golden Handshake')).toEqual({ attack: 4, health: 4 });
  });
  it('Shop: a triple is a Gild', () => {
    const id = PLAIN[1]!;
    let s = withRune(['rune_golden_handshake'], { board: [plain('x', 0), body('c1', id), body('c2', id)], shop: [{ uid: 'o', cardId: id }] });
    s = act(s, { type: 'buy', uid: 'o' });
    expect(s.hand.some((c) => c.cardId === id && c.golden)).toBe(true);
    expect(sumFrom(s.board.find((c) => c.uid === 'x')!, 'Golden Handshake')).toEqual({ attack: 2, health: 2 });
  });
  it('without the rune nothing', () => {
    const s = withRune([], { board: [plain('a', 0), plain('b', 1)] });
    gildMinion(s.board[0]!, s);
    expect(sumFrom(s.board[1]!, 'Golden Handshake')).toEqual({ attack: 0, health: 0 });
  });
  it('combat: a combat Gild (Ancient of Time) gives that side +2/+2 for the fight, either side', () => {
    const r = fight([wall(1, 'a', 50), wall(1, 'b', 50)], [wall(0)], { ancientTimeGild: { label: 'Ancient of Time' }, runeGoldenHandshake: true });
    expect(buffsFrom(r.events, 'Golden Handshake').map((x) => [x.target, x.attack, x.health])).toEqual([[cu(r, 'player', 0), 2, 2], [cu(r, 'player', 1), 2, 2]]);
    expect(triggers(r.events, 'runeGoldenHandshake', 'player')).toHaveLength(1);
    const en = fight([wall(0)], [wall(1, 'x', 50)], {}, 4, { ancientTimeGild: { label: 'Ancient of Time' }, runeGoldenHandshake: true });
    expect(buffsFrom(en.events, 'Golden Handshake').map((x) => x.target)).toEqual([cu(en, 'enemy', 0)]);
    const off = fight([wall(1, 'a', 50)], [wall(0)], { ancientTimeGild: { label: 'Ancient of Time' } });
    expect(buffsFrom(off.events, 'Golden Handshake')).toHaveLength(0);
  });
});

describe('LATE BLOOMER: a Shop upgrade gains 2 Gold and gives your minions +3/+3', () => {
  it('a paid upgrade pays 2 Gold and +3/+3 to every board minion, permanently; copies stack', () => {
    let s = withRune(['rune_late_bloomer'], { board: [plain('a', 0), plain('b', 1)], tier: 2, upgradeCost: 5, embers: 10 });
    s = act(s, { type: 'upgrade' });
    expect(s.tier).toBe(3);
    expect(s.embers).toBe(10 - 5 + 2);
    expect(boardSum(s, 'Late Bloomer')).toEqual({ attack: 6, health: 6 });
    let two = withRune(['rune_late_bloomer', 'rune_late_bloomer'], { board: [plain('a', 0)], tier: 2, upgradeCost: 5, embers: 10 });
    two = act(two, { type: 'upgrade' });
    expect(two.embers).toBe(9);
    expect(boardSum(two, 'Late Bloomer')).toEqual({ attack: 6, health: 6 });
  });
  it('without the rune: no Gold, no stats', () => {
    let s = withRune([], { board: [plain('a', 0)], tier: 2, upgradeCost: 5, embers: 10 });
    s = act(s, { type: 'upgrade' });
    expect(s.embers).toBe(5);
    expect(boardSum(s, 'Late Bloomer')).toEqual({ attack: 0, health: 0 });
  });
});

describe('LOYAL CUSTOMER: every 4th minion you buy is free', () => {
  const shopOf = (n: number) => Array.from({ length: n }, (_, i) => ({ uid: `o${i}`, cardId: PLAIN[0]! }));
  it('buys 1-3 pay, the 4th costs 0 (shown and charged), the 8th again; the badge counts N/4', () => {
    let s = withRune(['rune_loyal_customer'], { shop: shopOf(8), embers: 100, hand: [] });
    const paid: number[] = [];
    for (let i = 0; i < 8; i++) {
      const offer = s.shop.find((o) => o.uid === `o${i}`)!;
      const shown = offerBuyPrice(s, offer).cost;
      const before = s.embers;
      s = act(s, { type: 'buy', uid: offer.uid });
      expect(before - s.embers, 'the coin shows what the buy charges').toBe(shown);
      paid.push(before - s.embers);
      s = { ...s, hand: [], board: [] }; // never three copies: no triple
    }
    expect(paid).toEqual([3, 3, 3, 0, 3, 3, 3, 0]);
    expect(runeTally(s, 'rune_loyal_customer')).toBe('0/4');
  });
  it('a buy already free for another reason still counts; a duplicate is a sweetener; no rune, no free buy', () => {
    expect(RUNE_DUP_SWEETENER.has('rune_loyal_customer')).toBe(true);
    let s = withRune(['rune_loyal_customer'], { shop: shopOf(2), embers: 100, nextCardFree: 1 });
    s = act(s, { type: 'buy', uid: 'o0' });
    expect(s.loyalCustomerBuys).toBe(1);
    expect(runeTally(s, 'rune_loyal_customer')).toBe('1/4');
    let n = withRune([], { shop: shopOf(4), embers: 100 });
    for (let i = 0; i < 4; i++) { n = act(n, { type: 'buy', uid: `o${i}` }); n = { ...n, hand: [] }; }
    expect(n.embers).toBe(100 - 12);
  });
});
