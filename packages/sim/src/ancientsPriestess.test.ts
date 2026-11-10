/**
 * ANCIENTS × PRIESTESS (Duos only; owner pairings 2026-11-10, R-ANCPRIESTESS-01..06). Passaria (2 Gold, targeted, once
 * per turn): "Pass a non-Gilded minion in the Shop or on your board." Every pairing through the real reducer on two
 * teammates' runs (the sender's outbox entry travels as `duosWireOf` and lands through `receivePass`, as the Versus
 * store ships it), and the combat half through the simulator.
 *
 * Ancients are not on in any Duos game players can reach: each run here is built with `createVersusRun`'s dev seam.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, ANCIENT_PAIRINGS, activePowers, ancientCombatMods, ancientOfferText, ancientPassesThisTurn, deserialize, heroPowerText, reduce, serialize,
  type AncientId, type BoardCard, type RunState, type ShopCard,
} from './index';
import { powerDiscoverPool } from './heroes';
import { createVersusRun, buildVersusCandidate, legalModalAnswers, versusAutoResolve } from './versus/run';
import type { VersusRoomOptions } from './versus/options';
import { duosWaitingCount, duosWireOf } from './duosPass';
import { handCap } from './state';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };
const BASE = '**Pass** a **non-Gilded** minion in the Shop or on your board.';

const minions = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby).map((c) => c!);
/** A minion with an Echo and neither Rise nor Taunt printed, and plain minions with no effects at all. */
const ECHO = minions.find((c) => c.effects.some((e) => e.on === 'onDeath') && c.effects.length === 1 && !c.keywords.includes('R') && c.tier <= 3)!.id;
const PLAIN = minions.filter((c) => c.effects.length === 0 && c.keywords.length === 0 && c.tier <= 2).map((c) => c.id);

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}, ancients = true): RunState =>
  ({ ...createVersusRun(11, 'priestess', 'set2', DUOS, 'warden', ancients ? { ancients: true } : undefined), phase: 'recruit', embers: 20, heroReady: true, hand: [], board: [], shop: [], spell: null, ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = base(over);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const mate = (over: Partial<RunState> = {}): RunState =>
  ({ ...createVersusRun(12, 'warden', 'set2', DUOS, 'priestess'), phase: 'recruit', embers: 10, hand: [], board: [], shop: [], spell: null, ...over } as RunState);
/** Ship every outbox entry from `since` on to the teammate's run, as the Versus store does. */
function ship(from: RunState, to: RunState, since = 0): RunState {
  let out = to;
  for (const e of from.duos!.outbox.slice(since)) out = reduce(out, { type: 'receivePass', from: 'p1', seq: e.seq, card: duosWireOf(e) });
  return out;
}
const passaria = (s: RunState, uid: string): RunState => reduce(s, { type: 'heroPower', uid });
const drag = (s: RunState, uid: string): RunState => reduce(s, { type: 'passCard', uid });
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const last = (s: RunState) => s.duos!.outbox[s.duos!.outbox.length - 1]!;
const fullHand = (): BoardCard[] => minions.filter((c) => c.tier <= 2 && !PLAIN.slice(0, 3).includes(c.id) && c.id !== ECHO).slice(0, 10).map((c, i) => card(`h${i}`, c.id));

describe('Priestess × every Ancient has a written pairing', () => {
  it('all six are written, in plain words: no em dash, no "Oath" or "climb", "Gold" spelled out', () => {
    for (const id of ANCIENT_IDS) {
      const p = ANCIENT_PAIRINGS.priestess![id]!;
      expect(ancientOfferText('priestess', id)).not.toBe('Not written yet.');
      for (const t of [p.offerText, p.powerText]) {
        expect(t).not.toMatch(/—|--|Oath|climb/i);
        expect(t).not.toMatch(/\d\s?g\b/);
      }
    }
  });

  it('Passaria is never a power Mimic, Void or Power Shifter can take, so no other hero meets these pairings', () => {
    expect(powerDiscoverPool('mimic')).not.toContain('priestess');
    expect(powerDiscoverPool('void')).not.toContain('priestess');
  });
});

describe('the seam: Ancients reach a Duos run only through createVersusRun\'s dev argument', () => {
  it('no dev argument: the run has no Ancients, byte for byte the run of before', () => {
    const plain = createVersusRun(11, 'priestess', 'set2', DUOS, 'warden');
    expect(plain.ancientsEnabled).toBeUndefined();
    expect(plain.ancients).toBeUndefined();
    expect(serialize(createVersusRun(11, 'priestess', 'set2', DUOS, 'warden', undefined))).toBe(serialize(plain));
    expect(serialize(createVersusRun(11, 'priestess', 'set2', DUOS, 'warden', {}))).toBe(serialize(plain));
  });

  it('the dev argument turns them on for a Duos run only, with the Scene Builder\'s meter', () => {
    const on = createVersusRun(11, 'priestess', 'set2', DUOS, 'warden', { ancients: true });
    expect(on.ancientsEnabled).toBe(true);
    expect(on.ancients).toEqual({ points: 0, cost: 16, refresh: 1, combat: 2 });
    expect(createVersusRun(11, 'priestess', 'set2', DUOS, 'warden', { ancients: { cost: 1 } }).ancients!.cost).toBe(1);
    // Everything else about the run is the run of before.
    const { ancientsEnabled: _e, ancients: _a, ...rest } = on;
    void _e; void _a;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(createVersusRun(11, 'priestess', 'set2', DUOS, 'warden')));
    // Never outside a team mode.
    expect(createVersusRun(11, 'indy', 'set2', { v: 1, mode: 'duel', modifiers: [] }, null, { ancients: true }).ancients).toBeUndefined();
  });

  it('a Duos game without Ancients is untouched: the same passes make the same bytes, with nothing new on the wire', () => {
    const play = (): RunState => {
      let s = base({ board: [card('e', ECHO), card('p', PLAIN[0]!)], hand: [card('h', PLAIN[1]!)] }, false);
      s = passaria(s, 'e');
      return drag(s, 'h');
    };
    const s = play();
    expect(serialize(s)).toBe(serialize(play()));
    for (const e of s.duos!.outbox) {
      expect(Object.keys(e).filter((k) => ['ancRise', 'bonds', 'copyUid', 'copies'].includes(k))).toEqual([]);
      expect(Object.keys(duosWireOf(e)).filter((k) => k === 'passBonds' || k === 'passCopies')).toEqual([]);
      expect(e.card.keywords).not.toContain('R');
    }
    expect(s.embers).toBe(20 - 2 - 1);
    expect(heroPowerText(s)).toBe(BASE);
  });

  it('the awakening offer in a timed match: the Shop waits for the pick, and a timeout picks for you (a seeded legal pick)', () => {
    let s = base({ board: [card('p', PLAIN[0]!)], embers: 20 });
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost - 1 } };
    s = reduce(s, { type: 'roll' }); // the Refresh that fills the meter
    const offer = s.ancients!.offer!;
    expect(offer).toHaveLength(3);
    expect(reduce(s, { type: 'roll' })).toBe(s); // paused behind the offer
    expect(passaria(s, 'p')).toBe(s);
    expect(reduce(s, { type: 'faceOmen', deferFight: true })).toBe(s); // End Turn waits too
    // The timeout policy answers it like any other open decision, so the lock candidate is always built...
    expect(legalModalAnswers(s)).toEqual(offer.map((id) => ({ type: 'pickAncient', id })));
    const answered = versusAutoResolve(s, makeRng(9));
    expect(offer).toContain(answered.ancients!.picked);
    expect(versusAutoResolve(s, makeRng(9)).ancients!.picked).toBe(answered.ancients!.picked);
    expect(buildVersusCandidate(s, makeRng(9))?.board).toHaveLength(1);
    // ...and never touches the live run (the candidate is built on a clone).
    expect(s.ancients!.picked).toBeUndefined();
    // A run without Ancients has no such answer.
    expect(legalModalAnswers(base({}, false))).toEqual([]);
  });

  it('Ancients on but nothing picked yet: passes are still the passes of before', () => {
    let s = base({ board: [card('e', ECHO), card('p', PLAIN[0]!)] });
    s = passaria(s, 'e');
    expect(last(s).card.keywords).not.toContain('R');
    expect(last(s).bonds).toBeUndefined();
    expect(at(s, 'p').attack).toBe(CARD_INDEX[PLAIN[0]!]!.attack);
  });
});

