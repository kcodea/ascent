/**
 * OVERFLOWING CRYPT + PICNIC, owner 2026-10-23:
 *  - "add this spell and wire its art: * Overflowing Crypt - T2 - 3g Start of Combat: Summon 2 Skeletons."
 *  - "remove picnic from set 3"
 *
 * Overflowing Crypt is a next-combat bank (Weaken's shape): the Shop cast arms `pendingSkeletons`, which rides
 * `questMods.bankedSkeletons` into the fight (so a served snapshot carries it too, R-SYMMETRY), and `simulate`
 * summons two `u3_skeleton` at Start of Combat as REAL summons: the board cap holds and a Skeleton that does not fit
 * Overflows. It lapses when that fight settles. Pinned as R-SPELL-CRYPT-01 and R-ARCHIVE-SET3-1023-01.
 */
import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatResult } from '@game/core';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import { createRun, reduce, sideFromSnapshot, type Action, type BoardCard, type RunState } from './index';
import { runSpells } from './spellPool';
import { snapshotBoard } from './snapshot';

const CRYPT = 'sp_overflowingcrypt';
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const spell = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, undefined, 'ascent', undefined, 'set3'), phase: 'recruit', embers: 60, tier: 6, hand: [], board: [], ...over } as RunState);
const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over };
};
/** Skeletons summoned for `side` before the first swing. */
const skeletonsSummoned = (r: CombatResult, side: 'player' | 'enemy'): number => {
  let n = 0;
  for (const e of r.events) {
    if (e.type === 'attack') break;
    if (e.type === 'summon' && e.side === side && e.minion.cardId === 'u3_skeleton') n++;
  }
  return n;
};

describe('Overflowing Crypt: the card', () => {
  it('is a Set 3 Shop spell, Tier 2, 3 Gold, untargeted, with the owner text and no Gilded text', () => {
    const d = CARD_INDEX[CRYPT]!;
    expect([d.name, d.spell, d.tier, d.cost, d.tribe, d.target]).toEqual(['Overflowing Crypt', true, 2, 3, 'undead', undefined]);
    expect(d.text).toBe('**Start of Combat:** summon **2 Skeletons**.');
    expect(d.goldenText).toBeUndefined();
    expect(/—|--/.test(d.text)).toBe(false);
    expect(poolFor('set3').spells.some((c) => c.id === CRYPT)).toBe(true);
    expect(runSpells({ setId: 'set3', tribes: [...SETS.set3.tribes] }).some((c) => c.id === CRYPT)).toBe(true);
    // An Undead spell (owner 2026-10-23): tribe-gated, so a Set 3 run without Undead never offers it.
    expect(runSpells({ setId: 'set3', tribes: SETS.set3.tribes.filter((t) => t !== 'undead') }).some((c) => c.id === CRYPT)).toBe(false);
    expect(CARD_INDEX['u3_skeleton']).toMatchObject({ name: 'Skeleton', tribe: 'undead', attack: 1, health: 1, token: true });
  });
});

