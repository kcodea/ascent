import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * Set 2's Beast tribe — IN PROGRESS. This pins what's authored so far: the tribe is reachable in a set-2 run,
 * the carried-over set-1 Beasts are present, and Packstrider's per-Beast Rally scales with the board.
 */
describe('set 2 — Beast tribe wiring', () => {
  it('set 2 lists beast, and its new + carried-over Beasts are in the index', () => {
    const newBeasts = Object.values(CARD_INDEX).filter((c) => c.id.startsWith('b2_'));
    expect(newBeasts.length).toBeGreaterThan(0);
    expect(newBeasts.every((c) => c.tribe === 'beast')).toBe(true);
    // carried over from set 1 (opted into set 2's manifest)
    for (const id of ['badgington', 'seaurchin', 'sporebat', 'manasaber']) {
      expect(CARD_INDEX[id]).toBeTruthy();
    }
  });
});

describe('set 2 — Packstrider', () => {
  const pk: BoardMinion = { cardId: 'b2_packstrider', attack: 2, health: 40, keywords: ['RL'], sourceUid: 'PK' };

  it('Rally buffs itself by +1/+1 per Beast you control (including itself)', () => {
    // Three Beasts on board: Packstrider + two others. Its first attack should add +3/+3 (×3 Beasts).
    // Real Beasts (Strays) — a BoardMinion tribe override doesn't reach the combat minion, which reads its
    // CardDef tribe, so a tribe-overridden sandbag wouldn't count.
    const others: BoardMinion[] = [
      { cardId: 'stray', attack: 1, health: 40, sourceUid: 'B1' },
      { cardId: 'stray', attack: 1, health: 40, sourceUid: 'B2' },
    ];
    const r = simulate([pk, ...others], [{ cardId: 'sandbag', attack: 0, health: 400 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 1, tribes: ['beast'] }), combatSide({ tier: 1 }));
    // its rally buff event: +3/+3 (one per Beast, three Beasts)
    expect(r.events.some((e) => e.type === 'buff' && e.attack === 3 && e.health === 3)).toBe(true);
  });
});

const bm = (uid: string, cardId: string, tribe: BoardCard['tribe'] = 'beast', a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe, attack: a, health: h, keywords: [], golden: false });
const spell = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

describe('set 2 — Beast spell payoffs', () => {
  it('Mosswhisker Adept: the FIRST spell each turn buffs your Beasts +1/+1 (not the second)', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [bm('mw', 'b2_mosswhisker', 'beast', 1, 2), bm('b1', 'stray', 'beast', 1, 1)],
      hand: [spell('s1', 'growth'), spell('s2', 'growth')],
    };
    s = reduce(s, { type: 'play', uid: 's1' });
    const afterFirst = s.board.find((c) => c.uid === 'b1')!;
    const [a1, h1] = [afterFirst.attack, afterFirst.health];
    s = reduce(s, { type: 'play', uid: 's2' });
    const b1 = s.board.find((c) => c.uid === 'b1')!;
    // Growth buffs the board too, so compare DELTAS: the 2nd cast adds only Growth's +1/+1, the 1st added
    // Growth's +1/+1 plus Mosswhisker's +1/+1.
    expect([b1.attack - a1, b1.health - h1]).toEqual([1, 1]);
  });

  it('Runebloom Matriarch: every spell buffs 3 Beasts +3/+3', () => {
    // DISTINCT beasts on purpose — three copies of one token triple-combine and vanish (the recurring trap).
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [
        bm('rm', 'b2_runebloom', 'beast', 5, 9),
        bm('b1', 'stray', 'beast', 1, 1), bm('b2', 'pup', 'beast', 1, 1), bm('b3', 'manasaber', 'beast', 4, 1),
      ],
      hand: [spell('s1', 'spiritfire')],
    };
    const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    s = reduce(s, { type: 'play', uid: 's1', targetUid: 'rm' }); // Spirit Fire +2/+3, plus Runebloom's proc
    const after = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    // Spirit Fire (+2/+3 = 5) + Runebloom picks 3 Beasts × (+3/+3 = 6) = 5 + 18 = 23, whatever the pick.
    expect(after - before).toBe(23);
  });
});

