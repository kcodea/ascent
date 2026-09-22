import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, reduceWithPresentation, type RunState } from './index';

/**
 * THE LASSO CHANNEL (`RunState.lassoFx` / `lassoFxSeq`, owner ask 2026-09-22).
 *
 * Every Shop minion `stealTavernMinion` takes is recorded at the one place the theft resolves, so the UI can
 * throw the authored `lasso` beam at each one and hold the card in the row until it lands. The record carries
 * what the presentation cannot recover afterwards:
 *
 *   · the stolen OFFER (spliced out of `state.shop` in the same commit — the row has no memory of it),
 *   · its INDEX at splice time, so the hold can put it back where it was,
 *   · the HAND uid, because the copy that lands in hand gets a FRESH uid — matching on the shop uid matches
 *     nothing, the exact trap that once broke the buy path,
 *   · the ORIGIN, which is the whole point: the beam leaves the spell, Rope Wrangler, the Equipment slot or
 *     the rune badge depending on who pulled.
 *
 * It is presentation metadata. The theft itself resolves immediately and unchanged — pinned below.
 */

const mk = (uid: string, id: string) => ({
  uid, cardId: id, tribe: CARD_INDEX[id]!.tribe, attack: CARD_INDEX[id]!.attack,
  health: CARD_INDEX[id]!.health, keywords: [...CARD_INDEX[id]!.keywords], golden: false,
});
const shopOf = (...uids: string[]) => uids.map((uid) => ({ uid, cardId: 'stray' }));

const base = (over: Partial<RunState>): RunState => ({
  ...createRun(11, 'warden'), phase: 'recruit', hand: [], board: [], ...over,
}) as unknown as RunState;

describe('lassoFx — the Shop-steal channel', () => {
  it('the Lasso SPELL records one steal, origin `spell`, with the offer, its index and the hand uid', () => {
    const s = base({ hand: [mk('h1', 'lasso')], shop: shopOf('s1', 's2', 's3') });
    const next = reduce(s, { type: 'play', uid: 'h1' });
    expect(next.lassoFx).toHaveLength(1);
    const ev = next.lassoFx![0]!;
    expect(ev.origin).toBe('spell');
    expect(next.shop.some((o) => o.uid === ev.offer.uid), 'the offer really left the tavern').toBe(false);
    expect(s.shop[ev.index]!.uid, 'the index names the slot it was taken from').toBe(ev.offer.uid);
    const arrival = next.hand.find((c) => c.uid === ev.handUid);
    expect(arrival, 'the hand uid names the copy that landed').toBeDefined();
    expect(arrival!.cardId).toBe(ev.offer.cardId);
    expect(next.lassoFxSeq).toBe(1);
  });

  it('ROPE WRANGLER records one steal per cast, in order, all from the Wrangler itself', () => {
    const s = base({ goldSpentThisTurn: 18, board: [mk('b1', 'ropewrangler')], shop: shopOf('s1', 's2', 's3', 's4', 's5') });
    const next = reduce(s, { type: 'faceOmen' });
    const fx = next.lassoFx ?? [];
    expect(fx.length, 'several casts, several records').toBeGreaterThan(1);
    expect(new Set(fx.map((e) => e.origin))).toEqual(new Set(['board:b1']));
    expect(new Set(fx.map((e) => e.offer.uid)).size, 'no offer stolen twice').toBe(fx.length);
    expect(new Set(fx.map((e) => e.handUid)).size, 'one arrival per steal').toBe(fx.length);
    expect(fx.length, 'exactly as many records as cards gained').toBe(next.hand.length - s.hand.length);
  });

  it('WHIPLASS-O records `equipment` — the beam leaves the slot, not a body on the board', () => {
    // The Equipment is granted by PLAYING its carrier — the same path the player takes.
    const played = reduce(base({ embers: 20, hand: [mk('h1', 'n3_hustler')], shop: shopOf('s1', 's2') }), { type: 'play', uid: 'h1', toIndex: 0 });
    const next = reduce(played, { type: 'activateEquipment' });
    expect((next.lassoFx ?? []).map((e) => e.origin)).toEqual(['equipment']);
  });

  it('an EMPTY SHOP records nothing — no steal, no beam', () => {
    const s = base({ hand: [mk('h1', 'lasso')], shop: [] });
    const next = reduce(s, { type: 'play', uid: 'h1' });
    expect(next.lassoFx ?? []).toEqual([]);
    expect(next.lassoFxSeq ?? 0).toBe(0);
  });

  it('is CLEARED per action, so a later action never replays an old cascade', () => {
    const s = base({ hand: [mk('h1', 'lasso')], shop: shopOf('s1', 's2') });
    const stolen = reduce(s, { type: 'play', uid: 'h1' });
    expect(stolen.lassoFx).toHaveLength(1);
    const later = reduce(stolen, { type: 'roll' });
    expect(later.lassoFx ?? []).toEqual([]);
  });

  it('changes nothing about what RESOLVES — the record only DESCRIBES a theft that already happened', () => {
    const s = base({ goldSpentThisTurn: 12, board: [mk('b1', 'ropewrangler')], shop: shopOf('s1', 's2', 's3') });
    const next = reduce(s, { type: 'faceOmen' });
    const fx = next.lassoFx ?? [];
    expect(fx.length).toBeGreaterThan(0);
    const stolen = new Set(fx.map((e) => e.offer.uid));
    // The row lost EXACTLY the offers the records name, and the survivors kept their order.
    expect(next.shop.map((o) => o.uid)).toEqual(s.shop.map((o) => o.uid).filter((u) => !stolen.has(u)));
    // The hand gained one copy per record, in the same order, each of the card its record names.
    const arrivals = next.hand.filter((c) => fx.some((e) => e.handUid === c.uid));
    expect(arrivals.map((c) => c.uid)).toEqual(fx.map((e) => e.handUid));
    expect(arrivals.map((c) => c.cardId)).toEqual(fx.map((e) => e.offer.cardId));
    // …and CAPTURING adds the channel and nothing else: strip it and the two entry points are byte-identical,
    // with the same rng cursor, so recording a steal can never move the run off its seeded line.
    const strip = (st: RunState): string => {
      const { lassoFx: _fx, lassoFxSeq: _seq, ...rest } = st;
      return JSON.stringify(rest);
    };
    const captured = reduceWithPresentation(s, { type: 'faceOmen' }, true).state;
    expect(strip(captured)).toBe(strip(next));
    expect(captured.rngCursor).toBe(next.rngCursor);
  });

  it("an End-of-Turn steal's hand uid is the one the batch's `cardGranted` names — that is how the UI pairs them", () => {
    const s = base({ goldSpentThisTurn: 12, board: [mk('b1', 'ropewrangler')], shop: shopOf('s1', 's2', 's3') });
    const { state: next, batch } = reduceWithPresentation(s, { type: 'faceOmen' }, true);
    const grantUids = (batch?.events ?? [])
      .filter((e) => e.type === 'cardGranted')
      .map((e) => (e as { target: { uid?: string } }).target.uid);
    expect(grantUids.length).toBeGreaterThan(0);
    for (const ev of next.lassoFx ?? []) expect(grantUids).toContain(ev.handUid);
  });
});
