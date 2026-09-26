/**
 * ANCIENTS × the AUCTIONEER (hero id `myra`; owner pairings 2026-09-26). Pulse: "Trigger a friendly minion's
 * Shout." (free, once per turn). Each pairing in the phase(s) it fires in, with real-time ordering where it matters.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, activePowers, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { hasBattlecry } from './recruit';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** Effect-less bodies, one card per uid letter so no two ever form a triple. */
const VANILLA: Record<string, string> = { a: 'hm_test_squire', b: 'n2_spellsword', v: 'k3_forkvein', r: 'k3_splitpick' };
const pup = (uid: string, attack: number, health: number): BoardCard => card(uid, VANILLA[uid]!, { attack, health, keywords: [] });
/** A plain Dragon (no effects) — Cleric's Shout ("give your other Dragons +3/+3") lands on it, so it counts fires. */
const drake = (uid: string, attack = 1, health = 50): BoardCard => card(uid, 'whelpling', { attack, health });
/** Cleric: "Shout: give your other Dragons +3/+3" — a combat-meaningful Shout. */
const cleric = (uid = 'c', extra: Partial<BoardCard> = {}): BoardCard => card(uid, 'cleric', { attack: 1, health: 50, ...extra });
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'myra'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const foes = (wave: number, attack: number, health: number, n = 1): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health * n,
  minions: Array.from({ length: n }, () => ({ cardId: 'sandbag', attack, health, keywords: [] })), seed: 1, origin: 'self',
});
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
/** The combat uid of the player's i-th starting minion. */
const cuid = (s: RunState, i: number): string => s.lastCombat!.initial.player[i]!.uid;

describe('Auctioneer × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('myra', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('myra', id)).not.toMatch(/—|--/);
    }
  });
});

describe('Auctioneer × DEATH — Pulse triggers the Shout one more time, then destroys the minion', () => {
  it('the Shout fires twice, then the target is destroyed; the charge is spent', () => {
    let s = picked('death', { board: [drake('w'), cleric()] });
    s = reduce(s, { type: 'heroPower', uid: 'c' });
    expect([at(s, 'w').attack, at(s, 'w').health]).toEqual([1 + 6, 50 + 6]); // two fires of +3/+3
    expect(s.board.some((c) => c.uid === 'c'), 'destroyed').toBe(false);
    expect(s.heroReady).toBe(false);
  });

  it('the destroy is a REAL shop death: a Rebirth target comes back', () => {
    let s = picked('death', { board: [drake('w'), cleric('c', { keywords: ['RB'] })] });
    s = reduce(s, { type: 'heroPower', uid: 'c' });
    const back = s.board.find((c) => c.cardId === 'cleric');
    expect(back, 'returned by Rebirth').toBeDefined();
    expect(back!.keywords).not.toContain('RB');
  });

  it('a minion with no Shout cannot be Pulsed (nothing happens, nothing spent)', () => {
    const s = picked('death', { board: [drake('w'), pup('a', 1, 1)] });
    expect(reduce(s, { type: 'heroPower', uid: 'a' })).toBe(s);
  });

  it('prints the replaced power', () => {
    expect(heroPowerText(picked('death'))).toBe("Trigger a friendly minion's **Shout** twice, then destroy it.");
  });
});