describe('Priestess × DEATH: "Passing a minion with an Echo grants it Rise."', () => {
  it('Passaria on a minion with an Echo: the teammate receives it with Rise', () => {
    let s = picked('death', { board: [card('e', ECHO)] });
    expect(heroPowerText(s)).toBe(`${BASE} A minion with an **Echo** gains **Rise** when you **Pass** it.`);
    s = passaria(s, 'e');
    expect(last(s).card.keywords).toContain('R');
    const b = ship(s, mate());
    expect(b.hand).toHaveLength(1);
    expect(b.hand[0]!.cardId).toBe(ECHO);
    expect(b.hand[0]!.keywords).toContain('R');
  });

  it('every pass counts: an ordinary hand pass, and a Shop minion Passaria sends', () => {
    let s = picked('death', { hand: [card('h', ECHO)], shop: [{ uid: 'o', cardId: ECHO } as ShopCard] });
    s = drag(s, 'h');
    expect(last(s).card.keywords).toContain('R');
    s = passaria(s, 'o');
    expect(last(s).card.keywords).toContain('R');
    expect(ship(s, mate()).hand.every((c) => c.keywords.includes('R'))).toBe(true);
  });

  it('a minion with no Echo gains nothing; one that already has Rise is unchanged', () => {
    let s = picked('death', { board: [card('p', PLAIN[0]!)], hand: [card('r', ECHO, { keywords: ['R'] })] });
    s = passaria(s, 'p');
    expect(last(s).card.keywords).not.toContain('R');
    s = drag(s, 'r');
    expect(last(s).card.keywords.filter((k) => k === 'R')).toHaveLength(1);
    expect(last(s).ancRise).toBeUndefined();
  });

  it('a pass that comes back takes the Rise off again (the pass never happened)', () => {
    let s = picked('death', { board: [card('e', ECHO)] });
    s = passaria(s, 'e');
    s = reduce(s, { type: 'passRefunded', seq: 0 });
    expect(at(s, 'e').keywords).not.toContain('R');
    expect(s.embers).toBe(20);
    expect(s.heroReady).toBe(true);
  });

  it('another Ancient picked: no Rise (the test fails without the effect)', () => {
    const s = passaria(picked('fortune', { board: [card('e', ECHO)] }), 'e');
    expect(last(s).card.keywords).not.toContain('R');
  });
});

