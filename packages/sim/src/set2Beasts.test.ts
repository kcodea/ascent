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