describe('Auctioneer × FORTUNE — every Shop Shout banks 1 Gold for next turn', () => {
  it('a Pulse is a Shop Shout: +1 next turn, and the power text prints the live amount banked', () => {
    let s = picked('fortune', { board: [cleric()] });
    const bank0 = s.bonusEmbersNextTurn ?? 0;
    expect(heroPowerText(s)).toContain('**0 Gold** banked this turn');
    s = reduce(s, { type: 'heroPower', uid: 'c' });
    expect((s.bonusEmbersNextTurn ?? 0) - bank0).toBe(1);
    expect(heroPowerText(s)).toContain('**1 Gold** banked this turn');
  });

  it('a Shout PLAYED from hand counts too, in real time', () => {
    let s = picked('fortune', { board: [], hand: [cleric('h')] });
    const bank0 = s.bonusEmbersNextTurn ?? 0;
    s = reduce(s, { type: 'play', uid: 'h', toIndex: 0 });
    expect(s.board.some((c) => c.uid === 'h')).toBe(true);
    expect((s.bonusEmbersNextTurn ?? 0) - bank0).toBe(1);
  });

  it('the Gold arrives next turn', () => {
    let s = picked('fortune', { board: [cleric()] });
    s = reduce(s, { type: 'heroPower', uid: 'c' });
    const withF = reduce(fightNow(s), { type: 'resolveCombat' });
    let t = picked('war', { board: [cleric()] }); // same Pulse, no Fortune
    t = reduce(t, { type: 'heroPower', uid: 'c' });
    t = { ...t, board: t.board.map((c) => ({ ...c, grantedEffects: undefined, keywords: c.keywords.filter((k) => k !== 'RL') })) };
    const without = reduce(fightNow(t), { type: 'resolveCombat' });
    expect(withF.embers - without.embers).toBe(1);
  });

  it('COMBAT Shouts do not count (the text says Shop phase)', () => {
    // A cleric carrying the War graft re-fires its Shout on every attack in the fight.
    let s = picked('fortune', { board: [cleric('c', { keywords: ['RL'], grantedEffects: [{ on: 'onAttack', do: 'rallyTriggerOwnShout', params: {} }] })] });
    const bank0 = s.bonusEmbersNextTurn ?? 0;
    s = fightNow(s);
    expect(events(s).some((e) => e.type === 'shout')).toBe(true);
    expect(s.bonusEmbersNextTurn ?? 0).toBe(bank0);
    expect(s.ancients!.shoutGold).toBeUndefined();
  });
});

describe('Auctioneer × WAR — the Pulsed minion gains "Rally: trigger this minion\'s Shout"', () => {
  it('Pulse still fires the Shout, and the target gains the Rally keyword + the grafted Rally (once, never stacked)', () => {
    let s = picked('war', { board: [drake('w'), cleric()] });
    s = reduce(s, { type: 'heroPower', uid: 'c' });
    expect(at(s, 'w').attack).toBe(1 + 3);
    expect(at(s, 'c').keywords).toContain('RL');
    expect(at(s, 'c').grantedEffects?.filter((e) => e.do === 'rallyTriggerOwnShout')).toHaveLength(1);
    s = reduce({ ...s, heroReady: true }, { type: 'heroPower', uid: 'c' });
    expect(at(s, 'c').grantedEffects?.filter((e) => e.do === 'rallyTriggerOwnShout')).toHaveLength(1);
    expect(heroPowerText(s)).toContain('**Rally:** trigger this minion');
  });

  it('COMBAT: every time it attacks, its Shout fires right then (a counted shout event, then the buff)', () => {
    let s = picked('war', { board: [cleric(), drake('w', 0, 400)] });
    s = reduce(s, { type: 'heroPower', uid: 'c' });
    const w0 = at(s, 'w').attack;
    s = fightNow(s);
    const c = cuid(s, 0), w = cuid(s, 1);
    expect(s.lastCombat!.initial.player[0]!.grantedRallyShout, 'the combat card knows it carries the Rally').toBe(true);
    const ev = events(s);
    const swings = ev.flatMap((e, i) => (e.type === 'attack' && e.attacker === c ? [i] : []));
    expect(swings.length).toBeGreaterThanOrEqual(2);
    for (const i of swings) {
      const next = ev.findIndex((e, j) => j > i && e.type === 'attack');
      const window = ev.slice(i, next < 0 ? undefined : next);
      expect(window.some((e) => e.type === 'shout' && e.target === c), 'a Shout per swing').toBe(true);
      expect(window.some((e) => e.type === 'buff' && e.target === w && e.attack === 3), 'its buff lands in the same swing').toBe(true);
    }
    expect(w0).toBe(3); // shop Pulse: +3/+3
  });

  it('the graft is permanent: it survives the fight on the run card', () => {
    let s = picked('war', { board: [cleric()] });
    s = reduce(s, { type: 'heroPower', uid: 'c' });
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(at(s, 'c').grantedEffects?.some((e) => e.do === 'rallyTriggerOwnShout')).toBe(true);
  });
});

