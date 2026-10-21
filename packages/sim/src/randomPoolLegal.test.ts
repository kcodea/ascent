import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, STANDARD_TIER_CEILING, type BoardMinion, type CardDef } from '@game/core';
import { CARD_INDEX, poolFor, SETS, type SetId } from '@game/content';
import { createRun, reduce, legalRandomMinionPool, randomTierCeiling, type RunState } from './index';
import type { BoardCard } from './state';

/**
 * R-RANDOM-POOL-01 (owner reports 2026-10-20): a random-minion effect may only hand out a minion the Shop could
 * offer this run. Two leaks reported live:
 *  - "a player just got elderhorn from a bullseye from funeral on loan - that shouldnt be possible."
 *  - "orivax can be granted from the rune that gives a dragon when you sell 5 minions. that also should not be
 *    possible."
 * Both pickers built their list off the set pool with only `!token && !spell` and no tier bound, and every set
 * pool carries its Tier 7 minions. The fix routes every random-minion picker through `legalRandomMinionPool`
 * (Shop) / `isLegalRandomMinion` (combat). These tests pin both reports and sweep every card for the class.
 */
const SET_IDS: SetId[] = ['set1', 'set2', 'set3'];
const tierOf = (id: string): number => CARD_INDEX[id]?.tier ?? 0;
const isT7Minion = (id: string): boolean => { const d = CARD_INDEX[id]; return !!d && !d.spell && d.tier >= 7; };
const body = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: 3, health: 3, keywords: [], golden: false, ...extra } as BoardCard);

function run(seed: number, setId: SetId, extra: Partial<RunState> = {}): RunState {
  const r = createRun(seed, undefined, 'ascent', undefined, setId, SETS[setId].tribes);
  return { ...r, phase: 'recruit', wave: 9, tier: 6, embers: 40, shop: [], board: [], hand: [], ...extra } as RunState;
}
/** A borrowed (Funeral on Loan) play: the body lands, then its Echo fires on the death step. */
const playBorrowed = (s: RunState, uid: string, toIndex: number): RunState =>
  reduce(reduce(s, { type: 'play', uid, toIndex }), { type: 'resolveShopDeath' });
const newIds = (before: RunState, after: RunState): string[] => {
  const had = new Set([...before.board, ...before.hand].map((c) => c.uid));
  return [...after.board, ...after.hand].filter((c) => !had.has(c.uid)).map((c) => c.cardId);
};

describe('the legal random minion pool', () => {
  it('holds no Tier 7, token, spell, Ruby or henchman in a normal run, in every set', () => {
    for (const setId of SET_IDS) {
      const s = run(1, setId);
      expect(randomTierCeiling(s)).toBe(STANDARD_TIER_CEILING);
      const pool = legalRandomMinionPool(s);
      expect(pool.length, setId).toBeGreaterThan(0);
      for (const c of pool) {
        expect(c.tier <= 6 && !c.spell && !c.ruby && !c.token && !c.henchman, `${setId}: ${c.id}`).toBe(true);
      }
    }
    const ids = legalRandomMinionPool(run(1, 'set2')).map((c) => c.id);
    expect(ids).not.toContain('b2_elderhorn');
    expect(ids).not.toContain('d2_orivax');
  });

  it('opens Tier 7 only with Tier-7 access (Summit, or the access flag), and keeps the set pool order', () => {
    const access = legalRandomMinionPool(run(1, 'set2', { tier7Access: true })).map((c) => c.id);
    expect(access).toContain('b2_elderhorn');
    expect(access).toContain('d2_orivax');
    const summit = run(1, 'set2', { rift: 'summit' });
    expect(randomTierCeiling(summit)).toBe(7);
    const expectOrder = poolFor('set2').buyable.filter((c) => !c.ruby && !c.henchman).map((c) => c.id);
    expect(access, 'stable order: the set pool order, filtered').toEqual(expectOrder.filter((id) => access.includes(id)));
  });

  it('a `maxTier` narrows it further (up to your Shop tier)', () => {
    const pool = legalRandomMinionPool(run(1, 'set2'), { maxTier: 3 });
    expect(pool.every((c) => c.tier <= 3)).toBe(true);
  });
});

describe('owner report 1: Funeral on Loan + Bullseye never summons Elderhorn', () => {
  it('a borrowed Bullseye at Shop tier 6 (set 2) never rolls a Tier 7 Beast, across 200 seeds', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const s = run(seed, 'set2', { board: [body('f1', 'sandbag')], hand: [body('b', 'b2_bullseye', { borrowed: true } as Partial<BoardCard>)] });
      const after = playBorrowed(s, 'b', 1);
      for (const id of newIds(s, after)) seen.add(id);
    }
    expect(seen.size, 'Bullseye summoned Beasts').toBeGreaterThan(0);
    expect([...seen]).not.toContain('b2_elderhorn');
    expect([...seen].filter(isT7Minion), 'no Tier 7 at all').toEqual([]);
  });

  it('a borrowed Bullseye at Shop tier 3 rolls only Tier 3 or lower (parity with the combat body)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = run(seed, 'set2', { tier: 3, board: [body('f1', 'sandbag')], hand: [body('b', 'b2_bullseye', { borrowed: true } as Partial<BoardCard>)] });
      for (const id of newIds(s, playBorrowed(s, 'b', 1))) expect(tierOf(id), id).toBeLessThanOrEqual(3);
    }
  });

  it('a borrowed Menagerie Mammoth never rolls Elderhorn either', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const s = run(seed, 'set2', { board: [body('f1', 'sandbag')], hand: [body('m', 'b2_mammoth', { borrowed: true } as Partial<BoardCard>)] });
      expect(newIds(s, playBorrowed(s, 'm', 1)).filter(isT7Minion), `seed ${seed}`).toEqual([]);
    }
  });

  it('a combat Bullseye at tier 6 never summons Elderhorn', () => {
    const ids = poolFor('set2').all.map((c) => c.id);
    for (let seed = 1; seed <= 60; seed++) {
      const r = simulate([{ cardId: 'b2_bullseye', attack: 0, health: 1 }], [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(seed), CARD_INDEX,
        combatSide({ tier: 6, tribes: [...SETS.set2.tribes], poolIds: ids }), combatSide({ tier: 6, poolIds: ids }));
      const summoned = r.events.filter((e) => e.type === 'summon' && (e as { side: string }).side === 'player')
        .map((e) => (e as { minion: { cardId: string } }).minion.cardId);
      expect(summoned.filter(isT7Minion), `seed ${seed}`).toEqual([]);
    }
  });
});

