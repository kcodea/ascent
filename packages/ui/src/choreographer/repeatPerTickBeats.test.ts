import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import type { ConsequenceEvent, SourceTriggerEvent } from '@game/core';
import { createRun, endOfTurnRepeats, endOfTurnTicksOf, prepareActionWithPresentation, projectEndOfTurnSteps, questEndOfTurnBeats, reduce, type BoardCard, type RunState } from '@game/sim';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import { createTimelinePlayer } from './livePlayer';

/**
 * REPEAT PER TICK on the path players see — the Choreographer's End of Turn (owner ruling 2026-09-22, R-REPEAT-01):
 *
 *   *"both kringle and mother moss should function with the repeat logic. their animation beats will also
 *   naturally be longer since they'll spew out all of the different buffs repeated times instead of 1 per target."*
 *
 * The sim contract is `packages/sim/src/repeatPerTick.test.ts`. This file pins the SIGNAL the Choreographer
 * actually plays: a repeating End-of-Turn effect emits one ROOT trigger PER TICK (never a nested child — the
 * compiler places children at the parent's delivery, all at once), each carrying exactly that tick's
 * `statsChanged`, so the compiled timeline holds one beat per tick, in order, and its duration grows with the
 * count (the choreography rule: "assert the compiled timeline's duration grows with the number of effects").
 * The legacy projection path must agree 1:1 with the beat list Recruit.tsx builds, and the prepared commit must
 * stay byte-identical to a plain reduce.
 */

const faceOmen = { type: 'faceOmen' } as never;
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (setId: 'set2' | 'set3', over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId, phase: 'recruit', embers: 20, tier: 6, tribes: ['spirit', 'dwarf'],
    pool: Object.fromEntries(poolFor(setId).buyable.map((c) => [c.id, 5])), ...over } as RunState);
const cardsPlayed = (n: number): string[] => Array.from({ length: n }, (_, i) => `x${i}`);
const spiritsPlayed = (n: number): string[] => Array.from({ length: n }, () => 'sp3_kindled');

const kringle = (n: number, over: Partial<RunState> = {}): RunState =>
  run('set2', { board: [body('l', 'dw_brakka'), body('k', 'dw_foreman'), body('r', 'dw_edward')], playedThisTurn: cardsPlayed(n), ...over });
const moss = (n: number): RunState =>
  run('set3', { board: [body('m', 'sp3_nurturer'), body('a', 'sp3_kindled'), body('b', 'sp3_kindled')], playedThisTurn: spiritsPlayed(n) });

/** The batch's triggers for one source uid, with the consequences each one owns. */
function triggersOf(state: RunState, uid: string) {
  const prepared = prepareActionWithPresentation(state, faceOmen);
  const events = prepared.batch?.events ?? [];
  const triggers = events.filter((e): e is SourceTriggerEvent => e.type === 'sourceTrigger' && e.source.uid === uid);
  const owned = (t: SourceTriggerEvent) => events.filter((e): e is ConsequenceEvent => e.type !== 'sourceTrigger' && e.parentId === t.id);
  return { prepared, events, triggers, owned };
}

