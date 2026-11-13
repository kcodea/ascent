/**
 * ANCIENTS × MAGICIAN (Duos only; owner pairings 2026-11-10, R-ANCMAGICIAN-01..06). Magic Hat (passive): "After you buy
 * 3 cards, your teammate gets a copy of a random one. Twice per turn." (three buys: owner 2026-11-12) Every pairing through
 * the real reducer on two teammates' runs (the copy travels as `duosWireOf` and lands through `receivePass`), and War
 * through the Duos round resolver (the tag-team fight the Worker runs).
 *
 * Ancients are not on in any Duos game players can reach: each run here is built with `createVersusRun`'s dev seam.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { makeRng, type CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, ANCIENT_PAIRINGS, ancientCombatMods, ancientOfferText, deserialize, heroPowerArmed, heroPowerText, magicHatView, reduce, serialize,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState, type ShopCard,
} from './index';
import { powerDiscoverPool } from './heroes';
import { createVersusRun, buildVersusCandidate } from './versus/run';
import { resolveVersusDuosRound } from './versus/duos';
import type { VersusRoomOptions } from './versus/options';
import { duosWaitingCount, duosWireOf } from './duosPass';
import { handCap } from './state';
import { CONFIG } from './config';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };

const all = Object.values(CARD_INDEX).filter((c) => c && !c.token && !c.duos).map((c) => c!);
const minionDefs = all.filter((c) => !c.spell && !c.ruby);
/** Distinct plain minions (no effects), so a run of buys never makes a triple and nothing else moves. */
const PLAIN = minionDefs.filter((c) => c.tier <= 2 && c.effects.length === 0 && c.keywords.length === 0).map((c) => c.id);
/** A minion with an Echo and neither Rise nor Taunt printed. */
const ECHO = minionDefs.find((c) => c.effects.length === 1 && c.effects[0]!.on === 'onDeath' && !c.keywords.includes('R') && !c.keywords.includes('T') && c.tier <= 3)!.id;
const SPELL = all.find((c) => c.spell && !c.ruby && (c.cost ?? 0) <= 3)!.id;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const offer = (i: number, over: Partial<ShopCard> = {}): ShopCard => ({ uid: `s${i}`, cardId: PLAIN[i % PLAIN.length]!, ...over });
const base = (over: Partial<RunState> = {}, ancients = true): RunState =>
  ({ ...createVersusRun(11, 'magician', 'set2', DUOS, 'warden', ancients ? { ancients: true } : undefined), phase: 'recruit', embers: 400, hand: [], board: [], shop: [], spell: null, ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = base(over);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const mate = (over: Partial<RunState> = {}): RunState =>
  ({ ...createVersusRun(12, 'warden', 'set2', DUOS, 'magician'), phase: 'recruit', embers: 10, hand: [], board: [], shop: [], spell: null, ...over } as RunState);
/** Buy one offer (a fresh one-card row), then empty the hand so the cap never stops the next buy. */
let n = 0;
const buyOf = (s: RunState, o: Partial<ShopCard> = {}): RunState => {
  const uid = `q${n++}`;
  return { ...reduce({ ...s, shop: [{ ...offer(n), ...o, uid }] }, { type: 'buy', uid }), hand: [] };
};
const buyN = (s: RunState, count: number): RunState => { let out = s; for (let i = 0; i < count; i++) out = buyOf(out); return out; };
/** A WHOLE HAT OF ONE OFFER: every buy that fills it is `o` (the hand is emptied between buys, so nothing triples), so
 *  whichever card the hat picks, the copy is `o`. The last buy fires it. `need`: the hat's size (3; Genesis: 8). */
const hatOf = (s: RunState, o: Partial<ShopCard> = {}, need = 3): RunState => { let out = s; for (let i = 0; i < need; i++) out = buyOf(out, o); return out; };
function ship(from: RunState, to: RunState, since = 0): RunState {
  let out = to;
  for (const e of from.duos!.outbox.slice(since)) out = reduce(out, { type: 'receivePass', from: 'p1', seq: e.seq, card: duosWireOf(e) });
  return out;
}
const last = (s: RunState) => s.duos!.outbox[s.duos!.outbox.length - 1]!;
const nextTurn = (s: RunState): RunState => ({ ...s, wave: s.wave + 1 });

describe('Magician × every Ancient has a written pairing', () => {
  it('all six are written, in plain words: no em dash, no "Oath" or "climb", "Gold" spelled out', () => {
    for (const id of ANCIENT_IDS) {
      const p = ANCIENT_PAIRINGS.magician![id]!;
      expect(ancientOfferText('magician', id)).not.toBe('Not written yet.');
      for (const t of [p.offerText, p.powerText]) {
        expect(t).not.toMatch(/—|--|Oath|climb/i);
        expect(t).not.toMatch(/\d\s?g\b/);
      }
    }
  });

  it('Magic Hat is never a power Mimic, Void or Power Shifter can take, so no other hero meets these pairings', () => {
    expect(powerDiscoverPool('mimic')).not.toContain('magician');
    expect(powerDiscoverPool('void')).not.toContain('magician');
  });

  it('a Duos game without Ancients is untouched: the hat of before, the same bytes, nothing new on the wire', () => {
    const play = (): RunState => hatOf(base({}, false), { cardId: ECHO });
    const s = play();
    n -= 3;
    expect(serialize(play())).toBe(serialize(s));
    expect(magicHatView(s)).toEqual({ count: 0, need: 3, left: 1, perTurn: 2, full: false, active: false, capped: false });
    const e = last(s);
    expect(e.hat).toBe(true);
    expect(e.copies).toBeUndefined();
    expect(e.card).toMatchObject({ cardId: ECHO, golden: false, keywords: CARD_INDEX[ECHO]!.keywords });
    expect(Object.keys(duosWireOf(e)).filter((k) => k === 'passBonds' || k === 'passCopies')).toEqual([]);
    expect(s.upgradeCost).toBe(base({}, false).upgradeCost);
  });

  it('Ancients on but nothing picked yet: still the hat of before', () => {
    const s = hatOf(base(), { cardId: ECHO });
    expect(magicHatView(s)).toMatchObject({ need: 3, left: 1 });
    expect(last(s).card).toMatchObject({ golden: false, keywords: CARD_INDEX[ECHO]!.keywords });
  });
});

describe('Magician × DEATH: "Echo minions passed from Magic Hat gain Rise or Taunt at random."', () => {
  it('the copy of a minion with an Echo arrives with exactly one of Rise or Taunt; my own card is unchanged', () => {
    let s = hatOf(picked('death'), { cardId: ECHO }, 2);
    const kept = reduce({ ...s, shop: [{ uid: 'e', cardId: ECHO }] }, { type: 'buy', uid: 'e' });
    const got = last(kept).card.keywords.filter((k) => k === 'R' || k === 'T');
    expect(got).toHaveLength(1);
    expect(kept.hand[0]!.keywords).toEqual(CARD_INDEX[ECHO]!.keywords);
    const b = ship(kept, mate());
    expect(b.hand[0]!.keywords.filter((k) => k === 'R' || k === 'T')).toEqual(got);
    s = kept;
    expect(heroPowerText(s)).toContain('A copy of a minion with an **Echo** gains **Rise** or **Taunt** at random.');
  });

  it('seeded: the same run rolls the same keyword, and both keywords come up across seeds', () => {
    const roll = (cursor: number): string => {
      const s = { ...picked('death'), rngCursor: cursor };
      return last(hatOf(s, { cardId: ECHO })).card.keywords.filter((k) => k === 'R' || k === 'T').join('');
    };
    expect(roll(5)).toBe(roll(5));
    const seen = new Set(Array.from({ length: 24 }, (_, i) => roll(1000 + i * 7919)));
    expect([...seen].sort()).toEqual(['R', 'T']);
  });

  it('a keyword it already has is never the one given: with Rise it gains Taunt, with both it gains nothing', () => {
    const fire = (keywords: BoardCard['keywords']): BoardCard['keywords'] => {
      // Shop offers that already carry the keyword (a Shop buff), bought with it.
      return last(hatOf(picked('death'), { cardId: ECHO, keywords })).card.keywords;
    };
    expect(fire(['R']).filter((k) => k === 'R' || k === 'T').sort()).toEqual(['R', 'T']);
    expect(fire(['T']).filter((k) => k === 'R' || k === 'T').sort()).toEqual(['R', 'T']);
    expect(fire(['R', 'T']).filter((k) => k === 'R' || k === 'T').sort()).toEqual(['R', 'T']);
  });

  it('a minion with no Echo, and a spell, gain nothing', () => {
    expect(last(hatOf(picked('death'))).card.keywords).toEqual([]);
    const sp = hatOf(picked('death'), { cardId: SPELL });
    expect(last(sp).card.cardId).toBe(SPELL);
    expect(last(sp).card.keywords).toEqual(CARD_INDEX[SPELL]!.keywords);
  });

  it('another Ancient picked: no keyword (the test fails without the effect)', () => {
    expect(last(hatOf(picked('time'), { cardId: ECHO })).card.keywords).toEqual(CARD_INDEX[ECHO]!.keywords);
  });
});

describe('Magician × FORTUNE: "Triggering Magic Hat reduces your Shop upgrade cost by 4."', () => {
  it('each copy sent takes 4 Gold off the Shop upgrade, never below 0, and the text prints the price', () => {
    let s = picked('fortune', { tier: 2, upgradeCost: 7 });
    s = buyN(s, 2);
    expect(s.upgradeCost).toBe(7); // filling the hat is not a trigger
    s = buyOf(s);
    expect(s.upgradeCost).toBe(3);
    expect(heroPowerText(s)).toContain('Each copy sent makes your Shop upgrade cost **4** Gold less. Upgrading costs **3 Gold** now.');
    s = buyN(s, 3);
    expect(s.upgradeCost).toBe(Math.max(CONFIG.upgradeCostFloor, 0));
    expect(s.upgradeCost).toBe(0);
  });

  it('it is for the upgrade in front of you: tiering up starts the next price fresh', () => {
    let s = hatOf(picked('fortune', { tier: 2, upgradeCost: 7 }));
    s = reduce(s, { type: 'upgrade' });
    expect(s.tier).toBe(3);
    expect(s.upgradeCost).toBe(CONFIG.upgradeCost[4]);
  });

  it('a reload\'s replayed copy pays the cut again (the turn\'s own was dropped with it), once per copy', () => {
    const s = reduce(picked('fortune', { tier: 2, upgradeCost: 7 }), { type: 'restoreEffectPass', uid: 'hat9', cardId: PLAIN[0]!, via: 'sale', hat: true });
    expect(s.upgradeCost).toBe(3);
    expect(s.duos!.outbox).toHaveLength(1);
  });

  it('another Ancient picked: the price does not move (the test fails without the effect)', () => {
    expect(hatOf(picked('time', { tier: 2, upgradeCost: 7 })).upgradeCost).toBe(7);
  });
});

describe('Magician × GENESIS: "Magic Hat triggers after 8 buys, but Gilds the minion passed, or grants 3 copies of a spell passed."', () => {
  it('the hat needs 8 buys; the counter, the text and the ready glow all follow it', () => {
    let s = picked('genesis');
    expect(magicHatView(s)).toMatchObject({ count: 0, need: 8, active: false });
    expect(heroPowerText(s)).toContain('After you buy **8** cards (**0/8**), your teammate gets a copy of a random one.');
    s = buyN(s, 5);
    expect(magicHatView(s)).toMatchObject({ count: 5, need: 8, active: false });
    expect(heroPowerArmed(s)).toBe(false);
    s = buyN(s, 2);
    // One buy short of the eighth: the next card bought sends the copy.
    expect(magicHatView(s)).toMatchObject({ count: 7, need: 8, active: true });
    expect(s.magicHatCards).toHaveLength(7);
    expect(heroPowerArmed(s)).toBe(true);
    expect(s.duos!.outbox).toHaveLength(0);
    expect(heroPowerText(s)).toContain('Your hat is **ready** (**7/8**).');
    expect(heroPowerText(s)).toContain('A minion copy arrives **Gilded**. A spell arrives as **3** copies.');
  });

  it('a minion copy arrives Gilded (double the printed stats on top of what it was bought with); I keep the plain one', () => {
    const d = CARD_INDEX[PLAIN[0]!]!;
    // All eight buys are the same buffed offer, so whichever the hat picks, the copy is that card as it was bought.
    const s = reduce({ ...hatOf(picked('genesis'), { cardId: d.id, atk: 2, hp: 3 }, 7), shop: [{ uid: 'g', cardId: d.id, atk: 2, hp: 3 }] }, { type: 'buy', uid: 'g' });
    expect(s.duos!.outbox).toHaveLength(1); // the eighth buy fired it
    expect(s.hand[0]).toMatchObject({ cardId: d.id, golden: false, attack: d.attack + 2, health: d.health + 3 });
    expect(last(s).card).toMatchObject({ cardId: d.id, golden: true, attack: d.attack * 2 + 2, health: d.health * 2 + 3 });
    const b = ship(s, mate());
    expect(b.hand[0]).toMatchObject({ cardId: d.id, golden: true, attack: d.attack * 2 + 2, health: d.health * 2 + 3 });
    expect(magicHatView(s)).toMatchObject({ count: 0, left: 1 }); // the per-turn cap still applies
  });

  it('a spell arrives as 3 copies from ONE pass; the same pass delivered again adds nothing', () => {
    const s = hatOf(picked('genesis'), { cardId: SPELL }, 8);
    expect(s.duos!.outbox).toHaveLength(1);
    expect(duosWireOf(last(s)).passCopies).toBe(3);
    const b = ship(s, mate());
    expect(b.hand.map((c) => c.cardId)).toEqual([SPELL, SPELL, SPELL]);
    expect(new Set(b.hand.map((c) => c.uid)).size).toBe(3);
    expect(b.hand.every((c) => !('passCopies' in c) && !('passHat' in c))).toBe(true);
    expect(ship(s, b)).toBe(b);
  });

  it('a full hand: the three copies wait and land as room opens, none lost', () => {
    const s = hatOf(picked('genesis'), { cardId: SPELL }, 8);
    const filler = minionDefs.filter((c) => c.tier <= 2 && c.effects.length > 0).slice(0, 10).map((c, i) => card(`h${i}`, c.id));
    let b = ship(s, mate({ hand: filler.slice(0, handCap(mate())) }));
    expect(duosWaitingCount(b)).toBe(3);
    b = reduce({ ...b, hand: b.hand.slice(2) }, { type: 'roll' });
    expect(duosWaitingCount(b)).toBe(1);
    expect(b.hand.filter((c) => c.cardId === SPELL)).toHaveLength(2);
    // One slot free: the first copy lands, the other two wait.
    const one = ship(s, mate({ hand: filler.slice(0, handCap(mate()) - 1) }));
    expect(one.hand.filter((c) => c.cardId === SPELL)).toHaveLength(1);
    expect(duosWaitingCount(one)).toBe(2);
  });

  it('a spell copy count a client inflates is cut to 3, and only a Magic Hat copy may carry one', () => {
    const s = hatOf(picked('genesis'), { cardId: SPELL }, 8);
    const big = reduce(mate(), { type: 'receivePass', from: 'p1', seq: 0, card: { ...duosWireOf(last(s)), passCopies: 50 } as BoardCard });
    expect(big.hand).toHaveLength(3);
    const { passHat: _h, ...notHat } = duosWireOf(last(s));
    void _h;
    expect(reduce(mate(), { type: 'receivePass', from: 'p1', seq: 0, card: notHat }).hand).toHaveLength(1);
  });

  it('save and restore keep the count that rides the pass', () => {
    const s = hatOf(picked('genesis'), { cardId: SPELL }, 8);
    expect(duosWireOf(last(deserialize(serialize(s))))).toEqual(duosWireOf(last(s)));
  });
});

describe('Magician × TIME: "Start of Turn: Get a random copy of a card you\'ve passed this game."', () => {
  const passed = (ids: string[], over: Partial<RunState> = {}): RunState => {
    const s = picked('time', over);
    return { ...s, duos: { ...s.duos!, outbox: ids.map((id, i) => ({ seq: i, wave: 1, card: card(`o${i}`, id, { attack: 30, health: 30 }), from: 'hand' as const, index: 0, paid: 0, ...(i === 0 ? { via: 'sale' as const, hat: true as const } : {}) })) } };
  };
  /** Fight a served board, settle, and open the next Shop (Start of Turn has run). */
  const foes = (wave: number): BoardSnapshot => ({ v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: PLAIN[3]!, attack: 1, health: 1, keywords: [] }], seed: 1, origin: 'self' });
  const turn = (s: RunState): RunState => reduce(reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave) } }, { type: 'faceOmen' }), { type: 'resolveCombat' });

  it('counts Magic Hat copies and my own passes, and prints the pool size', () => {
    const s = passed([PLAIN[0]!, PLAIN[1]!]);
    expect(heroPowerText(s)).toContain('**Start of Turn:** Get a plain copy of a random card you have passed this game (**2** passed).');
  });

  it('the next turn starts with a PLAIN copy of one of them in hand', () => {
    const s = passed([PLAIN[0]!, PLAIN[1]!]);
    const started = turn(s);
    const got = started.hand.filter((c) => c.cardId === PLAIN[0] || c.cardId === PLAIN[1]);
    expect(got).toHaveLength(1);
    const d = CARD_INDEX[got[0]!.cardId]!;
    expect(got[0]).toMatchObject({ attack: d.attack, health: d.health, golden: false });
    expect(started.wave).toBe(s.wave + 1);
  });

  it('nothing passed yet, or only passes that came back: nothing', () => {
    const none = picked('time');
    expect(turn(none).hand).toHaveLength(0);
    expect(turn(none).wave).toBe(none.wave + 1);
    const s = passed([PLAIN[0]!]);
    const refunded = { ...s, duos: { ...s.duos!, outbox: s.duos!.outbox.map((e) => ({ ...e, refunded: true as const })) } };
    expect(heroPowerText(refunded)).toContain('(**0** passed)');
    expect(turn(refunded).hand).toHaveLength(0);
  });

  it('seeded: the same run gets the same card', () => {
    const go = (): string => serialize(turn(passed([PLAIN[0]!, PLAIN[1]!, PLAIN[2]!, ECHO])));
    expect(go()).toBe(go());
  });

  it('a spell I passed comes back as a spell', () => {
    expect(turn(passed([SPELL])).hand.map((c) => c.cardId)).toEqual([SPELL]);
  });

  it('another Ancient picked: nothing (the test fails without the effect)', () => {
    const s = passed([PLAIN[0]!]);
    const other = { ...s, ancients: { ...s.ancients!, picked: 'death' as AncientId } };
    expect(turn(other).hand).toHaveLength(0);
  });
});

