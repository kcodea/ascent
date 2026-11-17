/**
 * A PASS TO A FULL HAND NEVER FAILS (owner 2026-11-16, R-DUOS-PASS-WAITS-01): "A passed minion when a teammates hand is
 * full should actually not fail, and should enter the teammates hand when they have space."
 *
 * Supersedes 2026-10-25's "Pass is refused if hand is full". The sender's pass completes (all costs paid, every on-pass
 * effect once); the card waits on the receiver's run, first in first out, and lands the moment there is room. A pass the
 * ROOM refuses for another rule (the clock, the cap, a teammate away) still comes back whole, and Priestess x Bonds'
 * own +10/+10 comes off with it (ancients audit F1: a refund used to keep it, so a pass repeated for free).
 *
 * Every step goes through the real reducer on two teammates' runs; the wire form is `duosWireOf`, as the store ships it.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { ANCIENT_IDS, ancientPassesThisGame, reduce, type AncientId, type BoardCard, type RunState } from './index';
import { createVersusRun } from './versus/run';
import type { VersusRoomOptions } from './versus/options';
import { DUOS_BONDS_SOURCE, duosPassBlocked, duosWaitingCount, duosWireOf } from './duosPass';
import { ANCIENTS } from './ancients';
import { handCap } from './state';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };
const minions = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby).map((c) => c!);
const PLAIN = minions.filter((c) => c.effects.length === 0 && c.keywords.length === 0 && c.tier <= 2).map((c) => c.id);

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** The teammate's full hand: ten DIFFERENT minions, none of them a passed card (so nothing triples). */
const fullHand = (): BoardCard[] => minions.filter((c) => c.tier <= 2 && !PLAIN.slice(0, 3).includes(c.id)).slice(0, 10).map((c, i) => card(`f${i}`, c.id));
const keyed = (s: RunState, key: string): BoardCard | undefined => s.hand.find((c) => c.passKey === key);

const priestess = (over: Partial<RunState> = {}, ancient?: AncientId): RunState => {
  let s = { ...createVersusRun(11, 'priestess', 'set2', DUOS, 'warden', ancient ? { ancients: true } : undefined), phase: 'recruit', embers: 20, heroReady: true, hand: [], board: [], shop: [], spell: null, ...over } as RunState;
  if (ancient) {
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [ancient, ...ANCIENT_IDS.filter((a) => a !== ancient).slice(0, 2)] } };
    s = reduce(s, { type: 'pickAncient', id: ancient });
    expect(s.ancients!.picked).toBe(ancient);
  }
  return s;
};
const mate = (over: Partial<RunState> = {}): RunState =>
  ({ ...createVersusRun(12, 'warden', 'set2', DUOS, 'priestess'), phase: 'recruit', embers: 10, hand: [], board: [], shop: [], spell: null, ...over } as RunState);
/** Ship outbox entries from `since` on to the teammate's run (`receivePass`), as the Versus store does. */
function ship(from: RunState, to: RunState, since = 0): RunState {
  let out = to;
  for (const e of from.duos!.outbox.slice(since)) out = reduce(out, { type: 'receivePass', from: 'p1', seq: e.seq, card: duosWireOf(e) });
  return out;
}
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;

describe('R-DUOS-PASS-WAITS-01: a manual pass to a full hand completes and waits for room', () => {
  it('the teammate\'s full hand is no longer a reason to refuse the drag', () => {
    const s = priestess({ hand: [card('h', PLAIN[0]!)] });
    expect(duosPassBlocked(s, 'h')).toBeNull();
  });

  it('the sender pays once and keeps nothing back; the receiver answers it as landed and holds the card', () => {
    const s = reduce(priestess({ hand: [card('h', PLAIN[0]!)] }), { type: 'passCard', uid: 'h' });
    expect(s.embers).toBe(19);
    expect(s.hand).toHaveLength(0);
    const b = ship(s, mate({ hand: fullHand() }));
    expect(b.duos!.received).toEqual(['p1:0']);
    expect(b.duos!.refused).toEqual([]);
    expect(b.hand).toHaveLength(handCap(b));
    expect(duosWaitingCount(b)).toBe(1);
    expect(b.duos!.waiting![0]!.card.cardId).toBe(PLAIN[0]);
    // No transport marker rides on the waiting card.
    expect(Object.keys(b.duos!.waiting![0]!.card)).not.toContain('passFrom');
  });

  it('several waiting cards land first in, first out, one per free slot, each with the pass key it came by', () => {
    let s = priestess({ hand: [card('h1', PLAIN[0]!), card('h2', PLAIN[1]!), card('h3', PLAIN[2]!)] });
    for (const uid of ['h1', 'h2', 'h3']) s = reduce(s, { type: 'passCard', uid });
    let b = ship(s, mate({ hand: fullHand() }));
    expect(b.duos!.waiting!.map((w) => w.card.cardId)).toEqual([PLAIN[0], PLAIN[1], PLAIN[2]]);
    // One slot opens: only the first lands.
    b = reduce({ ...b, hand: b.hand.slice(1) }, { type: 'roll' });
    expect(keyed(b, 'p1:0')?.cardId).toBe(PLAIN[0]);
    expect(b.duos!.waiting!.map((w) => w.key)).toEqual(['p1:1', 'p1:2']);
    // Two more open: the rest land in order, and the queue is gone.
    b = reduce({ ...b, hand: b.hand.slice(2) }, { type: 'roll' });
    expect([keyed(b, 'p1:1')?.cardId, keyed(b, 'p1:2')?.cardId]).toEqual([PLAIN[1], PLAIN[2]]);
    expect(b.hand.slice(-2).map((c) => c.passKey)).toEqual(['p1:1', 'p1:2']);
    expect(b.duos!.waiting).toBeUndefined();
  });

  it('a pass arriving behind a waiting card waits too, even when a slot is free (no overtaking)', () => {
    let s = priestess({ hand: [card('h1', PLAIN[0]!), card('h2', PLAIN[1]!)] });
    s = reduce(s, { type: 'passCard', uid: 'h1' });
    let b = ship(s, mate({ hand: fullHand() }));
    s = reduce(s, { type: 'passCard', uid: 'h2' });
    // One slot opened outside any action (the queue has not run yet). The second pass queues BEHIND the first, then
    // the queue runs: the first takes the free slot, the second keeps waiting.
    b = ship(s, { ...b, hand: b.hand.slice(1) }, 1);
    expect(keyed(b, 'p1:0')).toBeDefined();
    expect(keyed(b, 'p1:1')).toBeUndefined();
    expect(b.duos!.waiting!.map((w) => w.key)).toEqual(['p1:1']);
  });

  it('the same pass delivered twice is received once', () => {
    const s = reduce(priestess({ hand: [card('h', PLAIN[0]!)] }), { type: 'passCard', uid: 'h' });
    const once = ship(s, mate({ hand: fullHand() }));
    expect(ship(s, once)).toBe(once);
  });
});

