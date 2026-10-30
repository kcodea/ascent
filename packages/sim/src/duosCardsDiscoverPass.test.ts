/**
 * DUOS-ONLY CARDS, batch "Discover + pass" (owner design 2026-10-30, R-DUOS-CARDS-05): Disco (Discover, the teammate gets
 * the other options), Matchmaker (Discover a minion of the teammate's most common type and pass it), CueBee (Whisper:
 * Pass). Plus the effect-pass QUEUE (owner 2026-10-30, R-DUOS-EFFECT-PASS-QUEUE-01: "if your teammate's hand is full, they
 * get the card once there is space in their hand"). Each through the real reducer on two teammates' runs.
 */
import { describe, expect, it } from 'vitest';
import { makeRng } from '@game/core';
import { CARD_INDEX, WHISPER_TIERS } from '@game/content';
import { reduce } from './reducer';
import { type BoardCard, type RunState } from './state';
import { createVersusRun } from './versus/run';
import type { VersusRoomOptions } from './versus/options';
import { duosWaitingCount, duosWireOf } from './duosPass';
import { effectPassCard, mateTribeCounts, mostCommonMateTribe, runReadsMateTribes } from './recruit';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };

function card(id: string, uid: string, golden = false): BoardCard {
  const d = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden };
}
function seat(over: Partial<RunState> = {}, seed = 11): RunState {
  const run = createVersusRun(seed, 'warden', 'set2', DUOS);
  return { ...run, hand: [], board: [], embers: 10, ...over };
}
function ship(from: RunState, fromSeat: string, to: RunState, since = 0): RunState {
  let out = to;
  for (const e of from.duos!.outbox.slice(since)) out = reduce(out, { type: 'receivePass', from: fromSeat, seq: e.seq, card: duosWireOf(e) });
  return out;
}
const fillerId = (): string => Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.tier === 1 && !c.duos && c.effects.length === 0)!.id;
const filler = (n: number, prefix = 'f'): BoardCard[] => Array.from({ length: n }, (_, i) => card(fillerId(), `${prefix}${i}`));
/** A full hand that cannot triple: distinct minions (the first an effectless one, safe to play). */
const fullHand = (): BoardCard[] => {
  const ids = [fillerId(), ...Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && c.id !== fillerId() && c.tier <= 2).slice(0, 9).map((c) => c.id)];
  return ids.map((id, i) => card(id, `h${i}`));
};
const minionOf = (tribe: string, uid: string): BoardCard => {
  const d = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.universalTribe && c.tribe === tribe && !c.tribe2 && !c.duos)!;
  return card(d.id, uid);
};

describe('Disco: "Discover a minion. Your teammate gets the other options."', () => {
  it('my pick joins my hand; the two options I did not take land in my teammate\'s hand', () => {
    let ann = seat({ hand: [card('duo_disco', 'd1')] });
    ann = reduce(ann, { type: 'play', uid: 'd1' });
    const opts = [...ann.discover!];
    expect(opts).toHaveLength(3);
    for (const id of opts) expect(CARD_INDEX[id]!.tier).toBeLessThanOrEqual(ann.tier);
    ann = reduce(ann, { type: 'discover', index: 1 });
    expect(ann.hand.map((c) => c.cardId)).toEqual([opts[1]]);
    expect(ann.duos!.outbox.map((e) => e.team)).toEqual([
      { kind: 'gift', cardId: opts[0], count: 1 },
      { kind: 'gift', cardId: opts[2], count: 1 },
    ]);
    expect(ann.discoverDuos).toBeUndefined();
    const bob = ship(ann, 'p1', seat({}, 12));
    expect(bob.hand.map((c) => c.cardId)).toEqual([opts[0], opts[2]]);
  });

  it('is deterministic (the same run offers the same options); a later plain Discover carries no Duos rider', () => {
    const play = (): RunState => reduce(seat({ hand: [card('duo_disco', 'd1')] }), { type: 'play', uid: 'd1' });
    expect(play().discover).toEqual(play().discover);
    let ann = reduce(play(), { type: 'discover', index: 0 });
    const sent = ann.duos!.outbox.length;
    ann = reduce({ ...ann, hand: [...ann.hand, card('duo_disco', 'd2')] }, { type: 'play', uid: 'd2' });
    ann = { ...ann, discoverDuos: undefined }; // a plain minion Discover (no rider) gifts nothing
    ann = reduce(ann, { type: 'discover', index: 0 });
    expect(ann.duos!.outbox).toHaveLength(sent);
  });
});