describe('Magician × BONDS: "Magic Hat has no maximum triggers per turn."', () => {
  it('a third and a fourth copy go out in one turn; the text and the view say so', () => {
    let s = picked('bonds');
    expect(heroPowerText(s)).toBe('After you buy **3** cards (**0/3**), your teammate gets a copy of a random one. No limit each turn.');
    for (let i = 0; i < 4; i++) s = buyN(s, 3);
    expect(s.duos!.outbox.filter((e) => e.hat)).toHaveLength(4);
    s = buyN(s, 2);
    expect(magicHatView(s)).toMatchObject({ count: 2, active: true, capped: false, noCap: true });
    expect(heroPowerArmed(s)).toBe(true);
    expect(heroPowerText(s)).toBe('Your hat is **ready** (**2/3**). The next card you buy sends your teammate a copy of a random card in it. No limit each turn.');
  });

  it('without it the third copy waits for the next turn (the test fails without the effect)', () => {
    let s = picked('time');
    for (let i = 0; i < 2; i++) s = buyN(s, 3);
    s = buyN(s, 3);
    expect(magicHatView(s)).toMatchObject({ active: false, capped: true });
    expect(buyOf(s).duos!.outbox.filter((e) => e.hat)).toHaveLength(2);
    expect(magicHatView(nextTurn(s)).active).toBe(true);
  });

  it('a reload\'s replay of three copies in one turn restores all three', () => {
    let s = picked('bonds');
    for (let i = 0; i < 3; i++) s = reduce(s, { type: 'restoreEffectPass', uid: `hat${i}`, cardId: PLAIN[0]!, via: 'sale', hat: true });
    expect(s.duos!.outbox).toHaveLength(3);
  });
});

