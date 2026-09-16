import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type Keyword } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * SET 3 BATCH 2 (2026-09-16) — TRANCHE D, the combat half: the two runes tranche A deferred because they live on
 * the hand-summon machinery in `simulate.ts`.
 *
 *   · Rune of the Open Hand (Epic 5): when you summon a minion from your hand, give its stats to another friendly
 *     minion — EVERY landed hand-summon (the Spirit copies, Rope Wrangler's Echo, the Waking Reserve's copy); the
 *     receiver is a random OTHER friendly; the gift is the summoned body's CURRENT Attack / Health.
 *   · Rune of the Waking Reserve (Epic 6): Start of Combat — summon a copy of the highest-stat (Attack + Health)
 *     minion in hand when the board has room. The hand card is NOT marked as summoned.
 *
 * Every fight here is a real `simulate()` with a served hand (`handMinions`), so a rune that forgets a link fails
 * here rather than shipping inert.
 */
const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (attack: number, health: number): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
const handMinion = (uid: string, cardId: string, over: Partial<{ attack: number; health: number; keywords: Keyword[]; golden: boolean }> = {}) => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords] as Keyword[], golden: false, ...over };
};
type Hand = ReturnType<typeof handMinion>[];
const fight = (mine: BoardMinion[], foes: BoardMinion[], mods: object = {}, hand: Hand = [], seed = 5, enemyExtra: object = {}) =>
  simulate(mine, foes, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['undead', 'beast', 'spirit', 'celestial'], questMods: mods, handMinions: hand }),
    combatSide({ tier: 6, ...enemyExtra }));

type Summon = Extract<CombatEvent, { type: 'summon' }>;
type Buff = Extract<CombatEvent, { type: 'buff' }>;
const summons = (evs: CombatEvent[], side: 'player' | 'enemy' = 'player'): Summon[] => evs.filter((e): e is Summon => e.type === 'summon' && e.side === side);
const fromHandSummons = (evs: CombatEvent[]): Summon[] => summons(evs).filter((e) => !!(e as { fromHandUid?: string }).fromHandUid);
const openHandBuffs = (evs: CombatEvent[]): Buff[] => evs.filter((e): e is Buff => e.type === 'buff' && e.source === 'Rune of the Open Hand');
const triggers = (evs: CombatEvent[], flag: string) => evs.filter((e) => e.type === 'questTrigger' && e.flag === flag);
/** Where the SoC summons end: the index of the first `attack` event. */
const firstAttackAt = (evs: CombatEvent[]): number => { const i = evs.findIndex((e) => e.type === 'attack'); return i < 0 ? evs.length : i; };

// Dreamtide Caller's Echo summons a COPY of the highest-Health hand minion — the Spirit hand-summon path.
const twoCallers = () => [bm('sp3_dreamtide', { attack: 1, health: 1 }), bm('sp3_dreamtide', { attack: 1, health: 1 })];
const handOf44and22 = (): Hand => [handMinion('h1', 'u3_poochy', { attack: 4, health: 4, keywords: [] }), handMinion('h2', 'u3_poochy', { attack: 2, health: 2, keywords: [] })];