describe('set 2 — Dawnclaw', () => {
  it('is wired to the shared adjacent-Battlecry re-fire (the mechanic Ryme already proves)', () => {
    // Dawnclaw's Echo reuses `deathrattleReplayAdjacentBattlecry` verbatim — the SAME factory Ryme uses, whose
    // combat behaviour (both neighbours, golden twice, narrates + procs Karwind) is covered by the Ryme tests
    // in simulate.test.ts / rymeWayfinder.test.ts. What's new here is the card wiring, so that's what we pin.
    const dc = CARD_INDEX['b2_dawnclaw']!;
    expect([dc.tier, dc.attack, dc.health]).toEqual([4, 5, 3]);
    expect(dc.effects).toContainEqual({ on: 'onDeath', do: 'deathrattleReplayAdjacentBattlecry' });
  });
});

describe('set 2 — Beast summon + aura cards', () => {
  it('Groveweaver: buffs a summoned Beast +2/+4, and a spell cast improves that grant', () => {
    // Summon path: play a Beast while Groveweaver is out → it lands with the grant folded in.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [bm('gw', 'b2_groveweaver', 'beast', 4, 8)],
      hand: [bm('n1', 'stray', 'beast', 1, 1), spell('sp', 'emberpouch'), bm('n2', 'pup', 'beast', 1, 1)],
    };
    s = reduce(s, { type: 'play', uid: 'n1' });
    const first = s.board.find((c) => c.uid === 'n1')!;
    expect([first.attack - 1, first.health - 1]).toEqual([2, 4]); // base grant

    s = reduce(s, { type: 'play', uid: 'sp' }); // a cast improves the grant by +1
    s = reduce(s, { type: 'play', uid: 'n2' });
    const second = s.board.find((c) => c.uid === 'n2')!;
    expect([second.attack - 1, second.health - 1]).toEqual([3, 5]); // improved by +1 on each stat
  });

  it('Denkeeper Oona / Lancel / Solaris / T-Rex are wired with the expected stats + effects', () => {
    // These reuse combat primitives already covered elsewhere (avengeShieldAttack, addTribeAura, the
    // fixed+goldenTokens summon shape), so the new surface is the card wiring.
    const oona = CARD_INDEX['b2_oona']!;
    expect([oona.tier, oona.attack, oona.health]).toEqual([5, 4, 6]);
    expect(oona.effects[0]!.do).toBe('scSummonOnlyTribeAura');

    const lancel = CARD_INDEX['b2_lancel']!;
    expect([lancel.tier, lancel.attack, lancel.health]).toEqual([3, 3, 4]);

    const solaris = CARD_INDEX['b2_solaris']!;
    expect(solaris.effects[0]!.do).toBe('avengeShieldAttack'); // Solaris Fang's factory, verbatim

    // T-Rex's Echo must keep the count fixed and gild the TOKEN (not summon two) — the Void Panther shape.
    const trex = CARD_INDEX['b2_trex']!;
    expect(trex.effects[0]!.params).toMatchObject({ tokenId: 'b2_trexbaby', count: 1, fixed: true, goldenTokens: true });
    expect(CARD_INDEX['b2_trexbaby']!.token).toBe(true);
  });
});

describe('set 2 — Sunmane Herald spreads its Rally', () => {
  /** Every `buff` event's Attack magnitude, in order — the spread's generation sequence. */
  const rallyGrants = (board: BoardMinion[]): number[] =>
    simulate(board, [{ cardId: 'sandbag', attack: 0, health: 400 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 5, tribes: ['beast'] }), combatSide({ tier: 1 }))
      .events.filter((e) => e.type === 'buff' && e.health === 0)
      .map((e) => (e as { attack: number }).attack);

  it('DOUBLES each generation: the Beasts it touches grant +6, not another +3', () => {
    // The owner ruling (2026-07-24) is that the rally stacks multiplicatively. Sunmane grants the base +3 and
    // hands out a copy worth double, so the second-generation Herald grants +6. Flat spreading — the bug —
    // produced only +3s forever, so the presence of a 6 is what distinguishes fixed from broken.
    const grants = rallyGrants([
      { cardId: 'b2_sunmane', attack: 3, health: 60, keywords: ['RL'], sourceUid: 'SH' },
      { cardId: 'stray', attack: 1, health: 60, sourceUid: 'B1' },
    ]);
    expect(grants).toContain(3); // generation 0 — Sunmane's own grant
    expect(grants).toContain(6); // generation 1 — the Beast it converted grants double
  });

  it('each body learns the rally only ONCE, which is what bounds the doubling', () => {
    // With two Beasts, the chain can only reach generation 1: when B1 attacks it would hand Sunmane a
    // generation-2 copy, but Sunmane already carries the rally, so nothing is re-granted. Without that guard
    // the magnitude would compound with ATTACK COUNT rather than spread depth and diverge — a 12 here is the
    // signature of that runaway.
    const grants = rallyGrants([
      { cardId: 'b2_sunmane', attack: 3, health: 60, keywords: ['RL'], sourceUid: 'SH' },
      { cardId: 'stray', attack: 1, health: 60, sourceUid: 'B1' },
    ]);
    expect(Math.max(...grants)).toBe(6);
    expect(grants).not.toContain(12);
  });

  it('buffs Beasts +3 Attack and grafts the rally onto them (once each, no runaway)', () => {
    const r = simulate([
      { cardId: 'b2_sunmane', attack: 3, health: 60, keywords: ['RL'], sourceUid: 'SH' },
      { cardId: 'stray', attack: 1, health: 60, sourceUid: 'B1' },
      { cardId: 'pup', attack: 1, health: 60, sourceUid: 'B2' },
    ], [{ cardId: 'sandbag', attack: 0, health: 400 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 5, tribes: ['beast'] }), combatSide({ tier: 1 }));
    // The Herald's attack buffs both Beasts +3/+0…
    const buffs = r.events.filter((e) => e.type === 'buff' && e.attack === 3 && e.health === 0);
    expect(buffs.length).toBeGreaterThanOrEqual(2);
    // …and they picked up the rally, so THEY buff too as they attack — more +3/+0 events than the Herald
    // alone could produce in its own attacks. The dedupe guard keeps this linear, not exponential: the fight
    // resolves (the harness/suite would hang otherwise).
    expect(buffs.length).toBeGreaterThan(2);
  });
});

