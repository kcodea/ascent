import { describe, it, expect } from 'vitest';
import { BUYABLE_CARDS, CARD_INDEX, SETS, activeSet, poolFor } from '@game/content';
import { createRun, deserialize, missingCardIds, serialize, type RunState } from './state';
import { poolOf, setIdOf } from './cardPool';
import { pickOpponent } from './opponents';
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
    const base = poolFor('set1').all.map((c) => c.id);
    // set 2 currently inherits set 1 wholesale, so it should be a prefix-preserving superset.
    const two = poolFor('set2').all.map((c) => c.id);
    const excluded = new Set(SETS.set2.excludes ?? []);
    expect(two.slice(0, base.length - excluded.size)).toEqual(base.filter((id) => !excluded.has(id)));
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
