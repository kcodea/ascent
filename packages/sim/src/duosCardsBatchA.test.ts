/**
 * DUOS-ONLY CARDS, batch A (owner design 2026-10-30): Antsy, Salandaman, Bratworst Buck, Spencer, Roo, Toot Toot, Proxus,
 * Hippie Hulk, Galfagan, Monstrocity, Broshake, Tribe Bundle. Each through the real reducer on two teammates' runs (the
 * sender's outbox shipped to the receiver the way the transport does). Combat cards fight a real `simulate()` through the
 * deferred-fight path the Duos resolver uses, so the team carry is the one the live game lands at settle.
 */
import { describe, expect, it } from 'vitest';
import { ALE_IDS, combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, SETS, duosPoolFor, type SetId } from '@game/content';
import { reduce } from './reducer';
import { type BoardCard, type RunState } from './state';
import { createVersusRun } from './versus/run';
import type { VersusRoomOptions } from './versus/options';
import { duosWireOf } from './duosPass';
import { fireShopRally, isTribe } from './recruit';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };

function card(id: string, uid: string, golden = false, over: Partial<BoardCard> = {}): BoardCard {
  const d = CARD_INDEX[id]!;
  const g = golden ? 2 : 1;
  return { uid, cardId: id, tribe: d.tribe, attack: d.attack * g, health: d.health * g, keywords: [...d.keywords], golden, ...over };
}

/** A Duos seat's run in its first Shop with a chosen hand and board. */
function seat(over: Partial<RunState> = {}, seed = 11): RunState {
  const run = createVersusRun(seed, 'warden', 'set2', DUOS);
  return { ...run, hand: [], board: [], embers: 10, ...over };
}

/** Ship every entry `from` queued since `since` to `to` the way the transport does (the wire form, `receivePass`). */
function ship(from: RunState, fromSeat: string, to: RunState, since = 0): RunState {
  let out = to;
  for (const e of from.duos!.outbox.slice(since)) out = reduce(out, { type: 'receivePass', from: fromSeat, seq: e.seq, card: duosWireOf(e) });
  return out;
}

const teamOut = (s: RunState) => s.duos!.outbox.filter((e) => e.team).map((e) => e.team!);
const vanilla = (n: number, prefix = 'f', tier = 1): BoardCard[] => {
  const id = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.tier === tier && !c.duos && c.effects.length === 0 && c.keywords.length === 0)!.id;
  return Array.from({ length: n }, (_, i) => card(id, `${prefix}${i}`));
};
const foe = (attack: number, health: number, n = 1): BoardMinion[] =>
  Array.from({ length: n }, () => ({ cardId: 'sandbag', attack, health, keywords: [] }) as unknown as BoardMinion);

/** End the turn (the deferred Duos fight), fight `enemy` with a real `simulate()`, and settle. */
function fight(run: RunState, enemy: BoardMinion[], seed = 7): { after: RunState; events: { type: string; attacker?: string }[]; initial: { uid: string; cardId: string }[] } {
  const parked = reduce(run, { type: 'faceOmen', deferFight: true });
  const prep = parked.pendingCombatSide!;
  expect(prep).toBeDefined();
  const result = simulate(structuredClone(prep.board), structuredClone(enemy), makeRng(seed), CARD_INDEX, structuredClone(prep.state), combatSide({ tier: 6 }), prep.config);
  const after = reduce(parked, { type: 'resolveCombat', fight: { result, damageTaken: 0 } });
  return { after, events: result.events as never, initial: result.initial.player };
}