describe('set 2 — Elderhorn multiplies BEAST triggers only', () => {
  // A Deathrattle that summons, so extra Echo fires are countable as extra summons.
  const echoBeast: CardDef = { id: 'ehbeast', name: 'EB', tribe: 'beast', tier: 2, attack: 1, health: 1, keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'stray', count: 1 } }], text: '' };
  const echoDragon: CardDef = { ...echoBeast, id: 'ehdragon', name: 'ED', tribe: 'dragon' };

  const summonsWith = (mode: { beastRitualExtra?: number }, deadCardId: string): number => {
    const r = simulate(
      [{ cardId: deadCardId, attack: 1, health: 1, sourceUid: 'D' }],
      [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(3), { ...CARD_INDEX, ehbeast: echoBeast, ehdragon: echoDragon },
      combatSide({ tier: 5, tribes: ['beast'], ...mode }), combatSide({ tier: 1 }));
    return r.events.filter((e) => e.type === 'summon').length;
  };

  it('Ritual makes a BEAST Echo fire an extra time', () => {
    expect(summonsWith({}, 'ehbeast')).toBe(1);
    expect(summonsWith({ beastRitualExtra: 1 }, 'ehbeast')).toBe(2); // the extra fire
  });

  it('Ritual does NOT touch a non-Beast Echo (tribe-scoped, unlike Drakko/Uron)', () => {
    expect(summonsWith({}, 'ehdragon')).toBe(1);
    expect(summonsWith({ beastRitualExtra: 1 }, 'ehdragon')).toBe(1); // unchanged
  });

  it('the Choose-One installs the run-level mode (Hunt vs Ritual)', () => {
    const eh = (uid: string): BoardCard => ({ uid, cardId: 'b2_elderhorn', tribe: 'beast', attack: 8, health: 10, keywords: [], golden: false });
    let s: RunState = { ...createRun(7), tier: 7, phase: 'recruit', embers: 60, board: [], hand: [eh('e1')] };
    s = reduce(s, { type: 'play', uid: 'e1' });
    s = reduce(s, { type: 'chooseOne', index: 0 }); // Hunt
    expect(s.beastHuntExtra).toBe(1);
    expect(s.beastRitualExtra ?? 0).toBe(0); // only the chosen mode installs

    let s2: RunState = { ...createRun(7), tier: 7, phase: 'recruit', embers: 60, board: [], hand: [eh('e2')] };
    s2 = reduce(s2, { type: 'play', uid: 'e2' });
    s2 = reduce(s2, { type: 'chooseOne', index: 1 }); // Ritual
    expect(s2.beastRitualExtra).toBe(1);
    expect(s2.beastHuntExtra ?? 0).toBe(0);
  });
});

