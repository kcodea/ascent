/**
 * DUOS-ONLY RUNES (owner design 2026-10-30, R-DUOS-RUNES-01..03): the nine runes on two teammates' runs through the real
 * reducer, the forge gate, the REAL-TIME combat gift (R-DUOS-RUNES-02: queued when the fight lands, announced by a
 * `teamSend` event at its beat, never sent twice) and the Megamimic's Start-of-Combat copy (R-DUOS-RUNES-03).
 */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, megamimicBoard, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, poolFor } from '@game/content';
import { reduce, runeforgePool } from './reducer';
import type { BoardCard, PreparedCombatSide, RunState } from './state';
import { createVersusRun } from './versus/run';
import { createRun } from './state';
import type { VersusRoomOptions } from './versus/options';
import { duosPassCost, duosWireOf } from './duosPass';
import { duosRuneTally } from './duosRunes';
import { duosMemberOf, duosMemberView, duosMateOf, duosRandomFirst, resolveVersusDuosRound } from './versus/duos';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };
const DUOS_RUNE_IDS = ['rune_spell_theory', 'rune_gold_gifts', 'rune_teammate_synergy', 'rune_passable', 'rune_playing_catch',
  'rune_shoutful_bounty', 'rune_echoing_results', 'rune_salesman_of_the_year', 'rune_megamimed'];

function card(id: string, uid: string, golden = false): BoardCard {
  const d = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden };
}
function seat(over: Partial<RunState> = {}, seed = 11): RunState {
  const run = createVersusRun(seed, 'warden', 'set2', DUOS);
  return { ...run, hand: [], board: [], embers: 10, ...over };
}
const rune = (s: RunState, id: string): RunState => reduce(s, { type: 'devGrant', kind: 'rune', id });
/** Ship every entry `from` queued since `since` to `to` (the wire form, `receivePass`), as the transport does. */
function ship(from: RunState, fromSeat: string, to: RunState, since = 0): RunState {
  let out = to;
  for (const e of from.duos!.outbox.slice(since)) out = reduce(out, { type: 'receivePass', from: fromSeat, seq: e.seq, card: duosWireOf(e) });
  return out;
}
const plainMinion = (): string => poolFor('set2').buyable.find((c) => c.effects.length === 0 && c.keywords.length === 0)!.id;
/** `n` DIFFERENT plain minions (so nothing triples by accident). */
const plainMinions = (n: number): string[] => poolFor('set2').buyable.filter((c) => c.effects.length === 0).slice(0, n).map((c) => c.id);
const aSpell = (): string => poolFor('set2').spells.find((c) => !c.ruby && c.tier === 1 && !c.target)!.id;

describe('R-DUOS-RUNES-01: the nine runes exist, are Duos-only, and only a Duos forge offers them', () => {
  it('all nine are defined with the owner costs and rarities', () => {
    const want: Record<string, [number, boolean]> = {
      rune_spell_theory: [2, false], rune_gold_gifts: [1, false], rune_teammate_synergy: [2, false], rune_passable: [1, false],
      rune_playing_catch: [2, false], rune_shoutful_bounty: [4, true], rune_echoing_results: [3, true],
      rune_salesman_of_the_year: [3, true], rune_megamimed: [4, true],
    };
    for (const [id, [cost, epic]] of Object.entries(want)) {
      const r = RUNE_INDEX[id]!;
      expect(r.duos).toBe(true);
      expect(r.cost).toBe(cost);
      expect((epic ? EPIC_RUNES : RUNES).includes(r)).toBe(true);
    }
  });

  it('a Duos run\'s forge offers them; a 1v1 Versus run and a lobby run never do', () => {
    const duos = { ...seat(), runeforgeEpic: false } as RunState;
    const duosEpic = { ...seat(), runeforgeEpic: true } as RunState;
    const pool = [...runeforgePool(duos), ...runeforgePool(duosEpic)];
    for (const id of DUOS_RUNE_IDS) expect(pool).toContain(id);
    for (const other of [createVersusRun(11, 'warden', 'set2'), createRun(11, 'warden', 'lobby', undefined, 'set2')]) {
      const all = [...runeforgePool({ ...other, runeforgeEpic: false } as RunState), ...runeforgePool({ ...other, runeforgeEpic: true } as RunState)];
      for (const id of DUOS_RUNE_IDS) expect(all).not.toContain(id);
    }
  });
});