describe('Priestess × FORTUNE: "Passaria costs 0 Gold."', () => {
  it('the power costs 0, and a use spends nothing', () => {
    let s = picked('fortune', { board: [card('p', PLAIN[0]!)], embers: 0 });
    expect(activePowers(s)[0]!.cost).toBe(0);
    expect(heroPowerText(s)).toBe(`${BASE} It costs **0** Gold.`);
    s = passaria(s, 'p');
    expect(s.duos!.outbox).toHaveLength(1);
    expect(s.embers).toBe(0);
    expect(last(s).paid).toBe(0);
    expect(s.heroReady).toBe(false); // still once per turn
  });

  it('without it Passaria needs its 2 Gold', () => {
    const s = base({ board: [card('p', PLAIN[0]!)], embers: 0 });
    expect(passaria(s, 'p')).toBe(s);
  });
});

describe('Priestess × WAR: "Start of Combat: Give your minions +2/+2 for each card passed this turn."', () => {
  it('counts every card I passed this turn, live in the text, and carries the total into combat', () => {
    let s = picked('war', { board: [card('a', PLAIN[0]!), card('b', PLAIN[1]!), card('c', PLAIN[2]!)], hand: [card('h', PLAIN[1]!)] });
    expect(heroPowerText(s)).toContain('(**0** passed: **+0/+0**)');
    expect(ancientCombatMods(s).ancientSocBuffAll).toBeUndefined();
    s = passaria(s, 'c');
    expect(heroPowerText(s)).toContain('(**1** passed: **+2/+2**)');
    s = drag(s, 'h');
    expect(ancientPassesThisTurn(s)).toBe(2);
    expect(heroPowerText(s)).toContain('(**2** passed: **+4/+4**)');
    expect(ancientCombatMods(s).ancientSocBuffAll).toEqual({ attack: 4, health: 4, label: 'Ancient of War' });
  });

  it('a pass that came back, a team effect and my teammate\'s passes do not count; a new turn starts at 0', () => {
    let s = picked('war', { board: [card('a', PLAIN[0]!)], hand: [card('h', PLAIN[1]!), card('g', PLAIN[2]!)] });
    s = drag(s, 'h');
    s = drag(s, 'g');
    s = reduce(s, { type: 'passRefunded', seq: 1 });
    expect(ancientPassesThisTurn(s)).toBe(1);
    // A card my teammate passes to me is not a card I passed.
    const b = drag(mate({ hand: [card('m', PLAIN[0]!)] }), 'm');
    s = reduce(s, { type: 'receivePass', from: 'p2', seq: 0, card: duosWireOf(b.duos!.outbox[0]!) });
    expect(ancientPassesThisTurn(s)).toBe(1);
    expect(ancientPassesThisTurn({ ...s, wave: s.wave + 1 })).toBe(0);
  });

  it('the fight: the locked side carries it, and every living minion gains it at Start of Combat', () => {
    let s = picked('war', { board: [card('a', PLAIN[0]!, { attack: 1, health: 30 }), card('b', PLAIN[1]!, { attack: 1, health: 30 })], hand: [card('h', PLAIN[2]!), card('g', PLAIN[2]!)] });
    s = drag(drag(s, 'h'), 'g');
    const side = buildVersusCandidate(s, makeRng(3))!;
    expect(side.state.questMods?.ancientSocBuffAll).toEqual({ attack: 4, health: 4, label: 'Ancient of War' });
    const foe = [{ cardId: PLAIN[0]!, attack: 1, health: 500, keywords: [] }];
    const r = simulate(structuredClone(side.board), foe, makeRng(5), CARD_INDEX, structuredClone(side.state), combatSide());
    const got = r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'Ancient of War');
    expect(got.map((e) => [e.attack, e.health])).toEqual([[4, 4], [4, 4]]);
    // The same side as the ENEMY gets the same grant (sides are symmetric).
    const mirrored = simulate(foe, structuredClone(side.board), makeRng(5), CARD_INDEX, combatSide(), structuredClone(side.state));
    expect(mirrored.events.filter((e) => e.type === 'buff' && e.source === 'Ancient of War')).toHaveLength(2);
    // Combat only: the run's board is unchanged.
    expect(s.board.map((c) => c.attack)).toEqual([1, 1]);
  });

  it('no pass this turn: nothing rides into the fight', () => {
    const s = picked('war', { board: [card('a', PLAIN[0]!)] });
    expect(buildVersusCandidate(s, makeRng(3))!.state.questMods?.ancientSocBuffAll).toBeUndefined();
  });
});

