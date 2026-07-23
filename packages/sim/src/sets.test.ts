import { describe, it, expect } from 'vitest';
import { BUYABLE_CARDS, CARD_INDEX, SETS, activeSet, poolFor } from '@game/content';
import { createRun, deserialize, missingCardIds, serialize, type RunState } from './state';
import { poolOf, setIdOf } from './cardPool';
import { pickOpponent } from './opponents';
import { synthesizeWaveFromCurve } from './synthesize';
import { buildWaveLadders } from './rating';
import type { BoardSnapshot } from './snapshot';

/**
 * Card sets — the contract that lets set 2 be built in parallel and flipped live without disturbing set 1.
 *
 * The properties worth defending are all about ISOLATION and PINNING, not about any particular card list:
 * these must keep passing as both sets grow.
 */
describe('card sets — registry', () => {
  it('exactly one set is active, and it is the first enabled in declaration order', () => {
    const enabled = Object.values(SETS).filter((s) => s.enabled);
    expect(activeSet().id).toBe(enabled[0]?.id ?? 'set1');
    // Not an error to have several enabled — first wins — but it IS a footgun, so make it visible.
    expect(enabled.length, 'more than one set enabled: the later ones are silently dead').toBeLessThanOrEqual(1);
  });

  it("set 1's pool matches the flat pool the game shipped with (seeds keep replaying)", () => {
    // BUYABLE_CARDS is still assembled the old way; if set-1 resolution ever reorders or drops a card,
    // every existing seed's shop diverges. Order equality, not just membership.
    expect(poolFor('set1').buyable.map((c) => c.id)).toEqual(BUYABLE_CARDS.map((c) => c.id));
  });

  it('resolves inherits − excludes + own, in that order', () => {
    // Derived from the registry rather than hardcoded, so this keeps testing the RESOLUTION LOGIC as the
    // sets themselves change shape (set 2 started as a set-1 clone, then became empty-and-opt-in).
    for (const def of Object.values(SETS)) {
      const inherited = def.inherits
        ? poolFor(def.inherits).all.map((c) => c.id).filter((id) => !(def.excludes ?? []).includes(id))
        : [];
      const expected = [...inherited, ...def.own.map((c) => c.id)]
        .filter((id, i, arr) => arr.indexOf(id) === i); // first occurrence wins, order preserved
      expect(poolFor(def.id).all.map((c) => c.id), `${def.id} resolution`).toEqual(expected);
    }
  });

  it('the ACTIVE set is never empty — an empty set live means an empty shop', () => {
    // The footgun this guards: set 2 starts empty by design, so enabling it before its cards land would
    // ship a game with nothing to buy. Failing here is the intended way to find that out.
    expect(poolFor(activeSet().id).buyable.length,
      `the active set (${activeSet().id}) has no buyable minions`).toBeGreaterThan(0);
  });

  it('a set never contains the same card twice, even if it inherits and redeclares it', () => {
    for (const id of Object.keys(SETS) as (keyof typeof SETS)[]) {
      const ids = poolFor(id).all.map((c) => c.id);
      expect(new Set(ids).size, `${id} has duplicate ids`).toBe(ids.length);
    }
  });

  it('the DRAWABLE views never contain a token — that is what keeps rewards out of the shop', () => {
    // A set does carry its own reward-only tokens (Chorus Engine et al) in `all`; the point is that they
    // must never reach a draw site. This is the rule the old BUYABLE_CARDS/SPELL_CARDS filters enforced.
    for (const id of Object.keys(SETS) as (keyof typeof SETS)[]) {
      expect(poolFor(id).buyable.some((c) => c.token), `${id} buyable leaks a token`).toBe(false);
      expect(poolFor(id).spells.some((c) => c.token), `${id} spells leaks a token`).toBe(false);
    }
    // Token cards are declared wherever they belong thematically (Fodder sits in demons.ts, not tokens.ts),
    // so "is it a token" is a FLAG, not a file. What matters is that they resolve globally — a summon works
    // no matter which set is active — while never being drawable.
    expect(CARD_INDEX.fred).toBeDefined();
    expect(CARD_INDEX.fred!.token).toBe(true);
    expect(poolFor('set1').buyable.some((c) => c.id === 'fred')).toBe(false);
  });
});

describe('card sets — set 2 carries set 1 spells', () => {
  const DROPPED = ['lanternofsouls', 'undeadarmy', 'consume', 'foddertreatment'];

  it('set 2 offers the whole set-1 neutral spell toolkit except the tribe-locked few', () => {
    const s1 = new Set(poolFor('set1').spells.map((c) => c.id));
    const s2 = new Set(poolFor('set2').spells.map((c) => c.id));
    // Everything set 1 draws, minus the four that have no home in set 2, is present in set 2.
    for (const id of s1) {
      if (DROPPED.includes(id)) expect(s2.has(id), `${id} should be dropped from set 2`).toBe(false);
      else expect(s2.has(id), `${id} should carry into set 2`).toBe(true);
    }
    // ...and set 2 adds no NEW drawable spell set 1 lacks (the carryover is a subset of set 1's spells).
    for (const id of s2) expect(s1.has(id), `${id} is in set 2 but not set 1`).toBe(true);
  });

  it('a Discover in a set-2 run pulls only Kobolds (+ neutral), never a set-1 minion', () => {
    // The pool a Discover draws from is poolOf(run).buyable ∩ the run's tribes. A set-2 run's tribes are
    // Kobold-only, and set 2's buyable pool is Kobolds only — so no set-1 minion can ever surface.
    const run: RunState = { ...createRun(6, 'warden'), setId: 'set2', tribes: ['kobold'] };
    const buyable = poolOf(run).buyable.filter((c) => c.tribe === 'neutral' || run.tribes.includes(c.tribe));
    expect(buyable.length).toBeGreaterThan(0);
    expect(buyable.every((c) => c.tribe === 'kobold' || c.tribe2 === 'kobold')).toBe(true);
  });
});

