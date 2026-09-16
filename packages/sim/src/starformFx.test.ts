import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  createRun, reduce, tierSlots,
  createStarform, hasStarform, starformOf, buffStarform, starformConsumeShopMinion,
  type Action, type BoardCard, type RunState, type ShopCard,
} from './index';
import { consumeShopMinion, rightmostShopMinion } from './recruit';
import { selectEquipment } from './equipment';
import { STAR_DESTROYER } from '@game/content';

/**
 * THE STARFORM PULL CHANNEL (`RunState.starformFx` / `starformFxSeq`, owner ask 2026-09-12): the UI's authored
 * `starform-pull` def plays FROM the thing being consumed TO the thing gaining at exactly three moments —
 * the token eating a Shop minion, a warband minion eating the token (the BUY into your left-most Celestial —
 * rules v2 2026-09-13), and the Collapse (one play per HIT, duplicates included). The Star Destroyer's silent
 * exit and a Demon eating the token keep their own cues and emit NOTHING here. Per-action, like `shopEaten`:
 * the reducer clears it at the top of every action.
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const play = (s: RunState, uid: string): RunState => act(s, { type: 'play', uid, toIndex: 0 } as Action);
const offer = (s: RunState, cardId: string, over: Partial<ShopCard> = {}): ShopCard => ({ uid: `s${s.uidSeq++}`, cardId, ...over });
const SRC = { cardId: 'dbg_starseed', name: 'Star Seed' };
/** A run with an OPEN slot and a Starform in it (nothing eaten at creation). */
const withStarform = (over: Partial<RunState> = {}): RunState => {
  const s = run(over);
  s.shop = [offer(s, 'ce3_seer')];
  createStarform(s, SRC);
  buffStarform(s, 4, 6, 'test'); // 5/7
  // The fixture's creation records its own `created` cue (2026-09-14); the scenarios below assert the NEXT
  // action's channel, so start them clean — `reduce` would have cleared it anyway on the next action.
  s.starformFx = undefined; s.starformFxSeq = 0;
  return s;
};

