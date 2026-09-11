import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, REVELER_IDS, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { handCardLocked, revelerValue, spiritsPlayedThisTurn, summonCopyFromHandShop } from './recruit';

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
 *  - Tidebud / Spiritbringer: one board recipient AND one hand recipient. Dreamcurrent: a hand minion per cast.
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
    expect(stats(at(s, 'k'))).toEqual([3 + 1, 1]);
    expect(stats(at(s, 'v')), 'Flame pays Spirits only').toEqual([1, 1]);
    expect(stats(inHand(s, 'h')), 'the hand is NEVER paid (owner correction 2026-09-09)').toEqual([1, 3]);
    expect(revelerValue(s)).toBe(2);
    s = sell(s, 't');
    expect(stats(at(s, 'k'))).toEqual([4, 1 + 2]);
    expect(revelerValue(s)).toBe(3);
    s = sell(s, 'g');
    expect(stats(at(s, 'k'))).toEqual([4 + 3, 3 + 3]);
    expect(stats(at(s, 'v')), 'the Grove pays every minion').toEqual([1 + 3, 1 + 3]);
    expect(revelerValue(s)).toBe(4);
  });

  it('a golden Reveler pays 2X (and still raises the value by one)', () => {
    let s = run({ board: [body('f', 'sp3_flamereveler', { golden: true }), body('k', 'sp3_kindled')], revelerX: 5 });
    s = sell(s, 'f');
    expect(at(s, 'k').attack).toBe(3 + 10);
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
  it('Kindled Sprite (combat): +1 Attack per Spirit played this turn, frozen at combat start', () => {
    const r = simulate([bm('sp3_kindled')], [foe(0, 30)], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, spiritsPlayed: 3, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 6 }));
    const gains = r.events.filter((e) => e.type === 'buff' && String((e as { key?: string }).key ?? '').includes('rallyGainAttackPerSpiritsPlayed'));
    expect(gains.length).toBeGreaterThan(0);
    expect((gains[0] as { attack: number }).attack).toBe(3);
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

  it('Aspect: +1/+1 to 3 random Spirits per play, improving to +2/+2 after 3 triggers', () => {
    const ids = { a: 'sp3_tidebud', b: 'sp3_nurturer', c: 'sp3_bondweaver', d: 'sp3_festivalkeeper' } as const;
    let s = run({ board: [body('ac', 'sp3_aspect'), body('x', 'sp3_kindled')], hand: Object.entries(ids).map(([u, id]) => body(u, id)) });
    // Total Attack the Choreographer has handed out = Σ (other Spirits' attack − printed). None of the played
    // Spirits touches Attack on play (Tidebud's Shout is Health-only), so the sum is a clean read.
    const handed = (st: RunState): number => st.board.filter((c) => c.uid !== 'ac').reduce((n, c) => n + c.attack - CARD_INDEX[c.cardId]!.attack, 0);
    s = play(s, 'a'); s = play(s, 'b'); s = play(s, 'c');
    expect(at(s, 'ac').spiritTally).toBe(3);
    // fires with 2, 3, 4 other Spirits available → 2 + 3 + 3 recipients × +1 Attack
    expect(handed(s)).toBe(8);
    s = play(s, 'd'); // the 4th trigger pays the improved +2 Attack to 3 recipients
    expect(handed(s)).toBe(14);
  });

  it('Forest Colossus counts only Spirits played AFTER it, and its Start of Combat pays per point in the fight', () => {
    let s = run({ board: [body('early', 'sp3_kindled')], hand: [body('fc', 'sp3_forestcolossus'), body('a', 'sp3_tidebud'), body('b', 'sp3_tidebud')] });
    s = play(s, 'fc');
    expect(at(s, 'fc').spiritTally ?? 0, 'its own arrival never counts').toBe(0);
    s = play(s, 'a'); s = play(s, 'b');
    expect(at(s, 'fc').spiritTally).toBe(2);
    const r = simulate([bm('sp3_forestcolossus', { spiritTally: 2 } as Partial<BoardMinion>), bm('sp3_kindled')], [foe(1, 40)], makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 6 }));
    const kindled = r.initial.player.find((m) => m.cardId === 'sp3_kindled')!;
    const soc = r.events.find((e) => e.type === 'buff' && (e as { target?: string }).target === kindled.uid && (e as { attack?: number }).attack === 2 && (e as { health?: number }).health === 2);
    expect(soc, 'Kindled Sprite got +2/+2 at Start of Combat').toBeTruthy();
  });
});

describe('board-and-hand recipients', () => {
  it('Tidebud buffs one random Spirit on board AND one in hand (+2 Health each)', () => {
    let s = run({ board: [body('x', 'sp3_kindled')], hand: [body('tb', 'sp3_tidebud'), body('h', 'sp3_nurturer'), body('v', 'venom')] });
    s = play(s, 'tb');
    expect(at(s, 'x').health).toBe(1 + 2);
    expect(inHand(s, 'h').health).toBe(6 + 2);
    expect(inHand(s, 'v').health, 'not a Spirit').toBe(1);
    expect(at(s, 'tb').health, 'never itself').toBe(3);
  });

  it('Spiritbringer: the targeted board Spirit and a random hand Spirit get +6/+6', () => {
    let s = run({ board: [body('x', 'sp3_kindled')], hand: [body('bw', 'sp3_bondweaver'), body('h', 'sp3_nurturer')], embers: 10 });
    s = play(s, 'bw');
    s = reduce(s, { type: 'activateEquipment', targetUid: 'x' } as Action);
    expect(stats(at(s, 'x'))).toEqual([3 + 6, 1 + 6]);
    expect(stats(inHand(s, 'h'))).toEqual([2 + 6, 6 + 6]);
  });

  it('Dreamcurrent Mystic: a Shop spell cast → a random hand minion +4/+6', () => {
    let s = run({ board: [body('dm', 'sp3_dreamcurrent')], hand: [body('h', 'sp3_kindled'), body('sp', 'growth')] });
    s = reduce(s, { type: 'play', uid: 'sp' } as Action);
    expect(stats(inHand(s, 'h'))).toEqual([3 + 4, 1 + 6]);
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
