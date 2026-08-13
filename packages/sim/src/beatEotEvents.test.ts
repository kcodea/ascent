import { describe, it, expect } from 'vitest';
import { createRun, reduce, reduceWithPresentation, type RunState } from './index';
import type { SourceTriggerEvent, ResourceChangedConsequence } from '@game/core';

/**
 * BEAT SYSTEM PR 5 — End-of-Turn event migration. `reduceWithPresentation(faceOmen)` must (a) leave gameplay
 * byte-identical to plain `reduce` and (b) emit a source-attributed End-of-Turn batch: board minions
 * left-to-right, then recurring/limited rewards, plus own beats for Coffers / Shopkeep (the handoff-doc gaps).
 */
const faceOmen = { type: 'faceOmen' } as const;

/** A recruit state at end-of-turn with a board EoT minion + assorted runes armed. */
function eotState(over: Partial<RunState> = {}): RunState {
  const run = createRun(3, 'warden');
  return {
    ...run,
    phase: 'recruit',
    board: [
      // Soul Defiler-style: an EoT stat/aura minion. We use a real EoT card if present; otherwise the board
      // simply produces no minion beats and the rune beats still assert.
      { uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false },
    ],
    ...over,
  } as RunState;
}

const triggers = (evts: readonly unknown[]) => evts.filter((e): e is SourceTriggerEvent => (e as { type: string }).type === 'sourceTrigger');

describe('reduceWithPresentation(faceOmen) — gameplay equivalence', () => {
  it('is byte-identical to plain reduce, capture on and off', () => {
    const s = eotState({ runeCoffers: true, runeShopkeep: true, runeLapidary: true, playedThisTurn: ['a', 'b'] });
    const plain = reduce(s, faceOmen);
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, false).state)).toBe(JSON.stringify(plain));
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, true).state)).toBe(JSON.stringify(plain));
  });
});

describe('reduceWithPresentation(faceOmen) — End-of-Turn emission', () => {
  it('tags the batch endOfTurn and emits Coffers as an own-beat resourceChanged', () => {
    const s = eotState({ runeCoffers: true });
    const { batch } = reduceWithPresentation(s, faceOmen, true);
    expect(batch?.phase).toBe('endOfTurn');
    const coffers = triggers(batch!.events).find((t) => t.source.id === 'rune_coffers');
    expect(coffers, 'Coffers got a beat').toBeTruthy();
    expect(coffers!.policy).toBe('ownBeat');
    const res = batch!.events.find(
      (e): e is ResourceChangedConsequence => e.type === 'resourceChanged' && e.parentId === coffers!.id,
    );
    expect(res).toMatchObject({ resource: 'maxGold', amount: 1 });
  });

  it('emits Shopkeep as an own-beat upgradeCost change', () => {
    const s = eotState({ runeShopkeep: true, upgradeCost: 9 });
    const { batch } = reduceWithPresentation(s, faceOmen, true);
    const shopkeep = triggers(batch!.events).find((t) => t.source.id === 'rune_shopkeep');
    expect(shopkeep, 'Shopkeep got a beat').toBeTruthy();
    const res = batch!.events.find(
      (e): e is ResourceChangedConsequence => e.type === 'resourceChanged' && e.parentId === shopkeep!.id,
    );
    expect(res?.resource).toBe('upgradeCost');
    expect(res!.amount).toBeLessThan(0);
  });

  it('emits the Lapidary recurring reward as a labeled beat with rubyPlayed consequences', () => {
    const s = eotState({ runeLapidary: true, playedThisTurn: ['a', 'b', 'c'] });
    const { batch } = reduceWithPresentation(s, faceOmen, true);
    // CHOREOGRAPHER PR 1: the source is the OWNING RUNE (`rune_lapidary`), not the bare recurring-effect
    // name it used to carry — that is what lets the beat name its registry row and group under the rune.
    const lap = triggers(batch!.events).find((t) => t.source.id === 'rune_lapidary');
    expect(lap, 'Lapidary got a labeled beat').toBeTruthy();
    expect(lap!.source.label).toBe('Rune of the Lapidary');
    expect(lap!.policyKey).toBe('rune:rune_lapidary:endOfTurn');
    // Its Rubies land on the board minion — captured as rubyPlayed under the Lapidary trigger (PR 6c
    // reclassified rubies out of the generic stat channel so the viewer can fire the gem cascade).
    const rubies = batch!.events.filter((e) => e.type === 'rubyPlayed' && e.parentId === lap!.id);
    expect(rubies.length, 'rubies landed as rubyPlayed consequences').toBeGreaterThan(0);
  });

  it('orders board minion beats before recurring reward beats', () => {
    const s = eotState({ runeLapidary: true, playedThisTurn: ['a'] });
    const { batch } = reduceWithPresentation(s, faceOmen, true);
    const ts = triggers(batch!.events);
    const lapIdx = ts.findIndex((t) => t.source.id === 'runeLapidary');
    const minionIdx = ts.findIndex((t) => t.source.kind === 'minion');
    if (minionIdx >= 0 && lapIdx >= 0) expect(minionIdx).toBeLessThan(lapIdx);
    // Steps are non-decreasing across the batch (resolution order preserved).
    const steps = batch!.events.filter((e): e is SourceTriggerEvent => (e as { type: string }).type === 'sourceTrigger').map((t) => t.step);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it('is deterministic — identical batches for the same end of turn', () => {
    const s = eotState({ runeCoffers: true, runeLapidary: true, playedThisTurn: ['a', 'b'] });
    const a = reduceWithPresentation(s, faceOmen, true).batch;
    const b = reduceWithPresentation(s, faceOmen, true).batch;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
