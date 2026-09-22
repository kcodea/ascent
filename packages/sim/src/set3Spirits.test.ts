import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, REVELER_IDS, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { fireShopRally, handCardLocked, revelerValue, spiritsPlayedThisTurn, summonCopyFromHandShop } from './recruit';
import { equipmentState } from './equipment';

/**
 * SET 3 — SPIRITS, tranche 1 (owner roster + rulings 2026-09-09). The roster order is pinned by
 * `set3Scaffold.test.ts`; this file covers the engines:
 *  - The SHARED Reveler value: every Reveler pays it (Flame → Attack, Tide → Health, Grove → both, to every
 *    minion, BOARD ONLY) and raises it by one; golden pays 2X. Luminary adds it on both stats.
 *  - Revelers as a class: Revelator / Revelmaker hand them out; Treasurer's stacking, capped, spent discount;
 *    Grand Procession's one-return-per-type-per-turn.
 *  - The Spirits-played tally: Kindled Sprite (combat, frozen at combat start), Nurturer's repeats.
 *  - `onTribePlayed` per-instance tallies: Festival Keeper (every 3, carries across turns), Aspect
 *    (improves every 3), Forest Colossus (counts only Spirits AFTER it; SoC pays per point, in combat).
 *  - Tidebud / Spiritbinder: one board recipient AND one hand recipient. Dreamcurrent: a hand minion per cast.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, tribes: ['spirit', 'undead', 'kobold'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const inHand = (s: RunState, uid: string): BoardCard => s.hand.find((c) => c.uid === uid)!;
const play = (s: RunState, uid: string, toIndex = s.board.length): RunState => reduce(s, { type: 'play', uid, toIndex } as Action);
const sell = (s: RunState, uid: string): RunState => reduce(s, { type: 'sell', uid } as Action);
const stats = (c: BoardCard): [number, number] => [c.attack, c.health];
const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (attack: number, health: number): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);

describe('the Revelers share one value', () => {
  it('Flame pays Spirits Attack, Tide pays Health, Grove pays every minion both — each raises the shared value', () => {
    let s = run({
      board: [body('f', 'sp3_flamereveler'), body('t', 'sp3_tidereveler'), body('g', 'sp3_grovereveler'), body('k', 'sp3_kindled'), body('v', 'venom')],
      hand: [body('h', 'sp3_tidebud')],
    });
    expect(revelerValue(s)).toBe(1);
    s = sell(s, 'f');
    expect(stats(at(s, 'k')), 'Kindled Sprite is 1/3 (2026-09-18)').toEqual([1 + 1, 3]);
    expect(stats(at(s, 'v')), 'Flame pays Spirits only').toEqual([1, 1]);
    expect(stats(inHand(s, 'h')), 'the hand is NEVER paid (owner correction 2026-09-09)').toEqual([2, 3]); // Tidebud 2/3 since 2026-09-18
    expect(revelerValue(s)).toBe(2);
    s = sell(s, 't');
    expect(stats(at(s, 'k'))).toEqual([2, 3 + 2]);
    expect(revelerValue(s)).toBe(3);
    s = sell(s, 'g');
    expect(stats(at(s, 'k'))).toEqual([2 + 3, 5 + 3]);
    expect(stats(at(s, 'v')), 'the Grove pays every minion').toEqual([1 + 3, 1 + 3]);
    expect(revelerValue(s)).toBe(4);
  });

  it('a golden Reveler pays 2X (and still raises the value by one)', () => {
    let s = run({ board: [body('f', 'sp3_flamereveler', { golden: true }), body('k', 'sp3_kindled')], revelerX: 5 });
    s = sell(s, 'f');
    expect(at(s, 'k').attack).toBe(1 + 10);
    expect(revelerValue(s)).toBe(6);
  });

  it('Festival Luminary: 3 random Spirits get +1/+1 plus the shared value on both stats', () => {
    let s = run({ board: [body('a', 'sp3_kindled'), body('b', 'sp3_tidebud'), body('c', 'sp3_nurturer'), body('v', 'venom')], hand: [body('l', 'sp3_luminary')], revelerX: 3 });
    s = play(s, 'l');
    for (const uid of ['a', 'b', 'c']) {
      const base = CARD_INDEX[at(s, uid).cardId]!;
      expect(stats(at(s, uid))).toEqual([base.attack + 4, base.health + 4]);
    }
    expect(stats(at(s, 'v'))).toEqual([1, 1]);
  });
});

describe('Revelers as a class', () => {
  it('Revelator hands out a Reveler (golden: two); the Revelmaker Equipment does the same', () => {
    let s = run({ hand: [body('r', 'sp3_revelator')] });
    s = play(s, 'r');
    const got = s.hand.map((c) => c.cardId);
    expect(got).toHaveLength(1);
    expect(REVELER_IDS).toContain(got[0]);
    let g = run({ hand: [body('r', 'sp3_revelator', { golden: true })] });
    g = play(g, 'r');
    expect(g.hand.filter((c) => REVELER_IDS.includes(c.cardId))).toHaveLength(2);
    let e = run({ hand: [body('p', 'sp3_paradeartificer')], embers: 10 });
    e = play(e, 'p');
    e = reduce(e, { type: 'activateEquipment' } as Action);
    expect(e.hand.filter((c) => REVELER_IDS.includes(c.cardId))).toHaveLength(1);
  });

  it('Festival Treasurer: each Reveler sold stacks −1 (cap 3) on the next Spirit bought, spent by that buy', () => {
    let s = run({
      board: [body('tr', 'sp3_treasurer'), body('f1', 'sp3_flamereveler'), body('f2', 'sp3_flamereveler'), body('f3', 'sp3_flamereveler'), body('f4', 'sp3_flamereveler')],
      embers: 10, shop: [{ uid: 'o1', cardId: 'sp3_kindled', cost: 3 }, { uid: 'o2', cardId: 'sp3_kindled', cost: 3 }, { uid: 'o3', cardId: 'venom', cost: 3 }] as never,
    });
    for (const uid of ['f1', 'f2', 'f3', 'f4']) s = sell(s, uid);
    expect(s.spiritDiscount, 'four sales, capped at 3').toBe(3);
    const before = s.embers;
    s = reduce(s, { type: 'buy', uid: 'o3' } as Action);
    expect(before - s.embers, 'a non-Spirit pays full price').toBe(3);
    expect(s.spiritDiscount).toBe(3);
    s = reduce(s, { type: 'buy', uid: 'o1' } as Action);
    expect(s.embers, 'the Spirit was free (3 − 3)').toBe(before - 3);
    expect(s.spiritDiscount, 'spent').toBe(0);
    const b2 = s.embers;
    s = reduce(s, { type: 'buy', uid: 'o2' } as Action);
    expect(b2 - s.embers).toBe(3);
  });

  it('Grand Procession: the first of each Reveler type sold each turn returns a plain copy; a second of the same type does not', () => {
    let s = run({ board: [body('gp', 'sp3_grandprocession'), body('f1', 'sp3_flamereveler', { golden: true }), body('f2', 'sp3_flamereveler'), body('t1', 'sp3_tidereveler')] });
    s = sell(s, 'f1');
    expect(s.hand.map((c) => c.cardId)).toEqual(['sp3_flamereveler']);
    expect(s.hand[0]!.golden, 'a PLAIN copy').toBe(false);
    s = sell(s, 'f2');
    expect(s.hand.filter((c) => c.cardId === 'sp3_flamereveler')).toHaveLength(1);
    s = sell(s, 't1');
    expect(s.hand.map((c) => c.cardId).sort()).toEqual(['sp3_flamereveler', 'sp3_tidereveler']);
    expect(revelerValue(s), 'every sale still raised the value').toBe(4);
  });
});

describe('Spirits played this turn', () => {
  it('Kindled Sprite (combat): +1 Attack per Spirit played this turn, frozen at combat start — PERMANENT (carried back as a perma-buff, owner 2026-09-18)', () => {
    const r = simulate([bm('sp3_kindled', { sourceUid: 'k1', health: 40 } as Partial<BoardMinion>)], [foe(0, 30)], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, spiritsPlayed: 3, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 6 }));
    const gains = r.events.filter((e) => e.type === 'buff' && String((e as { key?: string }).key ?? '').includes('rallyGainAttackPerSpiritsPlayed'));
    expect(gains.length).toBeGreaterThan(0);
    expect((gains[0] as { attack: number }).attack).toBe(3);
    // Every Rally swing books +3 into `permaGain`; the settle carry-back (`playerPermaBuffs`) hands the total home.
    const home = r.playerPermaBuffs?.filter((b) => b.sourceUid === 'k1') ?? [];
    expect(home.length, 'a perma-buff record for the run card').toBe(1);
    expect(home[0]!.attack, 'the sum of its Rallies').toBe(3 * gains.length);
    expect(home[0]!.health).toBe(0);
  });

  it('Kindled Sprite: the run card keeps the Attack after the fight (End Turn → combat → next shop)', () => {
    // Three (distinct — three of a kind would triple) Spirits played this turn, then the fight: the Sprite comes
    // home with +3 Attack per Rally it made. A 40-Health body so it survives to be carried back.
    let s = run({ board: [body('k', 'sp3_kindled', { health: 40 })], hand: [body('a', 'sp3_tidebud'), body('b', 'sp3_nurturer'), body('c', 'sp3_bondweaver')], playedThisTurn: [] });
    s = play(s, 'a'); s = play(s, 'b'); s = play(s, 'c');
    expect(spiritsPlayedThisTurn(s)).toBe(3);
    const before = at(s, 'k').attack;
    s = reduce(reduce(reduce(s, { type: 'faceOmen' } as Action), { type: 'settleCombat' } as Action), { type: 'resolveCombat' } as Action);
    expect(s.phase).toBe('recruit');
    const rallies = (s.lastCombat?.events ?? []).filter((e) => e.type === 'buff' && String((e as { key?: string }).key ?? '').includes('rallyGainAttackPerSpiritsPlayed'));
    expect(rallies.length).toBeGreaterThan(0);
    expect((rallies[0] as { attack: number }).attack, 'the frozen count').toBe(3);
    expect(at(s, 'k').attack - before, 'permanent: +3 per Rally, on the run card').toBe(3 * rallies.length);
    expect((at(s, 'k').buffs ?? []).find((b) => b.source === 'Kindled Sprite'), 'the ledger names the card, not Flowing Monk').toBeTruthy();
  });

  it('Kindled Sprite (shop-triggered Rally): the live count, permanent as every shop grant', () => {
    let s = run({ board: [body('k', 'sp3_kindled')], hand: [body('a', 'sp3_tidebud'), body('b', 'sp3_nurturer')], playedThisTurn: [] });
    s = play(s, 'a'); s = play(s, 'b');
    const before = at(s, 'k').attack;
    fireShopRally(s, at(s, 'k'));
    expect(at(s, 'k').attack - before).toBe(2);
    expect((at(s, 'k').buffs ?? []).filter((b) => b.source === 'Kindled Sprite').reduce((n, b) => n + b.attack, 0)).toBe(2);
  });

  it('Nurturer: End of Turn pays once, plus once per Spirit played this turn', () => {
    let s = run({ board: [body('n', 'sp3_nurturer')], hand: [body('a', 'sp3_kindled'), body('b', 'sp3_tidebud')], playedThisTurn: [] });
    s = play(s, 'a'); s = play(s, 'b');
    expect(spiritsPlayedThisTurn(s)).toBe(2);
    s = reduce(s, { type: 'faceOmen' } as Action);
    const total = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    const base = s.board.reduce((n, c) => n + CARD_INDEX[c.cardId]!.attack + CARD_INDEX[c.cardId]!.health, 0);
    // Tidebud's Shout may have added +2 Health to one Spirit; Nurturer's three fires add 3 × (3 + 4) = 21.
    expect(total - base).toBeGreaterThanOrEqual(21);
  });
});

describe('onTribePlayed — per-instance tallies', () => {
  it('Festival Keeper: every third Spirit played → a Shop spell; the count carries across turns', () => {
    let s = run({ board: [body('fk', 'sp3_festivalkeeper')], hand: [body('a', 'sp3_kindled'), body('b', 'sp3_tidebud'), body('c', 'sp3_nurturer')], playedThisTurn: [] });
    s = play(s, 'a'); s = play(s, 'b');
    expect(at(s, 'fk').spiritTally).toBe(2);
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell)).toHaveLength(0);
    // Across a turn: the tally is on the body, so it survives the flip; the third play pays.
    s = { ...s, playedThisTurn: [] };
    s = play(s, 'c');
    expect(at(s, 'fk').spiritTally).toBe(3);
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell), 'a random Shop spell arrived').toHaveLength(1);
  });

  it('Aspect: +2/+2 to 3 random Spirits per play, improving to +4/+4 after 3 triggers (owner handoff 2026-09-18; was +1/+1)', () => {
    const ids = { a: 'sp3_tidebud', b: 'sp3_nurturer', c: 'sp3_bondweaver', d: 'sp3_festivalkeeper' } as const;
    let s = run({ board: [body('ac', 'sp3_aspect'), body('x', 'sp3_kindled')], hand: Object.entries(ids).map(([u, id]) => body(u, id)) });
    // Total Attack the Aspect has handed out = Σ (other Spirits' attack − printed). None of the played
    // Spirits touches Attack on play (Tidebud's Shout is Health-only), so the sum is a clean read.
    const handed = (st: RunState): number => st.board.filter((c) => c.uid !== 'ac').reduce((n, c) => n + c.attack - CARD_INDEX[c.cardId]!.attack, 0);
    s = play(s, 'a'); s = play(s, 'b'); s = play(s, 'c');
    expect(at(s, 'ac').spiritTally).toBe(3);
    // fires with 2, 3, 4 other Spirits available → (2 + 3 + 3) recipients × +2 Attack
    expect(handed(s)).toBe(16);
    s = play(s, 'd'); // the 4th trigger pays the improved +4 Attack to 3 recipients
    expect(handed(s)).toBe(16 + 12);
    // The second improvement: a copy that has already witnessed 6 triggers pays +6 on the 7th.
    let t = run({ board: [body('ac', 'sp3_aspect', { spiritTally: 6 }), body('x', 'sp3_kindled'), body('y', 'sp3_nurturer'), body('z', 'sp3_bondweaver')], hand: [body('a', 'sp3_tidebud')] });
    t = play(t, 'a');
    expect(handed(t), '3 recipients × +6').toBe(18);
    // Gilded: a +4 step improving by +4.
    let g = run({ board: [body('ac', 'sp3_aspect', { golden: true }), body('x', 'sp3_kindled'), body('y', 'sp3_nurturer'), body('z', 'sp3_bondweaver')], hand: [body('a', 'sp3_tidebud')] });
    g = play(g, 'a');
    expect(handed(g), '3 recipients × +4').toBe(12);
  });

  it('Old Timber counts only Spirits played AFTER it; its Start of Combat pays a base +3/+2 plus +3/+2 per point (owner handoff 2026-09-18)', () => {
    let s = run({ board: [body('early', 'sp3_kindled')], hand: [body('fc', 'sp3_forestcolossus'), body('a', 'sp3_tidebud'), body('b', 'sp3_tidebud')] });
    s = play(s, 'fc');
    expect(at(s, 'fc').spiritTally ?? 0, 'its own arrival never counts').toBe(0);
    s = play(s, 'a'); s = play(s, 'b');
    expect(at(s, 'fc').spiritTally).toBe(2);
    const socOn = (tally: number, golden = false) => {
      const r = simulate([bm('sp3_forestcolossus', { spiritTally: tally, golden } as Partial<BoardMinion>), bm('sp3_kindled')], [foe(1, 40)], makeRng(5), CARD_INDEX,
        combatSide({ tier: 6, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 6 }));
      const kindled = r.initial.player.find((m) => m.cardId === 'sp3_kindled')!;
      const e = r.events.find((ev) => ev.type === 'buff' && (ev as { target?: string }).target === kindled.uid && String((ev as { key?: string }).key ?? '').includes('scBuffTribePerTally')) as { attack: number; health: number } | undefined;
      return e ? [e.attack, e.health] : null;
    };
    expect(socOn(0), 'nothing counted yet: the printed base +3/+2').toEqual([3, 2]);
    expect(socOn(2), 'two counted: (1 + 2) × +3/+2').toEqual([9, 6]);
    expect(socOn(2, true), 'gilded doubles').toEqual([18, 12]);
  });
});

describe('board-and-hand recipients', () => {
  it('Tidebud buffs one random Spirit on board AND one in hand (+2 Health each)', () => {
    let s = run({ board: [body('x', 'sp3_kindled')], hand: [body('tb', 'sp3_tidebud'), body('h', 'sp3_nurturer'), body('v', 'venom')] });
    s = play(s, 'tb');
    expect(at(s, 'x').health).toBe(3 + 2);
    expect(inHand(s, 'h').health).toBe(6 + 2);
    expect(inHand(s, 'v').health, 'not a Spirit').toBe(1);
    expect(at(s, 'tb').health, 'never itself').toBe(3);
  });

  it('Spiritbinder: a random board Spirit and a random hand Spirit get +6/+6 — never a non-Spirit (owner bug 2026-09-14)', () => {
    // Board: one non-Spirit + the Shaman itself (a Spirit). Hand: one Spirit + one non-Spirit. With a single
    // eligible body per zone the draw is forced, so the assertion is exact — and the stray must be untouched.
    let s = run({ board: [body('v', 'stray')], hand: [body('bw', 'sp3_bondweaver'), body('h', 'sp3_nurturer'), body('w', 'stray')], embers: 10 });
    s = play(s, 'bw');
    const before = stats(at(s, 'bw'));
    s = reduce(s, { type: 'activateEquipment' } as Action);
    expect(stats(at(s, 'bw')), 'the Shaman is an eligible board Spirit').toEqual([before[0] + 6, before[1] + 6]);
    expect(stats(inHand(s, 'h'))).toEqual([2 + 6, 6 + 6]);
    expect(stats(at(s, 'v')), 'non-Spirit on board').toEqual([1, 1]);
    expect(stats(inHand(s, 'w')), 'non-Spirit in hand').toEqual([1, 1]);
  });

  /*
   * THE SPIRITBINDER BEAM (owner ask 2026-09-22: *"It should target the board minion, but the minion in hand
   * should still get the generic hand buffed effect that it currently has."*)
   *
   * Spiritbinder now carries an authored `useFxId` (the owner's `spiritbinder` beam) plus `useFxTargetsBuffed`,
   * so it takes the reducer's `fire()` branch instead of `captureBuffFx` and its destination rides the `use`
   * cue. The generic buff-FX tendril it used to record (asserted here until 2026-09-22) is GONE ON PURPOSE:
   * one press must produce one cue, not a beam and a ribbon (owner ruling 2026-08-11).
   *
   * The HAND recipient is untouched by all of this. Its pop is `handBuffFx`, a pure render diff over the hand
   * views, which reads no FX signal from the sim — so the only thing these tests can and must pin on the sim
   * side is that the hand Spirit still GAINS, which is what the diff fires on.
   */
  const spiritbinderCues = (s: RunState) => (s.equipFx ?? []).filter((f) => f.kind === 'use' && f.equipmentId === 'spiritbringer');

  it('Spiritbinder stamps ONE use cue carrying the board recipient and its gain, and records no generic tendril (owner 2026-09-22)', () => {
    let s = run({ board: [body('x', 'sp3_kindled')], hand: [body('bw', 'sp3_bondweaver'), body('h', 'sp3_nurturer')], embers: 10 });
    s = play(s, 'bw');
    const handBefore = stats(inHand(s, 'h'));
    s = reduce(s, { type: 'activateEquipment' } as Action);
    const cues = spiritbinderCues(s);
    expect(cues, 'one cue per activation').toHaveLength(1);
    const cue = cues[0]!;
    expect(cue.uid, 'the source is the granting body').toBe('bw');
    expect(['x', 'bw'], 'the destination is a board Spirit').toContain(cue.targetUid);
    expect([cue.buffAttack, cue.buffHealth], 'the beam owes exactly what this fire added').toEqual([6, 6]);
    const got = at(s, cue.targetUid!);
    expect(stats(got), 'the body the beam names is the body that grew').toEqual([
      CARD_INDEX[got.cardId]!.attack + 6, CARD_INDEX[got.cardId]!.health + 6,
    ]);
    expect((s.recruitBuffFx ?? []).filter((e) => e.targetUid === cue.targetUid), 'no second cue for one press').toHaveLength(0);
    expect(stats(inHand(s, 'h')), 'the hand Spirit still gains, which is what the hand-buff render diff fires on')
      .toEqual([handBefore[0] + 6, handBefore[1] + 6]);
  });

  it('Spiritbinder with NO Spirit on the board stamps no destination (so: no beam) and still buffs the hand', () => {
    let s = run({ board: [body('v', 'stray')], hand: [body('bw', 'sp3_bondweaver'), body('h', 'sp3_nurturer')], embers: 10 });
    s = play(s, 'bw', 1);
    s = reduce(s, { type: 'sell', uid: 'bw' } as Action); // the grant outlives its source, so the board holds no Spirit
    expect(s.board.some((c) => c.cardId === 'sp3_bondweaver')).toBe(false);
    s = reduce(s, { type: 'activateEquipment' } as Action);
    const cue = spiritbinderCues(s).at(-1)!;
    expect(cue.targetUid, 'nothing to fly at').toBeUndefined();
    expect(cue.buffAttack, 'and nothing to hold').toBeUndefined();
    expect(stats(inHand(s, 'h')), 'the hand recipient is unaffected by the board being empty').toEqual([2 + 6, 6 + 6]);
    expect(stats(at(s, 'v')), 'the non-Spirit is never a fallback target').toEqual([1, 1]);
  });

  it('Spiritbinder with NO Spirit in hand still beams the board recipient', () => {
    let s = run({ board: [body('x', 'sp3_kindled')], hand: [body('bw', 'sp3_bondweaver'), body('w', 'stray')], embers: 10 });
    s = play(s, 'bw');
    s = reduce(s, { type: 'activateEquipment' } as Action);
    const cue = spiritbinderCues(s).at(-1)!;
    expect(cue.targetUid).toBeDefined();
    expect([cue.buffAttack, cue.buffHealth]).toEqual([6, 6]);
    expect(stats(inHand(s, 'w')), 'the non-Spirit in hand is never a recipient').toEqual([1, 1]);
  });

  it('Spiritbinder can pick the granting body itself, and the beam still leaves the SLOT, so a self-draw needs no special case', () => {
    // The Shaman is the ONLY Spirit on the board, so the draw is forced onto the source.
    let s = run({ board: [body('v', 'stray')], hand: [body('bw', 'sp3_bondweaver')], embers: 10 });
    s = play(s, 'bw');
    s = reduce(s, { type: 'activateEquipment' } as Action);
    const cue = spiritbinderCues(s).at(-1)!;
    expect(cue.targetUid, 'the source is an eligible recipient').toBe('bw');
    expect(cue.uid, 'source and destination are the same body; the def flies slot to body either way').toBe('bw');
    expect([cue.buffAttack, cue.buffHealth]).toEqual([6, 6]);
  });

  it('a GILDED Spiritbinder beams the same single board recipient, owing +12/+12', () => {
    let s = run({ board: [body('x', 'sp3_kindled')], hand: [body('bw', 'sp3_bondweaver', { golden: true }), body('h', 'sp3_nurturer')], embers: 10 });
    s = play(s, 'bw');
    s = reduce(s, { type: 'activateEquipment' } as Action);
    const cue = spiritbinderCues(s).at(-1)!;
    expect([cue.buffAttack, cue.buffHealth]).toEqual([12, 12]);
    expect(stats(inHand(s, 'h')), 'still exactly one hand recipient').toEqual([2 + 12, 6 + 12]);
  });

  it('several activations in one turn stamp one cue each, and each cue names its own recipient', () => {
    let s = run({ board: [body('x', 'sp3_kindled')], hand: [body('bw', 'sp3_bondweaver')], embers: 30 });
    s = play(s, 'bw');
    s = reduce(s, { type: 'activateEquipment' } as Action);
    const first = spiritbinderCues(s);
    expect(first, 'one per press').toHaveLength(1);
    expect(['x', 'bw']).toContain(first[0]!.targetUid);
    s = reduce(s, { type: 'activateEquipment' } as Action);
    const second = spiritbinderCues(s);
    expect(second, 'the cue list is per ACTION, so the second press stamps its own').toHaveLength(1);
    expect(['x', 'bw'], 'and names a board Spirit of its own draw').toContain(second[0]!.targetUid);
    expect([second[0]!.buffAttack, second[0]!.buffHealth]).toEqual([6, 6]);
  });

  it('an Equipment with its own use-def records no generic tendril (Bloodpot, unchanged)', () => {
    let b = run({ board: [body('t', 'stray')], hand: [body('c', 'e3_frank')], embers: 10 });
    b = play(b, 'c');
    expect(equipmentState(b).available.map((g) => g.equipmentId)).toContain('bloodpot');
    b = reduce(b, { type: 'selectEquipment', equipmentId: 'bloodpot' } as Action);
    const before = stats(at(b, 't'));
    b = reduce(b, { type: 'activateEquipment', targetUid: 't' } as Action);
    expect(stats(at(b, 't')), 'the Bloodpot did land').not.toEqual(before);
    expect((b.recruitBuffFx ?? []).filter((e) => e.targetUid === 't')).toHaveLength(0);
    const cue = (b.equipFx ?? []).find((f) => f.kind === 'use' && f.equipmentId === 'bloodpot')!;
    expect(cue.targetUid, 'an AIMED Equipment still names what it was cast on').toBe('t');
    expect(cue.buffAttack, 'and carries no hold: it is not `useFxTargetsBuffed`').toBeUndefined();
  });

  it('Spiritbinder ignores a targetUid — it can no longer be aimed at a non-Spirit', () => {
    let s = run({ board: [body('v', 'stray'), body('x', 'sp3_kindled')], hand: [body('bw', 'sp3_bondweaver')], embers: 10 });
    s = play(s, 'bw');
    s = reduce(s, { type: 'activateEquipment', targetUid: 'v' } as Action);
    expect(stats(at(s, 'v')), 'aimed at the stray, which must not receive it').toEqual([1, 1]);
    const spiritGains = [at(s, 'x'), at(s, 'bw')].filter((c) => c.attack + c.health > 0 && (c.buffs ?? []).some((b) => b.attack === 6)).length;
    expect(spiritGains, 'exactly one board Spirit got the +6/+6').toBe(1);
  });

  it('Dreamcurrent Mystic: a Shop spell cast → a random hand minion +4/+6', () => {
    let s = run({ board: [body('dm', 'sp3_dreamcurrent')], hand: [body('h', 'sp3_kindled'), body('sp', 'growth')] });
    s = reduce(s, { type: 'play', uid: 'sp' } as Action);
    expect(stats(inHand(s, 'h'))).toEqual([1 + 4, 3 + 6]);
  });

  it('Gathering Guide only Discovers with another Spirit on board', () => {
    let alone = run({ hand: [body('gg', 'sp3_gatheringguide')] });
    alone = play(alone, 'gg');
    expect(alone.discover ?? null).toBeNull();
    let with1 = run({ board: [body('x', 'sp3_kindled')], hand: [body('gg', 'sp3_gatheringguide')] });
    with1 = play(with1, 'gg');
    expect(with1.discover?.length).toBeGreaterThan(0);
    for (const id of with1.discover ?? []) expect([CARD_INDEX[id]?.tribe, CARD_INDEX[id]?.tribe2], id).toContain('spirit');
  });

  it('Gathering Guide never Discovers ITSELF (owner report 2026-09-12) — across seeds, plain and gilded', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = run({ board: [body('x', 'sp3_kindled')], hand: [body('gg', 'sp3_gatheringguide')], rngCursor: seed * 7919, tier: 6 });
      s = play(s, 'gg');
      expect(s.discover, `seed ${seed}`).not.toContain('sp3_gatheringguide');
    }
    let g = run({ board: [body('x', 'sp3_kindled')], hand: [{ ...body('gg', 'sp3_gatheringguide'), golden: true }], tier: 6 });
    g = play(g, 'gg');
    expect(g.discover).not.toContain('sp3_gatheringguide');
    for (const spec of g.discoverQueue ?? []) expect((spec as { exclude?: string }).exclude).toBe('sp3_gatheringguide');
  });
});

