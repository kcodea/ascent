/**
 * ANCIENTS × CINDY (Duos only; owner pairings 2026-11-14, R-ANCCINDY-01..06). Golden Gratitude (0 Gold, once per game):
 * "The next minion your teammate buys gives you a Gilded copy of it." Every pairing through the real reducer on two
 * teammates' runs (each outbox entry travels as `duosWireOf` and lands through `receivePass`, as the Versus store ships
 * it). The combat halves are in `packages/core/src/combat/cindyAncients.test.ts`.
 *
 * Ancients are not on in any Duos game players can reach: Cindy's run here is built with `createVersusRun`'s dev seam.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatResult } from '@game/core';
import {
  ANCIENT_IDS, ANCIENT_PAIRINGS, ancientAfterCombat, ancientAvengeReset, ancientCombatMods, ancientOfferText, ancientStartOfTurn, heroPowerText, questCombatMods, reduce,
  type AncientId, type BoardCard, type RunState, type ShopCard,
} from './index';
import { createVersusRun } from './versus/run';
import type { VersusRoomOptions } from './versus/options';
import { duosWireOf } from './duosPass';
import { addBuff, fireOnFriendDeath, gildMinion } from './recruit';
import { duosLinkSync } from './duosLinks';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };
const PLAIN = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby && c.tier <= 4 && c.effects.length === 0 && c.keywords.length === 0 && !c.chooseOne && !c.universalTribe).map((c) => c!.id);
const offer = (i: number, over: Partial<ShopCard> = {}): ShopCard => ({ uid: `s${i}`, cardId: PLAIN[i % PLAIN.length]!, ...over });
const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};

/** Cindy's run with Ancients (the dev seam), in the Shop. */
const cindy = (over: Partial<RunState> = {}): RunState =>
  ({ ...createVersusRun(11, 'cindy', 'set2', DUOS, 'warden', { ancients: true }), phase: 'recruit', embers: 50, hand: [], board: [], shop: [offer(5), offer(6)], spell: null, ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = cindy(over);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
/** Her teammate's run (no Ancients: the pairing is Cindy's). */
const mate = (over: Partial<RunState> = {}): RunState =>
  ({ ...createVersusRun(12, 'warden', 'set2', DUOS, 'cindy'), phase: 'recruit', embers: 100, hand: [], board: [], shop: [offer(0), offer(1), offer(2)], spell: null, ...over } as RunState);
/** Deliver every outbox entry of `from` (from `since` on) to `to`, as the room would. */
function ship(from: RunState, to: RunState, since = 0): RunState {
  let out = to;
  for (const e of from.duos!.outbox.slice(since)) out = reduce(out, { type: 'receivePass', from: 'p1', seq: e.seq, card: duosWireOf(e) });
  return out;
}
const press = (s: RunState): RunState => reduce(s, { type: 'heroPower' });
const teamOf = (s: RunState, since = 0) => s.duos!.outbox.slice(since).filter((e) => e.team).map((e) => e.team!);
const linked = (s: RunState): BoardCard[] => [...s.board, ...s.hand].filter((c) => c.duosLink);
/** Cindy (with `id` picked) presses, her teammate hears it and buys the left-most Shop minion; the copy lands. */
function payout(id: AncientId, ann0 = picked(id), bob0 = mate()): { ann: RunState; bob: RunState } {
  const ann = press(ann0);
  const bob = reduce(ship(ann, bob0), { type: 'buy', uid: 's0' });
  return { ann: ship(bob, ann), bob };
}

describe('Cindy × every Ancient has a written pairing', () => {
  it('all six are written, in plain words: no em dash, no "Oath" or "climb", "Gold" spelled out', () => {
    for (const id of ANCIENT_IDS) {
      const p = ANCIENT_PAIRINGS.cindy![id]!;
      expect(ancientOfferText('cindy', id)).not.toBe('Not written yet.');
      for (const t of [p.offerText, p.powerText]) {
        expect(t).not.toMatch(/—|--|Oath|climb/i);
        expect(t).not.toMatch(/\d\s?g\b/);
      }
    }
  });

  it('the owner\'s words, on the offer', () => {
    expect(ANCIENT_PAIRINGS.cindy!.death!.offerText).toBe('When **15** friendly minions die, give your teammate a **Goldcrafter**.');
    expect(ANCIENT_PAIRINGS.cindy!.fortune!.offerText).toBe('Every **40 Gold** spent, refresh your hero power.');
    expect(ANCIENT_PAIRINGS.cindy!.war!.offerText).toBe('**Start of Combat:** your left-most minion is **Gilded**.');
    expect(ANCIENT_PAIRINGS.cindy!.genesis!.offerText).toBe("Your teammate's copy is **Gilded**, too.");
    expect(ANCIENT_PAIRINGS.cindy!.time!.offerText).toBe('You and your teammate get a **Goldcrafter** next turn.');
    expect(ANCIENT_PAIRINGS.cindy!.bonds!.offerText).toBe('The copies of your cards are **Linked**. When one gains stats, the other does too.');
  });
});

describe('Death: When 15 friendly minions die, give your teammate a Goldcrafter (R-ANCCINDY-01, carry-over since R-ANCIENT-CARRYOVER-01)', () => {
  it('the 15th friendly death in the Shop gives the teammate a Goldcrafter right then, and it repeats', () => {
    let s = picked('death', { board: [card('d1', PLAIN[0]!)] });
    s = { ...s, ancients: { ...s.ancients!, cindyDeaths: 14 } };
    const before = s.duos!.outbox.length;
    fireOnFriendDeath(s, s.board[0]!); // one Shop death (every destroy path walks this)
    expect(s.ancients!.cindyDeaths).toBe(0);
    expect(teamOf(s, before)).toEqual([{ kind: 'gift', cardId: 'goldcrafter' }]);
    const bob = ship(s, mate(), before);
    expect(bob.hand.map((c) => c.cardId)).toEqual(['goldcrafter']);
    // 14 more deaths: nothing; the 15th: a second one.
    for (let i = 0; i < 14; i++) fireOnFriendDeath(s, s.board[0]!);
    expect(teamOf(s, before)).toHaveLength(1);
    fireOnFriendDeath(s, s.board[0]!);
    expect(teamOf(s, before)).toHaveLength(2);
  });

  it('one running count across phases (the carry-over kind, R-ANCIENT-CARRYOVER-01): combat carries it in, settle adds the fight\'s deaths, the phase reset keeps it', () => {
    let s = picked('death');
    s = { ...s, ancients: { ...s.ancients!, cindyDeaths: 9 } };
    expect(ancientCombatMods(s).ancientMateGiftAvenge).toEqual({ every: 15, tick: 9, gift: { kind: 'gift', cardId: 'goldcrafter' }, label: 'Ancient of Death', carry: true });
    ancientAvengeReset(s); // the fight-start boundary
    expect(s.ancients!.cindyDeaths).toBe(9);
    ancientAfterCombat(s, { playerDeaths: 8 } as CombatResult);
    expect(s.ancients!.cindyDeaths).toBe(2); // 9 + 8 = 17: one fire (paid live in the fight), 2 toward the next
    // ...and the next Shop picks up from there: 13 Shop deaths pay the next one.
    s = { ...s, board: [card('d1', PLAIN[0]!)] };
    const before = s.duos!.outbox.length;
    for (let i = 0; i < 12; i++) fireOnFriendDeath(s, s.board[0]!);
    expect(teamOf(s, before)).toHaveLength(0);
    fireOnFriendDeath(s, s.board[0]!);
    expect(teamOf(s, before)).toEqual([{ kind: 'gift', cardId: 'goldcrafter' }]);
  });

  it('a sale is not a death (it never counts)', () => {
    const s = reduce(picked('death', { board: [card('d1', PLAIN[0]!)] }), { type: 'sell', uid: 'd1' });
    expect(s.ancients!.cindyDeaths ?? 0).toBe(0);
  });

  it('the power prints the live count; without Death nothing counts (fails without the effect)', () => {
    let s = picked('death');
    s = { ...s, ancients: { ...s.ancients!, cindyDeaths: 4 } };
    expect(heroPowerText(s)).toContain('When **15** friendly minions die, give your teammate a **Goldcrafter** (**11** more to go).');
    expect(heroPowerText(s, 0, { friendlyDeaths: 6 }), 'live through a fight: the replay adds to the carried count').toContain('(**5** more to go)');
    const war = picked('war', { board: [card('d1', PLAIN[0]!)] });
    fireOnFriendDeath(war, war.board[0]!);
    expect(war.ancients!.cindyDeaths).toBeUndefined();
  });
});

describe('Fortune: spending 40 Gold refreshes Golden Gratitude (R-ANCCINDY-02)', () => {
  it('after it paid, the 40th Gold gives the once-per-game use back, and it can be pressed again', () => {
    const { ann } = payout('fortune');
    expect(ann.cindyGratitude).toBe('paid');
    expect(ann.heroPowerSpent).toBe(true);
    let s = { ...ann, ancients: { ...ann.ancients!, cindyGold: 39 } } as RunState;
    s = reduce(s, { type: 'roll' }); // 1 Gold: the 40th
    expect(s.ancients!.cindyGold).toBe(0);
    expect(s.heroPowerSpent).toBe(false);
    expect(s.cindyGratitude).toBeUndefined();
    const again = press(s);
    expect(again.cindyGratitude).toBe('armed');
    expect(teamOf(again, s.duos!.outbox.length)).toEqual([{ kind: 'gratitude' }]);
  });

  it('a refresh earned while it waits on the buy is banked, and pays the moment the copy lands', () => {
    let ann = press(picked('fortune'));
    ann = { ...ann, ancients: { ...ann.ancients!, cindyGold: 39 } } as RunState;
    ann = reduce(ann, { type: 'roll' });
    expect(ann.cindyGratitude).toBe('armed');
    expect(ann.ancients!.cindyRefreshBanked).toBe(1);
    expect(heroPowerText(ann)).toContain('A refresh is waiting for your copy.');
    const bob = reduce(ship(ann, mate()), { type: 'buy', uid: 's0' });
    const got = ship(bob, ann);
    expect(got.cindyGratitude).toBeUndefined();
    expect(got.heroPowerSpent).toBe(false);
    expect(got.ancients!.cindyRefreshBanked).toBeUndefined();
  });

  it('a refresh earned while it is still UNUSED is banked, shown, and pays once the next use is spent (R-ANCSYS-05)', () => {
    let s = picked('fortune');
    s = { ...s, ancients: { ...s.ancients!, cindyGold: 39 } } as RunState;
    s = reduce(s, { type: 'roll' });
    expect(s.cindyGratitude).toBeUndefined();
    expect(s.heroPowerSpent).toBeFalsy();
    expect(s.ancients!.cindyRefreshBanked).toBe(1);
    expect(heroPowerText(s)).toContain('A refresh is banked for after your next use.');
    const armed = press(s);
    expect(armed.cindyGratitude).toBe('armed');
    expect(heroPowerText(armed)).toContain('A refresh is waiting for your copy.');
    const bob = reduce(ship(armed, mate()), { type: 'buy', uid: 's0' });
    const got = ship(bob, armed);
    expect(got.cindyGratitude, 'the banked refresh paid as the copy landed').toBeUndefined();
    expect(got.heroPowerSpent).toBe(false);
    expect(got.ancients!.cindyRefreshBanked).toBeUndefined();
  });

  it('the count prints live; without Fortune nothing refreshes', () => {
    let s = picked('fortune');
    s = { ...s, ancients: { ...s.ancients!, cindyGold: 39 } } as RunState;
    s = reduce(s, { type: 'roll' });
    expect(heroPowerText(reduce(s, { type: 'roll' }))).toContain('(**1/40**)');
    const { ann } = payout('war');
    const spent = reduce({ ...ann, embers: 100, ancients: { ...ann.ancients!, cindyGold: 39 } } as RunState, { type: 'roll' });
    expect(spent.heroPowerSpent).toBe(true);
    expect(spent.cindyGratitude).toBe('paid');
  });
});

describe('War: Start of Combat, your left-most minion is Gilded (R-ANCCINDY-03)', () => {
  it('rides into the fight; an Engraved one the fight hands back stays Gilded', () => {
    const s = picked('war', { board: [card('w1', PLAIN[0]!, { keywords: ['EG'] }), card('w2', PLAIN[1]!)] });
    expect(ancientCombatMods(s).ancientSocGildLeftmost).toEqual({ label: 'Ancient of War' });
    ancientAfterCombat(s, { playerDeaths: 0, playerAncientGildKept: ['w1'] } as CombatResult);
    expect(s.board.map((c) => c.golden)).toEqual([true, false]);
  });

  it('nothing comes home for a non-Engraved minion, so it is back to plain; the text names the minion now', () => {
    const s = picked('war', { board: [card('w1', PLAIN[0]!)] });
    ancientAfterCombat(s, { playerDeaths: 0 } as CombatResult);
    expect(s.board[0]!.golden).toBe(false);
    expect(heroPowerText(s)).toContain(`(now **${CARD_INDEX[PLAIN[0]!]!.name}**)`);
    expect(ancientCombatMods(picked('death')).ancientSocGildLeftmost).toBeUndefined();
  });
});

describe('Genesis: your teammate\'s copy is Gilded, too (R-ANCCINDY-04)', () => {
  it('the arm carries the gild; the teammate\'s bought minion turns Gilded and Cindy still gets her Gilded copy', () => {
    const ann = press(picked('genesis'));
    expect(teamOf(ann)).toEqual([{ kind: 'gratitude', gild: true }]);
    const { ann: got, bob } = payout('genesis');
    const def = CARD_INDEX[PLAIN[0]!]!;
    expect(bob.hand[0]).toMatchObject({ cardId: def.id, golden: true, attack: def.attack * 2, health: def.health * 2 });
    expect(got.hand.at(-1)).toMatchObject({ cardId: def.id, golden: true });
  });

  it('picked after the press, the gild follows the arm (an update); without Genesis the bought minion stays plain', () => {
    let ann = press(cindy());
    ann = { ...ann, ancients: { ...ann.ancients!, points: ann.ancients!.cost, offer: ['genesis', 'war', 'time'] } };
    const at = ann.duos!.outbox.length;
    ann = reduce(ann, { type: 'pickAncient', id: 'genesis' });
    expect(teamOf(ann, at)).toEqual([{ kind: 'gratitude', update: true, gild: true }]);
    const bob = reduce(ship(ann, mate()), { type: 'buy', uid: 's0' });
    expect(bob.hand[0]!.golden).toBe(true);
    expect(payout('war').bob.hand[0]!.golden).toBe(false);
  });

  it('an update never arms a power that has not been pressed (or has paid)', () => {
    const bob = reduce(mate(), { type: 'receivePass', from: 'p1', seq: 0, card: duosWireOf({ seq: 0, wave: 1, card: { uid: 't0', cardId: PLAIN[0]!, tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false }, from: 'hand', index: -1, paid: 0, team: { kind: 'gratitude', update: true, gild: true } }) });
    expect(bob.duos!.gratitude).toBeUndefined();
    expect(bob.duos!.gratitudeGild).toBeUndefined();
  });
});

describe('Time: you and your teammate get a Goldcrafter next turn (R-ANCCINDY-05)', () => {
  it('once, at the Start of the turn after the pick: one to her hand, one to her teammate', () => {
    const s = picked('time');
    expect(heroPowerText(s)).toContain('You and your teammate get a **Goldcrafter** next turn.');
    const before = s.duos!.outbox.length;
    ancientStartOfTurn(s); // the pick's own turn: not yet
    expect(s.hand).toHaveLength(0);
    s.wave += 1;
    ancientStartOfTurn(s);
    expect(s.hand.map((c) => c.cardId)).toEqual(['goldcrafter']);
    expect(teamOf(s, before)).toEqual([{ kind: 'gift', cardId: 'goldcrafter' }]);
    expect(s.sotBeatFx?.length).toBeGreaterThan(0); // its own Start-of-Turn beat
    expect(ship(s, mate(), before).hand.map((c) => c.cardId)).toEqual(['goldcrafter']);
    expect(heroPowerText(s)).toContain('You and your teammate each got a **Goldcrafter**.');
    s.wave += 1;
    ancientStartOfTurn(s);
    expect(s.hand).toHaveLength(1);
    expect(teamOf(s, before)).toHaveLength(1);
  });
});

describe('Bonds: the copies are Linked (R-ANCCINDY-06)', () => {
  const linkedPair = (): { ann: RunState; bob: RunState } => payout('bonds');

  it('the arm carries the link; both copies land Linked under one id, and print "Linked"', () => {
    expect(teamOf(press(picked('bonds')))).toEqual([{ kind: 'gratitude', link: true }]);
    const { ann, bob } = linkedPair();
    const [a] = linked(ann), [b] = linked(bob);
    expect(a && b).toBeTruthy();
    expect(a!.duosLink!.id).toBe(b!.duosLink!.id);
    expect(ann.duosLinkIds).toEqual([a!.duosLink!.id]);
    expect(bob.duosLinkIds).toEqual([a!.duosLink!.id]);
    expect(payout('genesis').bob.hand.some((c) => c.duosLink)).toBe(false); // without Bonds: no link
  });

  it('a Shop gain on either is gained by the other, once: no ping-pong', () => {
    const { ann, bob } = linkedPair();
    const bobAt = bob.duos!.outbox.length;
    // The teammate's copy gains +3/+2 (any Shop gain: the boundary measures it).
    const buffed = structuredClone(bob) as RunState;
    addBuff(buffed.hand[0]!, 'Test', 3, 2);
    const bob2 = reduce(buffed, { type: 'roll' });
    expect(teamOf(bob2, bobAt)).toEqual([{ kind: 'linkGain', id: bob.hand[0]!.duosLink!.id, attack: 3, health: 2 }]);
    const annAt = ann.duos!.outbox.length;
    const before = linked(ann)[0]!;
    const ann2 = ship(bob2, ann, bobAt);
    const after = linked(ann2)[0]!;
    expect([after.attack - before.attack, after.health - before.health]).toEqual([3, 2]);
    // The mirrored gain is never sent back, even after more actions.
    expect(teamOf(reduce(ann2, { type: 'roll' }), annAt).filter((t) => t.kind === 'linkGain')).toHaveLength(0);
    // …and the other way: Cindy's copy gains, the teammate's twin follows.
    const cBuff = structuredClone(ann2) as RunState;
    addBuff(linked(cBuff)[0]!, 'Test', 1, 1);
    const ann3 = reduce(cBuff, { type: 'roll' });
    const bob3 = ship(ann3, bob2, annAt);
    expect([bob3.hand[0]!.attack - bob2.hand[0]!.attack, bob3.hand[0]!.health - bob2.hand[0]!.health]).toEqual([1, 1]);
  });

  it('a gain landing at settle (a kept combat gain) is mirrored like a Shop one: the boundary hears every action', () => {
    const { bob } = linkedPair();
    const s = structuredClone(bob) as RunState;
    const at = s.duos!.outbox.length;
    s.hand[0]!.attack += 5; // what a settle's Engraved carry-back does to the run card
    duosLinkSync(s);
    expect(teamOf(s, at)).toEqual([{ kind: 'linkGain', id: s.hand[0]!.duosLink!.id, attack: 5, health: 0 }]);
  });

  it('gilding either copy keeps the link and is not a gain', () => {
    const { bob } = linkedPair();
    const s = structuredClone(bob) as RunState;
    const at = s.duos!.outbox.length;
    gildMinion(s.hand[0]!, s);
    const after = reduce(s, { type: 'roll' });
    expect(after.hand[0]!.golden).toBe(true);
    expect(after.hand[0]!.duosLink).toBeTruthy();
    expect(teamOf(after, at).filter((t) => t.kind === 'linkGain')).toHaveLength(0);
  });

  it('a triple hands the link to its Golden', () => {
    const { bob } = linkedPair();
    const id = bob.hand[0]!.duosLink!.id;
    const s = { ...bob, hand: [...bob.hand, card('x1', bob.hand[0]!.cardId)], shop: [offer(0, { uid: 's9' })] } as RunState;
    const after = reduce(s, { type: 'buy', uid: 's9' });
    const golden = after.hand.find((c) => c.golden && c.cardId === bob.hand[0]!.cardId);
    expect(golden?.duosLink?.id).toBe(id);
    expect(teamOf(after, bob.duos!.outbox.length).some((t) => t.kind === 'linkEnd')).toBe(false);
  });

  it('a sold twin ends the link on both runs', () => {
    const { ann, bob } = linkedPair();
    const at = bob.duos!.outbox.length;
    const placed = reduce(bob, { type: 'play', uid: bob.hand[0]!.uid, toIndex: 0 });
    const sold = reduce(placed, { type: 'sell', uid: placed.board[0]!.uid });
    expect(teamOf(sold, at).filter((t) => t.kind === 'linkEnd' || t.kind === 'linkGain')).toEqual([{ kind: 'linkEnd', id: ann.duosLinkIds![0]! }]);
    expect(sold.duosLinkIds).toBeUndefined();
    const ann2 = ship(sold, ann, at);
    expect(linked(ann2)).toHaveLength(0);
    expect(ann2.duosLinkIds).toBeUndefined();
  });

  it('the Linked board cards ride into the fight (`duosLinks`), with or without an Ancient on that run', () => {
    const { bob } = linkedPair();
    const placed = reduce(bob, { type: 'play', uid: bob.hand[0]!.uid, toIndex: 0 });
    expect(questCombatMods(placed).duosLinks).toEqual([{ id: placed.board[0]!.duosLink!.id, uid: placed.board[0]!.uid }]);
    expect(questCombatMods(mate()).duosLinks).toBeUndefined();
  });

  it('a passed card never travels Linked', () => {
    const { bob } = linkedPair();
    const s = reduce(bob, { type: 'passCard', uid: bob.hand[0]!.uid });
    const e = s.duos!.outbox.find((x) => !x.team && x.card.cardId === bob.hand[0]!.cardId && !x.gratitude);
    if (e) expect(duosWireOf(e)).not.toHaveProperty('duosLink');
  });
});
