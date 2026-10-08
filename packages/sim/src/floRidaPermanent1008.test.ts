import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyEndOfTurn } from './recruit';

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