describe('owner report 2: Rune of the Foundry never grants Orivax', () => {
  const sellFive = (s: RunState): RunState => {
    for (let i = 0; i < 5; i++) {
      s = reduce({ ...s, board: [body(`x${i}`, 'stray')] }, { type: 'sell', uid: `x${i}` }) as RunState;
    }
    return s;
  };

  it('5 sells in a normal set 2 run never hand over a Tier 7 Dragon, across 200 seeds', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const s = reduce(run(seed, 'set2', { runeforgeOffer: ['rune_foundry'] }), { type: 'buyRune', index: 0 }) as RunState;
      expect(s.runeFoundry, 'the rune was bought').toBeTruthy();
      const after = sellFive(s);
      for (const id of newIds(s, after)) seen.add(id);
    }
    expect(seen.size, 'the Foundry paid Dragons').toBeGreaterThan(0);
    expect([...seen]).not.toContain('d2_orivax');
    expect([...seen].filter(isT7Minion), 'no Tier 7 at all').toEqual([]);
  });
});

describe('every random-minion picker respects the ceiling (property sweep)', () => {
  // Cards whose text NAMES Tier 7 are authored Tier-7 sources (Rune of the Deep's kin) and are skipped.
  const namesTier7 = (c: CardDef): boolean => /tier 7/i.test(`${c.text} ${c.goldenText ?? ''}`);
  const candidates = (setId: SetId): CardDef[] =>
    poolFor(setId).all.filter((c) => !c.spell && !c.ruby && c.tier <= 6 && !namesTier7(c));

  it('Shop: playing every minion (its Shout) and Funeral-on-Loan playing it (its Echo) never produces a Tier 7', () => {
    const leaks: string[] = [];
    for (const setId of SET_IDS) {
      for (const c of candidates(setId)) {
        for (const seed of [1, 2, 3]) {
          for (const borrowed of [false, true]) {
            const s = run(seed, setId, { board: [body('f1', 'sandbag')], hand: [body('p', c.id, borrowed ? { borrowed: true } as Partial<BoardCard> : {})] });
            let after: RunState;
            try {
              after = borrowed ? playBorrowed(s, 'p', 1) : reduce(s, { type: 'play', uid: 'p', toIndex: 1 });
            } catch { continue; } // a card that needs a target / Choose One pick is not this sweep's business
            for (const id of newIds(s, after)) if (isT7Minion(id)) leaks.push(`${setId} ${c.id}${borrowed ? ' (borrowed)' : ''} -> ${id}`);
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it('Combat: every minion fighting at tier 6 never summons or grants a Tier 7', () => {
    const leaks: string[] = [];
    for (const setId of SET_IDS) {
      const ids = poolFor(setId).all.map((c) => c.id);
      for (const c of candidates(setId)) {
        for (const seed of [1, 2]) {
          const player: BoardMinion[] = [{ cardId: c.id, attack: 2, health: 1 }, { cardId: c.id, attack: 2, health: 1, golden: true }];
          const r = simulate(player, [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(seed), CARD_INDEX,
            combatSide({ tier: 6, tribes: [...SETS[setId].tribes], poolIds: ids }), combatSide({ tier: 6, poolIds: ids }));
          for (const e of r.events) {
            const ev = e as { type: string; side?: string; cardId?: string; minion?: { cardId: string } };
            const id = ev.type === 'summon' ? ev.minion?.cardId : ev.type === 'toHand' ? ev.cardId : undefined;
            if (id && ev.side === 'player' && isT7Minion(id)) leaks.push(`${setId} ${c.id} -> ${id} (${ev.type})`);
          }
        }
      }
    }
    expect([...new Set(leaks)]).toEqual([]);
  });

  it('Combat with NO pinned pool (harness / legacy sides) still never hands out a Tier 7 below a Tier-7 Shop', () => {
    // Uncle Orc's (Warband Recruiter) random Rally minion read every card when `poolIds` is empty, which includes the Tier 7
    // Kobold Alchemist (a Rally).
    for (let seed = 1; seed <= 40; seed++) {
      const r = simulate([{ cardId: 'n3_recruiter', attack: 2, health: 400 }], [{ cardId: 'sandbag', attack: 0, health: 400 }], makeRng(seed), CARD_INDEX,
        combatSide({ tier: 6 }), combatSide({ tier: 6 }));
      const got = r.events.filter((e) => e.type === 'summon' || e.type === 'toHand')
        .map((e) => (e as { cardId?: string; minion?: { cardId: string } }).minion?.cardId ?? (e as { cardId?: string }).cardId ?? '');
      expect(got.filter(isT7Minion), `seed ${seed}`).toEqual([]);
    }
  });
});