describe('pool membership (batch A)', () => {
  it('each card joins a set by tribe; Monstrocity is All-type and joins every set', () => {
    const has = (id: SetId, c: string): boolean => duosPoolFor(id).all.some((x) => x.id === c);
    for (const id of Object.keys(SETS) as SetId[]) {
      const tribes = new Set<string>(SETS[id].tribes);
      for (const [c, t] of [['duo_antsy', 'beast'], ['duo_bratworst', 'dwarf'], ['duo_roo', 'kobold'], ['duo_proxus', 'demon'], ['duo_galfagan', 'dragon']] as const) {
        expect(has(id, c)).toBe(tribes.has(t));
      }
      expect(has(id, 'duo_monstrocity')).toBe(true);
      expect(has(id, 'duo_broshake') && has(id, 'duo_tribebundle')).toBe(true);
    }
    const m = card('duo_monstrocity', 'm');
    for (const t of SETS.set2.tribes) expect(isTribe(m, t)).toBe(true);
  });
});

describe('Antsy: "Echo: Give your teammate a random Tier 1 Shop Spell."', () => {
  it('its combat Echo sends the gift (landed at settle); the teammate gets a Tier 1 Shop Spell of their own pool', () => {
    const { after } = fight(seat({ board: [card('duo_antsy', 'a1')] }), foe(10, 60));
    expect(teamOut(after)).toEqual([{ kind: 'gift', randomSpellTier: 1, count: 1 }]);
    const bob = ship(after, 'p1', seat({}, 12));
    expect(bob.hand).toHaveLength(1);
    const got = CARD_INDEX[bob.hand[0]!.cardId]!;
    expect([got.spell, got.tier]).toEqual([true, 1]);
  });

  it('another minion dying is not its Echo; Gilded sends 2', () => {
    const { after } = fight(seat({ board: [...vanilla(1), card('duo_antsy', 'a1', true)] }), foe(10, 60));
    expect(teamOut(after).filter((t) => t.kind === 'gift')).toEqual([{ kind: 'gift', randomSpellTier: 1, count: 2 }]);
  });
});

