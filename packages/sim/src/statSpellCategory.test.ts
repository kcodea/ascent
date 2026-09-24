import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, spellCostReduction, isStatSpell, type BoardCard, type RunState } from './index';
import { advanceRuneThresholds, castSpellWithoutAim, isStatGrantingSpell } from './recruit';
import { poolOf } from './cardPool';

/**
 * THE STAT-GRANTING SPELL CATEGORY (owner ruling 2026-09-23): "all targeted spells should be castable and fit
 * this category, just with random targets chosen. the shop based ones i'm iffy on. but definitely targeted and
 * board wide stat buff spells".
 *
 * `isStatGrantingSpell` is the ONE predicate a "cast a random stat-granting spell" effect reads, and
 * `castSpellWithoutAim` is the ONE no-aim cast (random legal friendly target, fizzle when there is none).
 * Rune of the Gilded Ledger used to filter every targeted spell out, which left it NOTHING to cast at Tier 1.
 */

const minion = (uid: string, cardId: string, attack = 2, health = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });

/** Buy the Ledger through the real Runeforge path, then pin the tier / board the scenario needs. */
const ledger = (tier: number, board: BoardCard[], rngCursor?: number): RunState => {
  const s = reduce(
    { ...createRun(3, 'runesmith'), wave: 7, tier: 6, phase: 'recruit', embers: 40, runeforgeOffer: ['rune_gilded_ledger'] } as RunState,
    { type: 'buyRune', index: 0 },
  ) as RunState;
  s.tier = tier;
  s.board = board;
  s.hand = [];
  if (rngCursor !== undefined) s.rngCursor = rngCursor;
  return s;
};

const statsOf = (s: RunState): Record<string, [number, number]> =>
  Object.fromEntries(s.board.map((c) => [c.uid, [c.attack, c.health] as [number, number]]));

// ── membership ──────────────────────────────────────────────────────────────────────────────────────────
describe('the category: Set 2 membership, pinned per tier', () => {
  /** The whole Set 2 category. Growing it is a deliberate act: a new stat spell lands here in its own PR. */
  const SET2: Record<number, string[]> = {
    1: ['bulwark', 'crestclimb', 'lanternlight'],
    2: ['growth', 'spiritfire'],
    3: ['mightofaeon', 'patchjob', 'shatter', 'wo_attack', 'wo_champion', 'wo_health'],
    4: ['fronttoback', 'greatpot', 'hoardflame', 'sp_blessing', 'sp_flutter'],
    5: ['sp_dragonflame'],
    6: ['sp_beefy', 'sparkplug'],
  };

  it('is exactly the pinned table', () => {
    const got: Record<number, string[]> = {};
    for (const c of poolOf({ setId: 'set2' }).spells) if (isStatGrantingSpell(c)) (got[c.tier] ??= []).push(c.id);
    for (const t of Object.keys(got)) got[+t]!.sort();
    expect(got).toEqual(SET2);
  });

  it('TARGETED stat spells are IN (the ruling), with their aim intact', () => {
    for (const id of ['bulwark', 'lanternlight', 'crestclimb', 'spiritfire', 'shatter', 'patchjob', 'fronttoback', 'hoardflame', 'sp_blessing', 'sp_flutter', 'sp_beefy']) {
      expect(isStatGrantingSpell(CARD_INDEX[id]), id).toBe(true);
      expect(CARD_INDEX[id]!.target, `${id} is aimed`).toBeTruthy();
    }
  });

  it('the stat Ales are IN; the non-stat Ales are not', () => {
    for (const id of ['wo_champion', 'wo_health', 'wo_attack']) expect(isStatGrantingSpell(CARD_INDEX[id]), id).toBe(true);
    for (const id of ['wo_mine', 'wo_reinforcement']) expect(isStatGrantingSpell(CARD_INDEX[id]), id).toBe(false);
  });

  it('the SHOP-buff spells stay OUT (owner "iffy"), but Rune of Thrift still discounts them', () => {
    for (const id of ['apples', 'staffofguel', 'facetwright', 'veinstorm', 'sp_picnic']) {
      expect(isStatGrantingSpell(CARD_INDEX[id]), `${id} is not in the category`).toBe(false);
      expect(isStatSpell(CARD_INDEX[id]), `${id} is still a Thrift stat spell`).toBe(true);
    }
  });

  it('Common Ground is NOT in the category: it averages, it grants nothing immediately (owner 2026-09-23)', () => {
    // "common ground should not be in the grouping ... it should only be stat granting spells that give stats
    // immediately basically ... that's more a utility thing."
    const cg = CARD_INDEX['commonground']!;
    expect(isStatGrantingSpell(cg)).toBe(false);
    expect(isStatSpell(cg), 'Rune of Thrift still discounts it (unchanged)').toBe(true);
  });

  it('stat MOVERS / setters / next-combat buffs are OUT', () => {
    for (const id of ['turnabout', 'perfectvision', 'fleetingvigor', 'sp_solidground', 'emberpouch']) {
      expect(isStatGrantingSpell(CARD_INDEX[id]), id).toBe(false);
    }
  });

  it('every category member is a Thrift stat spell (the category is a subset, never a rival list)', () => {
    for (const c of poolOf({ setId: 'set2' }).spells) if (isStatGrantingSpell(c)) expect(isStatSpell(c), c.id).toBe(true);
  });

  it('Great Pot (buffOnePerTribe) is a stat spell now, so Rune of Thrift discounts it', () => {
    const pot = CARD_INDEX['greatpot']!;
    expect(isStatSpell(pot)).toBe(true);
    const s = { ...createRun(3), runeThrift: true, runeStacks: { rune_thrift: 1 } } as unknown as RunState;
    expect(spellCostReduction(s, pot) - spellCostReduction(s, CARD_INDEX['emberpouch'])).toBe(2);
  });
});

