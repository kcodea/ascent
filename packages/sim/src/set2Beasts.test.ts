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

  it('Rally gains +1 Attack (no Health) per Beast you control, counting itself (owner rework 2026-08-11)', () => {
    // Three Beasts on board: Packstrider + two others. Its first attack should add +3 Attack, +0 Health (×3
    // Beasts). Real Beasts (Strays) — a BoardMinion tribe override doesn't reach the combat minion, which reads
    // its CardDef tribe, so a tribe-overridden sandbag wouldn't count.
    const others: BoardMinion[] = [
      { cardId: 'stray', attack: 1, health: 40, sourceUid: 'B1' },
      { cardId: 'stray', attack: 1, health: 40, sourceUid: 'B2' },
    ];
    const r = simulate([pk, ...others], [{ cardId: 'sandbag', attack: 0, health: 400 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 1, tribes: ['beast'] }), combatSide({ tier: 1 }));
    // its rally buff event: +3 Attack, +0 Health (one Attack per Beast, three Beasts — no Health)
    expect(r.events.some((e) => e.type === 'buff' && e.attack === 3 && e.health === 0)).toBe(true);
  });
});

const bm = (uid: string, cardId: string, tribe: BoardCard['tribe'] = 'beast', a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe, attack: a, health: h, keywords: [], golden: false });
const spell = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

describe('set 2 — Beast spell payoffs', () => {
  it('Runebloom Matriarch no longer procs in the SHOP — its payoff moved into combat (2026-08-07)', () => {
    // It used to buff 3 Beasts +3/+3 on every shop cast. The rework replaced that with a Start-of-Combat
    // grant ("your Shop Spells cast an extra time in combat"), so a shop cast must now do nothing beyond the
    // spell itself. The combat half is covered in `core/src/combat/combatSpellCast.test.ts`.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [
        bm('rm', 'b2_runebloom', 'beast', 5, 9),
        bm('b1', 'stray', 'beast', 1, 1), bm('b2', 'pup', 'beast', 1, 1), bm('b3', 'manasaber', 'beast', 4, 1),
      ],
      hand: [spell('s1', 'spiritfire')],
    };
    const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    s = reduce(s, { type: 'play', uid: 's1', targetUid: 'rm' });
    const after = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    expect(after - before, 'only Spirit Fire (+2/+3) should have landed').toBe(5);
  });
});

describe('set 2 — Dawnclaw', () => {
  it('is wired to the shared adjacent-Battlecry re-fire, now with the ONE-neighbour param (owner rework 2026-08-11)', () => {
    // Dawnclaw's Echo reuses `deathrattleReplayAdjacentBattlecry` — the SAME factory Ryme uses — but with
    // `params: { one: true }`, so the ungilded card re-fires exactly ONE neighbour's Shout (a seeded pick when
    // it has two), while golden fires BOTH. The shared factory's both/×2 behaviour (no `one`) is Ryme's, covered
    // in simulate.test.ts / rymeWayfinder.test.ts. What's new here is the card wiring, so that's what we pin.
    const dc = CARD_INDEX['b2_dawnclaw']!;
    expect([dc.tier, dc.attack, dc.health]).toEqual([4, 5, 3]);
    expect(dc.effects).toContainEqual({ on: 'onDeath', do: 'deathrattleReplayAdjacentBattlecry', params: { one: true } });
  });
});