describe('Rune of the Open Hand — every landed hand-summon gives its stats to another friendly minion', () => {
  it('a Spirit hand-summon: the copy lands and a random OTHER friendly gains the copy\'s current Attack/Health, on its own beat', () => {
    // A durable 1/100 receiver stands beside the Callers so another living friendly exists at every hand-summon.
    const r = fight([...twoCallers(), bm('u3_poochy', { attack: 1, health: 100, keywords: [] })], [foe(3, 500)], { runeOpenHand: true }, handOf44and22());
    const fh = fromHandSummons(r.events);
    expect(fh.length, 'the Callers\' Echoes summoned from the hand').toBe(2);
    const gifts = openHandBuffs(r.events);
    expect(gifts.length, 'one gift per landed hand-summon').toBe(fh.length);
    expect(triggers(r.events, 'runeOpenHand')).toHaveLength(fh.length);
    for (let i = 0; i < fh.length; i++) {
      const summoned = fh[i]!.minion;
      expect([gifts[i]!.attack, gifts[i]!.health], 'the gift is the summoned body\'s stats').toEqual([summoned.attack, summoned.health]);
      expect(gifts[i]!.target, 'never the summoned body itself').not.toBe(summoned.uid);
    }
  });

  it('without the rune the same fight gives nothing', () => {
    const r = fight(twoCallers(), [foe(3, 500)], {}, handOf44and22());
    expect(fromHandSummons(r.events).length).toBeGreaterThanOrEqual(1);
    expect(openHandBuffs(r.events)).toHaveLength(0);
  });

  it('a summon that is NOT from the hand (an Echo token) pays nothing', () => {
    const r = fight([bm('pack'), bm('u3_poochy', { keywords: [] })], [foe(9, 500)], { runeOpenHand: true });
    expect(summons(r.events).length, 'the Pack\'s Echo summoned').toBeGreaterThanOrEqual(1);
    expect(openHandBuffs(r.events)).toHaveLength(0);
  });

  it('no OTHER living friendly at the summon → no gift (the copy is never its own receiver)', () => {
    // One Caller, alone: when its Echo summons, the Caller is dead and the copy is the only body.
    const r = fight([bm('sp3_dreamtide', { attack: 1, health: 1 })], [foe(3, 500)], { runeOpenHand: true }, handOf44and22());
    expect(fromHandSummons(r.events)).toHaveLength(1);
    expect(openHandBuffs(r.events)).toHaveLength(0);
  });

  it('the consumed hand-summon Echo (`deathrattleSummonRandomHandMinion`, Rope Wrangler\'s old body) pays it too', () => {
    CARD_INDEX['dbg_hand_wrangler'] = { id: 'dbg_hand_wrangler', name: 'Hand Wrangler (probe)', tribe: 'neutral', tier: 4, attack: 1, health: 1, keywords: [],
      effects: [{ on: 'onDeath', do: 'deathrattleSummonRandomHandMinion' }], text: '' };
    const r = fight([bm('dbg_hand_wrangler'), bm('u3_poochy', { attack: 1, health: 100, keywords: [] })], [foe(3, 500)], { runeOpenHand: true },
      [handMinion('h1', 'u3_poochy', { attack: 6, health: 5, keywords: [] })]);
    const fh = summons(r.events).filter((e) => e.minion.cardId === 'u3_poochy' && e.minion.attack === 6);
    expect(fh, 'the Wrangler summoned the 6/5 from hand').toHaveLength(1);
    const gifts = openHandBuffs(r.events);
    expect(gifts).toHaveLength(1);
    expect([gifts[0]!.attack, gifts[0]!.health]).toEqual([6, 5]);
  });

  it('two copies held: two gifts per hand-summon (boolean-flag family)', () => {
    const r = fight(twoCallers(), [foe(3, 500)], { runeOpenHand: true, flagCopies: { runeOpenHand: 2 } }, handOf44and22());
    const fh = fromHandSummons(r.events);
    expect(fh.length).toBeGreaterThanOrEqual(1);
    // The first hand-summon lands beside the second (still living) Caller — one other body, two gifts on it.
    expect(openHandBuffs(r.events).length).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic from the seed', () => {
    const a = fight(twoCallers(), [foe(3, 500)], { runeOpenHand: true }, handOf44and22(), 9);
    const b = fight(twoCallers(), [foe(3, 500)], { runeOpenHand: true }, handOf44and22(), 9);
    expect(a.events).toEqual(b.events);
  });
});