describe('Priestess × GENESIS: "Passaria also gets you a plain copy of the minion you Pass but costs 4g."', () => {
  it('costs 4 Gold; the passed minion leaves as it was and a plain copy lands in my hand', () => {
    let s = picked('genesis', { board: [card('p', PLAIN[0]!, { attack: 9, health: 9 })] });
    expect(activePowers(s)[0]!.cost).toBe(4);
    expect(heroPowerText(s)).toBe(`${BASE} You also get a plain copy of it. It costs **4** Gold.`);
    s = passaria(s, 'p');
    expect(s.embers).toBe(16);
    expect(last(s).card).toMatchObject({ cardId: PLAIN[0], attack: 9, health: 9 });
    const d = CARD_INDEX[PLAIN[0]!]!;
    expect(s.hand).toHaveLength(1);
    expect(s.hand[0]).toMatchObject({ cardId: PLAIN[0], attack: d.attack, health: d.health, golden: false });
    expect(ship(s, mate()).hand[0]).toMatchObject({ attack: 9, health: 9 });
  });

  it('3 Gold is not enough; a full hand gets no copy; an ordinary hand pass gets none', () => {
    const poor = picked('genesis', { board: [card('p', PLAIN[0]!)], embers: 3 });
    expect(passaria(poor, 'p')).toBe(poor);
    const full = passaria(picked('genesis', { board: [card('p', PLAIN[0]!)], hand: fullHand() }), 'p');
    expect(full.duos!.outbox).toHaveLength(1);
    expect(full.hand).toHaveLength(handCap(full));
    const dragged = drag(picked('genesis', { hand: [card('h', PLAIN[0]!)] }), 'h');
    expect(dragged.hand).toHaveLength(0);
  });

  it('a pass that comes back: the minion, the 4 Gold and the charge return, and the copy leaves my hand', () => {
    let s = picked('genesis', { board: [card('p', PLAIN[0]!)] });
    s = passaria(s, 'p');
    s = reduce(s, { type: 'passRefunded', seq: 0 });
    expect(s.board.map((c) => c.uid)).toEqual(['p']);
    expect(s.hand).toHaveLength(0);
    expect(s.embers).toBe(20);
    expect(s.heroReady).toBe(true);
  });
});

