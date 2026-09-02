import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { SourceTriggerEvent } from '@game/core';
import { createRun, reduce, reduceWithPresentation, type RunState } from './index';

/**
 * RUNE OF THE RELIQUARY — one beat per Echo (owner report 2026-09-01: "literally has no beats, animations or
 * anything firing"; owner spec: "each trigger needs its own beat … it should trigger the deathrattle skull
 * animation + whatever bespoke or general animation each card triggers as they trigger their beats, left to
 * right").
 *
 * Before: the recurring loop wrapped the whole effect in ONE rune-sourced scope — no minion to pulse, both
 * Echoes' summons in one frame, the skull only as a commit-time stamp that played after the phase flipped.
 * Now the loop opens no scope for it; the effect opens one diffing scope PER ECHO, sourced on the Echo minion,
 * carrying an `echoFired` (the skull at its beat) and that Echo's own consequences.
 */
const faceOmen = { type: 'faceOmen' } as const;
const mk = (id: string, uid: string, extra: Record<string, unknown> = {}) => {
  const d = CARD_INDEX[id]!;
  return { uid, cardId: d.id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const state = (board: unknown[]): RunState => ({
  ...createRun(1, 'warden'), wave: 6, phase: 'recruit', questRecurringEndOfTurn: ['triggerLeftmostEcho'], board,
}) as unknown as RunState;
const batchOf = (s: RunState) => reduceWithPresentation(s, faceOmen, true).batch?.events ?? [];
const triggers = (evts: readonly unknown[]) => evts.filter((e): e is SourceTriggerEvent => (e as { type: string }).type === 'sourceTrigger');
const childrenOf = (evts: readonly unknown[], t: SourceTriggerEvent) =>
  evts.filter((e) => (e as { parentId?: string }).parentId === t.id).map((e) => (e as { type: string }).type);

describe('Rune of the Reliquary — one beat per Echo, left to right', () => {
  // pack + manasaber both summon on death (real Echoes with a shop half); stray has no Echo.
  const two = state([mk('pack', 'e1'), mk('manasaber', 'e2'), mk('stray', 'p')]);

  it('emits two minion-sourced beats under the rune identity, in board order, each with its skull + its own summons', () => {
    const evts = batchOf(two);
    const beats = triggers(evts);
    expect(beats.map((t) => [t.source.kind, t.source.uid, t.policyKey])).toEqual([
      ['minion', 'e1', 'rune:rune_reliquary:endOfTurn'],
      ['minion', 'e2', 'rune:rune_reliquary:endOfTurn'],
    ]);
    expect(childrenOf(evts, beats[0]!)).toEqual(['echoFired', 'cardSummoned', 'cardSummoned']);
    expect(childrenOf(evts, beats[1]!)).toEqual(['echoFired', 'cardSummoned', 'cardSummoned']);
    // The skull is attributed to the Echo minion that fired, not to the rune.
    const skulls = evts.filter((e) => (e as { type: string }).type === 'echoFired') as { target: { uid: string } }[];
    expect(skulls.map((s) => s.target.uid)).toEqual(['e1', 'e2']);
  });

  it('is byte-identical to plain reduce, capture on and off (presentation never changes state)', () => {
    const plain = reduce(two, faceOmen);
    expect(JSON.stringify(reduceWithPresentation(two, faceOmen, false).state)).toBe(JSON.stringify(plain));
    expect(JSON.stringify(reduceWithPresentation(two, faceOmen, true).state)).toBe(JSON.stringify(plain));
    // …and the legacy channels the commit still reads are stamped exactly as before: one tendril per Echo, no
    // proc COUNT (the badge already bursts once off the tendril sequence — a count on top fired it twice).
    expect(plain.questTendrilFx?.map((t) => [t.effect, t.uid])).toEqual([['triggerLeftmostEcho', 'e1'], ['triggerLeftmostEcho', 'e2']]);
    expect(plain.runeProcs?.rune_reliquary).toBeUndefined();
    expect(plain.shopDeathFx?.map((f) => [f.kind, f.uid])).toEqual([['echo', 'e1'], ['echo', 'e2']]);
  });

  it('Rune of the Crucible Choir follows the same rule: the Shout minion has its beat, then the Echo minion', () => {
    // alley (a Shout: Alleycat summons a Stray) and pack (an Echo) — two acting minions, two beats, in order.
    const s = { ...createRun(1, 'warden'), wave: 6, phase: 'recruit', runeCrucibleChoir: true, ownedRunes: ['rune_crucible_choir'], board: [mk('alley', 's1'), mk('pack', 'e1')] } as unknown as RunState;
    const evts = batchOf(s);
    const beats = triggers(evts).filter((t) => t.policyKey === 'rune:rune_crucible_choir:endOfTurn');
    expect(beats.map((t) => [t.source.kind, t.source.uid])).toEqual([['minion', 's1'], ['minion', 'e1']]);
    expect(childrenOf(evts, beats[1]!)[0], 'the Echo beat opens with its skull').toBe('echoFired');
    const plain = reduce(s, faceOmen);
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, true).state)).toBe(JSON.stringify(plain));
  });

  it('fires only the two LEFT-most Echoes — a third stays silent and gets no beat', () => {
    const three = state([mk('pack', 'e1'), mk('manasaber', 'e2'), mk('pack', 'e3')]);
    expect(triggers(batchOf(three)).map((t) => t.source.uid)).toEqual(['e1', 'e2']);
  });

  it('an Echo whose shop half does nothing (a stripped copy) leaves no beat; no Echo at all leaves no beat', () => {
    expect(triggers(batchOf(state([mk('pack', 'e1', { echoStripped: true }), mk('stray', 'p')])))).toEqual([]);
    expect(triggers(batchOf(state([mk('stray', 'p')])))).toEqual([]);
  });

  it('the beat is the rune\'s own (ownBeat, End of Turn) — so the audit observes the identity emitting', () => {
    const [b] = triggers(batchOf(two));
    expect(b!.policy).toBe('ownBeat');
    expect(b!.phase).toBe('endOfTurn');
    expect(b!.trigger).toBe('endOfTurn');
  });
});
