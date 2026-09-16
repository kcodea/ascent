/**
 * SET 3 RUNE ROSTER — the 2026-09-14 handoff's acceptance checks, verbatim.
 *
 *  - Set 3's static pool resolved to 115 Basic / 98 Epic before any Set 3-original rune: the 85 + 64 unscoped
 *    baseline plus 30 Basic + 34 Epic set-1/set-2 carryovers whose mechanics Set 3 has (Rubies, Ales, Dwarves,
 *    Kobolds, Undead, Shop consume).
 *  - Set 1 and Set 2 pools keep exactly their previous scoped runes (the carryovers ADD set3, never move).
 *  - A Set 3 Dwarf/Kobold run can be offered Contraband, Gemscript and Spellstone.
 *  - A Starform consume (the Celestial token eating a Shop minion) trips Rune of the Open Market exactly once per
 *    turn — it rides the one `consumeShopOffer` chokepoint every Shop consume uses.
 *  - Set 3 never offers an Attachment / Fodder-only rune.
 *  - The Yazzus-granting runes hand a Set 3 run `n3_yazzus` (the set's Tier-7 fork), never the legacy `yazzus`
 *    beside it — one Yazzus, no duplicate-name ambiguity.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, SET_FORKS, forkedCardId, poolFor, type SetId } from '@game/content';
import { runeforgePool } from './reducer';
import { createRun, reduce, type Action, type RunState } from './index';
import { createStarform, starformOf } from './starform';
import { starformConsumeShopMinion } from './starform';

const S3 = ['kobold', 'dwarf', 'undead', 'spirit', 'celestial'] as const;
/** The static pool for a set: `sets` scope + at least one tribe of the set's roster (the run-time gates minus the
 *  per-run tribe roll, hero and duplicate filters). */
const staticPool = (setId: SetId, tribes: readonly string[]) =>
  [...RUNES, ...EPIC_RUNES].filter((r) => (!r.sets || r.sets.includes(setId)) && (!r.tribes || r.tribes.some((t) => tribes.includes(t))));

/** A Set 3 ORIGINAL (batch 2, 2026-09-16 onward): scoped to set3 alone. The carryover pins below exclude these. */
const isOriginal = (r: { sets?: readonly string[] }): boolean => r.sets?.length === 1 && r.sets[0] === 'set3';
const originals = (epic: boolean): number => [...RUNES, ...EPIC_RUNES].filter((r) => isOriginal(r) && !!r.epic === epic).length;

describe('the Set 3 static rune pool (handoff 2026-09-14)', () => {
  it('resolves to 115 Basic / 98 Epic before any Set 3-original rune', () => {
    const pool = staticPool('set3', S3).filter((r) => !isOriginal(r));
    expect(pool.filter((r) => !r.epic)).toHaveLength(115);
    expect(pool.filter((r) => r.epic)).toHaveLength(98);
  });
  it('the Set 3-original runes (batch 2: tranche A 11/13, B 8/11, C 2/4, D 0/2) join on top', () => {
    const own = staticPool('set3', S3).filter(isOriginal);
    expect(own.filter((r) => !r.epic)).toHaveLength(21);
    expect(own.filter((r) => r.epic)).toHaveLength(30);
  });
  it('Set 1 and Set 2 pools keep their previous scoped runes — a carryover only ADDS set3', () => {
    for (const r of [...RUNES, ...EPIC_RUNES]) {
      if (r.sets?.includes('set3') && !isOriginal(r)) expect(r.sets.some((x) => x === 'set1' || x === 'set2'), `${r.id} kept its origin scope`).toBe(true);
    }
    // The set-1 / set-2 static pools as measured on origin/main BEFORE the carryover pass (2026-09-14) — unchanged.
    const s1 = staticPool('set1', ['beast', 'dragon', 'mech', 'undead', 'demon']);
    const s2 = staticPool('set2', ['beast', 'dragon', 'mech', 'demon', 'kobold', 'dwarf']);
    expect([s1.filter((r) => !r.epic).length, s1.filter((r) => r.epic).length]).toEqual([105, 90]);
    expect([s2.filter((r) => !r.epic).length, s2.filter((r) => r.epic).length]).toEqual([135, 126]);
  });
  it('never offers an Attachment / Fodder-only rune (their `sets` stay off set3)', () => {
    const banned = /attachment|fodder/i;
    for (const r of staticPool('set3', S3)) {
      expect(banned.test(r.text), `${r.id}: "${r.text}" reads Attachment/Fodder and is offered in set 3`).toBe(false);
    }
  });
});