describe('Magician × WAR: "Start of Combat: A minion that both you and your teammate control copies of gain each others stats."', () => {
  const SHARED = PLAIN[0]!;
  const body = (uid: string, cardId: string, attack: number, health: number, golden = false): BoardCard => card(uid, cardId, { attack, health, golden });
  /** A locked side: the run's own `buildVersusCandidate`, as the client sends it to the room. */
  const side = (heroId: string, seed: number, board: BoardCard[], pick?: AncientId) => {
    let run: RunState = { ...createVersusRun(seed, heroId, 'set2', DUOS, 'warden', pick ? { ancients: true } : undefined), hand: [], shop: [], spell: null, board };
    if (pick) {
      run = { ...run, ancients: { ...run.ancients!, points: run.ancients!.cost, offer: [pick, ...ANCIENT_IDS.filter((a) => a !== pick).slice(0, 2)] } };
      run = reduce(run, { type: 'pickAncient', id: pick });
    }
    return buildVersusCandidate(run, makeRng(seed))!;
  };
  const magicianBoard = (): BoardCard[] => [body('m0', PLAIN[1]!, 1, 40), body('m1', SHARED, 3, 50)];
  const mateBoard = (): BoardCard[] => [body('w0', SHARED, 7, 9), body('w1', PLAIN[2]!, 2, 2)];
  const foeBoard = (): BoardCard[] => [body('f0', PLAIN[2]!, 60, 3000)];
  const round = (round_: number, pick: AncientId | null = 'war') => resolveVersusDuosRound({
    matchSeed: 77, round: round_,
    sides: { p1: side('magician', 21, magicianBoard(), pick ?? undefined), p2: side('warden', 22, mateBoard()), p3: side('indy', 23, foeBoard()), p4: side('gorr', 24, foeBoard()) },
  });
  const warBuffs = (events: CombatEvent[]) => events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'Ancient of War');
  const tagIn = (events: CombatEvent[], s: 'player' | 'enemy') => events.find((e): e is Extract<CombatEvent, { type: 'tagIn' }> => e.type === 'tagIn' && e.side === s);

  it('the Magician\'s locked side carries it into the fight', () => {
    expect(ancientCombatMods(picked('war')).ancientMateSwap).toEqual({ label: 'Ancient of War' });
    expect(side('magician', 21, magicianBoard(), 'war').state.questMods?.ancientMateSwap).toEqual({ label: 'Ancient of War' });
    expect(side('magician', 21, magicianBoard()).state.questMods?.ancientMateSwap).toBeUndefined();
  });

  it('a real Duos round, whoever fights first: both copies gain the other\'s stats, once', () => {
    // The teams alternate who fights first: across two rounds the Magician is the first board once and the reserve once.
    const firsts = new Set<string>();
    for (const r of [1, 2]) {
      const res = round(r);
      expect(res.refused).toEqual({});
      firsts.add(res.first.a);
      const ev = res.aResult.events;
      const magicianFirst = res.first.a === 'p1';
      const buffs = warBuffs(ev);
      // The copy on the board that fights first gains the other copy's stats (a labelled combat buff)...
      expect(buffs).toHaveLength(1);
      expect([buffs[0]!.attack, buffs[0]!.health]).toEqual(magicianFirst ? [7, 9] : [3, 50]);
      // ...and the copy on the waiting board steps in with the first one's.
      const shared = tagIn(ev, 'player')!.minions.find((m) => m.cardId === SHARED)!;
      expect([shared.attack, shared.health]).toEqual([10, 59]);
    }
    expect([...firsts].sort()).toEqual(['p1', 'p2']);
  });

  it('without the pairing the same round has no such buff (the test fails without the effect)', () => {
    const res = round(1, null);
    expect(warBuffs(res.aResult.events)).toHaveLength(0);
    const shared = tagIn(res.aResult.events, 'player')!.minions.find((m) => m.cardId === SHARED)!;
    expect([[7, 9], [3, 50]]).toContainEqual([shared.attack, shared.health]);
  });

  it('the enemy team gets exactly the same when the Magician sits on it (sides are symmetric)', () => {
    const res = resolveVersusDuosRound({
      matchSeed: 77, round: 1,
      sides: { p1: side('indy', 23, foeBoard()), p2: side('gorr', 24, foeBoard()), p3: side('magician', 21, magicianBoard(), 'war'), p4: side('warden', 22, mateBoard()) },
    });
    const ev = res.bResult.events; // team B's own view: it is `player` there
    expect(warBuffs(ev)).toHaveLength(1);
    const shared = tagIn(ev, 'player')!.minions.find((m) => m.cardId === SHARED)!;
    expect([shared.attack, shared.health]).toEqual([10, 59]);
    // And in team A's view the same buff sits on the enemy side.
    expect(warBuffs(res.aResult.events)).toHaveLength(1);
  });

  it('the same round resolves to the same bytes twice', () => {
    expect(JSON.stringify(round(1))).toBe(JSON.stringify(round(1)));
  });

  it('the locked sides survive storage: read back from JSON they resolve to the same bytes', () => {
    const live = { p1: side('magician', 21, magicianBoard(), 'war'), p2: side('warden', 22, mateBoard()), p3: side('indy', 23, foeBoard()), p4: side('gorr', 24, foeBoard()) };
    const stored = JSON.parse(JSON.stringify(live)) as typeof live;
    expect(JSON.stringify(resolveVersusDuosRound({ matchSeed: 77, round: 1, sides: stored }))).toBe(JSON.stringify(resolveVersusDuosRound({ matchSeed: 77, round: 1, sides: live })));
  });
});