describe('Kringle — one ROOT trigger per tick, each its own beat', () => {
  it('2 cards played → 3 root triggers, identified, numbered 1..3 of 3, each with one +1/+2 per end', () => {
    const { triggers, owned } = triggersOf(kringle(2), 'k');
    expect(triggers.length).toBe(3);
    triggers.forEach((t, i) => {
      expect(t.parentId, 'a root, never a child (children would all play at the parent\'s delivery)').toBeUndefined();
      expect(t.policyKey).toBe('factory:endOfTurnBuffEndsTribePerCard:endOfTurn');
      expect(t.family).toBe('endOfTurn');
      expect([t.repeatIndex, t.repeatCount], 'fire k of N for this source this End of Turn').toEqual([i, 3]);
      const stats = owned(t).filter((c): c is Extract<ConsequenceEvent, { type: 'statsChanged' }> => c.type === 'statsChanged');
      expect(stats.map((c) => c.target.uid).sort(), `tick ${i} pays both ends`).toEqual(['l', 'r']);
      for (const c of stats) expect([c.attack, c.health], 'the per-tick grant, never a sum').toEqual([1, 2]);
    });
    // Emission order is tick order.
    expect(triggers.map((t) => t.sequence)).toEqual([...triggers.map((t) => t.sequence)].sort((a, b) => a - b));
  });

  it('nothing played → the base tick alone (one trigger, +1/+2 per end)', () => {
    const { triggers, owned } = triggersOf(kringle(0), 'k');
    expect(triggers.length).toBe(1);
    expect(owned(triggers[0]!).filter((c) => c.type === 'statsChanged').length).toBe(2);
  });

  it('under Chronos the tick sequence repeats: 2 repeats × 2 ticks = 4 root triggers, numbered 1..4 of 4', () => {
    const s = kringle(1, { extraEotThisTurn: true });
    expect(endOfTurnRepeats(s)).toBe(2);
    const { triggers } = triggersOf(s, 'k');
    expect(triggers.map((t) => [t.repeatIndex, t.repeatCount])).toEqual([[0, 4], [1, 4], [2, 4], [3, 4]]);
    for (const t of triggers) expect(t.parentId).toBeUndefined();
  });

  it('compiles to one beat per tick, placed one AFTER another, and the timeline grows with the count', () => {
    const compiled = (n: number) => {
      const { prepared } = triggersOf(kringle(n), 'k');
      return compileTimeline(normalizePresentationBatch(prepared.batch!));
    };
    const t3 = compiled(2);
    const mine = t3.beats.filter((b) => b.source.uid === 'k').sort((a, b) => a.startMs - b.startMs);
    expect(mine.length).toBe(3);
    for (let i = 1; i < mine.length; i++) {
      expect(mine[i]!.startMs, `tick ${i} starts after tick ${i - 1} has fully played`).toBeGreaterThanOrEqual(mine[i - 1]!.recoveryEndMs);
    }
    expect(mine.every((b) => b.lane === 'source' && b.mode === 'ownBeat'), 'every tick is its own source beat').toBe(true);
    expect(t3.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(t3.diagnostics.filter((d) => d.code === 'missingPolicyKey')).toEqual([]);
    // Reserved time, not just counted beats: more ticks → a longer End of Turn (the owner accepts this).
    expect(compiled(0).durationMs).toBeLessThan(compiled(1).durationMs);
    expect(compiled(1).durationMs).toBeLessThan(compiled(3).durationMs);
    expect(compiled(3).durationMs - compiled(0).durationMs, 'three extra full beats').toBeGreaterThanOrEqual(3 * (mine[0]!.recoveryEndMs - mine[0]!.startMs));
  });

  it('plays tick by tick: after the first beat the ends have gained exactly ONE +1/+2, and the whole run lands at the end', () => {
    const { prepared } = triggersOf(kringle(2), 'k');
    const timeline = compileTimeline(normalizePresentationBatch(prepared.batch!));
    const mine = timeline.beats.filter((b) => b.source.uid === 'k').sort((a, b) => a.startMs - b.startMs);
    const player = createTimelinePlayer(timeline);
    // Just past the first tick's delivery (plus its per-target stagger) and before the second tick begins.
    player.advanceTo(mine[0]!.deliveryMs + 2 * mine[0]!.config.targetStaggerMs + 1);
    const p1 = player.projection();
    expect(p1.boardStats.get('l'), 'one tick on the left end').toEqual({ attack: 1, health: 2 });
    expect(p1.boardStats.get('r'), 'one tick on the right end').toEqual({ attack: 1, health: 2 });
    player.advanceTo(timeline.durationMs + 1);
    expect(player.projection().boardStats.get('l')).toEqual({ attack: 3, health: 6 });
    expect(player.projection().boardStats.get('r')).toEqual({ attack: 3, health: 6 });
  });
});

describe('Mother Moss — one ROOT trigger per tick, one pick per beat', () => {
  it('2 Spirits played → 3 root triggers, each carrying exactly one +3/+4', () => {
    const { triggers, owned } = triggersOf(moss(2), 'm');
    expect(triggers.length).toBe(3);
    triggers.forEach((t, i) => {
      expect(t.parentId).toBeUndefined();
      expect(t.policyKey).toBe('factory:endOfTurnBuffRandomTribeRepeatPerPlayed:endOfTurn');
      expect([t.repeatIndex, t.repeatCount]).toEqual([i, 3]);
      const stats = owned(t).filter((c): c is Extract<ConsequenceEvent, { type: 'statsChanged' }> => c.type === 'statsChanged');
      expect(stats.length, `tick ${i} is one pick`).toBe(1);
      expect([stats[0]!.attack, stats[0]!.health]).toEqual([3, 4]);
      expect(['m', 'a', 'b']).toContain(stats[0]!.target.uid);
    });
  });

  it('the compiled beats sit one after another and the duration grows with the Spirits played', () => {
    const compiled = (n: number) => compileTimeline(normalizePresentationBatch(triggersOf(moss(n), 'm').prepared.batch!));
    const t = compiled(3);
    const mine = t.beats.filter((b) => b.source.uid === 'm').sort((a, b) => a.startMs - b.startMs);
    expect(mine.length).toBe(4);
    for (let i = 1; i < mine.length; i++) expect(mine[i]!.startMs).toBeGreaterThanOrEqual(mine[i - 1]!.recoveryEndMs);
    expect(compiled(0).durationMs).toBeLessThan(compiled(3).durationMs);
  });
});

describe('the two paths agree', () => {
  it('the legacy beat list (per card × repeat × tick) matches the projection 1:1, for both cards', () => {
    for (const s of [kringle(3), moss(2), kringle(2, { extraEotThisTurn: true })]) {
      const repeats = endOfTurnRepeats(s);
      let beats = 0;
      for (const card of s.board) {
        if (!CARD_INDEX[card.cardId]?.effects.some((e) => e.on === 'endOfTurn')) continue;
        beats += repeats * endOfTurnTicksOf(s, card);
      }
      beats += questEndOfTurnBeats(s).length;
      expect(projectEndOfTurnSteps(s).steps.length, 'Recruit.tsx builds exactly this many beats').toBe(beats);
    }
  });

  it('the prepared (played) End of Turn commits the run a plain dispatch produces, byte for byte', () => {
    for (const s of [kringle(3), moss(2)]) {
      const prepared = prepareActionWithPresentation(s, faceOmen);
      expect(JSON.stringify(prepared.after)).toBe(JSON.stringify(reduce(s, faceOmen)));
      const timeline = compileTimeline(normalizePresentationBatch(prepared.batch!));
      const player = createTimelinePlayer(timeline);
      player.advanceTo(timeline.durationMs + 1);
      expect(player.projection().deliveredEventIds.size, 'every tick delivered').toBe(timeline.consequenceDeliveries.length);
    }
  });
});
