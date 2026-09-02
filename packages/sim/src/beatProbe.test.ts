import { describe, it, expect } from 'vitest';
import { probeEmission, defaultScenarios, allScenarios, cardScenarios, shoutScenarios } from './beatProbe';
import { PRESENTATION_POLICIES } from '@game/core';

/**
 * BEAT CHOREOGRAPHER PR 13 — the emission probe.
 *
 * The audit could always answer "is this effect classified?". It could never answer "does gameplay ANNOUNCE
 * it?" — which is the difference between a green report and a screen where nothing happens. The probe answers
 * the second question with evidence: it runs real scenarios and collects what was actually emitted.
 *
 * The property that matters most here is that the probe cannot LIE in either direction — it must not report
 * emission that did not happen, and it must not let one scenario's leftovers make another look instrumented.
 */
describe('the probe reports what gameplay really emitted', () => {
  const result = probeEmission();

  it('observes the mechanics its scenarios target', () => {
    expect(result.observed.get('rune:rune_coffers:endOfTurn'), 'Coffers emits').toBeTruthy();
    expect(result.observed.get('system:startOfCombat:fleetingVigor'), 'Fleeting Vigor emits').toBeTruthy();
    expect(result.observed.get('hero:repete:secondHand'), 'Re-Pete emits').toBeTruthy();
    // Rune of the Reliquary — classified for weeks and never observed until 2026-09-01 (the owner saw nothing
    // on screen). Two Echoes on the probe board → two minion-sourced beats, each with its summons + echoFired.
    const reliquary = result.observed.get('rune:rune_reliquary:endOfTurn');
    expect(reliquary, 'the Reliquary emits').toBeTruthy();
    expect(reliquary!.consequences, 'and its beats carry the Echo consequences').toBeGreaterThan(0);
  });

  it('records how many consequences each beat carried', () => {
    // A beat that claims a moment and delivers nothing is a real (if lesser) problem, so the count is kept
    // rather than flattened to a boolean.
    const vigor = result.observed.get('system:startOfCombat:fleetingVigor')!;
    expect(vigor.consequences).toBeGreaterThan(0);
    expect(vigor.phase).toBe('startOfCombat');
  });

  it('every observed key is registry-anchored — the probe cannot invent identities', () => {
    for (const key of result.observed.keys()) {
      expect(PRESENTATION_POLICIES[key], `${key} was emitted but is unclassified`).toBeDefined();
    }
  });

  it('is deterministic — two runs agree exactly', () => {
    const a = [...probeEmission().observed.keys()].sort();
    const b = [...probeEmission().observed.keys()].sort();
    expect(a).toEqual(b);
  });

  it('does not let one scenario contaminate another', () => {
    // Each scenario runs on its own deep copy. Without that, emission would depend on the order the report
    // happened to run in — a report that changes when you reorder it is worse than no report.
    const single = probeEmission([defaultScenarios()[0]]);
    expect(single.observed.has('hero:repete:secondHand')).toBe(false);
    expect(single.observed.has('rune:rune_coffers:endOfTurn')).toBe(true);
  });

  it('reports un-migrated emitters separately instead of guessing an identity for them', () => {
    for (const u of result.unidentified) {
      expect(u.source).toBeTruthy();
      expect(u.trigger).toBeTruthy();
    }
  });
});

describe('the broad scenario sets', () => {
  it('cardScenarios covers every End-of-Turn card, batched onto boards', () => {
    const scenarios = cardScenarios();
    expect(scenarios.length).toBeGreaterThan(0);
    // Batched a board at a time: `faceOmen` resolves a whole combat, so one scenario per card would multiply
    // that cost by several hundred for no extra signal.
    expect(scenarios.every((s) => (s.state.board?.length ?? 0) > 0)).toBe(true);
  });

  it('shoutScenarios plays each card that has a Shout', () => {
    const scenarios = shoutScenarios();
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.every((s) => s.action?.type === 'play')).toBe(true);
  });

  it('the broad sets observe strictly MORE than the targeted ones', () => {
    const narrow = probeEmission(defaultScenarios()).observed.size;
    const broad = probeEmission(allScenarios()).observed.size;
    expect(broad).toBeGreaterThan(narrow);
  });

  it('End-of-Turn card effects are observed emitting', () => {
    // If this ever regresses to zero, End-of-Turn emission has broken and the audit would still read green
    // on classification alone — exactly the failure mode this probe exists to catch.
    const observed = probeEmission(cardScenarios()).observed;
    const eotFactories = [...observed.keys()].filter((k) => k.startsWith('factory:') && k.endsWith(':endOfTurn'));
    expect(eotFactories.length).toBeGreaterThan(0);
  });
});