describe('Priestess × TIME: "Passaria can be used twice each turn."', () => {
  it('two uses a turn, each paid; a third is refused; the text counts down', () => {
    let s = picked('time', { board: [card('a', PLAIN[0]!), card('b', PLAIN[1]!), card('c', PLAIN[2]!)] });
    expect(heroPowerText(s)).toBe(`${BASE} Use it **twice** each turn (**2** left this turn).`);
    s = passaria(s, 'a');
    expect(heroPowerText(s)).toContain('(**1** left this turn)');
    expect(s.heroReady).toBe(true);
    s = passaria(s, 'b');
    expect(heroPowerText(s)).toContain('(**0** left this turn)');
    expect(s.heroReady).toBe(false);
    expect(s.embers).toBe(16);
    expect(passaria(s, 'c')).toBe(s);
    expect(s.duos!.outbox).toHaveLength(2);
  });

  it('a pass that comes back gives its use back', () => {
    let s = picked('time', { board: [card('a', PLAIN[0]!), card('b', PLAIN[1]!), card('c', PLAIN[2]!)] });
    s = passaria(passaria(s, 'a'), 'b');
    s = reduce(s, { type: 'passRefunded', seq: 1 });
    expect(heroPowerText(s)).toContain('(**1** left this turn)');
    expect(passaria(s, 'c').duos!.outbox).toHaveLength(3);
  });

  it('a reload\'s replay of both uses counts both (never a third)', () => {
    let s = picked('time', { board: [card('a', PLAIN[0]!), card('b', PLAIN[1]!), card('c', PLAIN[2]!)] });
    for (const uid of ['a', 'b']) s = reduce(s, { type: 'restoreEffectPass', uid, cardId: at(s, uid).cardId, via: 'spell', power: 0, paid: 2 });
    expect(s.duos!.outbox).toHaveLength(2);
    expect(s.embers).toBe(16);
    expect(passaria(s, 'c')).toBe(s);
  });

  it('without it Passaria is once per turn', () => {
    const s = passaria(base({ board: [card('a', PLAIN[0]!), card('b', PLAIN[1]!)] }), 'a');
    expect(passaria(s, 'b')).toBe(s);
  });
});