describe('Matchmaker: "Shout: Discover a minion of your teammate\'s most common type and Pass it to them."', () => {
  it('reads my run\'s record of the teammate\'s board; the pick is passed (free, counts as a pass), never kept', () => {
    const base = seat();
    const tribe = base.tribes.find((t) => t !== 'neutral')!;
    let ann = seat({ hand: [card('duo_matchmaker', 'mm')], board: [card('duo_hitchhiker', 'hh')], embers: 0 });
    ann = reduce(ann, { type: 'noteMateTribes', tribes: { [tribe]: 3, kobold: 1 } });
    ann = reduce(ann, { type: 'play', uid: 'mm' });
    const offered = [...ann.discover!];
    for (const id of offered) {
      const d = CARD_INDEX[id]!;
      expect(d.tribe === tribe || d.tribe2 === tribe || !!d.universalTribe).toBe(true);
      expect(d.tier).toBeLessThanOrEqual(ann.tier);
    }
    const last = offered.length - 1; // a low Shop tier can hold fewer than 3 of one type
    ann = reduce(ann, { type: 'discover', index: last });
    expect(ann.hand).toHaveLength(0);
    expect(ann.embers).toBe(0); // free
    const e = ann.duos!.outbox[0]!;
    expect(e).toMatchObject({ via: 'spell', from: 'hand', paid: 0, card: { cardId: offered[last] } });
    expect(ann.board.find((c) => c.uid === 'hh')).toMatchObject({ attack: 3, health: 5 }); // Hitchhiker heard the pass
    const bob = ship(ann, 'p1', seat({}, 12));
    expect(bob.hand.map((c) => c.cardId)).toEqual([offered[last]]);
  });

  it('ties are a seeded 50/50 (the same every replay); never seen falls back to this run\'s own tribes', () => {
    const s = seat({ duos: { outbox: [], received: [], refused: [], mateTribes: { beast: 2, dragon: 2, demon: 1 } } });
    const seen = new Set<string>();
    for (let seed = 1; seed < 60; seed++) {
      const pick = mostCommonMateTribe(s, makeRng(seed))!;
      expect(['beast', 'dragon']).toContain(pick);
      expect(mostCommonMateTribe(s, makeRng(seed))).toBe(pick);
      seen.add(pick);
    }
    expect(seen.size).toBe(2);
    const blind = seat();
    expect(blind.tribes).toContain(mostCommonMateTribe(blind, makeRng(3)));
  });

  it('Gilded Discovers twice; outside a Duos run it does nothing', () => {
    let ann = seat({ hand: [card('duo_matchmaker', 'mm', true)] });
    ann = reduce(ann, { type: 'play', uid: 'mm' });
    expect(ann.discover).toBeDefined();
    expect(ann.discoverQueue ?? []).toHaveLength(1);
    const solo = { ...createVersusRun(11, 'warden', 'set2'), hand: [card('duo_matchmaker', 'mm')], board: [], embers: 10 };
    const after = reduce(solo, { type: 'play', uid: 'mm' });
    expect(after.discover).toBeUndefined();
  });

  it('`noteMateTribes`: counts by the shared tribe predicate, clamped, ignored outside Duos; only a Matchmaker holder reads it', () => {
    const board = [minionOf('beast', 'a'), minionOf('beast', 'b'), minionOf('dragon', 'c')];
    expect(mateTribeCounts(board, ['beast', 'dragon', 'demon'])).toEqual({ beast: 2, dragon: 1, demon: 0 });
    const s = reduce(seat(), { type: 'noteMateTribes', tribes: { beast: 99, nope: 3, dragon: -4 } as never });
    expect(s.duos!.mateTribes).toEqual({ beast: 7, dragon: 0 });
    const solo = createVersusRun(11, 'warden', 'set2');
    expect(reduce(solo, { type: 'noteMateTribes', tribes: { beast: 1 } })).toBe(solo);
    expect(runReadsMateTribes(seat())).toBe(false);
    expect(runReadsMateTribes(seat({ hand: [card('duo_matchmaker', 'mm')] }))).toBe(true);
  });
});