describe("Salandaman: Has +4/+4 for each of your team's Salandamans that died this game.", () => {
  it('each death (any copy) grows the run-wide enchant; the survivor grows mid-fight', () => {
    const { after, events } = fight(seat({ board: [card('duo_salandaman', 's1'), card('duo_salandaman', 's2')], hand: [card('duo_salandaman', 'h1')] }), foe(30, 200));
    const deaths = events.filter((e) => e.type === 'death').length;
    expect(deaths).toBeGreaterThanOrEqual(2);
    expect(after.cardBuffs['duo_salandaman']).toEqual({ attack: 8, health: 8 });
  });

  // R-DUOS-SALANDAMAN-TEAM-01 (owner 2026-11-01: "this means it counts both sides game wide").
  it('each of my deaths is sent to my teammate in real time (a teamSend beat per death), once', () => {
    const { after, events } = fight(seat({ board: [card('duo_salandaman', 's1'), card('duo_salandaman', 's2', true)] }), foe(30, 200));
    // Two deaths, a Gilded one included: still ONE death each.
    expect(teamOut(after)).toEqual([{ kind: 'cardDeath', cardId: 'duo_salandaman', count: 1 }, { kind: 'cardDeath', cardId: 'duo_salandaman', count: 1 }]);
    expect(events.filter((e) => e.type === 'teamSend')).toHaveLength(2);
    // Queued when the fight landed (the real-time path), never again at settle.
    expect(after.duos!.outbox.filter((e) => e.team).every((e) => e.combatIdx != null)).toBe(true);
  });

  it("my teammate's deaths grow MY Salandamans: board, hand (a Gilded copy too) and every future copy", () => {
    const { after: ann } = fight(seat({ board: [card('duo_salandaman', 's1'), card('duo_salandaman', 's2')] }), foe(30, 200));
    const bob0 = seat({ board: [card('duo_salandaman', 'b1')], hand: [card('duo_salandaman', 'h1', true)] }, 12);
    const bob = ship(ann, 'p1', bob0);
    expect(bob.cardBuffs['duo_salandaman']).toEqual({ attack: 8, health: 8 });
    expect([bob.board[0]!.attack, bob.board[0]!.health]).toEqual([12, 12]);
    expect([bob.hand[0]!.attack, bob.hand[0]!.health]).toEqual([16, 16]);
    // A copy that lands twice (a retry, a reconnect) counts once.
    expect(ship(ann, 'p1', bob)).toBe(bob);
    // Then Bob's own death adds on top: the team's total.
    const { after: bob2 } = fight(bob, foe(30, 200));
    expect(bob2.cardBuffs['duo_salandaman']).toEqual({ attack: 12, health: 12 });
  });

  it("a teammate's death lands mid-fight too (any phase), and a non-team or unknown card counts nothing", () => {
    const parked = reduce(seat({ board: [card('duo_salandaman', 'b1')] }, 12), { type: 'faceOmen', deferFight: true });
    const wire = (cardId: string, seq: number) => ({ uid: `team${seq}`, cardId: '__team', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false, passFrom: 'team', team: { kind: 'cardDeath', cardId, count: 1 } }) as unknown as BoardCard;
    const mid = reduce(parked, { type: 'receivePass', from: 'p1', seq: 0, card: wire('duo_salandaman', 0) });
    expect(mid.cardBuffs['duo_salandaman']).toEqual({ attack: 4, health: 4 });
    const knit = reduce(mid, { type: 'receivePass', from: 'p1', seq: 1, card: wire('knit', 1) });
    expect(knit.cardBuffs['knit']).toBeUndefined();
    const junk = reduce(knit, { type: 'receivePass', from: 'p1', seq: 2, card: wire('nope', 2) });
    expect(junk.cardBuffs).toEqual(knit.cardBuffs);
  });

  it('Spear Warden stays a one-run tally: its deaths send nothing', () => {
    const { after } = fight(seat({ board: [card('knit', 'k1'), card('knit', 'k2')] }), foe(30, 200));
    expect(teamOut(after).filter((t) => t.kind === 'cardDeath')).toEqual([]);
  });

  it("TAG-TEAM: the first board's Salandaman deaths are on the teammate's board when it steps in", () => {
    const sal = (uid: string): BoardMinion => ({ cardId: 'duo_salandaman', attack: 4, health: 4, sourceUid: uid }) as unknown as BoardMinion;
    const result = simulate(
      [sal('a1'), sal('a2')], foe(30, 400), makeRng(3), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 6 }),
      { reserve: { player: { board: [sal('b1')], state: combatSide({ tier: 4 }) } } },
    );
    const tagIn = (result.events as { type: string; side?: string; minions?: { cardId: string; attack: number; health: number }[] }[])
      .find((e) => e.type === 'tagIn' && e.side === 'player');
    expect(tagIn).toBeDefined();
    // Two of A's died (+8/+8): B's 4/4 steps in at 12/12.
    expect(tagIn!.minions!.map((m) => [m.attack, m.health])).toEqual([[12, 12]]);
    // B's own carry holds only B's own deaths: A's ride the team channel to B's run instead.
    const members = result.tagTeam!.members.player!;
    expect(members[0]!.cardBuffs).toEqual([{ cardId: 'duo_salandaman', attack: 8, health: 8 }]);
    expect(members[1]!.cardBuffs ?? []).toEqual([{ cardId: 'duo_salandaman', attack: 4, health: 4 }]);
  });
});