describe('Priestess x Bonds through a full hand (audit F1): the +10/+10 is given exactly once, and the card arrives when space opens', () => {
  const start = (): RunState => priestess({ board: [card('a', PLAIN[0]!, { attack: 1, health: 1 })], hand: [card('h', PLAIN[1]!)] }, 'bonds');
  const mateBoard = (): BoardCard[] => [card('x', PLAIN[2]!, { attack: 2, health: 2 })];

  it('THE TEST: a full-hand pass buffs both left-most minions once; room opens; the card lands; nothing is given again', () => {
    let s = reduce(start(), { type: 'passCard', uid: 'h' });
    expect([at(s, 'a').attack, at(s, 'a').health]).toEqual([11, 11]);
    expect(s.embers).toBe(19);
    let b = ship(s, mate({ board: mateBoard(), hand: fullHand() }));
    expect([b.board[0]!.attack, b.board[0]!.health]).toEqual([12, 12]);
    expect(duosWaitingCount(b)).toBe(1);
    expect(b.hand.some((c) => c.passKey === 'p1:0')).toBe(false);
    // The pass is final for the sender: nothing comes back to refund, so the card cannot be passed again for free.
    expect(s.hand).toHaveLength(0);
    expect(s.duos!.outbox[0]!.refunded).toBeUndefined();
    expect(ancientPassesThisGame(s)).toBe(1);
    // A second delivery of the same pass (a retry, a pull) changes nothing.
    expect(ship(s, b)).toBe(b);
    // Room opens (the teammate plays a card): the passed card lands, and the +10/+10 is not given a second time.
    b = reduce({ ...b, hand: b.hand.slice(1) }, { type: 'roll' });
    expect(keyed(b, 'p1:0')?.cardId).toBe(PLAIN[1]);
    expect(duosWaitingCount(b)).toBe(0);
    expect([b.board[0]!.attack, b.board[0]!.health]).toEqual([12, 12]);
    s = reduce(s, { type: 'roll' });
    expect([at(s, 'a').attack, at(s, 'a').health]).toEqual([11, 11]);
  });

  it('a pass the ROOM refuses (the cap, the clock, a teammate away) takes Bonds back: three refusals leave the minion at 1/1, for 0 Gold', () => {
    let s = start();
    expect(DUOS_BONDS_SOURCE).toBe(ANCIENTS.bonds.name);
    const gold = s.embers;
    for (let i = 0; i < 3; i++) {
      s = reduce(s, { type: 'passCard', uid: 'h' });
      expect(at(s, 'a').attack).toBe(11);
      s = reduce(s, { type: 'passRefunded', seq: s.duos!.outbox.length - 1 });
      expect([at(s, 'a').attack, at(s, 'a').health]).toEqual([1, 1]);
      expect(at(s, 'a').buffs?.some((x) => x.source === DUOS_BONDS_SOURCE) ?? false).toBe(false);
    }
    expect(s.embers).toBe(gold);
    expect(s.hand.map((c) => c.uid)).toEqual(['h']);
    expect(ancientPassesThisGame(s)).toBe(0);
  });

  it('a refused Passaria pass takes its Bonds back too (the buff went to the minion left-most after the pass)', () => {
    let s = priestess({ board: [card('a', PLAIN[0]!, { attack: 1, health: 1 }), card('b', PLAIN[1]!, { attack: 1, health: 1 })] }, 'bonds');
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(at(s, 'b')).toMatchObject({ attack: 11, health: 11 });
    s = reduce(s, { type: 'passRefunded', seq: 0 });
    expect(at(s, 'b')).toMatchObject({ attack: 1, health: 1 });
    expect(at(s, 'a')).toBeDefined();
    expect(s.heroReady).toBe(true);
  });

  it('a refund never kills: a buffed minion that lost Health since keeps at least 1', () => {
    let s = reduce(start(), { type: 'passCard', uid: 'h' });
    s = { ...s, board: s.board.map((c) => (c.uid === 'a' ? { ...c, health: 5 } : c)) };
    s = reduce(s, { type: 'passRefunded', seq: 0 });
    expect(at(s, 'a').health).toBe(1);
  });
});