describe('Basic Duos runes', () => {
  it('Spell Theory: passing a spell gets a copy of it, once per turn', () => {
    const sp = aSpell();
    let ann = rune(seat({ hand: [card(sp, 's1'), card(sp, 's2')] }), 'rune_spell_theory');
    ann = reduce(ann, { type: 'passCard', uid: 's1' });
    expect(ann.hand.filter((c) => c.cardId === sp)).toHaveLength(2); // s2 + the copy
    expect(duosRuneTally(ann, 'rune_spell_theory')).toBe('Used this turn');
    const n = ann.hand.length;
    ann = reduce(ann, { type: 'passCard', uid: 's2' });
    expect(ann.hand.length).toBe(n - 1); // (Once per turn): no second copy
  });

  it('Gold Gifts: Equip Gold Gifter (1) gives the teammate 3 Gold', () => {
    let ann = rune(seat(), 'rune_gold_gifts');
    expect(ann.equipment?.available.some((g) => g.equipmentId === 'gold_gifter')).toBe(true);
    const before = ann.embers;
    const sent = ann.duos!.outbox.length;
    ann = reduce(ann, { type: 'selectEquipment', equipmentId: 'gold_gifter' });
    ann = reduce(ann, { type: 'activateEquipment' });
    expect(ann.embers).toBe(before - 1);
    let bob = seat({ embers: 2 }, 12);
    bob = ship(ann, 'p1', bob, sent);
    expect(bob.embers).toBe(5);
  });

  it('Teammate Synergy: a Gild gives the teammate a Triple Reward, 3 per game', () => {
    const id = plainMinion();
    let ann = rune(seat(), 'rune_teammate_synergy');
    expect(duosRuneTally(ann, 'rune_teammate_synergy')).toBe('3 left');
    let bob = seat({}, 12);
    for (let k = 0; k < 4; k++) {
      const sent = ann.duos!.outbox.length;
      ann = { ...ann, hand: [card(id, `a${k}`)], board: [card(id, `c${k}`)] };
      // The third copy arrives from the teammate: a landed pass runs the triple check (R-DUOS-PASS-06).
      ann = reduce(ann, { type: 'receivePass', from: 'p2', seq: 100 + k, card: { ...card(id, `x${k}`), passFrom: 'hand' } as BoardCard });
      const gifts = ann.duos!.outbox.slice(sent).filter((e) => e.team?.kind === 'tripleReward');
      expect(gifts).toHaveLength(k < 3 ? 1 : 0);
      bob = ship(ann, 'p1', bob, sent);
    }
    expect(duosRuneTally(ann, 'rune_teammate_synergy')).toBe('0 left');
    expect(bob.hand.filter((c) => c.cardId === 'discoverspell').length).toBe(3);
  });

  it('Passable: a Handout now (and the recurring grant arms the Start of Turn repeat)', () => {
    const ann = rune(seat(), 'rune_passable');
    expect(ann.hand.some((c) => c.cardId === 'duo_handout')).toBe(true);
    expect(ann.questRecurringGrants).toContain('duo_handout');
  });

  it('Playing Catch: the team\'s first 3 manual passes each round are free, shared by both teammates; Brian\'s Pal spends first', () => {
    const ids = plainMinions(8);
    let ann = rune(seat({ hand: [0, 1, 2, 3].map((i) => card(ids[i]!, `h${i}`)) }), 'rune_playing_catch');
    let bob = seat({ hand: [card(ids[4]!, 'q0'), card(ids[5]!, 'q1')] }, 12);
    bob = ship(ann, 'p1', bob); // the `catch` team effect: Bob knows the team has 3 free passes
    expect(duosPassCost(bob)).toBe(0);
    // Bob passes once (free) -> Ann learns it when it lands.
    const bobSent = bob.duos!.outbox.length;
    bob = reduce(bob, { type: 'passCard', uid: 'q0' });
    expect(bob.embers).toBe(10);
    ann = ship(bob, 'p2', ann, bobSent);
    expect(duosRuneTally(ann, 'rune_playing_catch')).toBe('2/3 free');
    ann = reduce(ann, { type: 'passCard', uid: 'h0' });
    ann = reduce(ann, { type: 'passCard', uid: 'h1' });
    expect(ann.embers).toBe(10);
    expect(duosPassCost(ann)).toBe(1); // the team used all 3
    ann = reduce(ann, { type: 'passCard', uid: 'h2' });
    expect(ann.embers).toBe(9);
    // Brian's Pal spends its own pass first, so a Pal pass never eats a team Catch pass.
    let cat = rune(seat({ hand: [card(ids[6]!, 'z0'), card(ids[7]!, 'z1')], board: [card('duo_brianspal', 'pal')] }, 13), 'rune_playing_catch');
    cat = reduce(cat, { type: 'passCard', uid: 'z0' });
    expect(cat.duos!.outbox.at(-1)!.free).toBe('pal');
    expect(duosRuneTally(cat, 'rune_playing_catch')).toBe('3/3 free');
    cat = reduce(cat, { type: 'passCard', uid: 'z1' });
    expect(cat.duos!.outbox.at(-1)!.free).toBe('catch');
  });
});