// ── the Ledger ──────────────────────────────────────────────────────────────────────────────────────────
describe('Rune of the Gilded Ledger draws from the whole category', () => {
  it('at Tier 1 it casts a Tier-1 member and lands its stats on ONE friendly minion', () => {
    const s = ledger(1, [minion('a', 'sandbag', 1, 1), minion('b', 'sandbag', 1, 1)]);
    const before = statsOf(s);
    const cast0 = s.spellsCast;
    advanceRuneThresholds(s, 'gold', 7);
    expect(s.spellsCast, 'one real cast').toBe(cast0 + 1);
    expect(['bulwark', 'lanternlight', 'crestclimb']).toContain(s.lastSpellCastId);
    const after = statsOf(s);
    const changed = Object.keys(after).filter((u) => after[u]![0] !== before[u]![0] || after[u]![1] !== before[u]![1]);
    expect(changed, 'a targeted spell lands on exactly one friendly').toHaveLength(1);
    const u = changed[0]!;
    expect(after[u]![0] + after[u]![1]).toBeGreaterThan(before[u]![0] + before[u]![1]);
  });

  it('the target is RANDOM: across seeds both friendlies get picked', () => {
    const hit = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = ledger(1, [minion('a', 'sandbag', 1, 1), minion('b', 'sandbag', 1, 1)], seed * 7919);
      const before = statsOf(s);
      advanceRuneThresholds(s, 'gold', 7);
      const after = statsOf(s);
      for (const u of Object.keys(after)) if (after[u]![0] + after[u]![1] > before[u]![0] + before[u]![1]) hit.add(u);
    }
    expect([...hit].sort()).toEqual(['a', 'b']);
  });

  it('over many trips at Tier 1 it reaches every Tier-1 member', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const s = ledger(1, [minion('a', 'sandbag', 1, 1)], seed * 104729);
      advanceRuneThresholds(s, 'gold', 7);
      if (s.lastSpellCastId) seen.add(s.lastSpellCastId);
    }
    expect([...seen].sort()).toEqual(['bulwark', 'crestclimb', 'lanternlight']);
  });

  it('with an EMPTY board a targeted pick fizzles cleanly: no crash, no cast counted, no Gold moved', () => {
    const s = ledger(1, []);
    const cast0 = s.spellsCast;
    const gold0 = s.embers;
    expect(() => advanceRuneThresholds(s, 'gold', 7)).not.toThrow();
    expect(s.spellsCast).toBe(cast0);
    expect(s.embers).toBe(gold0);
    expect(s.board).toHaveLength(0);
  });

  it('is deterministic: the same state picks the same spell and the same target', () => {
    const run = () => {
      const s = ledger(4, [minion('a', 'sandbag', 1, 1), minion('b', 'sandbag', 1, 1), minion('c', 'sandbag', 1, 1)], 424242);
      advanceRuneThresholds(s, 'gold', 21); // three trips
      return { last: s.lastSpellCastId, stats: statsOf(s), cursor: s.rngCursor, cast: s.spellsCast };
    };
    expect(run()).toEqual(run());
  });
});

// ── the no-aim cast ─────────────────────────────────────────────────────────────────────────────────────
describe('castSpellWithoutAim: the shared random-target cast', () => {
  const bare = (board: BoardCard[]): RunState => ({ ...createRun(5), phase: 'recruit', tier: 6, board, hand: [] } as RunState);

  it('a targeted spell with no legal target fizzles (returns false, counts nothing)', () => {
    const s = bare([]);
    expect(castSpellWithoutAim(s, CARD_INDEX['spiritfire']!)).toBe(false);
    expect(s.spellsCast).toBe(0);
  });

  it('respects the aim\'s tribe restriction: Star Crash (Celestial-only) fizzles on a board with no Celestial', () => {
    const star = CARD_INDEX['starcrash']!;
    expect(star.targetTribe).toBe('celestial');
    const s = bare([minion('a', 'sandbag', 1, 1)]);
    expect(castSpellWithoutAim(s, star)).toBe(false);
    expect(s.board[0]!.attack).toBe(1);
    const celestial = Object.values(CARD_INDEX).find((c) => c.tribe === 'celestial' && !c.spell && !c.token)!;
    const t = bare([minion('a', 'sandbag', 1, 1), minion('c', celestial.id, 1, 1)]);
    expect(castSpellWithoutAim(t, star)).toBe(true);
    expect(t.board.find((c) => c.uid === 'c')!.attack, 'the primary hit landed on the Celestial').toBeGreaterThan(1);
  });

  it('a Choose One (Crest of the Climb) resolves one seeded branch: +4 Attack OR +4 Health', () => {
    const s = bare([minion('a', 'sandbag', 1, 1)]);
    expect(castSpellWithoutAim(s, CARD_INDEX['crestclimb']!)).toBe(true);
    const [a, h] = [s.board[0]!.attack, s.board[0]!.health];
    expect([[5, 1], [1, 5]]).toContainEqual([a, h]);
  });

  it('an untargeted member casts as it is (Growth buffs the whole board)', () => {
    const s = bare([minion('a', 'sandbag', 1, 1), minion('b', 'sandbag', 1, 1)]);
    expect(castSpellWithoutAim(s, CARD_INDEX['growth']!)).toBe(true);
    expect(s.board.every((c) => c.attack >= 2 && c.health >= 2)).toBe(true);
  });
});
