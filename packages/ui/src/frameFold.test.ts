import { describe, expect, it } from 'vitest';
import { CARD_INDEX, SETS, poolFor, type SetId } from '@game/content';
import { fuzzCombatBoard, fuzzCombatSide, makeRng, simulate, type CombatEvent, type CombatResult, type FuzzPool } from '@game/core';
import { computeFrame, makeFrameFolder } from './useCombatReplay';
import { replayBeats, replayOrder } from './choreo/replayOrder';

/**
 * R-PERF-COMBAT-FOLD-01 — THE CONTINUED FRAME FOLD EQUALS THE FROM-SCRATCH FOLD, AT EVERY BEAT.
 *
 * The combat screen used to rebuild the whole board from the starting snapshot on every beat (`computeFrame`,
 * events `0..upto`). It now keeps one fold alive and applies only the new events (`makeFrameFolder`). That is only
 * safe if the two are the same function, so this sweeps recorded fights of every set (random boards, run contexts and
 * combat mods: the R-SYMMETRY-01 fixture generator) and holds, beat by beat:
 *
 *  1. PLAYING FORWARD: the continued frame deep-equals the from-scratch frame at every beat, and at the resting end
 *     frame (`upto === beatStart === events.length`).
 *  2. NOTHING HANDED OUT EVER CHANGES: a frame React is still holding from an earlier beat is byte-identical after the
 *     fold moved on (the fold's ONE RULE: nested values are replaced, never edited in place).
 *  3. SEEK / SKIP / REWATCH: jumping backward, jumping to the end and starting over all land on the from-scratch frame.
 *  4. A NEW FIGHT resets the fold (the hook keeps one folder across fights).
 */

const SET_IDS: SetId[] = ['set1', 'set2', 'set3', 'set4'];
const fp = (set: SetId): FuzzPool => ({ ...poolFor(set), tribes: SETS[set].tribes });
const SEEDS = Number(process.env.FRAME_FOLD_SEEDS ?? 12); // per set; raise locally for a deeper sweep

function fight(set: SetId, seed: number): CombatResult {
  const r = makeRng(seed * 7919 + set.length * 31 + set.charCodeAt(3));
  const A = fuzzCombatBoard(r, fp(set), 'A');
  const B = fuzzCombatBoard(r, fp(set), 'B');
  return simulate(A, B, makeRng(seed), CARD_INDEX, fuzzCombatSide(r, fp(set), 'A', A), fuzzCombatSide(r, fp(set), 'B', B));
}

/** The (upto, beatStart) pair the replay hook asks for at each beat, then the resting end frame. */
function cursors(raw: CombatEvent[], events: CombatEvent[]): { upto: number; beatStart: number }[] {
  const beats = replayBeats(raw); // (orders the raw log itself, as the hook's `beats` does)
  const out = [{ upto: 0, beatStart: 0 }];
  for (const b of beats) out.push({ upto: b.end, beatStart: b.start });
  out.push({ upto: events.length, beatStart: events.length });
  return out;
}

describe('R-PERF-COMBAT-FOLD-01: the continued frame fold', () => {
  for (const set of SET_IDS) {
    it(`${set}: equals the from-scratch fold at every beat, and never changes a frame already handed out`, () => {
      let beatsChecked = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const res = fight(set, seed);
        const events = replayOrder(res.events);
        const names = new Map<string, string>();
        const fold = makeFrameFolder();
        const held: { frame: unknown; json: string }[] = [];
        for (const c of cursors(res.events, events)) {
          const inc = fold(res.initial, events, c.upto, c.beatStart, names);
          const full = computeFrame(res.initial, events, c.upto, c.beatStart, names);
          expect(inc, `${set} seed ${seed} at upto ${c.upto}`).toEqual(full);
          held.push({ frame: inc, json: JSON.stringify(inc) });
          beatsChecked++;
        }
        for (const [k, h] of held.entries()) expect(JSON.stringify(h.frame), `${set} seed ${seed}: frame ${k} changed after it was handed out`).toBe(h.json);
      }
      expect(beatsChecked).toBeGreaterThan(SEEDS * 3);
    });

    it(`${set}: a seek back, a skip to the end and a rewatch all land on the from-scratch frame`, () => {
      for (let seed = 1; seed <= Math.min(SEEDS, 6); seed++) {
        const res = fight(set, seed);
        const events = replayOrder(res.events);
        const names = new Map<string, string>();
        const cs = cursors(res.events, events);
        const fold = makeFrameFolder();
        const at = (k: number): void => {
          const c = cs[Math.max(0, Math.min(cs.length - 1, k))]!;
          expect(fold(res.initial, events, c.upto, c.beatStart, names), `${set} seed ${seed} cursor ${k}`)
            .toEqual(computeFrame(res.initial, events, c.upto, c.beatStart, names));
        };
        const r = makeRng(seed * 131 + 7);
        const mid = Math.floor(cs.length / 2);
        at(mid);                 // play (jump) forward to the middle
        at(Math.floor(mid / 2)); // seek BACK
        at(mid + 1);             // forward again
        at(cs.length - 1);       // skip to the end
        at(0);                   // rewatch from the start
        at(1);
        for (let k = 0; k < 12; k++) at(Math.floor(r.next() * cs.length)); // a scrub, anywhere
        // The same beat asked twice (a re-render, a same-beat re-seek) is the same frame.
        at(mid); at(mid);
      }
    });
  }

  it('a new fight starts a new fold (one folder serves every fight of a session)', () => {
    const a = fight('set1', 3), b = fight('set2', 4);
    const ea = replayOrder(a.events), eb = replayOrder(b.events);
    const names = new Map<string, string>();
    const fold = makeFrameFolder();
    expect(fold(a.initial, ea, ea.length, ea.length, names)).toEqual(computeFrame(a.initial, ea, ea.length, ea.length, names));
    const mid = Math.floor(eb.length / 2);
    expect(fold(b.initial, eb, mid, mid, names)).toEqual(computeFrame(b.initial, eb, mid, mid, names));
    // …and back to the first fight (a seat switch landing the other side's result).
    expect(fold(a.initial, ea, 2, 0, names)).toEqual(computeFrame(a.initial, ea, 2, 0, names));
  });

  it('hands out fresh bodies every call (the Unit memo compares the old frame to the new one)', () => {
    const res = fight('set1', 5);
    const events = replayOrder(res.events);
    const names = new Map<string, string>();
    const fold = makeFrameFolder();
    const f1 = fold(res.initial, events, 1, 0, names);
    const f2 = fold(res.initial, events, 1, 0, names);
    expect(f2).toEqual(f1);
    for (const [i, u] of f1.player.entries()) expect(f2.player[i]).not.toBe(u);
  });
});
