import { describe, expect, it } from 'vitest';
import { CARD_INDEX, SETS, badgeIdsForCombatFlag, poolFor, type SetId } from '@game/content';
import { fuzzCombatBoard, fuzzCombatSide, makeRng, simulate, type CombatEvent, type CombatResult, type FuzzPool } from '@game/core';
import { eventsOfType, foldPrefix, makePrefixFold } from './prefixFold';
import { replayBeats, replayOrder } from './replayOrder';
import { runeProgress, triggerCounts } from './triggerCounts';
import { COMBAT_BUFF_FOLD, COMBAT_PREVIEW_FOLD, combatBuffDelta, combatPreviewFold } from '../runBuffs';
import { grantsShownThrough, handBuffsShownThrough, handSummonedShownThrough } from '../useCombatReplay';

/**
 * R-PERF-COMBAT-FOLD-01 — THE RUNNING READOUTS, CONTINUED, EQUAL THE FROM-SCRATCH READING AT EVERY BEAT.
 *
 * The replay's readouts ("spell power gained so far", the display previews ...) used to loop the log from event 0 on
 * every beat. They are continued now (`makePrefixFold`), or walk a per-fight list of their own event type
 * (`eventsOfType`). Swept over recorded fights of every set:
 *
 *  1. the continued fold equals the from-scratch fold at every cursor, forward, backward and repeated;
 *  2. a reading handed out never changes after the fold moved on;
 *  3. the by-type lists hold exactly the log's events of that type, in order, with their positions;
 *  4. the readouts rewritten onto those lists equal a plain reference loop over the whole log.
 */

const SET_IDS: SetId[] = ['set1', 'set2', 'set3', 'set4'];
const fp = (set: SetId): FuzzPool => ({ ...poolFor(set), tribes: SETS[set].tribes });
const SEEDS = Number(process.env.FRAME_FOLD_SEEDS ?? 12);

function fight(set: SetId, seed: number): CombatResult {
  const r = makeRng(seed * 7919 + set.length * 31 + set.charCodeAt(3));
  const A = fuzzCombatBoard(r, fp(set), 'A');
  const B = fuzzCombatBoard(r, fp(set), 'B');
  return simulate(A, B, makeRng(seed), CARD_INDEX, fuzzCombatSide(r, fp(set), 'A', A), fuzzCombatSide(r, fp(set), 'B', B));
}