describe('Bratworst Buck: "When you cast a Dwarven Ale, give your teammate a copy. (Twice per turn)"', () => {
  const ale = ALE_IDS.find((id) => id === 'wo_champion')!;
  it('the first two Ales this turn each send a copy; the third does not; the teammate gets that Ale', () => {
    let ann = seat({ board: [card('duo_bratworst', 'b1')], hand: [card(ale, 'x1'), card(ale, 'x2'), card(ale, 'x3')] });
    ann = reduce(ann, { type: 'play', uid: 'x1' });
    ann = reduce(ann, { type: 'play', uid: 'x2' });
    ann = reduce(ann, { type: 'play', uid: 'x3' });
    expect(teamOut(ann)).toEqual([{ kind: 'gift', cardId: ale, count: 1 }, { kind: 'gift', cardId: ale, count: 1 }]);
    expect(ann.board[0]!.duosUses).toEqual({ aleCastGiftTeammate: 2 });
    const bob = ship(ann, 'p1', seat({}, 12));
    expect(bob.hand.map((c) => c.cardId)).toEqual([ale, ale]);
  });

  it('a non-Ale spell does nothing; Gilded sends 2 copies; the cap re-arms next turn', () => {
    const other = Object.values(CARD_INDEX).find((c) => c && c.spell && !c.duos && !ALE_IDS.includes(c.id) && c.tier === 1 && c.effects.some((e) => e.do === 'gainEmbers'));
    let ann = seat({ board: [card('duo_bratworst', 'b1', true)], hand: [card(ale, 'x1'), ...(other ? [card(other.id, 'o1')] : [])] });
    if (other) ann = reduce(ann, { type: 'play', uid: 'o1' });
    ann = reduce(ann, { type: 'play', uid: 'x1' });
    expect(teamOut(ann)).toEqual([{ kind: 'gift', cardId: ale, count: 2 }]);
    // Next turn (a later wave stamp): the uses read 0 again.
    ann = { ...ann, wave: ann.wave + 1, hand: [card(ale, 'y1'), card(ale, 'y2'), card(ale, 'y3')] };
    for (const u of ['y1', 'y2', 'y3']) ann = reduce(ann, { type: 'play', uid: u });
    expect(teamOut(ann)).toHaveLength(3);
  });
});

describe('Spencer: "Echo: Reduce the cost of upgrading your team\'s Shops by 1."', () => {
  it('its combat Echo lowers my upgrade cost at settle and my teammate\'s when it lands', () => {
    const plain = { ...vanilla(1)[0]!, attack: 6, health: 2 };
    const control = fight(seat({ board: [plain] }), foe(10, 60)).after;
    const { after } = fight(seat({ board: [card('duo_spencer', 'sp')] }), foe(10, 60));
    expect(teamOut(after)).toEqual([{ kind: 'upgradeDiscount', amount: 1 }]);
    expect(after.upgradeCost).toBe(Math.max(0, control.upgradeCost - 1));
    const bob0 = seat({}, 12);
    expect(ship(after, 'p1', bob0).upgradeCost).toBe(bob0.upgradeCost - 1);
  });
});

describe('Roo: "When you pass a card, get 2 Rubies."', () => {
  it('a pass I make mints 2 Rubies (Gilded 4); my teammate\'s pass does not', () => {
    const p = vanilla(1, 'p')[0]!;
    let ann = seat({ board: [card('duo_roo', 'r1')], hand: [p] });
    ann = reduce(ann, { type: 'passCard', uid: p.uid });
    expect(ann.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby)).toHaveLength(2);
    let gil = seat({ board: [card('duo_roo', 'r1', true)], hand: [p] });
    gil = reduce(gil, { type: 'passCard', uid: p.uid });
    expect(gil.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby)).toHaveLength(4);
    const bob = ship(ann, 'p1', seat({ board: [card('duo_roo', 'r2')] }, 12));
    expect(bob.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby)).toHaveLength(0);
  });
});

describe('Toot Toot: "Rally: Give your teammate a minion of their most common type."', () => {
  it('each of ITS swings sends one gift (an ally swinging sends none); the teammate gets a minion of their type', () => {
    const { after, events, initial } = fight(seat({ board: [card('duo_toottoot', 't1'), ...vanilla(1, 'v')] }), foe(0, 40));
    const tootUid = initial.find((m) => m.cardId === 'duo_toottoot')!.uid;
    const swings = events.filter((e) => e.type === 'attack' && e.attacker === tootUid).length;
    expect(swings).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'attack' && e.attacker !== tootUid && initial.some((m) => m.uid === e.attacker))).toBe(true);
    expect(teamOut(after)).toEqual(Array.from({ length: swings }, () => ({ kind: 'gift', mateTribe: true, count: 1 })));
    let bob = seat({}, 12);
    const tribe = bob.tribes.find((t) => t !== 'neutral')!;
    const d = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.universalTribe && c.tribe === tribe && !c.tribe2 && c.tier === 1)!;
    bob = { ...bob, board: [card(d.id, 'q1'), card(d.id, 'q2')] };
    bob = ship({ ...after, duos: { ...after.duos!, outbox: after.duos!.outbox.slice(0, 1) } }, 'p1', bob);
    expect(bob.hand).toHaveLength(1);
    expect(isTribe(bob.hand[0]!, tribe)).toBe(true);
  });
});