describe('starformFx — the per-action pull channel', () => {
  it('starts at seq 0 with no entries', () => {
    const s = createRun(7);
    expect(s.starformFxSeq).toBe(0);
    expect(s.starformFx).toBeUndefined();
  });

  it('(1) the token EATS a Shop minion: consumeShop from the eaten offer to the token — The Great Attractor; a CREATION records `created` (its meal is silent)', () => {
    let s = withStarform({ hand: [body('w', 'ce3_accretionwarden')] });
    const meal = s.shop[0]!.uid, token = starformOf(s)!.uid;
    s = play(s, 'w');
    expect(s.shop.some((o) => o.uid === meal), 'the offer left').toBe(false);
    expect(s.starformFx).toEqual([{ kind: 'consumeShop', fromUid: meal, toUids: [token] }]);
    expect(s.starformFxSeq).toBe(1);
    // …and the meal is ALSO on `shopEaten` with the token as its eater — the UI lets that ghost fly and swaps
    // the def, rather than playing two pulls.
    expect(s.shopEaten).toMatchObject([{ uid: meal, eaterUid: token }]);

    // A CREATION (owner 2026-09-14): the `created` cue on the token — into a full row (the meal is a real consume
    // on `shopEaten`, flagged `silent` so the UI draws no ghost / pull / held slot and the row never shifts) …
    const c = run();
    c.shop = Array.from({ length: tierSlots(c.tier) }, () => offer(c, 'ce3_seer'));
    const victim = c.shop[c.shop.length - 1]!.uid;
    const victimIdx = c.shop.length - 1;
    const sf = createStarform(c, SRC);
    expect(c.starformFx).toEqual([{ kind: 'created', fromUid: sf.uid, toUids: [sf.uid] }]);
    expect(c.shopEaten).toMatchObject([{ uid: victim, eaterUid: sf.uid, silent: true }]);
    expect(c.shop.indexOf(sf), 'the token took the victim\'s slot in place').toBe(victimIdx);
    // … and into an OPEN slot alike (no meal, no shopEaten).
    const o = run();
    o.shop = [offer(o, 'ce3_seer')];
    const sf2 = createStarform(o, SRC);
    expect(o.starformFx).toEqual([{ kind: 'created', fromUid: sf2.uid, toUids: [sf2.uid] }]);
    expect(o.shopEaten ?? []).toEqual([]);
    // A non-creation meal (The Great Attractor above) is NOT silent — its ghost and pull still play.
    expect(s.shopEaten![0]!.silent).toBeUndefined();

    // The helper directly, with a target that is not a minion → nothing recorded.
    const n = withStarform();
    n.shop.unshift(offer(n, 'starcrash'));
    expect(starformConsumeShopMinion(n, 0)).toBe(false);
    expect(n.starformFx ?? []).toEqual([]);
  });

  it('(2) a warband minion CONSUMES the token (the BUY — your left-most Celestial): consumed from the token to the body; no receiver → no record', () => {
    let s = withStarform({ board: [body('n', 'sandbag'), body('d', 'ce3_courier')] });
    const token = starformOf(s)!.uid;
    s = act(s, { type: 'buy', uid: token });
    expect(hasStarform(s)).toBe(false);
    expect(s.starformFx).toEqual([{ kind: 'consumed', fromUid: token, toUids: ['d'] }]);
    expect(s.starformFxSeq).toBe(1);
    let none = withStarform({ board: [body('n', 'sandbag')] });
    none = act(none, { type: 'buy', uid: starformOf(none)!.uid });
    expect(hasStarform(none)).toBe(false);
    expect(none.starformFx, 'nothing gained → nothing to pull to').toEqual([]);
    expect(none.starformFxSeq).toBe(0);
  });

  it('(3) COLLAPSE (Corona Devotee): one record from the token naming EVERY hit — two unique, one, or the Devotee alone; Herald extras repeat uids', () => {
    let s = withStarform({ board: [body('a', 'ce3_seer'), body('b', 'ce3_courier'), body('c', 'ce3_vendor'), body('n', 'sandbag')], hand: [body('d', 'ce3_coronadevotee')] });
    const token = starformOf(s)!.uid;
    s = play(s, 'd');
    expect(s.starformFx).toHaveLength(1);
    const fx = s.starformFx![0]!;
    expect([fx.kind, fx.fromUid]).toEqual(['collapse', token]);
    expect(fx.toUids).toHaveLength(2);
    expect(new Set(fx.toUids).size, 'two distinct targets').toBe(2);
    expect(fx.toUids).not.toContain('n');
    // The receivers on the record are exactly the bodies that gained.
    const gained = s.board.filter((c) => (c.buffs ?? []).some((b) => b.source === 'Solburn')).map((c) => c.uid);
    expect([...fx.toUids].sort()).toEqual(gained.sort());

    let two = withStarform({ board: [body('a', 'ce3_seer')], hand: [body('d', 'ce3_coronadevotee')] });
    two = play(two, 'd');
    expect([...two.starformFx![0]!.toUids].sort()).toEqual(['a', 'd']);

    let one = withStarform({ board: [body('n', 'sandbag')], hand: [body('d', 'ce3_coronadevotee')] });
    one = play(one, 'd');
    expect(one.starformFx![0]!.toUids).toEqual(['d']);

    // A Nova Herald's 2 extras land with replacement: 4 entries over 2 bodies — the FX plays once per hit.
    let h = withStarform({ board: [body('h', 'ce3_novaherald')], hand: [body('d', 'ce3_coronadevotee')] });
    h = play(h, 'd');
    const hits = h.starformFx![0]!.toUids;
    expect(hits).toHaveLength(4);
    expect(new Set(hits).size).toBe(2);
  });

  it('no Starform → Corona Devotee records nothing', () => {
    let s = run({ hand: [body('d', 'ce3_coronadevotee')] });
    s = play(s, 'd');
    expect(s.starformFx).toEqual([]);
    expect(s.starformFxSeq).toBe(0);
  });

  it('the STAR DESTROYER exit and a DEMON eating the token emit nothing (they keep their own cues)', () => {
    let s = withStarform();
    selectEquipment(s, STAR_DESTROYER.id);
    s = act(s, { type: 'activateEquipment' });
    expect(hasStarform(s)).toBe(false);
    expect(s.starformFx).toEqual([]);
    expect(s.starformFxSeq).toBe(0);

    const d = withStarform({ board: [body('e', 'ce3_courier')] });
    d.starformFx = [];
    expect(consumeShopMinion(d, d.board[0]!, rightmostShopMinion(d))).toBe(true);
    expect(hasStarform(d)).toBe(false);
    expect(d.starformFx).toEqual([]);
    expect(d.starformFxSeq).toBe(0);
  });

  it('is per-action: the next action clears the list; the seq only ever climbs', () => {
    let s = withStarform({ board: [body('c', 'ce3_courier')] });
    s = act(s, { type: 'buy', uid: starformOf(s)!.uid });
    expect(s.starformFx).toHaveLength(1);
    s = act(s, { type: 'roll' });
    expect(s.starformFx).toEqual([]);
    expect(s.starformFxSeq).toBe(1);
  });
});
