import { describe, it, expect } from 'vitest';
import { createRun, reduce, reduceWithPresentation, type RunState } from './index';
import { PRESENTATION_POLICIES, type SourceTriggerEvent } from '@game/core';
import { recurringEotOwner } from '@game/content';

/**
 * CHOREOGRAPHER PR 1 — EVENT IDENTITY HARDENING (blueprint §7, §21 PR 1, §25 "deriving families from source
 * card ID").
 *
 * The trap this closes: presentation reconstructing an effect's identity from its DISPLAY source id. A minion's
 * card id is not its factory id, so the timing chain silently falls through to a global default and the beat is
 * mistimed with no error anywhere. Identity must be stamped by the gameplay code that actually knows it.
 *
 * The invariants, in order of how badly they bite:
 *   1. Instrumentation still cannot change gameplay (the standing equivalence guarantee).
 *   2. Every emitted source trigger carries a `policyKey` that EXISTS in the registry — no orphan identities.
 *   3. `family` and `policy` on the event AGREE with that registry row — one source of truth, not two.
 *   4. Identity is deterministic across identical resolutions.
 */
const faceOmen = { type: 'faceOmen' } as never;

/** A recruit state at End of Turn with real emitting content armed (mirrors `beatEotEvents.test.ts`). */
function seeded(seed: number): RunState {
  const run = createRun(seed, 'warden');
  return {
    ...run,
    phase: 'recruit',
    board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    runeCoffers: true,
    runeShopkeep: true,
    runeLapidary: true,
    runeCrucibleChoir: true,
    upgradeCost: 9,
  } as RunState;
}

const triggers = (s: RunState): SourceTriggerEvent[] =>
  ((reduceWithPresentation(s, faceOmen, true).batch?.events ?? []).filter(
    (e): e is SourceTriggerEvent => e.type === 'sourceTrigger',
  ));

describe('event identity — gameplay is untouched', () => {
  it('capturing identity does not change the resolved state', () => {
    const s = seeded(4242);
    const plain = reduce(s, faceOmen);
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, true).state)).toBe(JSON.stringify(plain));
  });
});

describe('event identity — every emitted beat is registry-anchored', () => {
  const seeds = [11, 4242, 90210, 777];

  it('emits at least one identified End-of-Turn trigger across the sample', () => {
    const all = seeds.flatMap((seed) => triggers(seeded(seed)));
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((t) => t.policyKey)).toBe(true);
  });

  it('every emitted policyKey exists in the registry (no orphan identities)', () => {
    for (const seed of seeds) {
      for (const t of triggers(seeded(seed))) {
        if (!t.policyKey) continue; // un-migrated emitters are honest-absent, never guessed
        expect(PRESENTATION_POLICIES[t.policyKey], `${t.policyKey} (${t.source.kind}:${t.source.id})`).toBeDefined();
      }
    }
  });

  it('the event\'s family and policy AGREE with its registry row', () => {
    for (const seed of seeds) {
      for (const t of triggers(seeded(seed))) {
        const entry = t.policyKey ? PRESENTATION_POLICIES[t.policyKey] : undefined;
        if (!entry) continue;
        expect(t.family, t.policyKey).toBe(entry.family);
        expect(t.policy, t.policyKey).toBe(entry.policy);
      }
    }
  });

  it('identity is deterministic — the same resolution stamps the same keys', () => {
    const s = seeded(4242);
    const a = triggers(s).map((t) => `${t.policyKey}|${t.family}|${t.source.kind}:${t.source.id}`);
    const b = triggers(s).map((t) => `${t.policyKey}|${t.family}|${t.source.kind}:${t.source.id}`);
    expect(a).toEqual(b);
  });
});

describe('recurring End-of-Turn effects resolve their OWNING rune/quest', () => {
  // These were all emitted as `kind: 'rune'` with the bare effect name as the id — so the quests among them
  // were mis-grouped in the library and none of them could name a registry row.
  it('maps flag-armed rune recurrences to their rune', () => {
    expect(recurringEotOwner('runeLapidary')).toEqual({ key: 'rune:rune_lapidary:endOfTurn', kind: 'rune', id: 'rune_lapidary' });
  });

  it('maps a quest-granted recurrence to the QUEST that granted it', () => {
    const owner = recurringEotOwner('triggerLeftmostShout'); // Echoing Roar
    expect(owner?.kind).toBe('quest');
    expect(owner?.key).toMatch(/^quest:/);
  });

  it('every owner it resolves points at a real registry row', () => {
    for (const effect of ['runeLapidary', 'runeCrucibleChoir', 'triggerLeftmostShout', 'runeSpending', 'runeAction', 'quickStudy']) {
      const owner = recurringEotOwner(effect);
      if (!owner) continue;
      expect(PRESENTATION_POLICIES[owner.key], `${effect} → ${owner.key}`).toBeDefined();
    }
  });
});