describe('Toot Toot in the Shop (a triggered Rally)', () => {
  it("its own Shop Rally sends the gift at once; another minion's Rally does not", () => {
    const run = seat({ board: [card('duo_toottoot', 't1'), card('dw_bladethrower', 'bt')] });
    fireShopRally(run, run.board[1]!);
    expect(teamOut(run)).toHaveLength(0);
    fireShopRally(run, run.board[0]!);
    expect(teamOut(run)).toEqual([{ kind: 'gift', mateTribe: true, count: 1 }]);
  });
});

describe('Proxus: "When you pass a card, a Demon consumes a minion in the Shop."', () => {
  it('a pass feeds a Demon a Shop minion (Gilded: double its stats); no Demon, nothing', () => {
    const p = vanilla(1, 'p')[0]!;
    const base = seat({ board: [card('duo_proxus', 'px')], hand: [p] });
    const minions = base.shop.filter((o) => !CARD_INDEX[o.cardId]?.spell).length;
    expect(minions).toBeGreaterThan(0);
    const ann = reduce(base, { type: 'passCard', uid: p.uid });
    expect(ann.shop.filter((o) => !CARD_INDEX[o.cardId]?.spell)).toHaveLength(minions - 1);
    const gain = ann.board[0]!.attack - 8;
    expect(gain).toBeGreaterThan(0);
    const gil = reduce(seat({ board: [card('duo_proxus', 'px', true)], hand: [p] }), { type: 'passCard', uid: p.uid });
    expect(gil.board[0]!.attack - 16).toBe(gain * 2);
  });
});

describe('Hippie Hulk: "When your teammate sells a minion, this gains its stats. (Once per turn)"', () => {
  it('the first teammate sale this turn grows it by the sold stats; the second does not; Gilded gains double', () => {
    const m1 = { ...vanilla(1, 's')[0]!, attack: 6, health: 9 };
    const m2 = { ...vanilla(1, 't')[0]!, attack: 4, health: 4 };
    let ann = reduce(seat({ board: [m1, m2] }), { type: 'sell', uid: m1.uid });
    ann = reduce(ann, { type: 'sell', uid: m2.uid });
    const bob = ship(ann, 'p1', seat({ board: [card('duo_hippiehulk', 'hh')] }, 12));
    expect(bob.board[0]).toMatchObject({ attack: 15, health: 18 });
    expect(bob.board[0]!.duosUses).toEqual({ teammateSoldGainStats: 1 });
    const gil = ship(ann, 'p1', seat({ board: [card('duo_hippiehulk', 'hh', true)] }, 12));
    expect(gil.board[0]).toMatchObject({ attack: 18 + 12, health: 18 + 18 });
  });
});

describe('Galfagan: "When you pass a Shop Spell, get a copy of it. (Once per turn)"', () => {
  it('the first Shop Spell I pass this turn comes back as a copy; a second does not; a Ruby is not a Shop Spell', () => {
    const spell = duosPoolFor('set2').spells.find((c) => !c.duos && c.tier === 1)!;
    let ann = seat({ board: [card('duo_galfagan', 'g1')], hand: [card('ruby', 'gp'), card(spell.id, 'x1'), card(spell.id, 'x2')], embers: 10 });
    ann = reduce(ann, { type: 'passCard', uid: 'gp' });
    expect(ann.duos!.outbox).toHaveLength(1); // the Ruby passed
    expect(ann.hand.map((c) => c.cardId)).toEqual([spell.id, spell.id]);
    ann = reduce(ann, { type: 'passCard', uid: 'x1' });
    expect(ann.hand.map((c) => c.cardId)).toEqual([spell.id, spell.id]); // x2 + the copy
    ann = reduce(ann, { type: 'passCard', uid: 'x2' });
    expect(ann.hand.map((c) => c.cardId)).toEqual([spell.id]); // once per turn
  });
});

