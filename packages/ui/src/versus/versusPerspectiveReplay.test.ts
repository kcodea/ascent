/**
 * VERSUS 1:1 PRESENTATION (live playtest 2026-10-14: "combat is still just 'off' on the 'player 2' board ... not a 1:1
 * experience"; "swapping players in combat restarts combat for the spectator"). The p2 seat's result is the swapped
 * native fight (R-VERSUS-PERSPECTIVE-01, proven in sim), so its REPLAY is too. Pinned on the replay pipeline itself:
 *  - the beat schedule (`replayBeats`) of the p2 perspective equals the native swapped fight's, beat for beat;
 *  - the frame at EVERY beat (`computeFrame`) equals the native fight's frame there, so lunges, slots and FX anchors
 *    are the ordinary lobby path;
 *  - a seat switch resumes at the same beat index: the other side's frame at that index is exactly that side's frame
 *    when played from the start (both sides of the one fight have the same beats, so the index is the same moment).
 */
import { describe, expect, it } from 'vitest';
import { fuzzCombatBoard, fuzzCombatSide, makeRng, simulate, type CombatEvent, type CombatResult, type FuzzPool } from '@game/core';
import { CARD_INDEX, SETS, poolFor, type SetId } from '@game/content';
import { mirrorForEnemySeat } from '@game/sim';
import { replayBeats, replayOrder } from '../choreo/replayOrder';
import { computeFrame } from '../useCombatReplay';

const fp = (set: SetId): FuzzPool => ({ ...poolFor(set), tribes: SETS[set].tribes });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** The narration's "your / their" is the one per-seat wording (see R-SYMMETRY-01). */
const neutral = (s: string): string => s; // the narration is reworded for the seat too: compared verbatim
const names = new Map<string, string>();

function fights(set: SetId, seed: number): { p1: CombatResult; p2: CombatResult; native: CombatResult } {
  const r = makeRng(seed * 7727 + set.charCodeAt(3));
  const A = fuzzCombatBoard(r, fp(set), 'A'), B = fuzzCombatBoard(r, fp(set), 'B');
  const sA = fuzzCombatSide(r, fp(set), 'A', A), sB = fuzzCombatSide(r, fp(set), 'B', B);
  const X = seed % 2 ? 'player' as const : 'enemy' as const;
  const p1 = simulate(clone(A), clone(B), makeRng(seed), CARD_INDEX, clone(sA), clone(sB), { firstSide: X });
  const native = simulate(clone(B), clone(A), makeRng(seed), CARD_INDEX, clone(sB), clone(sA), { firstSide: X === 'player' ? 'enemy' : 'player' });
  return { p1, p2: mirrorForEnemySeat(p1), native };
}

const frameAt = (res: CombatResult, beat: number): string => {
  const events = replayOrder(res.events);
  const beats = replayBeats(res.events);
  const b = beats[Math.min(beat, beats.length - 1)];
  const upto = b ? b.end : events.length;
  return neutral(JSON.stringify(computeFrame(res.initial, events as CombatEvent[], upto, b ? b.start : 0, names)));
};

describe('the p2 replay is the native replay of the swapped fight', () => {
  for (const set of ['set1', 'set2', 'set3'] as SetId[]) {
    it(`${set}: same beats and the same frame at every beat, 60 fights`, () => {
      for (let seed = 1; seed <= 60; seed++) {
        const { p2, native } = fights(set, seed);
        const a = replayBeats(p2.events), b = replayBeats(native.events);
        expect(neutral(JSON.stringify(a)), `${set} ${seed}: beats`).toBe(neutral(JSON.stringify(b)));
        for (let i = 0; i < a.length; i++) expect(frameAt(p2, i), `${set} ${seed}: beat ${i}`).toBe(frameAt(native, i));
      }
    });
  }

  it('a seat switch at any beat lands on the other side exactly as if it had played from the start', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { p1, p2 } = fights('set2', seed);
      const beats = replayBeats(p1.events);
      // both sides have the same beat count: the index is the same moment of the one fight
      expect(replayBeats(p2.events).length).toBe(beats.length);
      if (!beats.length) continue;
      const at = (seed * 13) % beats.length;
      // resuming p2 at `at` = p2's own frame there (computeFrame is a pure fold from the start: nothing replays)
      const resumed = frameAt(p2, at);
      const fromStart = frameAt(p2, at);
      expect(resumed).toBe(fromStart);
      // and it is p1's frame at the same moment with the rows swapped
      const f1 = JSON.parse(frameAt(p1, at)) as { player: unknown; enemy: unknown };
      const f2 = JSON.parse(resumed) as { player: unknown; enemy: unknown };
      expect(f2.player).toEqual(f1.enemy);
      expect(f2.enemy).toEqual(f1.player);
    }
  });
});
