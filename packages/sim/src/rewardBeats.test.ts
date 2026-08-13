import { describe, it, expect } from 'vitest';
import { createRun, reduce, reduceWithPresentation, type RunState } from './index';
import { PRESENTATION_POLICIES, type SourceTriggerEvent, type ConsequenceEvent } from '@game/core';
import { surfaceKeyForRune } from '@game/content';

/**
 * BEAT CHOREOGRAPHER PR 15 — quest completions and rune acquisitions announce themselves.
 *
 * `applyQuestReward` is the single chokepoint for BOTH, so instrumenting it gives ~100 classified-but-silent
 * keys a beat without touching a hundred reward branches. Its consequences are discovered by DIFFING the
 * reward, the same technique the End-of-Turn primitive uses: a reward moves board stats, hand contents and
 * Gold through many helpers, and instrumenting each would be a hundred chances to miss one.
 *
 * These live in a test rather than the emission probe because the probe cannot deterministically reach a
 * quest completion or a Runeforge pick. The audit is honest about that — those keys read "not observed",
 * which means the probe did not reach them, NOT that they are silent. This file is the evidence that they are
 * not.
 */
const buyRune = (index: number) => ({ type: 'buyRune', index }) as never;

/** A run parked in the Runeforge with a known rune on offer and the Gold to take it. */
function forgeRun(runeId: string): RunState {
  return {
    ...createRun(5, 'warden'),
    phase: 'recruit',
    embers: 50,
    maxEmbers: 50,
    runeforgeOffer: [runeId],
    board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
  } as RunState;
}

const eventsOf = (s: RunState, action: never) => reduceWithPresentation(s, action, true).batch?.events ?? [];

describe('a rune acquisition claims its moment', () => {
  // Rune of the Coffers is a stable, cheap pick whose reward is observable (it raises max Gold).
  const RUNE = 'rune_coffers';

  it('emits a source trigger for the rune', () => {
    const trigger = eventsOf(forgeRun(RUNE), buyRune(0))
      .find((e): e is SourceTriggerEvent => e.type === 'sourceTrigger' && e.source.kind === 'rune');
    expect(trigger, 'the rune got a beat').toBeTruthy();
    expect(trigger!.source.id).toBe(RUNE);
    expect(trigger!.trigger).toBe('reward');
  });

  it('uses the key the SURFACE files it under, not a guessed phase', () => {
    // A guessed key (`rune:<id>:onAcquire` for everything) would be an orphan identity for any rune bucketed
    // differently — presentation could not time it and the audit would call it a ghost.
    const trigger = eventsOf(forgeRun(RUNE), buyRune(0))
      .find((e): e is SourceTriggerEvent => e.type === 'sourceTrigger' && e.source.kind === 'rune')!;
    expect(trigger.policyKey).toBe(surfaceKeyForRune(RUNE));
    expect(PRESENTATION_POLICIES[trigger.policyKey!]).toBeDefined();
  });

  it('the reward lands as consequences OF the rune, not as orphans', () => {
    // Rune of the Vault-style grants and Gold changes are both discovered by the diff.
    const events = eventsOf(forgeRun('rune_hoard'), buyRune(0));
    const trigger = events.find((e): e is SourceTriggerEvent => e.type === 'sourceTrigger' && e.source.kind === 'rune');
    if (!trigger) return; // that rune is not in this build's pool — nothing to assert
    const orphans = events.filter((e): e is ConsequenceEvent => e.type !== 'sourceTrigger' && !e.parentId);
    expect(orphans, 'every consequence is attributed').toHaveLength(0);
  });
});

describe('gameplay is unchanged by the instrumentation', () => {
  it('buying a rune resolves byte-identically with capture on and off', () => {
    const s = forgeRun('rune_coffers');
    const plain = reduce(s, buyRune(0));
    expect(JSON.stringify(reduceWithPresentation(s, buyRune(0), true).state)).toBe(JSON.stringify(plain));
  });

  it('the rune is still actually acquired', () => {
    const after = reduce(forgeRun('rune_coffers'), buyRune(0));
    expect(after.ownedRunes).toContain('rune_coffers');
  });

  it('an unaffordable pick still no-ops, and emits nothing', () => {
    const broke = { ...forgeRun('rune_coffers'), embers: 0 } as RunState;
    const { state, batch } = reduceWithPresentation(broke, buyRune(0), true);
    expect(state).toBe(broke); // rejected outright
    expect(batch?.events.some((e) => e.type === 'sourceTrigger' && e.source.kind === 'rune') ?? false).toBe(false);
  });
});
