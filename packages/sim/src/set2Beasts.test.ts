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

describe('set 2 — Sunmane Herald’s rally escalates', () => {
  /** Rally grants in order: Attack-only `buff` events granted BY someone else. The `source !== target` filter
   *  matters — the enemy sandbag self-buffs +1/+0 on its own schedule, and those readings would otherwise
   *  interleave with the rally rungs and make the sequence unreadable. */
  const grants = (board: BoardMinion[], seed = 3): number[] =>
    simulate(board, [{ cardId: 'sandbag', attack: 0, health: 600 }], makeRng(seed), CARD_INDEX,
      combatSide({ tier: 5, tribes: ['beast'] }), combatSide({ tier: 1 }))
      .events.filter((e) => {
        const b = e as { type: string; health: number; source?: string; target?: string };
        return b.type === 'buff' && b.health === 0 && b.source !== b.target;
      })
      .map((e) => (e as { attack: number }).attack);

  it('DOUBLES on every rally attack: 3 → 6 → 12 → 24 …', () => {
    // Owner spec 2026-07-25: the value continuously stacks board-wide. The previous reading — each recipient
    // learns a copy worth 2x what it was handed, once — could not escalate past +6 on a static board, because
    // every body had already learned it. This is the assertion that distinguishes the two.
    const g = grants([
      { cardId: 'b2_sunmane', attack: 3, health: 200, keywords: ['RL'], sourceUid: 'SH' },
      { cardId: 'stray', attack: 1, health: 200, sourceUid: 'B1' },
      { cardId: 'pup', attack: 1, health: 200, sourceUid: 'B2' },
    ]);
    // The distinct rungs the chain reaches, in order of first appearance.
    const rungs: number[] = [];
    for (const v of g) if (rungs[rungs.length - 1] !== v) rungs.push(v);
    expect(rungs.slice(0, 4)).toEqual([3, 6, 12, 24]);
  });

  it('a Beast summoned MID-COMBAT joins the chain at full strength', () => {
    // Owner rule: it has no stacks until a carrier attacks, then takes the CURRENT value and can carry on.
    // Sea Urchin's Echo summons a token mid-fight, so the token arrives after the chain has already escalated.
    const g = grants([
      { cardId: 'b2_sunmane', attack: 3, health: 200, keywords: ['RL'], sourceUid: 'SH' },
      { cardId: 'seaurchin', attack: 1, health: 1, sourceUid: 'SU' }, // dies early → summons its token
      { cardId: 'stray', attack: 1, health: 200, sourceUid: 'B1' },
    ], 7);
    // The chain still climbs past the opening rungs even though a fresh body joined partway — a newcomer must
    // not reset or stall it.
    expect(Math.max(...g)).toBeGreaterThanOrEqual(12);
  });

  it('the escalation cannot reach Infinity (the doubling is clamped)', () => {
    // Unbounded doubling is the design, but the arithmetic must stay finite — an Infinity here would turn every
    // downstream stat into NaN. A long fight with several Beasts exercises many rungs.
    const board: BoardMinion[] = [
      { cardId: 'b2_sunmane', attack: 3, health: 4000, keywords: ['RL'], sourceUid: 'SH' },
      { cardId: 'stray', attack: 1, health: 4000, sourceUid: 'B1' },
      { cardId: 'pup', attack: 1, health: 4000, sourceUid: 'B2' },
      { cardId: 'badgington', attack: 1, health: 4000, sourceUid: 'B3' },
    ];
    const r = simulate(board, [{ cardId: 'sandbag', attack: 0, health: 200000 }], makeRng(11), CARD_INDEX,
      combatSide({ tier: 5, tribes: ['beast'] }), combatSide({ tier: 1 }));
    const bad = r.events.filter((e) => {
      const v = (e as { attack?: number }).attack;
      return typeof v === 'number' && !Number.isFinite(v);
    });
    expect(bad).toEqual([]);
    for (const m of r.initial.player) expect(Number.isFinite(m.attack)).toBe(true);
  });

  it('still grants the Rally itself, so the spread reaches every Beast', () => {
    const g = grants([
      { cardId: 'b2_sunmane', attack: 3, health: 200, keywords: ['RL'], sourceUid: 'SH' },
      { cardId: 'stray', attack: 1, health: 200, sourceUid: 'B1' },
    ]);
    // More grants than Sunmane alone could produce from its own attacks — the Stray learned the rally and is
    // granting too.
    expect(g.length).toBeGreaterThan(2);
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

describe('set 2 — Moonhowl fires from BOTH spell-buy paths', () => {
  // Owner report 2026-07-24: "moonhowl isnt proccing when i buy spirit fire". There are two ways to buy a
  // spell — the right-hand spell SLOT and a spell offer sitting in the minion ROW (Spell Cart / set 2) — and
  // `spellBought` only fired from the slot, so a row buy silently taught nothing.
  const mentor = (): BoardCard =>
    ({ uid: 'mh', cardId: 'b2_moonhowl', tribe: 'beast', attack: 4, health: 9, keywords: [], golden: false });

  it('the right-hand spell SLOT teaches', () => {
    let s: RunState = {
      ...createRun(6), tier: 6, phase: 'recruit', embers: 60, board: [mentor()], hand: [],
      spell: { uid: 'sp', cardId: 'spiritfire' },
    };
    s = reduce(s, { type: 'buy', uid: 'sp' });
    expect(s.hand.find((c) => c.cardId === 'b2_magepup')?.taughtSpellId).toBe('spiritfire');
  });

  it('a spell offer in the minion ROW teaches too (the reported miss)', () => {
    let s: RunState = {
      ...createRun(6), tier: 6, phase: 'recruit', embers: 60, board: [mentor()], hand: [],
      shop: [{ uid: 'row', cardId: 'spiritfire' }], spell: null,
    };
    s = reduce(s, { type: 'buy', uid: 'row' });
    expect(s.hand.some((c) => c.cardId === 'spiritfire')).toBe(true); // the spell itself bought
    expect(s.hand.find((c) => c.cardId === 'b2_magepup')?.taughtSpellId).toBe('spiritfire');
  });
});

describe('set 2 — a Mage-Pup taught an AIMED spell lets you pick the target', () => {
  // Owner 2026-07-24. The aim is a PER-INSTANCE property: the Mage-Pup CardDef is untargeted, so the usual
  // `def.target === 'friendly'` deferral can't see it — the taught spell on the instance is what needs an aim.
  const pup = (uid: string, spellId: string): BoardCard => ({
    uid, cardId: 'b2_magepup', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false,
    taughtSpellId: spellId,
  });
  const body = (uid: string): BoardCard =>
    ({ uid, cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });

  it('playing it opens the aim picker instead of auto-casting', () => {
    let s: RunState = {
      ...createRun(6), tier: 6, phase: 'recruit', board: [body('a'), body('b')],
      hand: [pup('p', 'spiritfire')],
    };
    s = reduce(s, { type: 'play', uid: 'p' });
    expect(s.pendingTarget?.uid).toBe('p'); // waiting on the player
    // Nothing cast yet — the Shout is deferred, not fired-then-corrected.
    expect(s.spellsCast).toBe(0);
  });

  it('the chosen minion is the one that gets the spell', () => {
    let s: RunState = {
      ...createRun(6), tier: 6, phase: 'recruit', board: [body('a'), body('b')],
      hand: [pup('p', 'spiritfire')],
    };
    s = reduce(s, { type: 'play', uid: 'p' });
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'b' });
    expect(s.pendingTarget).toBeUndefined();
    expect(s.spellsCast).toBe(1);
    const a = s.board.find((c) => c.uid === 'a')!;
    const b = s.board.find((c) => c.uid === 'b')!;
    // Spirit Fire buffed the PICKED body, and only it — the whole point of aiming.
    expect(b.attack + b.health).toBeGreaterThan(2);
    expect(a.attack + a.health).toBe(2);
  });

  it('an UNtargeted taught spell still resolves immediately (no stray prompt)', () => {
    let s: RunState = {
      ...createRun(6), tier: 4, phase: 'recruit', board: [body('a')],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'],
      hand: [pup('p', 'beyondsummit')], shop: [],
    };
    s = reduce(s, { type: 'play', uid: 'p' });
    expect(s.pendingTarget).toBeUndefined();          // no aim for a Discover spell
    expect(s.discover?.length ?? 0).toBeGreaterThan(0); // it just resolved
  });
});

describe('set 2 — Mage-Pups never triple', () => {
  // Owner ruling 2026-07-24: "mage pups cannot be tripled in any circumstance". Each Pup's identity is the
  // spell on its instance, so a combine would have to pick one taught spell and bin the other two.
  const pup = (uid: string, spellId: string): BoardCard => ({
    uid, cardId: 'b2_magepup', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false,
    taughtSpellId: spellId,
  });
  const stray = (uid: string): BoardCard =>
    ({ uid, cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });

  /** Buying a shop minion is the realistic trigger: `checkTriples` runs on BUY (and play/grant), never on a
   *  roll — asserting after a roll would pass without the guard, i.e. prove nothing. */
  const buyToTriggerCheck = (s: RunState): RunState =>
    reduce({ ...s, embers: 60, shop: [{ uid: 'shopbuy', cardId: 'alley' }] }, { type: 'buy', uid: 'shopbuy' });

  it('three Pups do not combine — and each keeps its own taught spell', () => {
    let s: RunState = {
      ...createRun(6), tier: 6, phase: 'recruit', board: [],
      hand: [pup('p1', 'spiritfire'), pup('p2', 'growth'), pup('p3', 'mend')],
    };
    s = buyToTriggerCheck(s);
    const pups = [...s.board, ...s.hand].filter((c) => c.cardId === 'b2_magepup');
    expect(pups.length).toBe(3);                       // all three survive
    expect(pups.some((c) => c.golden)).toBe(false);    // nothing gilded
    expect(pups.map((c) => c.taughtSpellId).sort()).toEqual(['growth', 'mend', 'spiritfire']);
  });

  it('does not combine across hand and board either', () => {
    let s: RunState = {
      ...createRun(6), tier: 6, phase: 'recruit',
      board: [pup('p1', 'spiritfire'), pup('p2', 'growth')],
      hand: [pup('p3', 'mend')],
    };
    s = buyToTriggerCheck(s);
    const pups = [...s.board, ...s.hand].filter((c) => c.cardId === 'b2_magepup');
    expect(pups.length).toBe(3);
    expect(pups.some((c) => c.golden)).toBe(false);
  });

  it('Rune of Twin Gilding (Gild at 2) still cannot gild them', () => {
    // The rune lowers the threshold, so it's the case most likely to slip past a fix written against 3.
    let s: RunState = {
      ...createRun(6), tier: 6, phase: 'recruit', runeTwinGilding: true, board: [],
      hand: [pup('p1', 'spiritfire'), pup('p2', 'growth')],
    };
    s = buyToTriggerCheck(s);
    const pups = [...s.board, ...s.hand].filter((c) => c.cardId === 'b2_magepup');
    expect(pups.length).toBe(2);
    expect(pups.some((c) => c.golden)).toBe(false);
  });

  it('CONTROL: a normal minion still triples at 3 — the guard is Pup-specific, not a blanket break', () => {
    let s: RunState = {
      ...createRun(6), tier: 6, phase: 'recruit', board: [],
      hand: [stray('a'), stray('b'), stray('c')],
    };
    s = buyToTriggerCheck(s);
    expect([...s.board, ...s.hand].some((c) => c.cardId === 'stray' && c.golden)).toBe(true);
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
    // Spirit Fire is AIMED, so playing the Pup opens the picker (owner 2026-07-24) — complete the aim.
    expect(s.pendingTarget?.uid).toBe(pup.uid);
    s = reduce(s, { type: 'battlecryTarget', targetUid: 't1' });
    expect(s.spellsCast).toBe(before + 1); // it went through castSpell, so spell-watchers see it
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