describe('set 2 — Moonhowl Mentor teaches a Mage-Pup', () => {
  it('buying a Shop spell mints the taught Mage-Pup IMMEDIATELY (not at End of Turn)', () => {
    // Owner 2026-07-24: the payoff used to queue and mint at End of Turn, so the turn you invested in the
    // spell you got nothing. The Pup must be playable the same turn.
    let s: RunState = {
      ...createRun(6), tier: 6, phase: 'recruit', embers: 60,
      board: [bm('mh', 'b2_moonhowl', 'beast', 4, 9), bm('t1', 'stray', 'beast', 1, 1)],
      hand: [],
      spell: { uid: 'sp', cardId: 'spiritfire' }, // the shop's spell slot
    };
    s = reduce(s, { type: 'buy', uid: 'sp' });
    const pup = s.hand.find((c) => c.cardId === 'b2_magepup');
    expect(pup).toBeDefined();                       // in hand NOW, before any End of Turn
    expect(pup!.taughtSpellId).toBe('spiritfire');   // it remembers what it learned
    expect(s.hand.some((c) => c.cardId === 'spiritfire')).toBe(true); // the spell itself still bought
  });

  it('the taught Shout casts the spell — a real cast, tallied like any other', () => {
    let s: RunState = {
      ...createRun(6), tier: 6, phase: 'recruit', embers: 60,
      board: [bm('mh', 'b2_moonhowl', 'beast', 4, 9), bm('t1', 'stray', 'beast', 1, 1)],
      hand: [], spell: { uid: 'sp', cardId: 'spiritfire' },
    };
    s = reduce(s, { type: 'buy', uid: 'sp' });
    const pup = s.hand.find((c) => c.cardId === 'b2_magepup')!;
    const before = s.spellsCast;
    const boardBefore = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    s = reduce(s, { type: 'play', uid: pup.uid });
    expect(s.spellsCast).toBe(before + 1); // it went through castSpell, so spell-watchers see it
    // Spirit Fire is aimed; the taught cast auto-picks a friendly, so SOME body gained stats. Asserting the
    // board SUM keeps this independent of which minion the seeded pick landed on.
    expect(s.board.reduce((n, c) => n + c.attack + c.health, 0)).toBeGreaterThan(boardBefore);
  });

  it('a taught DISCOVER spell opens the real Discover (the Beyond the Summit bug)', () => {
    // The reported failure: `castSpell` only runs a spell's `effects[]`, and Beyond the Summit has none — it
    // works entirely through `discoverOnPlay`. A taught copy therefore did nothing at all. It now routes
    // through the same `discoverSpecFor` + `queueDiscover` the hand path uses.
    let s: RunState = {
      ...createRun(6), tier: 4, phase: 'recruit', embers: 60,
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'],
      board: [bm('mh', 'b2_moonhowl', 'beast', 4, 9)], hand: [], shop: [],
      spell: { uid: 'sp', cardId: 'beyondsummit' },
    };
    s = reduce(s, { type: 'buy', uid: 'sp' });
    const pup = s.hand.find((c) => c.cardId === 'b2_magepup')!;
    expect(pup.taughtSpellId).toBe('beyondsummit');
    s = reduce(s, { type: 'play', uid: pup.uid });
    expect(s.discover?.length ?? 0).toBeGreaterThan(0); // the peek actually opened
    // …and it's the tier-up peek the real card gives, not an arbitrary offer.
    expect(s.discover!.every((id) => (CARD_INDEX[id]?.tier ?? 0) >= 5)).toBe(true);
  });

  it('respects the once-per-turn cap, and does nothing with no Mentor on board', () => {
    // No Mentor → buying a spell mints nothing.
    let none: RunState = {
      ...createRun(6), tier: 6, phase: 'recruit', embers: 60, board: [], hand: [],
      spell: { uid: 'sp', cardId: 'spiritfire' },
    };
    none = reduce(none, { type: 'buy', uid: 'sp' });
    expect(none.hand.some((c) => c.cardId === 'b2_magepup')).toBe(false);

    // With a Mentor: the first buy teaches, a second in the same turn does not (cap 1 for a non-golden).
    let s: RunState = {
      ...createRun(6), tier: 6, phase: 'recruit', embers: 60,
      board: [bm('mh', 'b2_moonhowl', 'beast', 4, 9)], hand: [],
      spell: { uid: 'sp1', cardId: 'spiritfire' },
    };
    s = reduce(s, { type: 'buy', uid: 'sp1' });
    s = { ...s, spell: { uid: 'sp2', cardId: 'growth' } }; // a second spell appears in the slot
    s = reduce(s, { type: 'buy', uid: 'sp2' });
    const pups = s.hand.filter((c) => c.cardId === 'b2_magepup');
    expect(pups.length).toBe(1);                     // cap respected
    expect(pups[0]!.taughtSpellId).toBe('spiritfire'); // still the first spell
  });
});