describe('Rune of the Waking Reserve — Start of Combat: a copy of the highest-stat hand minion, the card unmarked', () => {
  const hand3 = (): Hand => [
    handMinion('h1', 'u3_poochy', { attack: 4, health: 4, keywords: [] }),
    handMinion('h2', 'u3_poochy', { attack: 3, health: 6, keywords: ['T'], golden: true }), // 9 — the highest
    handMinion('h3', 'u3_poochy', { attack: 2, health: 2, keywords: [] }),
  ];

  it('summons the copy at Start of Combat with the hand card\'s current stats, keywords and gilding — and no `fromHandUid`', () => {
    const r = fight([bm('sandbag')], [foe(0, 500)], { runeWakingReserve: true }, hand3());
    const soc = summons(r.events).filter((_, i, arr) => r.events.indexOf(arr[i]!) < firstAttackAt(r.events));
    expect(soc, 'exactly one Start-of-Combat summon').toHaveLength(1);
    const m = soc[0]!.minion;
    expect([m.cardId, m.attack, m.health]).toEqual(['u3_poochy', 3, 6]);
    expect(m.keywords).toContain('T');
    expect(m.golden).toBe(true);
    expect((soc[0] as { fromHandUid?: string }).fromHandUid, 'the hand card is NOT marked — the replay must not grey it').toBeUndefined();
    expect(triggers(r.events, 'runeWakingReserve')).toHaveLength(1);
  });

  it('the hand card is NOT spent: a Spirit hand-summon later this fight can still summon the same card', () => {
    // Dreamtide's Echo picks the highest-HEALTH hand card — h2 (6 Health), the same card the Reserve copied.
    const r = fight([bm('sp3_dreamtide', { attack: 1, health: 1 })], [foe(3, 500)], { runeWakingReserve: true }, hand3());
    const fh = fromHandSummons(r.events);
    expect(fh).toHaveLength(1);
    expect((fh[0] as { fromHandUid?: string }).fromHandUid, 'the Echo still found h2 summonable').toBe('h2');
    const copies = summons(r.events).filter((e) => e.minion.cardId === 'u3_poochy' && e.minion.health === 6);
    expect(copies, 'the Reserve copy AND the Echo copy of the same card').toHaveLength(2);
  });

  it('is a hand-summon for the other hand-summon runes: Dreamed Graves marks the copy, the Open Hand pays on it', () => {
    const r = fight([bm('sandbag')], [foe(0, 500)], { runeWakingReserve: true, runeDreamedGraves: true, runeOpenHand: true }, hand3());
    const soc = summons(r.events)[0]!;
    const rb = r.events.filter((e) => e.type === 'keyword' && e.keyword === 'RB') as { target: string }[];
    expect(rb).toHaveLength(1);
    expect(rb[0]!.target).toBe(soc.minion.uid);
    const gifts = openHandBuffs(r.events);
    expect(gifts).toHaveLength(1);
    expect([gifts[0]!.attack, gifts[0]!.health]).toEqual([3, 6]);
    expect(gifts[0]!.target, 'the sandbag took the gift').toBe(r.initial.player[0]!.uid);
  });

  it('only when there is room: a full board summons nothing (and does not overflow)', () => {
    const full = Array.from({ length: 7 }, () => bm('sandbag'));
    const r = fight(full, [foe(0, 500)], { runeWakingReserve: true }, hand3());
    expect(summons(r.events)).toHaveLength(0);
    expect(triggers(r.events, 'runeWakingReserve')).toHaveLength(0);
    expect(r.events.some((e) => e.type === 'questTrigger' && e.flag === 'runeOverflow')).toBe(false);
  });

  it('an empty hand (or a spell-only one) summons nothing; a locked card is skipped', () => {
    expect(summons(fight([bm('sandbag')], [foe(0, 500)], { runeWakingReserve: true }, []).events)).toHaveLength(0);
    const locked = [{ ...handMinion('h1', 'u3_poochy', { attack: 9, health: 9, keywords: [] }), locked: true }, handMinion('h2', 'u3_poochy', { attack: 1, health: 1, keywords: [] })];
    const r = fight([bm('sandbag')], [foe(0, 500)], { runeWakingReserve: true }, locked as Hand);
    const soc = summons(r.events);
    expect(soc).toHaveLength(1);
    expect([soc[0]!.minion.attack, soc[0]!.minion.health], 'the 9/9 is locked — the 1/1 comes').toEqual([1, 1]);
  });

  it('ties on Attack + Health go to the LEFT-MOST hand card', () => {
    const hand: Hand = [handMinion('a', 'u3_poochy', { attack: 5, health: 3, keywords: [] }), handMinion('b', 'u3_poochy', { attack: 3, health: 5, keywords: [] })];
    const r = fight([bm('sandbag')], [foe(0, 500)], { runeWakingReserve: true }, hand);
    expect([summons(r.events)[0]!.minion.attack, summons(r.events)[0]!.minion.health]).toEqual([5, 3]);
  });

  it('two copies held: two copies summoned, room re-checked each time', () => {
    const r = fight([bm('sandbag')], [foe(0, 500)], { runeWakingReserve: true, flagCopies: { runeWakingReserve: 2 } }, hand3());
    expect(summons(r.events).filter((e) => e.minion.health === 6)).toHaveLength(2);
    const six = Array.from({ length: 6 }, () => bm('sandbag'));
    const r2 = fight(six, [foe(0, 500)], { runeWakingReserve: true, flagCopies: { runeWakingReserve: 2 } }, hand3());
    expect(summons(r2.events), 'one slot → one copy').toHaveLength(1);
  });

  it('the copy takes the summon suite: Rune of the Undertow wards it', () => {
    const r = fight([bm('sandbag')], [foe(0, 500)], { runeWakingReserve: true, runeUndertow: 1 }, hand3());
    const soc = summons(r.events)[0]!;
    expect(soc.minion.keywords).toContain('DS');
  });

  it('a served ENEMY hand works the same (the snapshot side)', () => {
    const r = fight([bm('sandbag')], [foe(0, 500)], {}, [], 5,
      { questMods: { runeWakingReserve: true }, handMinions: [handMinion('e1', 'u3_poochy', { attack: 7, health: 7, keywords: [] })] });
    const soc = summons(r.events, 'enemy');
    expect(soc).toHaveLength(1);
    expect([soc[0]!.minion.attack, soc[0]!.minion.health]).toEqual([7, 7]);
  });
});
