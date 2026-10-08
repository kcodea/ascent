import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, gildMinion } from './recruit';

/**
 * Flo Rida, owner 2026-10-08: "flo rida should add the word permanently to its text so it does not reset per round".
 *
 * The improve rides the per-instance `summonBonus`. It is PERMANENT for the run: a Shop / End-of-Turn summon writes
 * the board card directly, and a combat summon is carried back to the board card at settle (`playerSummonBonus`,
 * the same channel Kennelmaster / Mama Bear / Pack Leader use). Nothing resets it between rounds. R-FLORIDA-01.
 */
const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as BoardCard;
};
const recruit = (seed: number, over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(seed, 'warden', 'ascent', undefined, 'set2'), wave: 6, tier: 6, phase: 'recruit', embers: 40, ...over } as RunState);
/** Face the next opponent and settle it, on a run that cannot lose. */
const turn = (s: RunState): RunState => {
  const safe = { ...s, resolve: 999, maxResolve: 999, armor: 999 } as RunState;
  return reduce(reduce(safe, { type: 'faceOmen' }) as RunState, { type: 'resolveCombat' }) as RunState;
};
const flo = (s: RunState) => s.board.find((c) => c.uid === 'flo')!;
/** Hand a fresh Beast to the player and play it; returns the new state and that Beast's Attack gain. */
const playBeast = (s: RunState, uid: string, cardId = 'stray'): [RunState, number] => {
  const next = reduce({ ...s, phase: 'recruit', embers: 40, hand: [...s.hand, bc(uid, cardId)] } as RunState, { type: 'play', uid }) as RunState;
  return [next, next.board.find((c) => c.uid === uid)!.attack - CARD_INDEX[cardId]!.attack];
};
/** A three-round sequence: one Shop Beast each round, then the fight. Pure function of the seed. */
const threeRounds = (seed: number) => {
  let s = recruit(seed, { board: [bc('flo', 'b2_florida', { health: 900 })] });
  const gains: number[] = [];
  const bonusAfterRound: number[] = [];
  for (let round = 0; round < 3; round++) {
    let g: number;
    // Three DIFFERENT vanilla Beasts (three copies of one card would triple).
    [s, g] = playBeast(s, `b${round}`, ['stray', 'pup', 'b2_trexbaby'][round]);
    gains.push(g);
    s = turn(s);
    bonusAfterRound.push(flo(s).summonBonus ?? 0);
  }
  return { s, gains, bonusAfterRound };
};

describe('Flo Rida: "...and permanently improve this" (owner 2026-10-08)', () => {
  it('prints the word permanently on both faces; the summoned Beast grant itself is unchanged', () => {
    const d = CARD_INDEX['b2_florida']!;
    expect(d.text).toBe('When you summon a **Beast**, give it **+5/+5** and permanently improve this.');
    expect(d.goldenText).toBe('When you summon a **Beast**, give it **+10/+10** and permanently improve this.');
    expect(d.effects).toEqual([{ on: 'onSummon', do: 'onSummonTribeBuffFlat', params: { tribe: 'beast', attack: 5, health: 5, improve: 5, every: 1 } }]);
  });

  it('a Shop improve persists across 3 rounds: 5, then 10, then 15, never back to 5', () => {
    const { gains, bonusAfterRound } = threeRounds(1);
    expect(gains).toEqual([5, 10, 15]);
    // The fight may add combat summons on top (carried back); it never takes the Shop count away.
    for (let i = 0; i < 3; i++) expect(bonusAfterRound[i]!, `after round ${i + 1}`).toBeGreaterThanOrEqual(i + 1);
  });

  it('a combat summon counts and carries back to the board card for the next Shop', () => {
    // Pack Leader dies and summons two Pups: each is a Beast summoned with Flo alive. Pick the first seed whose
    // fight actually lets Flo see a summon (an opponent can kill Flo first), deterministic per seed.
    let checked = 0;
    for (const seed of [1, 2, 4, 5, 6, 7]) {
      let s = recruit(seed, { board: [bc('p', 'pack', { attack: 1, health: 1 }), bc('flo', 'b2_florida', { health: 900, summonBonus: 3 })] });
      s = turn(s);
      const carried = s.lastCombat?.playerSummonBonus?.find((x) => x.sourceUid === 'flo')?.bonus;
      if (!carried || carried <= 3) continue;
      expect(flo(s).summonBonus, `seed ${seed}: the board card keeps the combat improve`).toBe(carried);
      const [, gain] = playBeast(s, 'next');
      expect(gain, `seed ${seed}: the next Shop Beast reads the carried value`).toBe(5 + 5 * carried);
      checked++;
    }
    expect(checked, 'at least one seed exercised the combat carry-back').toBeGreaterThan(0);
  });

  it('an End-of-Turn summon improves the board card itself', () => {
    const s = recruit(5, { board: [bc('p', 'pack'), bc('sp', 'b2_spots'), bc('flo', 'b2_florida')], runeCombatProwess: true } as Partial<RunState>);
    applyEndOfTurn(s);
    const pups = s.board.filter((c) => c.cardId === 'pup').length;
    expect(pups).toBeGreaterThan(0);
    expect(flo(s).summonBonus).toBe(pups);
  });

  it('Gilded follows the existing rule: the grant AND the earned step both double at read time', () => {
    const s = recruit(1, { board: [bc('flo', 'b2_florida', { golden: true, summonBonus: 2 })] });
    const [after, gain] = playBeast(s, 'g');
    expect(gain).toBe((5 + 5 * 2) * 2);
    expect(flo(after).summonBonus).toBe(3);
  });

  it('is deterministic: the same seed reproduces the same 3-round board exactly', () => {
    const a = threeRounds(4);
    const b = threeRounds(4);
    expect(a.gains).toEqual(b.gains);
    expect(a.bonusAfterRound).toEqual(b.bonusAfterRound);
    expect(JSON.stringify(a.s.board)).toBe(JSON.stringify(b.s.board));
  });
});

