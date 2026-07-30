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
  it('Groveweaver: buffs a summoned Beast +2/+2, and a spell cast improves that grant by +2/+2', () => {
    // Summon path: play a Beast while Groveweaver is out → it lands with the grant folded in.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [bm('gw', 'b2_groveweaver', 'beast', 4, 8)],
      hand: [bm('n1', 'stray', 'beast', 1, 1), spell('sp', 'emberpouch'), bm('n2', 'pup', 'beast', 1, 1)],
    };
    s = reduce(s, { type: 'play', uid: 'n1' });
    const first = s.board.find((c) => c.uid === 'n1')!;
    expect([first.attack - 1, first.health - 1]).toEqual([2, 2]); // base grant (owner change 2026-07-25)

    s = reduce(s, { type: 'play', uid: 'sp' }); // a cast improves the grant by +2/+2
    s = reduce(s, { type: 'play', uid: 'n2' });
    const second = s.board.find((c) => c.uid === 'n2')!;
    expect([second.attack - 1, second.health - 1]).toEqual([4, 4]); // improved by +2 on each stat
  });

  it('Denkeeper Oona / Lancel / Solaris / T-Rex are wired with the expected stats + effects', () => {
    // These reuse combat primitives already covered elsewhere (avengeShieldAttack, addTribeAura, the
    // fixed+goldenTokens summon shape), so the new surface is the card wiring.
    // Oona reworked 2026-07-25 (owner): an onSummon watcher that grants +1/+1 and THEN doubles, with an
    // Avenge(4) improving the flat half. No longer a Start-of-Combat aura, so `SC` came off her keywords too.
    const oona = CARD_INDEX['b2_oona']!;
    expect([oona.tier, oona.attack, oona.health]).toEqual([5, 4, 6]);
    expect(oona.effects.map((e) => e.do)).toEqual(['onSummonTribeBuffThenDouble', 'avengeImproveSummon']);
    expect(oona.keywords).not.toContain('SC');

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

describe('set 2 — Sunmane Herald’s rally accumulates', () => {
  /** Every rally grant in order (Attack-only buffs from another minion). The `source !== target` filter matters:
   *  the enemy Target Dummy self-buffs +1/+0 when damaged, and those would interleave with the rungs. */
  const grants = (board: BoardMinion[], enemyHp = 90000, seed = 3): number[] =>
    simulate(board, [{ cardId: 'sandbag', attack: 0, health: enemyHp }], makeRng(seed), CARD_INDEX,
      combatSide({ tier: 5, tribes: ['beast'] }), combatSide({ tier: 1 }))
      .events.filter((e) => {
        const b = e as { type: string; health: number; source?: string; target?: string };
        return b.type === 'buff' && b.health === 0 && b.source !== b.target;
      })
      .map((e) => (e as { attack: number }).attack);

  it('OWNER CASE: a carrier grants what it ACCUMULATED — it does not double per attack', () => {
    // The assertion that actually DISTINGUISHES the two models, and the reason it's the RAW sequence rather than
    // the distinct rungs. Four Beasts, one attack each:
    //   accumulation → Sunmane grants +3 x3, then the first carrier passes on the +3 it holds (+3 x3), THEN 6s
    //   "double per attack" → Sunmane grants +3 x3, then the first carrier already grants +6
    // So the count of +3s (six vs three) is the discriminator. Collapsing duplicate rungs hides it — an earlier
    // version of this test did exactly that and passed against the WRONG model.
    const g = grants([
      { cardId: 'b2_sunmane', attack: 3, health: 400, keywords: ['RL'], sourceUid: 'SH' },
      { cardId: 'stray', attack: 1, health: 400, sourceUid: 'B1' },
      { cardId: 'pup', attack: 1, health: 400, sourceUid: 'B2' },
      { cardId: 'babycub', attack: 1, health: 400, sourceUid: 'B3' },
    ]);
    expect(g.slice(0, 12)).toEqual([3, 3, 3, 3, 3, 3, 6, 6, 6, 12, 12, 12]);
  });

  it('OWNER CASE: a Flurry Sunmane grants its base once PER SWING, and the recipient passes on the sum', () => {
    // "it only buffs the rest of the beast minions +3 attack 4 times, so +12 attack. this DOES mean that the
    // next beast that attacks would rally: +12". Two swings here → +3, +3, then the Stray passes on 6.
    const g = grants([
      { cardId: 'b2_sunmane', attack: 3, health: 400, keywords: ['RL', 'W'], sourceUid: 'SH' },
      { cardId: 'stray', attack: 1, health: 400, sourceUid: 'B1' },
    ]);
    expect(g.slice(0, 3)).toEqual([3, 3, 6]);
  });

  it('Sunmane never buffs ITSELF, which is why it keeps granting its printed base', () => {
    // Load-bearing, not incidental: self-buffing would make Sunmane accumulate and its own grant escalate,
    // which is exactly the behaviour the owner rejected.
    const r = simulate(
      [{ cardId: 'b2_sunmane', attack: 3, health: 400, keywords: ['RL'], sourceUid: 'SH' },
       { cardId: 'stray', attack: 1, health: 400, sourceUid: 'B1' }],
      [{ cardId: 'sandbag', attack: 0, health: 90000 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 5, tribes: ['beast'] }), combatSide({ tier: 1 }));
    // m0 is Sunmane. It may RECEIVE from the Stray, but never from itself.
    const selfBuffs = (r.events as { type: string; source?: string; target?: string }[])
      .filter((e) => e.type === 'buff' && e.source === 'm0' && e.target === 'm0');
    expect(selfBuffs).toEqual([]);
  });

  it('the accumulation cannot reach Infinity (it is clamped)', () => {
    const board: BoardMinion[] = [
      { cardId: 'b2_sunmane', attack: 3, health: 4000, keywords: ['RL'], sourceUid: 'SH' },
      { cardId: 'stray', attack: 1, health: 4000, sourceUid: 'B1' },
      { cardId: 'pup', attack: 1, health: 4000, sourceUid: 'B2' },
      { cardId: 'badgington', attack: 1, health: 4000, sourceUid: 'B3' },
    ];
    const r = simulate(board, [{ cardId: 'sandbag', attack: 0, health: 500000 }], makeRng(11), CARD_INDEX,
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
    expect(g.length).toBeGreaterThan(2); // the Stray learned it and is granting too
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

describe('set 2 — King Oona (owner reworks 2026-07-25 / 2026-07-27)', () => {
  it('a summoned Beast gets +1/+1 and THEN doubles — order matters', () => {
    // Mama Pup's 1/1 Pups: +1/+1 → 2/2, then doubled → 4/4. If the doubling ran FIRST the Pup would be 3/3,
    // so this pins the printed order rather than merely "it got bigger".
    const r = simulate(
      [{ cardId: 'b2_oona', attack: 4, health: 40, sourceUid: 'O', keywords: [] },
       { cardId: 'pack', attack: 2, health: 1, sourceUid: 'P', keywords: [] }],
      [{ cardId: 'sandbag', attack: 9, health: 400 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 5, tribes: ['beast'] }), combatSide({ tier: 1 }));
    const summoned = (r.events.filter((e) => e.type === 'summon') as { minion: { uid: string; cardId: string } }[])
      .filter((e) => e.minion.cardId === 'pup');
    expect(summoned.length, 'the Pups spawned').toBeGreaterThan(0);
    const uid = summoned[0]!.minion.uid;
    const gained = (r.events.filter((e) => e.type === 'buff') as { target: string; attack: number; health: number }[])
      .filter((b) => b.target === uid);
    expect(gained.map((b) => [b.attack, b.health]), 'flat grant first, then a double of the NEW stats')
      .toEqual([[1, 1], [2, 2]]);
  });

  it('does not touch a non-Beast summon', () => {
    const oona = CARD_INDEX['b2_oona']!;
    expect(oona.effects[0]!.params!.tribe).toBe('beast');
  });

  it('GILDED triples instead of doubling (owner 2026-07-27)', () => {
    // Golden already doubles the flat grant (+2/+2). The rework is the second half: one extra copy of the
    // minion's own stats per `mul`, so a golden Oona turns a 2/2 Pup into 3× rather than 2×. Read off the
    // buff events: the flat grant is +2/+2, then the multiply must be +6/+6 (2× the post-grant 3/3), not +3/+3.
    const r = simulate(
      [{ cardId: 'b2_oona', attack: 4, health: 40, sourceUid: 'O', keywords: [], golden: true },
       { cardId: 'pack', attack: 2, health: 1, sourceUid: 'P', keywords: [] }],
      [{ cardId: 'sandbag', attack: 9, health: 400 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 5, tribes: ['beast'] }), combatSide({ tier: 1 }));
    const summoned = (r.events.filter((e) => e.type === 'summon') as { minion: { uid: string; cardId: string } }[])
      .filter((e) => e.minion.cardId === 'pup');
    expect(summoned.length).toBeGreaterThan(0);
    const uid = summoned[0]!.minion.uid;
    const gained = (r.events.filter((e) => e.type === 'buff') as { target: string; attack: number; health: number }[])
      .filter((b) => b.target === uid);
    expect(gained.map((b) => [b.attack, b.health]), 'gilded should TRIPLE: +2/+2 then 2× the new 3/3')
      .toEqual([[2, 2], [6, 6]]);
  });
});

describe('set 2 — Menagerie Mammoth (owner rework 2026-07-27)', () => {
  it('gives each summoned Beast +3 Attack, and the grant grows permanently', () => {
    // Mama Pup dies and leaves Pups behind: the first gets +3, the next +4 — the escalation is the whole card,
    // so asserting a single +3 would pass against a version that never improved.
    const r = simulate(
      [{ cardId: 'b2_mammoth', attack: 6, health: 200, sourceUid: 'M', keywords: [] },
       { cardId: 'pack', attack: 2, health: 1, sourceUid: 'P', keywords: [] }],
      [{ cardId: 'sandbag', attack: 9, health: 9999 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast'] }), combatSide({ tier: 1 }));
    const grants = (r.events.filter((e) => e.type === 'buff') as { source?: string; attack: number; health: number }[])
      .filter((b) => b.source === 'm0');
    expect(grants.length, 'the Mammoth granted nothing').toBeGreaterThan(1);
    expect(grants.every((g) => g.health === 0), 'the grant is Attack-only').toBe(true);
    expect(grants.map((g) => g.attack).slice(0, 2)).toEqual([3, 4]);
  });

  it('…and the improved grant rides home on the summon-bonus carry-back', () => {
    // "Permanently" is the load-bearing word: without `playerSummonBonus` the escalation would reset every
    // round and the card would read as broken across turns.
    const r = simulate(
      [{ cardId: 'b2_mammoth', attack: 6, health: 200, sourceUid: 'M', keywords: [] },
       { cardId: 'pack', attack: 2, health: 1, sourceUid: 'P', keywords: [] }],
      [{ cardId: 'sandbag', attack: 9, health: 9999 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast'] }), combatSide({ tier: 1 }));
    const carried = (r.playerSummonBonus ?? []).find((b) => b.sourceUid === 'M');
    expect(carried, 'the Mammoth’s accrual never left combat').toBeTruthy();
    expect(carried!.bonus).toBeGreaterThan(0);
  });
});

describe('set 2 — Bathing Matriarch alternates each turn (owner spec 2026-07-25)', () => {
  const play = (s: RunState, uid: string) => reduce(s, { type: 'play', uid });
  const setup = (eotTick?: number): RunState => ({
    ...createRun(1), phase: 'recruit', embers: 60,
    board: [{ uid: 'M', cardId: 'd2_matriarch', tribe: 'dragon', attack: 2, health: 7, keywords: [], golden: false, ...(eotTick === undefined ? {} : { eotTick }) }],
    hand: [{ uid: 'sh', cardId: 'd2_chronicler', tribe: 'dragon', attack: 3, health: 5, keywords: [], golden: false }],
  } as RunState);

  it('a FRESH Matriarch starts on Attack', () => {
    const after = play(setup(), 'sh');
    const m = after.board.find((c) => c.uid === 'M')!;
    expect([m.attack - 2, m.health - 7], 'Attack only on its first turn').toEqual([2, 0]);
  });

  it('the next turn it gives Health instead', () => {
    const after = play(setup(1), 'sh'); // one turn elapsed
    const m = after.board.find((c) => c.uid === 'M')!;
    expect([m.attack - 2, m.health - 7], 'Health only on the second turn').toEqual([0, 2]);
  });

  it('and flips back on the turn after that', () => {
    const after = play(setup(2), 'sh');
    const m = after.board.find((c) => c.uid === 'M')!;
    expect([m.attack - 2, m.health - 7]).toEqual([2, 0]);
  });

  it('the phase is PER-INSTANCE, so a Matriarch bought later still starts on Attack', () => {
    // The reason this isn't global wave parity: a card bought on an even turn would otherwise open on Health,
    // contradicting "starts on Attack".
    const s = setup();
    s.wave = 8;
    const m = play(s, 'sh').board.find((c) => c.uid === 'M')!;
    expect(m.attack - 2).toBe(2);
  });
});

describe('set 2 — Groveweaver (owner report 2026-07-25)', () => {
  it('buffs a Beast summoned IN COMBAT, not just in the shop', () => {
    // The missing half: `summonBuffTribeAsym` lived only in the recruit table, so Groveweaver paid for shop
    // summons and silently did nothing for the Echo tokens that make up most of a summon board.
    const r = simulate(
      [{ cardId: 'b2_groveweaver', attack: 4, health: 40, sourceUid: 'G', keywords: [] },
       { cardId: 'pack', attack: 2, health: 1, sourceUid: 'P', keywords: [] }],
      [{ cardId: 'sandbag', attack: 9, health: 400 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 5, tribes: ['beast'] }), combatSide({ tier: 1 }));
    const pups = (r.events.filter((e) => e.type === 'summon') as { minion: { uid: string; cardId: string } }[])
      .filter((e) => e.minion.cardId === 'pup');
    expect(pups.length, 'the Pups spawned').toBeGreaterThan(0);
    const got = (r.events.filter((e) => e.type === 'buff') as { target: string; attack: number; health: number }[])
      .filter((b) => b.target === pups[0]!.minion.uid);
    expect(got.some((b) => b.attack === 2 && b.health === 2), 'the summoned Pup got +2/+2').toBe(true);
  });

  it('the grant grows with the accrual it has banked', () => {
    const r = simulate(
      [{ cardId: 'b2_groveweaver', attack: 4, health: 40, sourceUid: 'G', keywords: [], summonBonus: 4 } as never,
       { cardId: 'pack', attack: 2, health: 1, sourceUid: 'P', keywords: [] }],
      [{ cardId: 'sandbag', attack: 9, health: 400 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 5, tribes: ['beast'] }), combatSide({ tier: 1 }));
    const pups = (r.events.filter((e) => e.type === 'summon') as { minion: { uid: string } }[]);
    const got = (r.events.filter((e) => e.type === 'buff') as { target: string; attack: number; health: number }[])
      .filter((b) => pups.some((p) => p.minion.uid === b.target));
    expect(got.some((b) => b.attack === 6 && b.health === 6), 'base +2/+2 plus two spells of accrual').toBe(true);
  });
});