describe('CueBee: "Whisper: Pass a minion in the Shop or on your board."', () => {
  it('a Pass arrives on play; cast on a Shop minion it passes it (free, the Whisper spent, counts as a spell)', () => {
    let ann = seat({ hand: [card('duo_cuebee', 'cb')] });
    ann = reduce(ann, { type: 'play', uid: 'cb' });
    const pass = ann.hand.find((c) => c.cardId === 'duo_w_pass')!;
    expect(pass).toBeDefined();
    expect(WHISPER_TIERS['duo_w_pass']).toBe(4); // CueBee's tier
    const offer = ann.shop.find((o) => !CARD_INDEX[o.cardId]?.spell && !o.starform)!;
    const spells = ann.spellsCast;
    ann = reduce(ann, { type: 'play', uid: pass.uid, targetUid: offer.uid });
    expect(ann.hand.some((c) => c.uid === pass.uid)).toBe(false);
    expect(ann.shop.some((o) => o.uid === offer.uid)).toBe(false);
    expect(ann.spellsCast).toBe(spells + 1);
    expect(ann.duos!.outbox.at(-1)).toMatchObject({ via: 'spell', from: 'shop', card: { cardId: offer.cardId } });
  });

  it('cast on one of my minions it leaves my board; a Golden one is refused (the Pass stays in hand)', () => {
    const [m] = filler(1, 'm');
    let ann = seat({ hand: [card('duo_w_pass', 'p1')], board: [card('duo_cuebee', 'cb'), m!, { ...filler(1, 'g')[0]!, golden: true }] });
    const refused = reduce(ann, { type: 'play', uid: 'p1', targetUid: 'g0' });
    expect(refused).toBe(ann);
    ann = reduce(ann, { type: 'play', uid: 'p1', targetUid: m!.uid });
    expect(ann.board.map((c) => c.uid)).toEqual(['cb', 'g0']);
    expect(ann.duos!.outbox.at(-1)).toMatchObject({ via: 'spell', from: 'board', card: { uid: m!.uid } });
  });

  it('Gilded CueBee hands over 2 Passes; an unused Pass vanishes at End of Turn', () => {
    let ann = seat({ hand: [card('duo_cuebee', 'cb', true)] });
    ann = reduce(ann, { type: 'play', uid: 'cb' });
    const passes = ann.hand.filter((c) => c.cardId === 'duo_w_pass');
    expect(passes).toHaveLength(2);
    for (const p of passes) expect(p.whisperMult ?? 1).toBe(1);
    ann = reduce(ann, { type: 'faceOmen' });
    expect(ann.hand.some((c) => c.cardId === 'duo_w_pass')).toBe(false);
  });
});

describe('effect passes wait for room (owner 2026-10-30: "they get the card once there is space in their hand")', () => {
  it('to a full hand: landed (answered), held in order, and each lands the moment there is room', () => {
    let ann = seat({ board: fullHand().slice(5, 7).map((c, i) => ({ ...c, uid: `m${i}` })) }); // two distinct minions (no triple with Bob's hand)
    effectPassCard(ann, ann.board.splice(0, 1)[0]!, 'board', 0);
    effectPassCard(ann, ann.board.splice(0, 1)[0]!, 'board', 0);
    ann = { ...ann };
    let bob = seat({ hand: fullHand() }, 12);
    bob = ship(ann, 'p1', bob);
    expect(bob.hand).toHaveLength(10);
    expect(bob.duos!.received).toEqual(['p1:0', 'p1:1']);
    expect(bob.duos!.refused).toEqual([]);
    expect(duosWaitingCount(bob)).toBe(2);
    // The sender gets nothing back: it arrived.
    bob = reduce(bob, { type: 'play', uid: 'h0' });
    expect(bob.hand.at(-1)).toMatchObject({ uid: expect.any(String), passKey: 'p1:0' });
    expect(duosWaitingCount(bob)).toBe(1);
    bob = reduce(bob, { type: 'passCard', uid: 'h1' }); // passing one of mine makes room too
    expect(bob.hand.at(-1)).toMatchObject({ passKey: 'p1:1' });
    expect(bob.duos!.waiting).toBeUndefined();
    // Delivered again (a retry, a restore): nothing twice.
    expect(ship(ann, 'p1', bob)).toBe(bob);
  });

  it('a later effect pass waits behind one already waiting, even with room (in order); a MANUAL pass is still refused when full', () => {
    let bob = seat({ hand: filler(10, 'h') }, 12);
    const wire = (uid: string, passFrom: 'spell' | 'hand') => ({ ...card(fillerId(), uid), passFrom });
    bob = reduce(bob, { type: 'receivePass', from: 'p1', seq: 0, card: wire('x0', 'spell') as never });
    bob = reduce(bob, { type: 'receivePass', from: 'p1', seq: 1, card: wire('x1', 'hand') as never });
    expect(bob.duos!.refused).toEqual(['p1:1']); // the drag pass keeps its rule
    expect(duosWaitingCount(bob)).toBe(1);
  });

  it('Golden: refused by default, passed with the explicit per-effect override (it travels as `passGolden`)', () => {
    const s = seat();
    const g = { ...filler(1, 'g')[0]!, golden: true };
    expect(effectPassCard(s, g, 'board', 0)).toBe(false);
    expect(effectPassCard(s, g, 'board', 0, { allowGolden: true })).toBe(true);
    const e = s.duos!.outbox[0]!;
    expect(e.allowGolden).toBe(true);
    expect(duosWireOf(e)).toMatchObject({ passFrom: 'spell', passGolden: true, golden: true });
    const bob = ship(s, 'p1', seat({}, 12));
    expect(bob.hand[0]).toMatchObject({ golden: true });
    expect('passGolden' in bob.hand[0]!).toBe(false);
  });
});