const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra });

// Owner 2026-10-08, on the in-place gild: "yes fix". Gilding an EXISTING copy (Indy, Golden Touch, Auric Runemaster in
// the Shop, ...) must not double the growth it already earned: only the base and FUTURE growth run at the golden rate.
// Same mechanism as Kennelmaster / Sovereign / Pack Leader (`GOLD_SCALED_ACCRUAL_CARDS` halves the count at gild time).
describe('Gilding Flo Rida / Beardsley in place keeps earned growth at face value (owner 2026-10-08)', () => {
  const cases = [
    { id: 'b2_florida', base: 5, improve: 5 },
    { id: 'b2_beardsley', base: 1, improve: 1 },
  ];
  for (const { id, base, improve } of cases) {
    it(`${id}: an odd earned count (3) gilds to base x2 + the same earned growth, then grows at the golden rate`, () => {
      const s = recruit(1, { board: [bc('flo', id, { summonBonus: 3 })] });
      gildMinion(flo(s), s);
      expect(flo(s).golden).toBe(true);
      // Before: base + 3 x improve. After: (2 x base) + the SAME 3 x improve, not 2 x (base + 3 x improve).
      const [after, gain] = playBeast(s, 'g1');
      expect(gain).toBe(2 * base + 3 * improve);
      // The next Beast steps up by the GOLDEN step (2 x improve).
      const [, gain2] = playBeast(after, 'g2', 'pup');
      expect(gain2).toBe(2 * base + 3 * improve + 2 * improve);
    });
  }

  it('a natural triple is untouched: the two highest counts combine and read at the golden rate (the universal rule)', () => {
    const s = recruit(1, { board: [bc('f1', 'b2_florida', { summonBonus: 2 }), bc('f2', 'b2_florida', { summonBonus: 1 })], hand: [bc('f3', 'b2_florida')] });
    const after = reduce(s, { type: 'play', uid: 'f3' }) as RunState;
    const gold = [...after.board, ...after.hand].find((c) => c.cardId === 'b2_florida' && c.golden);
    // The third Flo is itself a Beast: f1 and f2 each count it first (2 -> 3, 1 -> 2), then the triple sums 3 + 2.
    expect(gold?.summonBonus).toBe(5);
  });
});

// Owner 2026-10-08, on Rise: "rise = reset its number since its not the same minion per se". A Flo Rida / Beardsley that
// Rises comes back with its improve count at 0 (R-RISE-01), and the board card keeps what the risen body ends the fight
// with, 0 included: the old count is NOT restored at settle (the Second Wind precedent, risen-body results carry back).
describe('Rise resets the improve count, and the reset carries back to the board card (owner 2026-10-08)', () => {
  const fight = (player: BoardMinion[], enemy: BoardMinion[], seed: number) =>
    simulate(player, enemy, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));

  for (const id of ['b2_florida', 'b2_beardsley']) {
    it(`${id}: a risen body that sees no Beast afterwards carries back 0, not its pre-combat count`, () => {
      const r = fight([bm(id, 'flo', 7, 1, { keywords: ['R'], summonBonus: 4 })], [bm('sandbag', 'e', 3, 90000)], 1);
      const uid = r.initial.player[0]!.uid;
      expect(r.events.filter((e) => e.type === 'death' && e.target === uid).length, 'died, rose, died').toBe(2);
      expect(r.playerSummonBonus).toEqual([{ sourceUid: 'flo', bonus: 0 }]);
    });
  }

  it('growth earned BEFORE the Rise is lost; growth earned AFTER it counts from 0', () => {
    const enemy = [bm('sandbag', 'e1', 1, 1, { keywords: ['T'] }), bm('sandbag', 'e2', 5, 90000)];
    const player = () => [bm('b2_florida', 'flo', 7, 1, { keywords: ['R'], summonBonus: 4 }), bm('pack', 'p', 1, 1)];
    // Seed 5: Pack Leader's Pups arrive first (+25, +30: the count 4 -> 6), then Flo dies and Rises -> 0.
    const before = fight(player(), enemy, 5);
    expect(before.events.filter((e) => e.type === 'buff' && e.source === before.initial.player[0]!.uid).map((e) => (e as { attack: number }).attack)).toEqual([25, 30]);
    expect(before.playerSummonBonus).toEqual([{ sourceUid: 'flo', bonus: 0 }]);
    // Seed 7: Flo Rises first, then the Pups arrive: the risen body grants +5 then +10 and ends at 2.
    const after = fight(player(), enemy, 7);
    expect(after.events.filter((e) => e.type === 'buff' && e.source === after.initial.player[0]!.uid).map((e) => (e as { attack: number }).attack)).toEqual([5, 10]);
    expect(after.playerSummonBonus).toEqual([{ sourceUid: 'flo', bonus: 2 }]);
  });

  it('through the real reducer, the board card ends at the reset count after a fight where Flo Rose', () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      let s = recruit(seed, { board: [bc('flo', 'b2_florida', { attack: 7, health: 1, keywords: ['R'], summonBonus: 4 })] });
      s = turn(s);
      const uid = s.lastCombat?.initial.player.find((m) => m.cardId === 'b2_florida')?.uid;
      const rose = (s.lastCombat?.events ?? []).filter((e) => e.type === 'death' && e.target === uid).length >= 1;
      if (!rose) continue;
      expect(flo(s).summonBonus, `seed ${seed}`).toBe(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