describe('a Set 3 Dwarf / Kobold run at the forge', () => {
  const forge = (epic: boolean): string[] => {
    const s = { ...createRun(5, 'warden'), setId: 'set3', tribes: ['dwarf', 'kobold', 'undead', 'spirit', 'celestial'], runeforgeEpic: epic || undefined } as RunState;
    return runeforgePool(s);
  };
  it('can be offered Contraband (Basic), Gemscript and Spellstone (Epic)', () => {
    expect(forge(false)).toContain('rune_contraband');
    expect(forge(true)).toContain('rune_gemscript');
    expect(forge(true)).toContain('rune_spellstone');
  });
  it('the forge pool matches the static pool sizes minus nothing structural (every set-3 rune reachable when all five tribes roll)', () => {
    const basic = forge(false), epic = forge(true);
    // the Wishbone is hero-conditional (requiresDoublePower) — the Warden's power does not double, so one Basic fewer
    const wishbone = RUNE_INDEX['rune_wishbone'] ? 1 : 0;
    expect(basic.length).toBe(115 - wishbone + originals(false));
    expect(epic.length).toBe(98 + originals(true));
  });
});

describe('Rune of the Open Market hears the Starform', () => {
  const run = (): RunState => ({ ...createRun(3), setId: 'set3', phase: 'recruit', embers: 30, tier: 6, tribes: ['celestial', 'undead', 'kobold'], shop: [],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), runeforgeOffer: ['rune_open_market'] } as RunState);
  it('a Starform consume trips it exactly once per turn; the Shop channel rises +3/+3', () => {
    const s = reduce(run(), { type: 'buyRune', index: 0 } as Action) as RunState;
    expect(s.runeOpenMarket).toMatchObject({ attack: 3, health: 3, usedThisTurn: false });
    createStarform(s, { cardId: 'test', name: 'test' });
    s.shop.unshift({ uid: 'o1', cardId: 'ce3_courier' }, { uid: 'o2', cardId: 'ce3_vendor' });
    const before = { ...s.tavernBuyBonus };
    expect(starformConsumeShopMinion(s, 0)).toBe(true);
    expect(s.runeOpenMarket!.usedThisTurn).toBe(true);
    expect(s.tavernBuyBonus).toEqual({ atk: before.atk + 3, hp: before.hp + 3 });
    expect(starformConsumeShopMinion(s, 0)).toBe(true); // the second meal this turn pays nothing more
    expect(s.tavernBuyBonus).toEqual({ atk: before.atk + 3, hp: before.hp + 3 });
    expect(starformOf(s)).toBeDefined();
  });
});

describe('the Yazzus runes in Set 3', () => {
  it('SET_FORKS maps yazzus → n3_yazzus in set 3 only; both bodies share the display name', () => {
    expect(SET_FORKS.set3).toEqual({ yazzus: 'n3_yazzus' });
    expect(forkedCardId('set3', 'yazzus')).toBe('n3_yazzus');
    expect(forkedCardId('set2', 'yazzus')).toBe('yazzus');
    expect(forkedCardId('set3', 'alley')).toBe('alley');
    expect(CARD_INDEX['yazzus']!.name).toBe(CARD_INDEX['n3_yazzus']!.name);
  });
  it('Rune of Yazzus grants n3_yazzus in a set-3 run and the legacy yazzus in set 2', () => {
    const buy = (setId: SetId, rune: string) => reduce({ ...createRun(4), setId, phase: 'recruit', embers: 40, tier: 6, hand: [], board: [], runeforgeOffer: [rune] } as RunState, { type: 'buyRune', index: 0 } as Action) as RunState;
    const s3 = buy('set3', 'rune_yazzus');
    expect([...s3.hand, ...s3.board].map((c) => c.cardId)).toEqual(['n3_yazzus']);
    const s2 = buy('set2', 'rune_yazzus');
    expect([...s2.hand, ...s2.board].map((c) => c.cardId)).toEqual(['yazzus']);
  });
  it('Rune of Frontline Glory: a GILDED n3_yazzus + Front to Back in set 3 — one Yazzus outcome, never two', () => {
    const s = reduce({ ...createRun(4), setId: 'set3', phase: 'recruit', embers: 40, tier: 6, hand: [], board: [], runeforgeOffer: ['rune_frontline_glory'] } as RunState, { type: 'buyRune', index: 0 } as Action) as RunState;
    const cards = [...s.hand, ...s.board];
    const yaz = cards.filter((c) => c.cardId === 'n3_yazzus' || c.cardId === 'yazzus');
    expect(yaz.map((c) => [c.cardId, c.golden])).toEqual([['n3_yazzus', true]]);
    expect(cards.some((c) => c.cardId === 'fronttoback')).toBe(true);
  });
});