describe('Epic Duos runes', () => {
  it('Salesman of the Year: the first 2 minions sold each turn are sold (Gold paid) AND passed, Golden included', () => {
    const id = plainMinion();
    let ann = rune(seat({ board: [card(id, 'm0', true), card(id, 'm1'), card(id, 'm2')] }), 'rune_salesman_of_the_year');
    const gold = ann.embers;
    const sent = ann.duos!.outbox.length;
    ann = reduce(ann, { type: 'sell', uid: 'm0' });
    ann = reduce(ann, { type: 'sell', uid: 'm1' });
    ann = reduce(ann, { type: 'sell', uid: 'm2' });
    expect(ann.embers).toBeGreaterThan(gold); // every sale paid
    const passes = ann.duos!.outbox.slice(sent).filter((e) => e.via === 'sale');
    expect(passes.map((e) => e.card.uid)).toEqual(['m0', 'm1']); // the golden one too (owner 2026-10-30)
    expect(duosWireOf(passes[0]!).passFrom).toBe('sale');
    let bob = seat({}, 12);
    bob = ship(ann, 'p1', bob, sent);
    expect(bob.hand.filter((c) => c.cardId === id).map((c) => c.golden)).toEqual([true, false]);
    // A refusal returns nothing: the minion was sold.
    const refunded = reduce(ann, { type: 'passRefunded', seq: passes[0]!.seq });
    expect(refunded.board.length + refunded.hand.length).toBe(ann.board.length + ann.hand.length);
  });

  it('Megamimed: a Megamimic (T6 1/1 token) to hand, never in the Shop pool', () => {
    const ann = rune(seat(), 'rune_megamimed');
    expect(ann.hand.some((c) => c.cardId === 'duo_megamimic')).toBe(true);
    expect(CARD_INDEX['duo_megamimic']).toMatchObject({ tier: 6, attack: 1, health: 1, token: true });
    expect(ann.pool['duo_megamimic']).toBeUndefined();
  });

  it('Shoutful Bounty in the Shop: every 2 Shouts a random spell for the teammate, three per turn', () => {
    // Seven DIFFERENT untargeted Shout minions (no triples), played one by one.
    const shouters = poolFor('set2').buyable.filter((c) => c.effects.some((e) => e.on === 'onPlay') && !c.target && !c.chooseOne).slice(0, 7).map((c) => c.id);
    expect(shouters.length).toBe(7);
    let ann = rune(seat({ hand: shouters.map((sid, i) => card(sid, `s${i}`)) }), 'rune_shoutful_bounty');
    const sent = ann.duos!.outbox.length;
    for (let i = 0; i < 7; i++) {
      ann = reduce(ann, { type: 'play', uid: `s${i}` });
      if (ann.discover) ann = reduce(ann, { type: 'discover', index: 0 });
    }
    const gifts = ann.duos!.outbox.slice(sent).filter((e) => e.team?.kind === 'gift');
    expect(gifts.length).toBe(3); // 7 Shouts would pay 3; the cap is 3 anyway
    expect(duosRuneTally(ann, 'rune_shoutful_bounty')).toMatch(/3\/3 this turn$/);
    let bob = seat({}, 12);
    bob = ship(ann, 'p1', bob, sent);
    expect(bob.hand.filter((c) => CARD_INDEX[c.cardId]?.spell).length).toBe(3);
  });
});