/* ── tranche 2: the HAND-SUMMON mechanic (owner design 2026-09-09) ───────────────────────────────────── */
const handMinion = (uid: string, cardId: string, over: Partial<{ attack: number; health: number; golden: boolean; locked: boolean }> = {}) => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const fightH = (mine: BoardMinion[], foes: BoardMinion[], hand: ReturnType<typeof handMinion>[], seed = 7) =>
  simulate(mine, foes, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, handMinions: hand, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 6 }));
const summonsFromHand = (r: ReturnType<typeof simulate>) =>
  r.events.filter((e) => e.type === 'summon' && e.side === 'player' && (e as { fromHandUid?: string }).fromHandUid) as { minion: { cardId: string; keywords: readonly string[]; attack: number; health: number }; fromHandUid: string }[];

describe('summon from hand — a copy, the card stays, once per combat', () => {
  it('Dreamtide Caller\'s Echo summons a COPY of the highest-Health hand minion with its current stats; the card is not consumed', () => {
    const hand = [handMinion('h1', 'sp3_kindled', { attack: 9, health: 9 }), handMinion('h2', 'venom')];
    const r = fightH([bm('sp3_dreamtide', { attack: 1, health: 1 })], [foe(5, 40)], hand);
    const s = summonsFromHand(r);
    expect(s).toHaveLength(1);
    expect(s[0]!.fromHandUid).toBe('h1');
    expect(s[0]!.minion.cardId).toBe('sp3_kindled');
    expect([s[0]!.minion.attack, s[0]!.minion.health], 'the hand card\'s LIVE stats, not the printed ones').toEqual([9, 9]);
    expect(r.playerHandSummoned, 'nothing is removed from the hand at settle').toBeUndefined();
  });

  it('a card can be summoned only once per combat — a second summoner takes a different card, or nothing', () => {
    const hand = [handMinion('h1', 'sp3_kindled', { health: 9 }), handMinion('h2', 'venom', { health: 5 })];
    const r = fightH([bm('sp3_dreamtide', { attack: 1, health: 1 }), bm('sp3_dreamtide', { attack: 1, health: 1 })], [foe(5, 60)], hand);
    const s = summonsFromHand(r);
    expect(s.map((x) => x.fromHandUid)).toEqual(['h1', 'h2']);
    const solo = fightH([bm('sp3_dreamtide', { attack: 1, health: 1 }), bm('sp3_dreamtide', { attack: 1, health: 1 })], [foe(5, 60)], [handMinion('h1', 'sp3_kindled')]);
    expect(summonsFromHand(solo), 'one card, two Echoes: the second finds nothing').toHaveLength(1);
  });

  it('Dreaming Deep\'s copy arrives with Ward', () => {
    const r = fightH([bm('sp3_dreamingdeep', { attack: 1, health: 1 })], [foe(5, 40)], [handMinion('h1', 'sp3_kindled')]);
    const s = summonsFromHand(r);
    expect(s).toHaveLength(1);
    expect(s[0]!.minion.keywords).toContain('DS');
  });

  it('Seedling Spirit\'s Rally summons a random SPIRIT from hand (never a non-Spirit)', () => {
    const hand = [handMinion('h1', 'venom'), handMinion('h2', 'sp3_kindled'), handMinion('h3', 'sp3_tidebud')];
    const r = fightH([bm('sp3_seedling')], [foe(0, 40)], hand);
    const s = summonsFromHand(r);
    expect(s.length).toBeGreaterThan(0);
    expect(['sp3_kindled', 'sp3_tidebud']).toContain(s[0]!.minion.cardId);
  });

  it('a FULL board does not spend the hand card: the next summoner takes it once there is room (owner report 2026-09-10)', () => {
    // Seven bodies: two Seedlings and five 1-Health sandbags. Seedling A attacks first — no room, the copy
    // overflows and must NOT mark the card. The foe then kills a sandbag; Seedling B attacks with room and the
    // Colossus copy lands. Before the fix the first attempt marked the card and the second found nothing.
    const hand = [handMinion('h1', 'sp3_slumbering', { attack: 4, health: 4 })];
    const mine = [bm('sp3_seedling', { attack: 1, health: 30 }), bm('sp3_seedling', { attack: 1, health: 30 }), ...Array.from({ length: 5 }, () => bm('sandbag', { attack: 0, health: 1 }))];
    const r = fightH(mine, [foe(1, 200)], hand);
    const s = summonsFromHand(r);
    expect(s.length, 'the card was still summonable once room opened').toBe(1);
    expect(s[0]!.fromHandUid).toBe('h1');
    expect(s[0]!.minion.cardId).toBe('sp3_slumbering');
    // …and it landed AFTER the first player death freed a slot, i.e. on the second Rally, not the first.
    const firstDeath = r.events.findIndex((e) => e.type === 'death' && (e as { side?: string }).side === 'player');
    const summonAt = r.events.findIndex((e) => e.type === 'summon' && (e as { fromHandUid?: string }).fromHandUid === 'h1');
    expect(firstDeath, 'a sandbag died').toBeGreaterThanOrEqual(0);
    expect(summonAt, 'the copy landed after room opened').toBeGreaterThan(firstDeath);
  });

  it('Handbound Titan gains the highest-Health hand minion\'s stats at Start of Combat', () => {
    const r = fightH([bm('sp3_handboundtitan')], [foe(0, 40)], [handMinion('h1', 'venom', { attack: 4, health: 12 }), handMinion('h2', 'sp3_kindled')]);
    const titan = r.initial.player[0]!;
    const gain = r.events.find((e) => e.type === 'buff' && (e as { target?: string }).target === titan.uid && (e as { attack?: number }).attack === 4 && (e as { health?: number }).health === 12);
    expect(gain).toBeTruthy();
    expect(r.playerHandSummoned, 'the hand card is untouched').toBeUndefined();
  });

  it('Flamebanner Marshal\'s Rally gives 2 friendly Spirits the highest-Attack hand minion\'s Attack', () => {
    const r = fightH([bm('sp3_flamebanner'), bm('sp3_kindled'), bm('sp3_tidebud')], [foe(0, 60)], [handMinion('h1', 'venom', { attack: 11 })]);
    const gains = r.events.filter((e) => e.type === 'buff' && String((e as { key?: string }).key ?? '').includes('rallyGiveTribeAttackOfHighestAttackHand'));
    expect(gains.length).toBe(2);
    for (const g of gains) expect((g as { attack: number }).attack).toBe(11);
  });

  it('Hearth Whisperer: taking damage buffs a random hand minion +1/+2, permanently (a handBuff event)', () => {
    const r = fightH([bm('sp3_hearthwhisperer')], [foe(1, 40)], [handMinion('h1', 'sp3_kindled')]);
    const hb = r.events.find((e) => e.type === 'handBuff') as { uid: string; attack: number; health: number } | undefined;
    expect(hb).toBeTruthy();
    expect([hb!.uid, hb!.attack, hb!.health]).toEqual(['h1', 1, 2]);
  });
});