describe('Auctioneer × GENESIS — Pulse becomes: 2 Gold, Discover a Shout minion', () => {
  it('the power is untargeted and costs 2 Gold', () => {
    const s = picked('genesis');
    const p = activePowers(s)[0]!;
    expect([p.untargeted, p.cost, p.passive]).toEqual([true, 2, undefined]);
    expect(heroPowerText(s)).toBe('**Discover** a **Shout** minion.');
  });

  it('opens a Discover of Shout minions at your tier or below, charging 2 Gold, once per turn', () => {
    let s = picked('genesis', { tier: 3 });
    const gold = s.embers;
    s = reduce(s, { type: 'heroPower' });
    expect(s.embers).toBe(gold - 2);
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) {
      const d = CARD_INDEX[id]!;
      expect(hasBattlecry(d), id).toBe(true);
      expect(d.tier).toBeLessThanOrEqual(3);
    }
    expect(s.heroReady).toBe(false);
  });

  it('cannot be used without 2 Gold', () => {
    const s = picked('genesis', { embers: 1 });
    expect(reduce(s, { type: 'heroPower' })).toBe(s);
  });
});

describe('Auctioneer × TIME — passive; Start of Combat triggers the left-most and right-most Shouts', () => {
  it('the power is passive and cannot be activated', () => {
    const s = picked('time', { board: [cleric()] });
    expect(activePowers(s)[0]!.passive).toBe(true);
    expect(reduce(s, { type: 'heroPower', uid: 'c' })).toBe(s);
  });

  it('two Shout minions: both fire at Start of Combat (before the first attack); the one between them does not', () => {
    // cleric (the left-most Shout) · whelpling · Pimm (the right-most Shout) · a pup on the far right (no Shout)
    let s = picked('time', { board: [cleric('c'), drake('w', 0, 400), card('p', 'dw_pimm', { attack: 0, health: 50 }), pup('a', 0, 50)] });
    s = fightNow(s);
    const ev = events(s);
    const first = ev.findIndex((e) => e.type === 'attack');
    const soc = ev.slice(0, first);
    const shouts = soc.filter((e): e is Extract<CombatEvent, { type: 'shout' }> => e.type === 'shout').map((e) => e.target);
    expect(shouts).toEqual([cuid(s, 0), cuid(s, 2)]);
    expect(soc.some((e) => e.type === 'buff' && e.target === cuid(s, 1) && e.attack === 3), "the cleric's Shout landed at SoC").toBe(true);
  });

  it('only one Shout minion: it fires once', () => {
    let s = picked('time', { board: [pup('a', 0, 50), cleric('c'), drake('w', 0, 400)] });
    s = fightNow(s);
    const ev = events(s);
    const first = ev.findIndex((e) => e.type === 'attack');
    expect(ev.slice(0, first).filter((e) => e.type === 'shout').map((e) => (e as { target: string }).target)).toEqual([cuid(s, 1)]);
  });

  it('threads its mod only while Time is picked', () => {
    expect(ancientCombatMods(picked('time')).ancientEdgeShouts).toBeDefined();
    expect(ancientCombatMods(picked('war')).ancientEdgeShouts).toBeUndefined();
  });
});