// ── REAL TIME (R-DUOS-RUNES-02) ─────────────────────────────────────────────────────────────────────────────────────
const echoIds = (): string[] => poolFor('set2').buyable.filter((c) => c.effects.some((e) => e.on === 'onDeath') && !c.effects.some((e) => e.do.toLowerCase().includes('summon')) && !c.keywords.includes('R')).map((c) => c.id);
const echoId = (): string => echoIds()[0]!;

/** Four Duos seats' runs parked at End of Turn, the sides fought ONCE by the resolver, each seat landing its own view. */
function fightRound(runs: Record<'p1' | 'p2' | 'p3' | 'p4', RunState>): Record<'p1' | 'p2' | 'p3' | 'p4', RunState> {
  const parked = Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, reduce(r, { type: 'faceOmen', deferFight: true })])) as typeof runs;
  const sides = Object.fromEntries(Object.entries(parked).map(([k, r]) => [k, r.pendingCombatSide])) as Record<string, PreparedCombatSide>;
  const round = resolveVersusDuosRound({ matchSeed: 9, round: runs.p1.wave, sides });
  const out = {} as typeof runs;
  for (const seatId of ['p1', 'p2', 'p3', 'p4'] as const) {
    const team = seatId === 'p1' || seatId === 'p2' ? round.aResult : round.bResult;
    out[seatId] = reduce(parked[seatId], { type: 'landCombat', fight: { result: duosMemberView(team, duosMemberOf(seatId, round.first)), damageTaken: 0 } });
  }
  return out;
}

describe('R-DUOS-RUNES-02: a combat gift reaches the teammate in real time, once', () => {
  it('Echoing Results in combat: queued when the fight lands, announced at its beat, landed mid-fight, never re-queued at settle', () => {
    const ids = echoIds();
    expect(ids.length).toBeGreaterThanOrEqual(7);
    const big = (seed: number): RunState => seat({ board: [{ ...card(plainMinion(), `big${seed}`), attack: 60, health: 600 }] }, seed);
    // Ann's board is all Echoes and fights FIRST for team A (seat her on the seeded first chair).
    const first = duosRandomFirst(9, 1).a;
    const annSeat = first;
    const bobSeat = duosMateOf(first);
    let ann = rune(seat({ board: ids.slice(0, 7).map((eid, i) => card(eid, `e${i}`)) }, 21), 'rune_echoing_results');
    ann = { ...ann, wave: 1 };
    let bob = { ...seat({ board: [card(plainMinion(), 'bb')] }, 22), wave: 1 };
    const runs = { p1: big(31), p2: big(32), p3: big(33), p4: big(34) } as Record<'p1' | 'p2' | 'p3' | 'p4', RunState>;
    runs[annSeat] = ann;
    runs[bobSeat] = bob;
    for (const k of ['p3', 'p4'] as const) runs[k] = { ...runs[k], wave: 1 };
    const landed = fightRound(runs);
    ann = landed[annSeat];
    bob = landed[bobSeat];
    const fight = ann.lastCombat!;
    // The fight announces each gift at the moment it happened (a `teamSend` on Ann's member), the carry holds the gift.
    const sends = fight.events.filter((e): e is Extract<CombatEvent, { type: 'teamSend' }> => e.type === 'teamSend' && e.side === 'player' && e.member === (fight.duosMember ?? 0));
    expect(sends.length).toBe(2); // 7 Echoes = 2 trips (3 + 3), two per turn
    const lastIdx = fight.events.indexOf(sends[1]!);
    expect(lastIdx).toBeLessThan(fight.events.length - 1); // mid-fight, not at the end
    // The gifts are on Ann's outbox the moment the fight LANDED (before any replay or settle), tagged by carry index.
    const early = ann.duos!.outbox.filter((e) => e.combatIdx != null);
    expect(early.map((e) => e.combatIdx)).toEqual(sends.map((e) => e.idx));
    expect(ann.phase).toBe('combat');
    expect(bob.phase).toBe('combat');
    // Shipped at the beat, the minion lands in Bob's hand WHILE BOB IS STILL IN THE FIGHT.
    const handBefore = bob.hand.length;
    for (const e of early) bob = reduce(bob, { type: 'receivePass', from: annSeat, seq: e.seq, card: duosWireOf(e) });
    expect(bob.phase).toBe('combat');
    expect(bob.hand.length).toBe(handBefore + 2);
    // A second delivery (a reconnect replaying the rows) lands nothing more.
    for (const e of early) bob = reduce(bob, { type: 'receivePass', from: annSeat, seq: e.seq, card: duosWireOf(e) });
    expect(bob.hand.length).toBe(handBefore + 2);
    // Settle is the fallback only: it queues NOTHING the land already queued.
    const before = ann.duos!.outbox.length;
    ann = reduce(ann, { type: 'settleCombat' });
    expect(ann.duos!.outbox.length).toBe(before);
    // The meter came home: two paid (the turn's cap), the Echoes after it banked one short of a trip.
    expect(fight.playerDeathrattles).toBeGreaterThanOrEqual(8);
    expect(duosRuneTally(ann, 'rune_echoing_results')).toBe('2/3 Echoes · 2/2 this turn');
  });

  it('a run with no Duos runes fights byte-identically (no teamSend, no carry meters)', () => {
    const a: BoardMinion[] = [{ cardId: echoId(), attack: 1, health: 1 }];
    const b: BoardMinion[] = [{ cardId: plainMinion(), attack: 5, health: 50 }];
    const r = simulate(a, b, makeRng(5), CARD_INDEX, combatSide(), combatSide());
    expect(r.events.some((e) => e.type === 'teamSend')).toBe(false);
    expect(r.playerShoutCarry?.duosMeters).toBeUndefined();
  });
});