describe('a LOCKED hand card (Disco Dan tier lock etc.) can be buffed and read, never summoned', () => {
  it('combat: the summoners skip it — the next candidate goes instead — but Handbound Titan still reads its stats', () => {
    const hand = [handMinion('h1', 'sp3_kindled', { attack: 9, health: 9, locked: true }), handMinion('h2', 'venom', { health: 5 })];
    const r = fightH([bm('sp3_dreamtide', { attack: 1, health: 1 })], [foe(5, 40)], hand);
    const s = summonsFromHand(r);
    expect(s.map((x) => x.fromHandUid), 'the locked 9/9 is skipped; the 5-Health Venom is summoned').toEqual(['h2']);
    const only = fightH([bm('sp3_dreamtide', { attack: 1, health: 1 })], [foe(5, 40)], [handMinion('h1', 'sp3_kindled', { health: 9, locked: true })]);
    expect(summonsFromHand(only), 'a locked card alone: nothing is summoned').toHaveLength(0);
    // Reading is still allowed: the Titan gains the locked card's stats.
    const t = fightH([bm('sp3_handboundtitan')], [foe(1, 1)], [handMinion('h1', 'sp3_kindled', { attack: 9, health: 9, locked: true })]);
    const titan = t.initial.player[0]!;
    const gain = t.events.find((e) => e.type === 'buff' && (e as { target?: string }).target === titan.uid && (e as { attack?: number }).attack === 9 && (e as { health?: number }).health === 9);
    expect(gain, 'the Titan still reads the locked card').toBeTruthy();
  });

  it('shop: the primitive refuses a locked card, and the run marks it locked for combat', () => {
    const s = run({ tier: 1, board: [body('dc', 'sp3_dreamtide')], hand: [body('h', 'sp3_kindled', { attack: 7, health: 7, lockedUntilTier: 4 })] });
    expect(handCardLocked(s, inHand(s, 'h'))).toBe(true);
    expect(summonCopyFromHandShop(s, 'h', at(s, 'dc'), false), 'locked: no copy').toBeUndefined();
    expect(s.board).toHaveLength(1);
    expect(play(s, 'h').board, 'and it cannot be played either').toHaveLength(1);
    const open = run({ tier: 4, board: [body('dc', 'sp3_dreamtide')], hand: [body('h', 'sp3_kindled', { lockedUntilTier: 4 })] });
    expect(handCardLocked(open, inHand(open, 'h'))).toBe(false);
    expect(summonCopyFromHandShop(open, 'h', at(open, 'dc'), false), 'the gate opened at tier 4').toBeTruthy();
  });
});

