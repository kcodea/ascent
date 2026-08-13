import { describe, it, expect } from 'vitest';
import { scheduleBeats, activeBeatIndex, DEFAULT_TIMING } from './beatTimeline';
import type { PresentationBatch } from '@game/core';

/** BEAT SYSTEM PR 6 — the pure timeline scheduler. */
function batch(): PresentationBatch {
  return {
    id: 'batch:eot',
    actionId: 'faceOmen',
    phase: 'endOfTurn',
    events: [
      { type: 'sourceTrigger', id: 't1', sequence: 0, step: 1, phase: 'endOfTurn', source: { kind: 'minion', id: 'a' }, trigger: 'endOfTurn', policy: 'ownBeat' },
      { type: 'statsChanged', id: 'c1', sequence: 1, step: 1, parentId: 't1', target: { zone: 'board', uid: 'x' }, attack: 1, health: 1, permanent: true },
      { type: 'sourceTrigger', id: 't2', sequence: 2, step: 2, phase: 'endOfTurn', source: { kind: 'rune', id: 'r' }, trigger: 'endOfTurn', policy: 'foldedCue' },
      { type: 'statsChanged', id: 'c2', sequence: 3, step: 2, parentId: 't2', target: { zone: 'board', uid: 'y' }, attack: 2, health: 0, permanent: true },
    ],
  };
}

describe('scheduleBeats', () => {
  it('schedules one beat per trigger, sequentially, attaching consequences by parentId', () => {
    const { beats, totalMs } = scheduleBeats(batch());
    expect(beats.map((b) => b.id)).toEqual(['t1', 't2']);
    expect(beats[0]!.consequences.map((c) => c.id)).toEqual(['c1']);
    expect(beats[1]!.consequences.map((c) => c.id)).toEqual(['c2']);
    // t2 starts exactly when t1's window (incl. recovery) ends.
    expect(beats[1]!.startMs).toBe(beats[0]!.nextMs);
    expect(totalMs).toBe(beats[1]!.nextMs);
  });

  it('applies per-policy timing (ownBeat holds longer than foldedCue)', () => {
    const { beats } = scheduleBeats(batch());
    const own = beats[0]!;
    expect(own.consequenceMs).toBe(own.startMs + DEFAULT_TIMING.ownBeat.windupMs);
    expect(own.endMs - own.consequenceMs).toBe(DEFAULT_TIMING.ownBeat.holdMs);
    const folded = beats[1]!;
    expect(folded.endMs - folded.consequenceMs).toBe(DEFAULT_TIMING.foldedCue.holdMs);
  });

  it('activeBeatIndex walks the playhead through the schedule', () => {
    const { beats } = scheduleBeats(batch());
    expect(activeBeatIndex(beats, -1)).toBe(-1);
    expect(activeBeatIndex(beats, beats[0]!.startMs)).toBe(0);
    expect(activeBeatIndex(beats, beats[1]!.startMs)).toBe(1);
    expect(activeBeatIndex(beats, 10_000_000)).toBe(1);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(scheduleBeats(batch()))).toBe(JSON.stringify(scheduleBeats(batch())));
  });
});