describe('Priestess × BONDS: "When you Pass, give your left-most minion and your teammate\'s left-most minion +4/+4."', () => {
  const start = (over: Partial<RunState> = {}): RunState => picked('bonds', { board: [card('a', PLAIN[0]!, { attack: 1, health: 1 }), card('b', PLAIN[1]!, { attack: 1, health: 1 })], hand: [card('h', PLAIN[2]!)], ...over });
  const mateBoard = (): BoardCard[] => [card('x', PLAIN[0]!, { attack: 2, health: 2 }), card('y', PLAIN[1]!, { attack: 2, health: 2 })];

  it('my left-most minion gains +4/+4 now, and my teammate\'s gains it when the card arrives', () => {
    let s = start();
    s = drag(s, 'h');
    expect([at(s, 'a').attack, at(s, 'a').health]).toEqual([5, 5]);
    expect([at(s, 'b').attack, at(s, 'b').health]).toEqual([1, 1]);
    expect(at(s, 'a').buffs?.some((x) => x.source === 'Ancient of Bonds')).toBe(true);
    expect(duosWireOf(last(s)).passBonds).toEqual({ attack: 4, health: 4 });
    const b = ship(s, mate({ board: mateBoard() }));
    expect(b.board.map((c) => [c.attack, c.health])).toEqual([[6, 6], [2, 2]]);
    expect(b.hand).toHaveLength(1);
  });

  it('Passaria on my own left-most minion: the minion that is left-most AFTER it leaves gains it', () => {
    const s = passaria(start(), 'a');
    expect(s.board.map((c) => [c.uid, c.attack, c.health])).toEqual([['b', 5, 5]]);
  });

  it('exactly once: the same pass delivered again (a retry, a pull after the push) changes nothing', () => {
    const s = drag(start(), 'h');
    const once = ship(s, mate({ board: mateBoard() }));
    const twice = ship(s, once);
    expect(twice).toBe(once);
    expect(twice.board[0]).toMatchObject({ attack: 6, health: 6 });
  });

  it('the teammate has no minion: only mine is buffed', () => {
    const s = drag(start(), 'h');
    const b = ship(s, mate());
    expect(b.board).toHaveLength(0);
    expect(b.hand).toHaveLength(1);
    expect(at(s, 'a').attack).toBe(5);
  });

  it('I have no minion: only my teammate\'s is buffed', () => {
    const s = drag(start({ board: [] }), 'h');
    expect(ship(s, mate({ board: mateBoard() })).board[0]).toMatchObject({ attack: 6, health: 6 });
  });

  it('the teammate\'s hand is full: Passaria\'s minion waits for room, and the +4/+4 lands with its arrival, once', () => {
    const s = passaria(start(), 'b');
    let b = ship(s, mate({ board: mateBoard(), hand: fullHand() }));
    expect(duosWaitingCount(b)).toBe(1);
    expect(b.board[0]).toMatchObject({ attack: 6, health: 6 });
    // Room opens: the card lands, and nothing is given a second time.
    b = reduce({ ...b, hand: b.hand.slice(1) }, { type: 'roll' });
    expect(duosWaitingCount(b)).toBe(0);
    expect(b.board[0]).toMatchObject({ attack: 6, health: 6 });
  });

  it('an ordinary pass a full hand refuses gives the teammate nothing (the card never arrived)', () => {
    const s = drag(start(), 'h');
    const b = ship(s, mate({ board: mateBoard(), hand: fullHand() }));
    expect(b.duos!.refused).toEqual(['p1:0']);
    expect(b.board[0]).toMatchObject({ attack: 2, health: 2 });
  });

  it('a reload: the replayed pass buffs my minion again (the turn was dropped), and my teammate\'s run ignores the pass it already holds', () => {
    const first = drag(start(), 'h');
    const b = ship(first, mate({ board: mateBoard() }));
    // My run comes back from before the pass; the restore replays it.
    const again = drag(start(), 'h');
    expect(at(again, 'a').attack).toBe(5);
    expect(ship(again, b)).toBe(b);
  });

  it('save and restore keep what rides the pass', () => {
    const s = drag(start(), 'h');
    const back = deserialize(serialize(s));
    expect(duosWireOf(last(back))).toEqual(duosWireOf(last(s)));
    expect(JSON.parse(serialize(back))).toEqual(JSON.parse(serialize(s)));
  });

  it('the amount is the printed pairing at most, whatever a client sends', () => {
    const s = drag(start(), 'h');
    const wire = { ...duosWireOf(last(s)), passBonds: { attack: 999, health: 999 } };
    const b = reduce(mate({ board: mateBoard() }), { type: 'receivePass', from: 'p1', seq: 0, card: wire });
    expect(b.board[0]).toMatchObject({ attack: 6, health: 6 });
    const junk = reduce(mate({ board: mateBoard() }), { type: 'receivePass', from: 'p1', seq: 0, card: { ...duosWireOf(last(s)), passBonds: 'x' } as unknown as BoardCard });
    expect(junk.board[0]).toMatchObject({ attack: 2, health: 2 });
  });

  it('the marker never rides into the hand', () => {
    const b = ship(drag(start(), 'h'), mate({ board: mateBoard() }));
    expect(Object.keys(b.hand[0]!)).not.toContain('passBonds');
  });

  it('the same seed plays out to the same bytes', () => {
    const play = (): string => serialize(passaria(drag(start(), 'h'), 'b'));
    expect(play()).toBe(play());
  });

  it('another Ancient picked: no buff on either run (the test fails without the effect)', () => {
    const s = drag(picked('fortune', { board: [card('a', PLAIN[0]!, { attack: 1, health: 1 })], hand: [card('h', PLAIN[2]!)] }), 'h');
    expect(at(s, 'a').attack).toBe(1);
    expect(ship(s, mate({ board: mateBoard() })).board[0]).toMatchObject({ attack: 2, health: 2 });
  });
});