describe('Monstrocity: "When you buy or Discover this, your teammate gets a copy." (All-type)', () => {
  it('buying it sends a copy; buying another card with one on the board does not', () => {
    const run = seat({ embers: 10 });
    const offer = { uid: 'mo', cardId: 'duo_monstrocity' };
    let ann = reduce({ ...run, shop: [offer, ...run.shop.slice(1)] }, { type: 'buy', uid: 'mo' });
    expect(teamOut(ann)).toEqual([{ kind: 'gift', cardId: 'duo_monstrocity', count: 1 }]);
    const bob = ship(ann, 'p1', seat({}, 12));
    expect(bob.hand.map((c) => c.cardId)).toEqual(['duo_monstrocity']);
    const other = ann.shop.find((o) => !CARD_INDEX[o.cardId]?.spell)!;
    ann = reduce({ ...ann, board: [card('duo_monstrocity', 'mb')], embers: 10 }, { type: 'buy', uid: other.uid });
    expect(teamOut(ann)).toHaveLength(1);
  });

  it('Discovering it sends a copy too', () => {
    const ann = reduce(seat({ discover: ['duo_monstrocity'] }), { type: 'discover', index: 0 });
    expect(ann.hand.map((c) => c.cardId)).toEqual(['duo_monstrocity']);
    expect(teamOut(ann)).toEqual([{ kind: 'gift', cardId: 'duo_monstrocity', count: 1 }]);
  });
});

describe('Broshake: "Give your left-most minion and your teammate\'s left-most minion +3/+5."', () => {
  it('my left-most grows now; my teammate\'s left-most grows when it lands; an empty board takes nothing', () => {
    const [a, b] = vanilla(2, 'm');
    let ann = seat({ board: [a!, b!], hand: [card('duo_broshake', 'bs')] });
    ann = reduce(ann, { type: 'play', uid: 'bs' });
    expect(ann.board[0]).toMatchObject({ attack: a!.attack + 3, health: a!.health + 5 });
    expect(ann.board[1]).toMatchObject({ attack: b!.attack, health: b!.health });
    expect(teamOut(ann)).toEqual([{ kind: 'buffLeftmost', attack: 3, health: 5, cardId: 'duo_broshake' }]);
    const [c, d] = vanilla(2, 'n');
    const bob = ship(ann, 'p1', seat({ board: [c!, d!] }, 12));
    expect(bob.board[0]).toMatchObject({ attack: c!.attack + 3, health: c!.health + 5 });
    expect(bob.board[1]).toMatchObject({ attack: d!.attack, health: d!.health });
    expect(ship(ann, 'p1', seat({}, 12)).duos!.received).toEqual(['p1:0']);
  });
});

describe('Tribe Bundle: "Give your teammate a minion of their most common type."', () => {
  it('the teammate gets a minion of the type they field most, from their own pool', () => {
    const ann = reduce(seat({ hand: [card('duo_tribebundle', 'tb')] }), { type: 'play', uid: 'tb' });
    expect(teamOut(ann)).toEqual([{ kind: 'gift', mateTribe: true, count: 1 }]);
    let bob = seat({}, 12);
    const tribe = bob.tribes.find((t) => t !== 'neutral')!;
    const d = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.universalTribe && c.tribe === tribe && !c.tribe2 && c.tier === 1)!;
    bob = ship(ann, 'p1', { ...bob, board: [card(d.id, 'q1')] });
    expect(bob.hand).toHaveLength(1);
    expect(isTribe(bob.hand[0]!, tribe)).toBe(true);
  });
});