describe('set 2 — Beast summon + aura cards', () => {
  it('Groveweaver: buffs a summoned Beast +3/+3, and a spell cast improves that grant by +2/+2', () => {
    // Summon path: play a Beast while Groveweaver is out → it lands with the grant folded in.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [bm('gw', 'b2_groveweaver', 'beast', 4, 8)],
      hand: [bm('n1', 'stray', 'beast', 1, 1), spell('sp', 'emberpouch'), bm('n2', 'pup', 'beast', 1, 1)],
    };
    s = reduce(s, { type: 'play', uid: 'n1' });
    const first = s.board.find((c) => c.uid === 'n1')!;
    expect([first.attack - 1, first.health - 1]).toEqual([3, 3]); // base grant (owner balance 2026-08-04: +3/+3)

    s = reduce(s, { type: 'play', uid: 'sp' }); // a cast improves the grant by +2/+2
    s = reduce(s, { type: 'play', uid: 'n2' });
    const second = s.board.find((c) => c.uid === 'n2')!;
    expect([second.attack - 1, second.health - 1]).toEqual([5, 5]); // improved by +2 on each stat
  });

  it('Denkeeper Oona / Solaris / T-Rex are wired with the expected stats + effects (Lancel removed 2026-08-02)', () => {
    // These reuse combat primitives already covered elsewhere (avengeShieldAttack, addTribeAura, the
    // fixed+goldenTokens summon shape), so the new surface is the card wiring.
    // Oona, final owner rebalance 2026-08-02: the flat buff AND the Avenge improve are cut — she is purely
    // the stat multiply now (one effect, no Avenge). Still an onSummon watcher, so no `SC` keyword.
    const oona = CARD_INDEX['b2_oona']!;
    expect([oona.tier, oona.attack, oona.health]).toEqual([5, 4, 6]);
    expect(oona.effects.map((e) => e.do)).toEqual(['onSummonTribeBuffThenDouble']);
    expect(oona.keywords).not.toContain('SC');

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

describe("Elderhorn's Hunt is RALLIES only (owner 2026-07-31)", () => {
  /**
   * The branch was narrowed from "Rallies and Slaughters" to "Rallies" in the card TEXT, but `beastHuntExtra`
   * was still read at the kill site too — so the card promised less than it did, which is the worse direction
   * for a card to be wrong in. Nothing covered the Slaughter half, so narrowing it broke no test; these are
   * the tests that should have caught it.
   */
  // NOTE: the RALLY half is not asserted here. An attack-path Rally emits no `sc` beat — only a FREE rally
  // (Rune of Rallying / the Hunting Bell) narrates — so there is no event to count, and a first cut of this test
  // "passed" by comparing 0 to 0. The install is covered by the Choose-One test above; what needed pinning was
  // the Slaughter half, which is what silently kept firing.
  it('does NOT double Beast SLAUGHTERS any more', () => {
    const slaughter = Object.values(CARD_INDEX).find((c) => c.tribe === 'beast' && !c.spell && !c.token
      && c.keywords.includes('SL') && c.effects.some((e) => e.on === 'onKill'));
    if (!slaughter) return;
    const count = (mods: Record<string, number>): number => {
      const p: BoardMinion[] = [{ cardId: slaughter.id, attack: 6, health: 40 }];
      const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }, { cardId: 'sandbag', attack: 0, health: 1 }];
      const r = simulate(p, e, makeRng(5), CARD_INDEX,
        combatSide({ tier: 6, tribes: ['beast'], ...mods } as never), combatSide());
      // Slaughter re-fires show as extra `sc` beats from the killer; count them all and compare.
      return r.events.filter((x) => x.type === 'sc').length;
    };
    expect(count({ beastHuntExtra: 1 }), 'Hunt is still doubling Slaughters').toBe(count({}));
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

describe('set 2 — King Oona (owner reworks 2026-07-25 / 2026-07-27 / attack-only 2026-08-12)', () => {
  it('a summoned Beast has its ATTACK doubled, with no flat buff first (owner 2026-08-12)', () => {
    // Mama Pup's 1/1 Pups: no grant, then Attack doubled → 2/1. Exactly ONE buff event, +1/+0 (the multiply on
    // Attack alone); a lingering +0/+0 grant event would mean the cut half is still firing.
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
    expect(gained.map((b) => [b.attack, b.health]), 'the Attack multiply only — the 1/1 Pup → 2/1')
      .toEqual([[1, 0]]);
  });

  it('does not touch a non-Beast summon', () => {
    const oona = CARD_INDEX['b2_oona']!;
    expect(oona.effects[0]!.params!.tribe).toBe('beast');
  });

  it('GILDED triples Attack instead of doubling (owner 2026-07-27 / attack-only 2026-08-12)', () => {
    // With the flat grant cut and the multiply now Attack-only, GILDED reads +2/+0 (the 1/1 Pup's Attack
    // tripling to 3, Health untouched), not +2/+2.
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
    expect(gained.map((b) => [b.attack, b.health]), "gilded TRIPLES Attack: +2/+0 on the 1/1 Pup")
      .toEqual([[2, 0]]);
  });
});

describe('set 2 — Scavvers (owner rework 2026-08-07: Echo triggers an adjacent Rally)', () => {
  it('wiring: T4 4/5, Echo effect in place, Ninja Pal machinery gone', () => {
    const d = CARD_INDEX['b2_scavenger']!;
    expect([d.tier, d.attack, d.health]).toEqual([4, 4, 5]);
    expect(d.effects.some((e) => e.do === 'deathrattleTriggerAdjacentRally')).toBe(true);
    expect(d.effects.some((e) => e.do === 'avengeSummonAttack')).toBe(false);
  });

  it('its Echo fires the neighbouring Rally in combat', () => {
    // Scavvers (1 hp, dies to the first hit) sits beside Crownvein Vanguard, whose Rally buffs its Rubies —
    // the cheapest observable Rally. The free-rally primitive narrates 'Rally', which is what we pin.
    const r = simulate(
      [
        { cardId: 'b2_scavenger', attack: 1, health: 1, sourceUid: 'SC' },
        { cardId: 'k_crownvein', attack: 4, health: 200, sourceUid: 'CV' },
      ],
      [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast', 'kobold'] }), combatSide({ tier: 1 }));
    expect(r.events.some((e) => e.type === 'sc' && e.text === 'Rally'), 'the adjacent Rally never fired').toBe(true);
  });
});

describe('set 2 — Menagerie Mammoth (owner rework 2026-08-12: Echo, summon 3 random other Beasts)', () => {
  it('wiring: T5 6/6, Echo summons random Beasts (the hand-caster is gone)', () => {
    const d = CARD_INDEX['b2_mammoth']!;
    expect([d.tier, d.attack, d.health]).toEqual([5, 7, 4]); // owner balance 2026-08-18
    const e = d.effects.find((x) => x.do === 'deathrattleSummonRandomTribe');
    expect(e, 'no random-Beast Echo wired').toBeDefined();
    expect(e!.on).toBe('onDeath');
    expect(e!.params).toMatchObject({ tribe: 'beast', count: 3, excludeSelf: true });
    expect(d.effects.some((x) => x.do === 'avengeCastRandomHandSpell'), 'old hand-caster gone').toBe(false);
  });

  // Only the Mammoth's OWN summons (a summoned Beast could cascade its own Echo); the event's `source` is the
  // summoner's uid.
  const summonedBy = (r: ReturnType<typeof simulate>, uid: string): string[] =>
    (r.events.filter((e) => e.type === 'summon' && (e as { source?: string }).source === uid) as { minion: { cardId: string } }[])
      .map((e) => e.minion.cardId);

  const mammothUid = (r: ReturnType<typeof simulate>): string =>
    r.initial.player.find((m) => m.cardId === 'b2_mammoth')!.uid;

  it('on death, summons 3 random Beasts — and never another Mammoth', () => {
    const r = simulate(
      [{ cardId: 'b2_mammoth', attack: 6, health: 1, sourceUid: 'MM' }],
      [{ cardId: 'sandbag', attack: 60, health: 40000 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast'] }), combatSide({ tier: 1 }));
    const summoned = summonedBy(r, mammothUid(r));
    expect(summoned.length, 'three bodies from the Mammoth').toBe(3);
    expect(summoned.every((id) => CARD_INDEX[id]?.tribe === 'beast' || CARD_INDEX[id]?.tribe2 === 'beast'), 'all Beasts').toBe(true);
    expect(summoned.includes('b2_mammoth'), 'never summons another Mammoth').toBe(false);
  });

  it('a GILDED Mammoth summons 6', () => {
    const r = simulate(
      [{ cardId: 'b2_mammoth', attack: 6, health: 1, sourceUid: 'MM', golden: true }],
      [{ cardId: 'sandbag', attack: 60, health: 40000 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast'] }), combatSide({ tier: 1 }));
    expect(summonedBy(r, mammothUid(r)).length).toBe(6);
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
    expect(got.some((b) => b.attack === 3 && b.health === 3), 'the summoned Pup got +3/+3').toBe(true);
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
    expect(got.some((b) => b.attack === 7 && b.health === 7), 'base +3/+3 plus two spells of accrual').toBe(true);
  });
});