describe('card sets — run pinning', () => {
  it('a new run pins the ACTIVE set', () => {
    expect(createRun(1, 'warden').setId).toBe(activeSet().id);
  });

  it('a run draws from the set it was PINNED to, not the one that is live now', () => {
    const run: RunState = { ...createRun(1, 'warden'), setId: 'set2' };
    expect(setIdOf(run)).toBe('set2');
    expect(poolOf(run).setId).toBe('set2');
  });

  it('a pre-sets save heals to set1 — NOT to whatever set is live', () => {
    // The regression this guards: `deserialize` merges over `createRun`, which pins the LIVE set. On the day
    // set 2 goes live that would silently re-home every in-progress run onto a pool it never played.
    const saved = createRun(7, 'warden');
    const legacy = JSON.parse(serialize(saved)) as Record<string, unknown>;
    delete legacy.setId; // exactly what a save written before sets looks like
    expect(deserialize(JSON.stringify(legacy)).setId).toBe('set1');
  });

  it('a save WITH a set keeps it through a round-trip', () => {
    const saved: RunState = { ...createRun(7, 'warden'), setId: 'set2' };
    expect(deserialize(serialize(saved)).setId).toBe('set2');
  });
});

describe('card sets — opponent boards', () => {
  const board = (setId: string | undefined, wave = 3): BoardSnapshot => ({
    v: 1, wave, heroId: 'warden', resolve: 30, tier: 2, triples: 0, tribes: [], threat: 'glass', power: 4,
    minions: [{ cardId: 'alley', attack: 2, health: 2, keywords: [] }], seed: 1, origin: 'synthetic',
    ...(setId ? { setId: setId as 'set1' } : {}),
  } as BoardSnapshot);

  it('never serves a board built under a different set', () => {
    const pool = [board('set2'), board('set2')];
    expect(pickOpponent(3, 4, { int: () => 0, next: () => 0 } as never, pool, new Set(), 0, 'set1')).toBeNull();
  });

  it('treats a board with no set as set 1 (every board predating sets was set 1)', () => {
    const pool = [board(undefined)];
    expect(pickOpponent(3, 4, { int: () => 0, next: () => 0 } as never, pool, new Set(), 0, 'set1')).not.toBeNull();
    expect(pickOpponent(3, 4, { int: () => 0, next: () => 0 } as never, pool, new Set(), 0, 'set2')).toBeNull();
  });
});

describe('card sets — save integrity', () => {
  it('reports card ids this build no longer has, instead of crashing later', () => {
    const run: RunState = { ...createRun(1, 'warden'),
      board: [{ uid: 'a', cardId: 'nope_deleted', tribe: 'mech', attack: 1, health: 1, keywords: [], golden: false }] };
    expect(missingCardIds(run)).toEqual(['nope_deleted']);
  });

  it('is clean for a normal run', () => {
    expect(missingCardIds(createRun(3, 'warden'))).toEqual([]);
  });
});

describe('card sets — synthesized boards carry their set', () => {
  // The bug this guards against, found while wiring the bake: `setId` was threaded into card SELECTION but
  // not stamped on the emitted board. A set-2 bake would then emit unstamped boards, which default to set1
  // at pick time and get served into set-1 runs — made of cards that run cannot have.
  const ladders = buildWaveLadders([], [], [], { proceduralWaves: 3, proceduralSeeds: 2 });

  it('stamps the set it built from', () => {
    // set 2 ships empty, so build the case out of set 1's cards and assert the STAMP, which is the property
    // under test. (The empty-set path is covered below.)
    const boards = synthesizeWaveFromCurve(2, ladders, 99, { perWave: 3, proceduralSeeds: 2, setId: 'set1' });
    expect(boards.length).toBeGreaterThan(0);
    expect(boards.every((b) => b.setId === 'set1')).toBe(true);
  });

  it('refuses to bake a set that is not ready to synthesize (empty, or too sparse to cover the curve)', () => {
    // Baking a half-built set is the normal state while authoring one. A TRULY empty set is caught with a
    // named message (`has no buyable minions`); set 2 now holds a few Kobolds but is still far too sparse —
    // a single low-tier tribe can't fill the enemy curve — so the bake must still FAIL rather than emit
    // garbage boards. (When set 2's pool is real, this test's set moves to a genuinely-empty fixture.)
    expect(() => synthesizeWaveFromCurve(2, ladders, 99, { perWave: 3, proceduralSeeds: 2, setId: 'set2' })).toThrow();
  });

  it('defaults to set1 when unspecified, so existing bakes keep their meaning', () => {
    const boards = synthesizeWaveFromCurve(2, ladders, 99, { perWave: 3, proceduralSeeds: 2 });
    expect(boards.every((b) => b.setId === 'set1')).toBe(true);
  });
});
