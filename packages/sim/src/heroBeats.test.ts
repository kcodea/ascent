import { describe, it, expect } from 'vitest';
import { createRun, reduce, reduceWithPresentation, type RunState } from './index';
import { PRESENTATION_POLICIES, type SourceTriggerEvent, type ConsequenceEvent } from '@game/core';

/**
 * BEAT CHOREOGRAPHER PR 9 — hero powers emit, and their coverage is enforced HERE.
 *
 * Two jobs:
 *
 * 1. **The owner's third bug.** *"If I change Re-Pete to an ownBeat it does nothing."* Correct — and not a
 *    Beat Lab fault. Hero powers were the last whole CLASS of automatic effect emitting nothing at all, so
 *    the tool could change a beat's declared policy while gameplay never announced the moment. There was no
 *    beat to reclassify.
 *
 * 2. **The coverage tripwire heroes cannot get from content.** Heroes live in `@game/sim`, and content is a
 *    DEPENDENCY of sim — so `presentationSurface()` can never see them, and the content ghost-check skips
 *    `hero:*` for exactly that reason. Without this file, a hero key could rot silently.
 */
const faceOmen = { type: 'faceOmen' } as never;

/** Re-Pete at the end of a 3rd turn with a card in hand — the turn Second Hand fires. */
function repeteRun(wave = 3): RunState {
  const run = createRun(11, 'repete');
  return {
    ...run,
    phase: 'recruit',
    wave,
    hand: [{ uid: 'h1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
  } as RunState;
}

const triggersOf = (s: RunState): SourceTriggerEvent[] =>
  (reduceWithPresentation(s, faceOmen, true).batch?.events ?? [])
    .filter((e): e is SourceTriggerEvent => e.type === 'sourceTrigger');

describe('hero powers no longer resolve silently', () => {
  it('Re-Pete emits a source trigger for Second Hand', () => {
    const t = triggersOf(repeteRun()).find((x) => x.source.kind === 'hero');
    expect(t, 'Second Hand got a beat').toBeTruthy();
    expect(t!.trigger).toBe('secondHand');
    expect(t!.source.id).toBe('repete');
  });

  it('the beat is registry-anchored, so timing and policy resolve', () => {
    const t = triggersOf(repeteRun()).find((x) => x.source.kind === 'hero')!;
    expect(t.policyKey).toBe('hero:repete:secondHand');
    expect(PRESENTATION_POLICIES[t.policyKey!]).toBeDefined();
    expect(t.family).toBe('heroPower');
    // This is the property that makes the owner's toggle meaningful: the emitted policy comes from the
    // registry, so an override in the Lab has something real to override.
    expect(t.policy).toBe(PRESENTATION_POLICIES[t.policyKey!].policy);
  });

  it('the conjured card is a consequence OF the hero, not an orphan', () => {
    const { batch } = reduceWithPresentation(repeteRun(), faceOmen, true);
    const hero = (batch!.events).find((e): e is SourceTriggerEvent => e.type === 'sourceTrigger' && e.source.kind === 'hero')!;
    const granted = (batch!.events).filter(
      (e): e is ConsequenceEvent => e.type === 'cardGranted' && e.parentId === hero.id,
    );
    expect(granted).toHaveLength(1);
    // The HERO is the source, so the cue can anchor on the portrait rather than on the card that appears.
    expect(hero.source.kind).toBe('hero');
  });

  it('the source carries the hero id, so the Beat Lab can group by hero', () => {
    const t = triggersOf(repeteRun()).find((x) => x.source.kind === 'hero')!;
    expect(t.source.id).toBe('repete');
    expect(t.source.label).toBeTruthy();
  });
});

describe('it fires exactly when gameplay says, and no more', () => {
  it('emits nothing on a non-third turn', () => {
    expect(triggersOf(repeteRun(4)).find((x) => x.source.kind === 'hero')).toBeUndefined();
  });

  it('emits nothing with an empty hand', () => {
    const s = { ...repeteRun(), hand: [] } as RunState;
    expect(triggersOf(s).find((x) => x.source.kind === 'hero')).toBeUndefined();
  });

  it('a different hero emits no Second Hand beat', () => {
    const s = { ...repeteRun(), heroId: 'warden' } as RunState;
    expect(triggersOf(s).find((x) => x.trigger === 'secondHand')).toBeUndefined();
  });
});

describe('gameplay is unchanged', () => {
  it('capturing the hero beat does not change the resolved run', () => {
    const s = repeteRun();
    const plain = reduce(s, faceOmen);
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, true).state)).toBe(JSON.stringify(plain));
  });

  it('the conjured copy still lands in hand', () => {
    const before = repeteRun();
    const after = reduce(before, faceOmen);
    expect(after.hand.length).toBeGreaterThan(before.hand.length);
  });
});

describe('what this file adds on top of heroPolicies.test.ts', () => {
  // `heroPolicies.test.ts` owns the ENUMERATION tripwire: every hero in `heroSurface()` has a registry row,
  // and no hero row is a ghost. That subsumes the key-shape and missing-row checks this file used to repeat,
  // so they are gone rather than left as a second, weaker copy of the same guarantee.
  //
  // What remains here is the part enumeration cannot see: a classified power is not the same as an EMITTING
  // one. A power can be perfectly classified and still resolve in silence — which is the exact failure this
  // whole project exists to end, and what the owner hit with Re-Pete.

  it('a classified hero power still needs a family for template timing', () => {
    const heroKeys = Object.keys(PRESENTATION_POLICIES).filter((k) => k.startsWith('hero:'));
    for (const key of heroKeys) {
      const entry = PRESENTATION_POLICIES[key];
      expect(entry.family, `${key} needs a family for template timing`).toBeTruthy();
      if (entry.policy === 'intentionallySilent') expect(entry.reason, `${key} must justify silence`).toBeTruthy();
    }
  });

  it('every power wired to EMIT resolves through the registry', () => {
    // Grows as powers are wired. Classification alone was never the finish line.
    for (const key of ['hero:repete:secondHand']) {
      expect(PRESENTATION_POLICIES[key], `${key} is emitted but unclassified`).toBeDefined();
    }
  });
});
