import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, rollableWhisperIds, simulate, whisperOwners, type BoardMinion, type CardDef } from '@game/core';
import { ARCHIVED_CARDS, CARD_INDEX, WHISPER_IDS, WHISPER_TIERS, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type BoardSnapshot, type RunState } from './index';
import { mintRandomWhispers, rollableWhispersFor } from './recruit';

/**
 * R-WHISPER-TIER-01 (owner 2026-10-16): "whispers should be the tier of the unit they came from, so you should only be
 * able to get whispers from your tier etc from sources like jar of secrets or woozy." Corrected: "if you somehow have a
 * t5 whisper unit on your board and you're t4, the t5 whisper minion still grants its whisper. it's just that from
 * sources like echo/avenge/spell/equipment should abide by player tier."
 */

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const run = (tier: number, over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, undefined, 'ascent', undefined, 'set3'), phase: 'recruit', embers: 40, tier, hand: [], board: [], ...over } as RunState);
const whispersIn = (s: RunState): string[] => s.hand.filter((c) => CARD_INDEX[c.cardId]?.whisper).map((c) => c.cardId);
const tierOf = (id: string): number => CARD_INDEX[id]!.tier;
/** Falx was archived 2026-10-27 (owner), so its Whisper Ripple has no LIVE owner: Tier 1 by the no-owner rule, and never
 *  rolled by a set-scoped source (its only owner is in no set). Every other Whisper still has a live owner. */