describe('R-DUOS-RUNES-03: Megamimic copies the teammate\'s highest-Health minion at Start of Combat', () => {
  const mm: BoardMinion = { cardId: 'duo_megamimic', attack: 1, health: 1, sourceUid: 'mm' };
  const mate: BoardMinion[] = [
    { cardId: plainMinion(), attack: 3, health: 9, golden: true, keywords: ['T'], sourceUid: 'x1' },
    { cardId: plainMinion(), attack: 8, health: 4, sourceUid: 'x2' },
  ];

  it('an exact copy (stats, keywords, Gilded), combat-only (no carry-back uid); no teammate = it fights as itself', () => {
    const out = megamimicBoard([mm], mate, makeRng(1), CARD_INDEX);
    expect(out[0]).toMatchObject({ cardId: mate[0]!.cardId, attack: 3, health: 9, golden: true, keywords: ['T'] });
    expect(out[0]!.sourceUid).toBeUndefined();
    expect(megamimicBoard([mm], undefined, makeRng(1), CARD_INDEX)[0]).toBe(mm);
    expect(megamimicBoard([mm], [mm], makeRng(1), CARD_INDEX)[0]).toBe(mm); // another Megamimic is never a candidate
  });

  it('ties are a seeded pick: the same seed, the same copy; both tied minions are reachable', () => {
    const tied: BoardMinion[] = [{ cardId: plainMinion(), attack: 1, health: 7 }, { cardId: plainMinion(), attack: 2, health: 7 }];
    const seen = new Set<number>();
    for (let s = 1; s < 40; s++) {
      const a = megamimicBoard([mm], tied, makeRng(s), CARD_INDEX)[0]!;
      expect(megamimicBoard([mm], tied, makeRng(s), CARD_INDEX)[0]).toEqual(a);
      seen.add(a.attack);
    }
    expect([...seen].sort()).toEqual([1, 2]);
  });

  it('in a tag-team fight: the first board copies the reserve, the reserve copies the first board when it steps in', () => {
    const foe: BoardMinion[] = [{ cardId: plainMinion(), attack: 100, health: 1000 }];
    const r = simulate([mm, { cardId: plainMinion(), attack: 2, health: 20 }], foe, makeRng(3), CARD_INDEX, combatSide(), combatSide(), {
      reserve: { player: { board: [{ ...mm, sourceUid: 'mm2' }, ...mate], state: combatSide() } },
    });
    // The opening board: the Megamimic is the reserve's 3/9 (the highest Health).
    expect(r.initial.player.some((m) => m.attack === 3 && m.health === 9)).toBe(true);
    expect(r.initial.player.some((m) => m.cardId === 'duo_megamimic')).toBe(false);
    // The reserve's Megamimic steps in as the first board's best (2/20).
    const tag = r.events.find((e): e is Extract<CombatEvent, { type: 'tagIn' }> => e.type === 'tagIn' && e.side === 'player');
    expect(tag?.minions.some((m) => m.attack === 2 && m.health === 20 && m.cardId !== 'duo_megamimic')).toBe(true);
  });
});
