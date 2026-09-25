/**
 * SET 3 RUNE ROSTER — the 2026-09-14 handoff's acceptance checks, verbatim.
 *
 *  - Set 3's static pool resolved to 115 Basic / 97 Epic before any Set 3-original rune: the 85 + 64 unscoped
 *    baseline plus 30 Basic + 33 Epic set-1/set-2 carryovers whose mechanics Set 3 has (Rubies, Ales, Dwarves,
 *    Kobolds, Undead, Shop consume). (98 Epic at the handoff; Rune of Frontline Glory left set 3 on 2026-09-16.)
 *  - Set 1 and Set 2 pools keep exactly their previous scoped runes (the carryovers ADD set3, never move).
 *  - A Set 3 Dwarf/Kobold run can be offered Contraband, Gemscript and Spellstone.
 *  - A Starform consume (the Celestial token eating a Shop minion) trips Rune of the Open Market exactly once per
 *    turn — it rides the one `consumeShopOffer` chokepoint every Shop consume uses.
 *  - Set 3 never offers an Attachment / Fodder-only rune.
 *  - Rune of Yazzus hands a Set 3 run THE `yazzus` — one card in every set since the owner unified the set-3 fork
 *    into it (2026-09-16); `SET_FORKS` is empty and Frontline Glory is a set-1 rune again.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, SET_FORKS, forkedCardId, poolFor, type SetId } from '@game/content';
import { runeforgePool } from './reducer';
import { createRun, deserialize, reduce, serialize, type Action, type RunState } from './index';
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
  it('resolves to 115 Basic / 97 Epic before any Set 3-original rune (98 Epic at the handoff; Frontline Glory dropped 2026-09-16)', () => {
    const pool = staticPool('set3', S3).filter((r) => !isOriginal(r));
    expect(pool.filter((r) => !r.epic)).toHaveLength(64); // 99 → 64 on 2026-09-25 (owner's Set 3 rune list): 35 carryover Basics the list does not name;  100 → 99 on 2026-09-24 (Rune of Investment moved Basic → Epic, Ruby batch); 109 → 100 on 2026-09-24 (owner Set 3 rune cuts: Contraband, Facetwright, Gemcutting, Unbroken Vein, Shifting Facets, Last Call, Shared Pour, Pillaging, Aftershocks); // 115 at the handoff + Rune of Gambling (all sets, 2026-09-17); −4 on 2026-09-18 (tag pass: Beast/Mech-body runes now gate on tribes set 3 does not field); −2 on 2026-09-23 (Balance 9/23 archives: Centerline, Spare Chair); rune reworks A (2026-09-23) nets 0: −1 Drake Skull (now reads Dragons, gated `dragon`) +1 Hoardcalling (now any Shout, gate dropped); −1 on 2026-09-24 (owner: "hoardcalling should have a dragon tag" — Hoardcalling gated `dragon` again; set 3 fields no Dragons)
    expect(pool.filter((r) => r.epic)).toHaveLength(53); // 79 → 53 on 2026-09-25 (owner's Set 3 rune list): 26 carryover Epics the list does not name;  78 → 79 on 2026-09-24 (Rune of Investment moved Basic → Epic, Ruby batch); 87 → 78 on 2026-09-24 (owner Set 3 rune cuts: Lapidary, Redirection, Ruby Shrapnel, Baal, Chef, Mykel, Runic Exchange, Rising Graves, Soul Taxes); // 97 → 90 on 2026-09-18 (tag pass: Beast/Dragon/Mech/Demon-body Epics gate on tribes set 3 does not field); 90 → 87 on 2026-09-23 (Balance 9/23 archives: Taurus, Open Market, Warpath)
    expect(pool.some((r) => r.id === 'rune_frontline_glory')).toBe(false);
    expect(RUNE_INDEX['rune_frontline_glory']!.sets).toEqual(['set1']);
  });
  it('the Set 3-original runes (batch 2: tranche A 11/13, B 8/11, C 2/4, D 0/2; batch 3: 7/4) join on top', () => {
    const own = staticPool('set3', S3).filter(isOriginal);
    expect(own.filter((r) => !r.epic)).toHaveLength(26); // 19 → 26 on 2026-09-25 (Set 3 rune batch 3: 7 Basics); 20 → 19: Charted Skies CUT FROM SET 3 2026-09-25 (owner's Set 3 rune list); 21 → 20: the Full Hand CUT FROM SET 3 2026-09-24 (owner)
    expect(own.filter((r) => r.epic)).toHaveLength(31); // 27 → 31 on 2026-09-25 (Set 3 rune batch 3: 4 Epics); 29 → 27: the Festival Circuit + the Open Constellation CUT FROM SET 3 2026-09-25 (owner's Set 3 rune list); 30 → 29: the Grave Orbit CUT FROM SET 3 2026-09-24 (owner)
  });
  it('Set 1 and Set 2 pools keep their previous scoped runes — a carryover only ADDS set3', () => {
    for (const r of [...RUNES, ...EPIC_RUNES]) {
      if (r.sets?.includes('set3') && !isOriginal(r)) expect(r.sets.some((x) => x === 'set1' || x === 'set2'), `${r.id} kept its origin scope`).toBe(true);
    }
    // The set-1 / set-2 static pools as measured on origin/main BEFORE the carryover pass (2026-09-14) — unchanged,
    // +1 Basic each for Rune of Gambling (all sets, 2026-09-17). Set 1 −1 Epic on 2026-09-18 (tag pass: a Dwarf-body
    // Epic now gates on a tribe set 1 does not field).
    const s1 = staticPool('set1', ['beast', 'dragon', 'mech', 'undead', 'demon']);
    const s2 = staticPool('set2', ['beast', 'dragon', 'mech', 'demon', 'kobold', 'dwarf']);
    // 2026-09-23 (Balance 9/23 archives): set 1 −4 Basic (Emberline, Centerline, Second Litter, Spare Chair) / −4 Epic (Taurus, Ashen Heir,
    // Old Pack, Warpath); set 2 −5 Basic (those four + Cindergem) / −7 Epic (those four + Moonhowl, Open Market, and the Deathtouched
    // Apple, now Undead-gated — a tribe set 2 does not field).
    expect([s1.filter((r) => !r.epic).length, s1.filter((r) => r.epic).length]).toEqual([102, 85]);
    expect([s2.filter((r) => !r.epic).length, s2.filter((r) => r.epic).length]).toEqual([129, 117]); // set 2: −1 Epic on 2026-09-24 (Rune of the White Wolf archived with Moonhowl Mentor); set 2: Rune of Investment Basic → Epic (owner Ruby batch 2026-09-24); −1 Basic / −2 Epic on 2026-09-18 (tag pass: Undead/Spirit-body runes gate on tribes set 2 does not field)
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
  it('can be offered Engraving (Basic), the Gem Golem and Attacking Gems (Epic); never Contraband, Gemscript or Spellstone', () => {
    expect(forge(false)).toContain('rune_engraving');
    expect(forge(false)).not.toContain('rune_contraband'); // CUT FROM SET 3 2026-09-24 (owner)
    expect(forge(true)).toContain('rune_gem_golem');
    expect(forge(true)).toContain('rune_attacking_gems');
    expect(forge(true)).not.toContain('rune_gemscript'); // CUT FROM SET 3 2026-09-25 (owner's Set 3 rune list)
    expect(forge(true)).not.toContain('rune_spellstone'); // CUT FROM SET 3 2026-09-25 (owner's Set 3 rune list)
  });
  it('the forge pool matches the static pool sizes minus nothing structural (every set-3 rune reachable when all five tribes roll)', () => {
    const basic = forge(false), epic = forge(true);
    // the Wishbone is hero-conditional (requiresDoublePower) — the Warden's power does not double, so one Basic fewer
    // (the Wishbone left Set 3 on 2026-09-25 (owner's Set 3 rune list), so no hero-conditional Basic is left to subtract)
    expect(RUNE_INDEX['rune_wishbone']!.sets).toEqual(['set1', 'set2']);
    expect(basic.length).toBe(64 + originals(false)); // → 99 (Investment → Epic); → 100 on 2026-09-24 (owner Set 3 rune cuts); // 112 → 110 on 2026-09-23 (Balance 9/23 archives); → 109 on 2026-09-24 (Hoardcalling gated `dragon` again)
    expect(epic.length).toBe(53 + originals(true)); // → 53 on 2026-09-25 (owner's Set 3 rune list); // → 79 (Investment → Epic); → 78 on 2026-09-24 (owner Set 3 rune cuts); // 90 → 87 on 2026-09-23 (Balance 9/23 archives)
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

describe('the Yazzus runes — ONE Yazzus (owner 2026-09-16)', () => {
  const buy = (setId: SetId, rune: string) => reduce({ ...createRun(4), setId, phase: 'recruit', embers: 40, tier: 6, hand: [], board: [], runeforgeOffer: [rune] } as RunState, { type: 'buyRune', index: 0 } as Action) as RunState;
  it('SET_FORKS is empty: no set forks a card any more, and n3_yazzus is no longer a card of its own', () => {
    expect(SET_FORKS).toEqual({});
    expect(forkedCardId('set3', 'yazzus')).toBe('yazzus');
    expect(forkedCardId('set2', 'yazzus')).toBe('yazzus');
    expect(Object.keys(CARD_INDEX)).not.toContain('n3_yazzus');
    expect(CARD_INDEX['yazzus']!.text).toBe('**Targeted** spells you cast from hand cast **an additional** time.');
  });
  it('the old n3_yazzus id still RESOLVES (saved runs / replays) — to the one Yazzus, without being a second card', () => {
    expect(CARD_INDEX['n3_yazzus']).toBe(CARD_INDEX['yazzus']);
    expect(Object.values(CARD_INDEX).filter((c) => c.id === 'yazzus')).toHaveLength(1);
  });
  it('a save written with n3_yazzus on the board / in hand resumes with THE yazzus (deserialize heals the id)', () => {
    const y = { uid: 'y', cardId: 'n3_yazzus', tribe: 'neutral', attack: 4, health: 8, keywords: [], golden: true } as RunState['board'][number];
    const saved = serialize({ ...createRun(4), setId: 'set3', board: [y], hand: [{ ...y, uid: 'h', golden: false }] } as RunState);
    const s = deserialize(saved);
    expect(s.board.map((c) => [c.cardId, c.golden])).toEqual([['yazzus', true]]);
    expect(s.hand.map((c) => c.cardId)).toEqual(['yazzus']);
  });
  it('Rune of Yazzus grants yazzus in a set-3 run and in a set-2 run alike', () => {
    const s3 = buy('set3', 'rune_yazzus');
    expect([...s3.hand, ...s3.board].map((c) => c.cardId)).toEqual(['yazzus']);
    const s2 = buy('set2', 'rune_yazzus');
    expect([...s2.hand, ...s2.board].map((c) => c.cardId)).toEqual(['yazzus']);
  });
  it('Rune of Frontline Glory is out of the set-3 forge; in set 1 it still hands a GILDED yazzus + Front to Back', () => {
    const s3 = { ...createRun(5, 'warden'), setId: 'set3', tribes: [...S3], runeforgeEpic: true } as RunState;
    expect(runeforgePool(s3)).not.toContain('rune_frontline_glory');
    const s1 = buy('set1', 'rune_frontline_glory');
    const cards = [...s1.hand, ...s1.board];
    expect(cards.filter((c) => c.cardId === 'yazzus').map((c) => c.golden)).toEqual([true]);
    expect(cards.some((c) => c.cardId === 'fronttoback')).toBe(true);
  });
});