const ARCHIVED = new Set(ARCHIVED_CARDS.map((c) => c.id));
// CueBee's Pass (Duos, R-DUOS-CARDS-05): its owner is only in a DUOS pool, so a plain set 3 run never rolls it.
const ROLLABLE = WHISPER_IDS.filter((id) => id !== 'w3_ripple' && id !== 'duo_w_pass');
const quiet: BoardSnapshot = { v: 1, wave: 1, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: 'sandbag', attack: 0, health: 300, keywords: [] }], seed: 1, origin: 'self' };
const nextTurn = (s: RunState): RunState => {
  const served = { ...s, servedBoards: { ...(s.servedBoards ?? {}), [s.wave]: { ...quiet, wave: s.wave } } } as RunState;
  const after = act(act(act(served, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
  return { ...after, runeforgeOffer: undefined } as RunState;
};

/** Every Jar of Secrets roll over many seeds at this shop tier (the shared Shop roll, 3 Whispers a use). */
function jarRolls(tier: number, seeds = 120): Set<string> {
  const seen = new Set<string>();
  for (let seed = 1; seed <= seeds; seed++) {
    const s = run(tier, { rngCursor: seed * 7919 });
    mintRandomWhispers(s, 3);
    for (const id of whispersIn(s)) seen.add(id);
  }
  return seen;
}

/** Every Whisper a Woozy Avenge hands out over many seeds at this side tier (3 friendly deaths = 2 Whispers). */
const m = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health, keywords: [...CARD_INDEX[cardId]!.keywords], ...over } as unknown as BoardMinion);
const wall = (): BoardMinion[] => [{ cardId: 'sandbag', attack: 5, health: 5000, keywords: [] } as unknown as BoardMinion];
function woozyRolls(tier: number, cards: Record<string, CardDef> = CARD_INDEX, seeds = 60): string[] {
  const out: string[] = [];
  const poolIds = poolFor('set3').all.map((c) => c.id);
  for (let seed = 1; seed <= seeds; seed++) {
    const r = simulate(
      [m('d3_woozy', { attack: 0, health: 5000 }), m('venom', { health: 1, keywords: [] }), m('venom', { health: 1, keywords: [] }), m('venom', { health: 1, keywords: [] })],
      wall(), makeRng(seed), cards, combatSide({ tier, poolIds }), combatSide({ tier: 6 }),
    );
    out.push(...(r.playerHandGrants ?? []).filter((id) => cards[id]?.whisper));
  }
  return out;
}

describe('R-WHISPER-TIER-01: every Whisper has the tier of the Whisper minion that owns it', () => {
  it('exhaustive: every Whisper has an owning minion, and its tier is the LOWEST owner tier (derived, never hand-typed)', () => {
    const owners = whisperOwners(CARD_INDEX);
    const whispers = Object.values(CARD_INDEX).filter((c) => c.whisper);
    expect(whispers.map((c) => c.id)).toEqual([...WHISPER_IDS]);
    for (const w of whispers) {
      const o = (owners.get(w.id) ?? []).filter((id) => !ARCHIVED.has(id));
      if (w.id === 'w3_ripple') {
        expect(o, 'Ripple: its only owner (Falx) is archived').toEqual([]);
        expect(w.tier).toBe(1);
        continue;
      }
      expect(o.length, `${w.id} has an owning Whisper minion`).toBeGreaterThan(0);
      const want = Math.min(...o.map((id) => CARD_INDEX[id]!.tier));
      expect(w.tier, w.id).toBe(want);
      expect(WHISPER_TIERS[w.id], w.id).toBe(want);
      expect(w.tier >= 1 && w.tier <= 7, w.id).toBe(true);
    }
  });

  it('the table the owner was shown', () => {
    const table = Object.fromEntries(WHISPER_IDS.map((id) => [id, tierOf(id)]));
    expect(table).toEqual({
      // Ripple: 1 since Falx was archived (2026-10-27); Warding Call: 4 since Whispwarder moved to Tier 4 (2026-10-27).
      w4_tome: 1, w4_runebind: 2, w3_ripple: 1, w3_wellofdragons: 5, w3_seed: 1, w3_bait: 2, w3_clutch: 4, w3_wardingcall: 4,
      duo_w_pass: 4, // CueBee's Pass (Duos, 2026-10-30): CueBee is Tier 4
    });
  });
});

describe('R-WHISPER-TIER-01: Jar of Secrets rolls Whispers of your shop tier and below', () => {
  it('at shop tier 1 a real Equipment use only gives tier-1 Whispers', () => {
    for (let seed = 1; seed <= 25; seed++) {
      let s = act(run(1, { rngCursor: seed * 104729, hand: [bc('s', 'd3_shush')] }), { type: 'play', uid: 's', toIndex: 0 } as Action);
      s = act(s, { type: 'activateEquipment' } as Action);
      const got = whispersIn(s);
      expect(got).toHaveLength(3);
      for (const id of got) expect(tierOf(id), id).toBe(1);
    }
  });

  it('at tier 1 the pool is exactly the tier-1 Whispers; at tier 3 it is tier 1 to 3, and every one of them rolls', () => {
    const t1 = jarRolls(1);
    expect([...t1].sort()).toEqual(['w3_seed', 'w4_tome']);
    const t3 = jarRolls(3);
    for (const id of t3) expect(tierOf(id), id).toBeLessThanOrEqual(3);
    expect([...t3].sort()).toEqual(['w3_bait', 'w3_seed', 'w4_runebind', 'w4_tome']);
    expect([...jarRolls(6)].sort()).toEqual([...ROLLABLE].sort());
  });

  it('the pool is the run\'s pinned set: a set with no Whisper Dragons rolls nothing', () => {
    expect(rollableWhispersFor(run(6))).toEqual([...ROLLABLE]);
    const set2 = { ...run(6), setId: 'set2' } as RunState;
    expect(rollableWhispersFor(set2)).toEqual([]);
    mintRandomWhispers(set2, 3);
    expect(whispersIn(set2)).toEqual([]);
  });

  it('deterministic: the same seed rolls the same Whispers', () => {
    const roll = (): string[] => { const s = run(4, { rngCursor: 4242 }); mintRandomWhispers(s, 3); return whispersIn(s); };
    expect(roll()).toEqual(roll());
  });
});

describe('R-WHISPER-TIER-01: Woozy (Avenge, combat) is gated the same way', () => {
  it('at tier 1 every Woozy Whisper is tier 1; at tier 3, tier 1 to 3', () => {
    const t1 = woozyRolls(1);
    expect(t1.length).toBeGreaterThan(0);
    for (const id of t1) expect(tierOf(id), id).toBe(1);
    const t3 = woozyRolls(3);
    for (const id of t3) expect(tierOf(id), id).toBeLessThanOrEqual(3);
    expect(t3.some((id) => tierOf(id) > 1), 'a tier 2 Whisper can roll at tier 3').toBe(true);
  });
});

describe('R-WHISPER-TIER-01: a tier-6 Whisper never rolls at tier 5', () => {
  // No live Whisper is owned by a Tier 6 minion today, so the boundary is pinned on a synthetic Tier 6 owner + Whisper.
  const owner: CardDef = { ...CARD_INDEX['d3_falx']!, id: 'zz_t6owner', tier: 6, effects: [{ on: 'startOfTurn', do: 'grantWhisper', params: { cardId: 'zz_t6whisper' } }] };
  const whisper: CardDef = { ...CARD_INDEX['w4_tome']!, id: 'zz_t6whisper', name: 'Six', tier: 6 };
  const cards: Record<string, CardDef> = { ...CARD_INDEX, [owner.id]: owner, [whisper.id]: whisper };

  it('the shared roll pool excludes it at tier 5 and includes it at tier 6', () => {
    expect(rollableWhisperIds(cards, 5)).not.toContain('zz_t6whisper');
    expect(rollableWhisperIds(cards, 6)).toContain('zz_t6whisper');
    // Set-scoped: its owner is not in Set 3, so a Set 3 run never rolls it even at tier 6.
    const set3 = new Set(poolFor('set3').all.map((c) => c.id));
    expect(rollableWhisperIds(cards, 6, (id) => set3.has(id))).not.toContain('zz_t6whisper');
  });

  it('a combat Woozy at tier 5 never hands it out (unrestricted pool, so only the tier gate stands in the way)', () => {
    const got: string[] = [];
    for (let seed = 1; seed <= 80; seed++) {
      const r = simulate(
        [m('d3_woozy', { attack: 0, health: 5000 }), m('venom', { health: 1, keywords: [] }), m('venom', { health: 1, keywords: [] }), m('venom', { health: 1, keywords: [] })],
        wall(), makeRng(seed), cards, combatSide({ tier: 5 }), combatSide({ tier: 6 }),
      );
      got.push(...(r.playerHandGrants ?? []));
    }
    expect(got.length).toBeGreaterThan(0);
    expect(got).not.toContain('zz_t6whisper');
    for (const id of got) if (cards[id]?.whisper) expect(cards[id]!.tier).toBeLessThanOrEqual(5);
  });
});

describe('R-WHISPER-TIER-01: a Whisper minion granting its OWN Whisper is never gated', () => {
  // Falx (the original subject) was archived 2026-10-27; Well Watcher is the Tier 5 owner now.
  it('a Tier 5 Well Watcher on a Tier 4 board grants Well of Dragons (played from hand and at Start of Turn); Jar of Secrets at Tier 4 never gives it', () => {
    expect(tierOf('w3_wellofdragons')).toBe(5);
    let s = act(run(4, { hand: [bc('f', 'd3_wellwatcher')] }), { type: 'play', uid: 'f', toIndex: 0 } as Action);
    expect(whispersIn(s), 'played from hand at Tier 4').toEqual(['w3_wellofdragons']);
    // Start of Turn: hand it over again (the shared Start-of-Turn path, through a fresh turn).
    s = nextTurn({ ...s, hand: [] } as RunState);
    expect(s.tier, 'still Tier 4 next turn').toBe(4);
    expect(s.board.some((c) => c.cardId === 'd3_wellwatcher')).toBe(true);
    expect(whispersIn(s), 'Start of Turn at Tier 4').toContain('w3_wellofdragons');
    // Jar at Tier 4: never a Tier 5 Whisper (and never Ripple, whose only owner is archived).
    const jar = jarRolls(4, 200);
    for (const id of ['w3_ripple', 'w3_wellofdragons']) expect(jar.has(id), id).toBe(false);
    expect(jar.has('w3_clutch') && jar.has('w3_wardingcall'), 'Tier 4 Whispers still roll at Tier 4').toBe(true);
  });

  it('Tamby is EXEMPT (owner on #2111): a Tier 4 Warding Call cast on Tamby at Tier 3 is still copied', () => {
    for (const [tier, copies] of [[3, 1], [4, 1]] as const) {
      let s = run(tier, { board: [bc('t', 'd4_tamby')] });
      // Warding Call (Tier 4 since 2026-10-27, owned by Whispwarder): Ripple would need a Shout target, and Tamby has none.
      s = { ...s, hand: [{ uid: 'r', cardId: 'w3_wardingcall', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] } as RunState;
      s = act(s, { type: 'play', uid: 'r', targetUid: 't' } as Action);
      expect(whispersIn(s).filter((id) => id === 'w3_wardingcall'), `tier ${tier}`).toHaveLength(copies);
    }
  });

  it('Tamby is EXEMPT in combat too: a Runebind (Tier 2) Whaloo casts on Tamby at Tier 1 is still copied', () => {
    const r = simulate([m('d4_tamby', { health: 5000 }), m('d3_whaloo', { attack: 0, health: 5000 })], wall(), makeRng(3), CARD_INDEX, combatSide({ tier: 1 }), combatSide({ tier: 6 }));
    expect(tierOf('w4_runebind')).toBe(2);
    expect(r.playerHandGrants ?? []).toContain('w4_runebind');
  });
});