describe('R-SPELL-CRYPT-01: Overflowing Crypt summons 2 Skeletons at the next Start of Combat', () => {
  it('a Shop cast banks 2 Skeletons; the next fight opens by summoning them; the bank lapses at settle', () => {
    let s = run({ board: [body('a', 'sandbag', { attack: 2, health: 2 })], hand: [spell('sp', CRYPT)] });
    s = act(act(s, { type: 'play', uid: 'sp' } as Action), { type: 'resolveShopDeath' });
    expect(s.hand.some((c) => c.uid === 'sp')).toBe(false);
    expect(s.pendingSkeletons).toBe(2);
    expect(s.board.some((c) => c.cardId === 'u3_skeleton'), 'nothing is summoned in the Shop').toBe(false);
    s = act(s, { type: 'faceOmen' });
    const r = s.lastCombat!;
    expect(skeletonsSummoned(r, 'player')).toBe(2);
    expect(r.events.some((e) => e.type === 'bankedCast' && e.side === 'player' && e.spellId === CRYPT)).toBe(true);
    s = act(act(s, { type: 'settleCombat' }), { type: 'resolveCombat' });
    expect(s.pendingSkeletons ?? 0).toBe(0);
    expect(s.board.some((c) => c.cardId === 'u3_skeleton'), 'the Skeletons are combat bodies, not run cards').toBe(false);
    s = act(s, { type: 'faceOmen' });
    expect(skeletonsSummoned(s.lastCombat!, 'player'), 'one fight only').toBe(0);
  });

  it('two casts stack: 4 Skeletons', () => {
    let s = run({ board: [body('a', 'sandbag', { attack: 2, health: 2 })], hand: [spell('s1', CRYPT), spell('s2', CRYPT)] });
    for (const uid of ['s1', 's2']) s = act(act(s, { type: 'play', uid } as Action), { type: 'resolveShopDeath' });
    expect(s.pendingSkeletons).toBe(4);
    s = act(s, { type: 'faceOmen' });
    expect(skeletonsSummoned(s.lastCombat!, 'player')).toBe(4);
  });

  it('board cap: with 6 minions one Skeleton lands and the other Overflows (Ending pays for it)', () => {
    const six = [bm('u3_ending', { health: 60 }), ...Array.from({ length: 5 }, () => bm('sandbag', { attack: 0, health: 60 }))];
    const foe = [bm('sandbag', { attack: 0, health: 60 })];
    const fight = (board: BoardMinion[], skeletons: number): CombatResult =>
      simulate(board, foe, makeRng(3), CARD_INDEX, combatSide({ tier: 6, questMods: skeletons ? { bankedSkeletons: skeletons } : {} }), combatSide({ tier: 1 }));
    const armed = fight(six, 2);
    expect(skeletonsSummoned(armed, 'player')).toBe(1);
    // Ending: "When you Overflow a minion, give your Undead Aura +4 Health." One Overflow: Ending (an Undead) +4 Health.
    const endingUid = armed.initial.player.find((m) => m.cardId === 'u3_ending')!.uid;
    const gained = (r: CombatResult): number => r.events.reduce((t, e) => t + (e.type === 'buff' && e.target === endingUid ? e.health : 0), 0);
    expect(gained(armed) - gained(fight(six, 0))).toBe(4);
    // A full board: both Overflow, nothing lands.
    const seven = [...six, bm('sandbag', { attack: 0, health: 60 })];
    const full = fight(seven, 2);
    expect(skeletonsSummoned(full, 'player')).toBe(0);
    expect(gained(full) - gained(fight(seven, 0))).toBe(8);
  });

  it('symmetric: a served snapshot carries the bank and the ENEMY summons the Skeletons', () => {
    const s = run({ board: [body('a', 'sandbag', { attack: 2, health: 2 })], pendingSkeletons: 2 });
    const snap = snapshotBoard(s);
    expect(snap.questMods?.bankedSkeletons).toBe(2);
    const side = sideFromSnapshot(snap, snap.wave, poolFor('set3').all.map((c) => c.id));
    const r = simulate([bm('sandbag', { attack: 0, health: 60 })], snap.minions, makeRng(4), CARD_INDEX, combatSide({ tier: 1 }), side);
    expect(skeletonsSummoned(r, 'enemy')).toBe(2);
    expect(r.events.some((e) => e.type === 'bankedCast' && e.side === 'enemy' && e.spellId === CRYPT)).toBe(true);
  });
});

describe('R-ARCHIVE-SET3-1023-01: Picnic leaves Set 3', () => {
  it('is in no Set 3 draw, still a Set 2 and Set 4 spell, and still resolves by id', () => {
    expect(poolFor('set3').all.some((c) => c.id === 'sp_picnic')).toBe(false);
    expect(runSpells({ setId: 'set3', tribes: [...SETS.set3.tribes] }).some((c) => c.id === 'sp_picnic')).toBe(false);
    expect(poolFor('set2').spells.some((c) => c.id === 'sp_picnic')).toBe(true);
    expect(poolFor('set4').spells.some((c) => c.id === 'sp_picnic')).toBe(true);
    expect(CARD_INDEX['sp_picnic']).toBeTruthy();
  });
});