describe('R-PERF-COMBAT-FOLD-01: continued readouts', () => {
  for (const set of SET_IDS) {
    it(`${set}: the continued buff and preview folds equal the from-scratch folds at every cursor`, () => {
      let moved = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const events = replayOrder(fight(set, seed).events);
        const buffs = makePrefixFold(COMBAT_BUFF_FOLD), previews = makePrefixFold(COMBAT_PREVIEW_FOLD);
        const held: { v: unknown; json: string }[] = [];
        const at = (upto: number): void => {
          const b = buffs(events, upto, undefined), p = previews(events, upto, undefined);
          expect(b, `${set} ${seed} buffs @${upto}`).toEqual(combatBuffDelta(events, upto));
          expect(p, `${set} ${seed} previews @${upto}`).toEqual(combatPreviewFold(events, upto));
          held.push({ v: b, json: JSON.stringify(b) }, { v: p, json: JSON.stringify(p) });
        };
        for (let upto = 0; upto <= events.length; upto++) at(upto);            // every event boundary, forward
        at(events.length + 5);                                                // past the end reads as the end
        at(Math.floor(events.length / 2)); at(Math.floor(events.length / 3)); // backward (a seek)
        at(events.length); at(0); at(0); at(1);                                // skip, rewatch, the same cursor twice
        for (const h of held) expect(JSON.stringify(h.v)).toBe(h.json);        // nothing handed out ever changed
        if (JSON.stringify(combatPreviewFold(events, events.length)) !== JSON.stringify(combatPreviewFold(events, 0))) moved++;
      }
      expect(moved, 'the sweep must contain fights that actually move a preview').toBeGreaterThan(0);
    });

    it(`${set}: the by-type lists are the log's own events, and the readouts built on them match a plain loop`, () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const res = fight(set, seed);
        const events = replayOrder(res.events);
        for (const type of ['questTrigger', 'toHand', 'handBuff', 'summon', 'death', 'questComplete', 'runeSequence'] as const) {
          const want = events.map((e, i) => ({ i, e })).filter((x) => x.e.type === type);
          expect(eventsOfType(events, type)).toEqual(want);
        }
        const beats = replayBeats(res.events);
        for (let beatIdx = 0; beatIdx <= beats.length + 1; beatIdx++) {
          const through = beatIdx === 0 ? 0 : (beats[beatIdx - 1]?.end ?? events.length);
          const prefix = events.slice(0, through);
          // The three hand readouts, against the slice-and-scan they replaced.
          expect(grantsShownThrough(events, beats, beatIdx)).toEqual(prefix.flatMap((e) => (e.type === 'toHand' && e.side === 'player' ? [e.cardId] : [])));
          const buffed: Record<string, { attack: number; health: number }> = {};
          for (const e of prefix) if (e.type === 'handBuff' && e.side === 'player') { const c = buffed[e.uid] ?? { attack: 0, health: 0 }; buffed[e.uid] = { attack: c.attack + e.attack, health: c.health + e.health }; }
          expect(handBuffsShownThrough(events, beats, beatIdx)).toEqual(buffed);
          for (const side of ['player', 'enemy'] as const) {
            const grey = new Set<string>();
            for (const e of prefix) if (e.type === 'summon' && e.side === side && e.fromHandUid) grey.add(e.fromHandUid);
            expect(handSummonedShownThrough(events, beats, beatIdx, undefined, side)).toEqual(grey);
          }
          // The step-keyed readouts (not a prefix: the replay reorders inside a step), against a scan of the whole log.
          if (through > 0) {
            const curStep = events[through - 1]?.step ?? Infinity;
            for (const side of ['player', 'enemy'] as const) {
              const counts: Record<string, number> = {}, flags: Record<string, number> = {};
              let seq: string[] | undefined;
              for (const e of events as CombatEvent[]) {
                if (e.type === 'questTrigger' && e.side === side && (e.step ?? 0) <= curStep) {
                  flags[e.flag] = (flags[e.flag] ?? 0) + 1;
                  for (const id of badgeIdsForCombatFlag(e.flag)) counts[id] = (counts[id] ?? 0) + 1;
                }
                if (e.type === 'runeSequence' && e.side === side && (e.step ?? 0) <= curStep) seq = e.seq;
              }
              const got = triggerCounts(events, through, false, side);
              for (const [id, n] of Object.entries(counts)) expect(got[id], `${set} ${seed} badge ${id}`).toBe(n);
              const rp = runeProgress(events, through, false, side, undefined);
              expect(rp?.triggers).toEqual(flags);
              expect(rp?.sequence).toEqual(seq);
            }
          }
        }
      }
    });
  }

  it('a different log or a different context starts the fold over', () => {
    const a = replayOrder(fight('set1', 2).events), b = replayOrder(fight('set3', 2).events);
    const count = makePrefixFold<{ n: number; tag: string }, string, string>({
      init: (tag) => ({ n: 0, tag }),
      step: (s) => { s.n++; },
      read: (s) => `${s.tag}:${s.n}`,
    });
    expect(count(a, a.length, 'x')).toBe(`x:${a.length}`);
    expect(count(b, 3, 'x')).toBe('x:3');     // another fight: from zero
    expect(count(b, 5, 'x')).toBe('x:5');     // continued
    expect(count(b, 5, 'y')).toBe('y:5');     // another context: from zero, same reading
    expect(count(b, 2, 'y')).toBe('y:2');     // backward: from zero
    expect(foldPrefix({ init: () => ({ n: 0 }), step: (s: { n: number }) => { s.n++; }, read: (s) => s.n }, a, 4, undefined)).toBe(4);
  });
});
