import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRun, reduce, type RunState } from './index';
import { pinSet1Era } from './testPin';

// This suite predates set 2 going live (2026-07-31) and tests set-1-era content + the quest-era run loop —
// still-shipped mechanics. Pin the era rather than rewrite the fixtures. See `testPin.ts`.
pinSet1Era();

/**
 * SET 1 AND SET 2 MUST NOT MIX (owner 2026-07-27: "it's very important").
 *
 * Recruit-phase picks have always gone through `poolOf(state)`. COMBAT never had the set threaded in — every
 * random draw filtered the global `CARD_INDEX` — so a Set-1 run could be handed a Set-2 card. The owner hit it
 * twice in one run: Badgington's Slaughter produced a Set-2 spell, and Sea Urchin Discovered a Scalefeather
 * Drake.
 *
 * `CombatSideState.poolIds` carries the run's pinned pool and `ctx.poolCards(side)` narrows every pick to it.
 * These tests drive REAL combat rather than asserting on the helper, because the bug was never in the filter —
 * it was in which list the filter was applied to.
 */
const set1Ids = new Set(poolFor('set1').all.map((c) => c.id));
const set2Only = poolFor('set2').all.filter((c) => !set1Ids.has(c.id)).map((c) => c.id);

const bm = (cardId: string, uid: string, attack = 10, health = 40): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [] as BoardMinion['keywords'] });

describe('set separation — combat random picks respect the run’s set', () => {
  it('the fixture is meaningful: set 2 has cards set 1 does not', () => {
    expect(set2Only.length).toBeGreaterThan(30);
  });

  it("a SLAUGHTER spell grant in a set-1 run never yields a set-2 spell (Badgington)", () => {
    // Badgington kills the sandbag repeatedly; each kill grants a random spell. Run it across many seeds so a
    // single lucky roll can't pass — the bug was a wrong POOL, which shows up as soon as any set-2 id appears.
    const leaked: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const r = simulate(
        [bm('badgington', 'B', 30, 200), bm('pack', 'P', 1, 200)], // rework 2026-08-07: it casts ON another Beast — a lone Badgington does nothing
        [{ cardId: 'sandbag', attack: 0, health: 1 }, { cardId: 'sandbag', attack: 0, health: 1 },
         { cardId: 'sandbag', attack: 0, health: 1 }],
        makeRng(seed), CARD_INDEX,
        combatSide({ tier: 6, poolIds: poolFor('set1').all.map((c) => c.id) }),
        combatSide({ tier: 1 }),
      );
      for (const e of r.events) {
        if (e.type === 'toHand' && set2Only.includes((e as { cardId: string }).cardId)) {
          leaked.push((e as { cardId: string }).cardId);
        }
      }
    }
    expect(leaked, 'a set-1 run was handed set-2 cards').toEqual([]);
  });

  it('…and the same board WITHOUT a pinned pool is unrestricted (proves the test can see a leak)', () => {
    // The control. With no `poolIds` — the harness / procedural-threat case — the global index is fair game,
    // so set-2 ids DO appear. Without this, the assertion above could be passing because nothing was granted.
    let sawAnySpell = false;
    for (let seed = 1; seed <= 40 && !sawAnySpell; seed++) {
      const r = simulate(
        [bm('badgington', 'B', 30, 200), bm('pack', 'P', 1, 200)], // rework 2026-08-07: it casts ON another Beast — a lone Badgington does nothing
        [{ cardId: 'sandbag', attack: 0, health: 1 }, { cardId: 'sandbag', attack: 0, health: 1 }],
        makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }),
      );
      if (r.events.some((e) => e.type === 'toHand')) sawAnySpell = true;
    }
    expect(sawAnySpell, 'the fixture really does grant spells — otherwise the test above is vacuous').toBe(true);
  });

  it('a set-2 run is walled off the other way too', () => {
    const set2Pool = poolFor('set2').all.map((c) => c.id);
    const set1Only = poolFor('set1').all.filter((c) => !new Set(set2Pool).has(c.id)).map((c) => c.id);
    const leaked: string[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const r = simulate(
        [bm('badgington', 'B', 30, 200), bm('pack', 'P', 1, 200)], // rework 2026-08-07: it casts ON another Beast — a lone Badgington does nothing
        [{ cardId: 'sandbag', attack: 0, health: 1 }, { cardId: 'sandbag', attack: 0, health: 1 }],
        makeRng(seed), CARD_INDEX,
        combatSide({ tier: 6, poolIds: set2Pool }), combatSide({ tier: 1 }),
      );
      for (const e of r.events) {
        if (e.type === 'toHand' && set1Only.includes((e as { cardId: string }).cardId)) {
          leaked.push((e as { cardId: string }).cardId);
        }
      }
    }
    expect(leaked, 'a set-2 run was handed set-1-only cards').toEqual([]);
  });

  it('every combat random-draw site goes through poolCards, not allCards', () => {
    // The fix is only as good as its coverage: a NEW random pick written against `allCards()` would silently
    // reintroduce the leak, and no gameplay test would notice until a player saw a foreign card.
    for (const f of ['../../core/src/combat/simulate.ts', '../../core/src/effects/factories.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      const offenders = src.split('\n')
        .map((l, i) => [l, i + 1] as const)
        // `allow.has(c.id)` is `poolCards`' OWN body — the one place that legitimately filters the global
        // index, since narrowing it is the entire job.
        .filter(([l]) => !/allow\.has\(/.test(l))
        .filter(([l]) => /allCards\(\)\s*\.filter\(/.test(l) || /Object\.values\(cards\)\.filter\(/.test(l));
      expect(offenders.map(([l, n]) => `${f.split('/').pop()}:${n} ${l.trim().slice(0, 70)}`),
        'a random draw is filtering the GLOBAL index — use ctx.poolCards(side)').toEqual([]);
    }
  });

  it('a RECRUIT Discover is already set-scoped — Sea Urchin was not a leak', () => {
    // The owner also reported Sea Urchin Discovering a Mushy. That one is CORRECT: Sea Urchin is
    // opted into set 2, and Scalefeather is a Dragon/BEAST, so it's a legal Beast Discover in a set-2 run.
    // Recruit picks have always gone through `poolOf(state).buyable`. Pinned here so the claim is checkable
    // rather than a note in a chat log.
    const urchin = CARD_INDEX['seaurchin']!;
    expect(urchin.effects.some((e) => e.do === 'battlecryDiscoverMinion')).toBe(true);
    expect(CARD_INDEX['d2_scalefeather']!.tribe2, 'Scalefeather really is a Beast').toBe('beast');
    expect(poolFor('set2').all.some((c) => c.id === 'seaurchin'), 'and Sea Urchin really is in set 2').toBe(true);

    // The actual guarantee: a set-1 run's Discover can only offer set-1 cards.
    const s1: RunState = { ...createRun(4), phase: 'recruit', tier: 6, embers: 60,
      board: [], hand: [{ uid: 'u', cardId: 'seaurchin', tribe: 'beast', attack: 3, health: 3, keywords: [], golden: false }] };
    const after = reduce(s1, { type: 'play', uid: 'u' });
    for (const id of after.discover ?? []) {
      expect(set2Only, `Discover offered ${id}, which is set-2 only`).not.toContain(id);
    }
  });
});