describe('Auctioneer × TIME in REAL TIME — a Start-of-Combat Tidebud Shout pays the hand DURING the fight (R-REALTIME-01)', () => {
  it('the hand Spirit grows at Start of Combat (a live handBuff), the board Spirit too, and settle pays the hand exactly once', () => {
    const tb = (uid: string): BoardCard => card(uid, 'sp3_tidebud', { attack: 2, health: 3, keywords: [] });
    let s = picked('time', { board: [tb('t'), card('k', 'sp3_tidebud', { attack: 2, health: 3, keywords: [] })], hand: [card('h', 'sp3_flamereveler', { attack: 4, health: 3, keywords: [] })] });
    s = fightNow(s);
    const ev = events(s);
    const firstAttack = ev.findIndex((e) => e.type === 'attack');
    const hb = ev.findIndex((e) => e.type === 'handBuff' && e.side === 'player' && e.uid === 'h');
    expect(hb, 'the hand buff fires in the fight').toBeGreaterThanOrEqual(0);
    expect(hb, 'at Start of Combat, before any attack').toBeLessThan(firstAttack);
    const boardBuffs = ev.slice(0, firstAttack).filter((e) => e.type === 'buff' && e.health === 2);
    expect(boardBuffs.length, 'each edge Shout buffs the OTHER board Spirit').toBe(2);
    s = reduce(s, { type: 'resolveCombat' });
    // Two edge Shouts, each gives the only hand Spirit +2 Health: 3 + 2 + 2, paid once (never replayed at settle).
    expect(s.hand.find((c) => c.uid === 'h')!.health).toBe(7);
  });
});

describe('Auctioneer × BONDS — a Shout gives the minions next to it +4/+3', () => {
  it('SHOP: Pulse buffs both neighbours +4/+3, permanently, per fire', () => {
    let s = picked('bonds', { board: [pup('a', 1, 1), cleric(), pup('b', 1, 1), pup('v', 1, 1)] });
    s = reduce(s, { type: 'heroPower', uid: 'c' });
    expect([at(s, 'a').attack, at(s, 'a').health]).toEqual([5, 4]);
    expect([at(s, 'b').attack, at(s, 'b').health]).toEqual([5, 4]);
    expect([at(s, 'v').attack, at(s, 'v').health], 'not adjacent').toEqual([1, 1]);
    expect([at(s, 'c').attack, at(s, 'c').health], 'not itself').toEqual([1, 50]);
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(at(s, 'a').attack, 'permanent').toBe(5);
  });

  it('SHOP: a Shout played from hand buffs its new neighbours', () => {
    let s = picked('bonds', { board: [pup('a', 1, 1), pup('b', 1, 1)], hand: [cleric('h')] });
    s = reduce(s, { type: 'play', uid: 'h', toIndex: 1 });
    expect(s.board.map((c) => c.uid)).toEqual(['a', 'h', 'b']);
    expect([at(s, 'a').attack, at(s, 'b').attack]).toEqual([5, 5]);
  });

  it('COMBAT: the buff lands right after the Shout, on its living neighbours', () => {
    let s = picked('bonds', { board: [pup('a', 0, 200), cleric('c', { keywords: ['RL'], grantedEffects: [{ on: 'onAttack', do: 'rallyTriggerOwnShout', params: {} }] }), pup('b', 0, 200)] });
    s = fightNow(s);
    const ev = events(s);
    const c = cuid(s, 1);
    const shout = ev.findIndex((e) => e.type === 'shout' && e.target === c);
    expect(shout).toBeGreaterThanOrEqual(0);
    const after = ev.slice(shout + 1, shout + 4).filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff');
    expect(after.map((e) => [e.target, e.attack, e.health, e.source]).sort()).toEqual(
      [[cuid(s, 0), 4, 3, 'Ancient of Bonds'], [cuid(s, 2), 4, 3, 'Ancient of Bonds']].sort(),
    );
  });

  it('threads its mod into the fight', () => {
    expect(ancientCombatMods(picked('bonds')).ancientShoutAdjacent).toEqual({ attack: 4, health: 3, label: 'Ancient of Bonds' });
  });
});