describe('Slumbering Colossus — a hand watcher', () => {
  it('grows +4/+4 in hand for every Spirit played, and nothing once it is on the board', () => {
    let s = run({ hand: [body('sc', 'sp3_slumbering'), body('a', 'sp3_kindled'), body('b', 'sp3_tidebud')] });
    s = play(s, 'a');
    expect(stats(inHand(s, 'sc'))).toEqual([4 + 4, 6 + 4]);
    s = play(s, 'b'); // Tidebud's own Shout also hands the one hand Spirit +2 Health
    expect(stats(inHand(s, 'sc'))).toEqual([12, 16]);
    s = play(s, 'sc');
    const onBoard = at(s, 'sc');
    s = { ...s, hand: [body('c', 'sp3_nurturer')] };
    s = play(s, 'c');
    expect(stats(at(s, 'sc')), 'on the board it is asleep').toEqual(stats(onBoard));
  });
});

describe('the shop twin — a triggered Echo summons a copy from hand once per turn', () => {
  it('the primitive summons the copy beside the source, keeps the card, and refuses a second summon this turn', () => {
    const s = run({ board: [body('dc', 'sp3_dreamtide')], hand: [body('h', 'sp3_kindled', { attack: 7, health: 7 })] });
    expect(summonCopyFromHandShop(s, 'h', at(s, 'dc'), false)).toBeTruthy();
    expect(summonCopyFromHandShop(s, 'h', at(s, 'dc'), false), 'once per turn per card').toBeUndefined();
    const copy = s.board.find((c) => c.uid !== 'dc' && c.cardId === 'sp3_kindled')!;
    expect(copy).toBeTruthy();
    expect(stats(copy)).toEqual([7, 7]);
    expect(inHand(s, 'h'), 'the hand card stays').toBeTruthy();
    expect(s.handCopiedThisTurn).toContain('h');
  });
});
