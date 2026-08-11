import { describe, expect, it } from 'vitest';
import type { RunState } from '@game/sim';
import {
  captureRecruitSeqs, RECRUIT_MOMENT_KINDS, recruitMomentsSince, recruitSeqsOf, type RecruitSeqs, shoutMoment } from './recruitMoments';

/** Only the four FX fields are read; the rest of a RunState is irrelevant to this scan. */
type Src = Parameters<typeof recruitMomentsSince>[0];
const run = (o: Partial<Src> = {}): Src => ({
  rubyLandedFxSeq: undefined, rubyLandedFx: undefined,
  recruitFxSeq: undefined, recruitBuffFx: [],
  ...o,
} as Src);

const buff = (targetUid: string, attack = 1, health = 1): RunState['recruitBuffFx'][number] =>
  ({ targetUid, attack, health, sourceCardId: 'x', sourceTribe: 'beast', kind: 'minion' } as RunState['recruitBuffFx'][number]);

const buffFrom = (sourceCardId: string, targetUid: string): RunState['recruitBuffFx'][number] =>
  ({ targetUid, attack: 1, health: 1, sourceCardId, sourceTribe: 'dragon', kind: 'minion' } as RunState['recruitBuffFx'][number]);

const NONE: RecruitSeqs = {};

describe('recruitMomentsSince', () => {
  it('yields nothing when no counter has moved — a re-render with no action is free', () => {
    const r = run({ rubyLandedFxSeq: 4, rubyLandedFx: [{ uid: 'a', count: 1 }], recruitFxSeq: 9, recruitBuffFx: [buff('b')] });
    expect(recruitMomentsSince(r, recruitSeqsOf(r))).toEqual([]);
  });

  it('yields nothing for a run that has never fired either signal', () => {
    expect(recruitMomentsSince(run(), NONE)).toEqual([]);
  });

  describe('rubyLanded', () => {
    it('carries each recipient and its stack count', () => {
      const r = run({ rubyLandedFxSeq: 1, rubyLandedFx: [{ uid: 'a', count: 2 }, { uid: 'b', count: 1 }] });
      expect(recruitMomentsSince(r, NONE)).toEqual([
        { kind: 'rubyLanded', recipients: [{ uid: 'a', count: 2 }, { uid: 'b', count: 1 }] },
      ]);
    });

    /** A stack is two gems on one body. Collapsing it to a single land would under-report the count, which
     *  is the defect a gilded Frenzied Excavator once shipped with. */
    it('keeps a 2-stack as a count, not two recipients', () => {
      const r = run({ rubyLandedFxSeq: 1, rubyLandedFx: [{ uid: 'a', count: 2 }] });
      expect(recruitMomentsSince(r, NONE)[0]?.recipients).toEqual([{ uid: 'a', count: 2 }]);
    });

    it('fires again when the counter moves, even with the same payload', () => {
      const payload = [{ uid: 'a', count: 1 }];
      const first = run({ rubyLandedFxSeq: 1, rubyLandedFx: payload });
      const seqs = recruitSeqsOf(first);
      const second = run({ rubyLandedFxSeq: 2, rubyLandedFx: payload });
      expect(recruitMomentsSince(second, seqs)).toHaveLength(1);
    });

    it('drops a zero-count entry rather than scheduling a land that shows nothing', () => {
      const r = run({ rubyLandedFxSeq: 1, rubyLandedFx: [{ uid: 'a', count: 0 }] });
      expect(recruitMomentsSince(r, NONE)).toEqual([]);
    });
  });

  describe('minionBuffed', () => {
    it('names each buffed minion once, in event order', () => {
      const r = run({ recruitFxSeq: 1, recruitBuffFx: [buff('b'), buff('a')] });
      expect(recruitMomentsSince(r, NONE)[0]?.recipients.map((x) => x.uid)).toEqual(['b', 'a']);
    });

    /** Two sources buffing one minion in a single action is a STACK on that minion, not two minions. A
     *  cascade over duplicate recipients would visit the same card twice as if they were different bodies. */
    it('counts a repeat target into a stack instead of duplicating it', () => {
      const r = run({ recruitFxSeq: 1, recruitBuffFx: [buff('a'), buff('b'), buff('a')] });
      expect(recruitMomentsSince(r, NONE)[0]?.recipients).toEqual([{ uid: 'a', count: 2 }, { uid: 'b', count: 1 }]);
    });

    it('ignores a zero buff — it changes no digit and reads as nothing', () => {
      const r = run({ recruitFxSeq: 1, recruitBuffFx: [buff('a', 0, 0)] });
      expect(recruitMomentsSince(r, NONE)).toEqual([]);
    });

    it('names the source of the wave, so the cue can key the binding by the buffer', () => {
      const r = run({ recruitFxSeq: 1, recruitBuffFx: [buffFrom('karwind', 'd1')] });
      expect(recruitMomentsSince(r, NONE)).toEqual([
        { kind: 'minionBuffed', sourceCardId: 'karwind', recipients: [{ uid: 'd1', count: 1 }] },
      ]);
    });

    /** Two sources buffing in ONE action are two moments — mirroring how combat gives each buff wave its own
     *  source-keyed moment — so each source's binding resolves on its own recipients rather than smearing across
     *  the whole board. Source order and per-source target order are both first-appearance. */
    it('splits a mixed-source wave into one moment per source', () => {
      const r = run({
        recruitFxSeq: 1,
        recruitBuffFx: [buffFrom('karwind', 'd1'), buffFrom('d2_matriarch', 'd1'), buffFrom('karwind', 'd2')],
      });
      expect(recruitMomentsSince(r, NONE)).toEqual([
        { kind: 'minionBuffed', sourceCardId: 'karwind', recipients: [{ uid: 'd1', count: 1 }, { uid: 'd2', count: 1 }] },
        { kind: 'minionBuffed', sourceCardId: 'd2_matriarch', recipients: [{ uid: 'd1', count: 1 }] },
      ]);
    });
  });

  it('emits both kinds in a stable order when one action does both', () => {
    const r = run({
      rubyLandedFxSeq: 1, rubyLandedFx: [{ uid: 'a', count: 1 }],
      recruitFxSeq: 1, recruitBuffFx: [buff('b')],
    });
    expect(recruitMomentsSince(r, NONE).map((m) => m.kind)).toEqual(['rubyLanded', 'minionBuffed']);
  });

  /** Every declared kind must be reachable, or the workbench publishes a binding slot that never fires —
   *  the exact failure the `rally` binding shipped with for weeks.
   *
   *  Covers EVERY emitter in this module, not just `recruitMomentsSince`: `shout` is detected by a board
   *  diff rather than a counter (see `shoutMoment`), so a check that only knew about the counter-driven
   *  function would either fail on a perfectly sourced kind or have to be weakened to ignore it. Adding a
   *  kind still fails this test until its emitter is listed here. */
  it('every declared kind is actually produced by some emitter', () => {
    const produced = new Set<string>([
      ...recruitMomentsSince(run({
        rubyLandedFxSeq: 1, rubyLandedFx: [{ uid: 'a', count: 1 }],
        recruitFxSeq: 1, recruitBuffFx: [buff('b')],
      }), NONE).map((m) => m.kind),
      shoutMoment('a', 'dw_pimm').kind,
    ]);
    expect([...produced].sort()).toEqual([...RECRUIT_MOMENT_KINDS].sort());
  });

  it('a shout names its own card as the source, so each minion resolves its own binding', () => {
    const m = shoutMoment('u1', 'dw_pimm');
    expect(m).toEqual({ kind: 'shout', sourceCardId: 'dw_pimm', recipients: [{ uid: 'u1', count: 1 }] });
  });
});

describe('recruitSeqsOf', () => {
  it('snapshots both counters so a caller can hold one ref', () => {
    expect(recruitSeqsOf(run({ rubyLandedFxSeq: 3, recruitFxSeq: 8 }) as RunState))
      .toEqual({ rubyLanded: 3, recruitFx: 8 });
  });
});

/**
 * The shop is the HOT phase — a drag re-renders the largest component in the app at ~90fps — so the
 * per-action bookkeeping must not allocate. `captureRecruitSeqs` is the in-place half of that.
 */
describe('captureRecruitSeqs', () => {
  it('advances a snapshot in place, keeping the same object', () => {
    const snap = recruitSeqsOf(run({ rubyLandedFxSeq: 1, recruitFxSeq: 1 }) as RunState);
    const identity = snap;
    captureRecruitSeqs(run({ rubyLandedFxSeq: 5, recruitFxSeq: 7 }) as RunState, snap);
    expect(snap).toBe(identity);                       // no new object
    expect(snap).toEqual({ rubyLanded: 5, recruitFx: 7 });
  });

  it('round-trips: capturing then diffing yields nothing', () => {
    const r = run({ rubyLandedFxSeq: 3, rubyLandedFx: [{ uid: 'a', count: 1 }], recruitFxSeq: 4, recruitBuffFx: [buff('b')] });
    const snap = recruitSeqsOf(run() as RunState);
    expect(recruitMomentsSince(r, snap)).toHaveLength(2);   // first read sees both
    captureRecruitSeqs(r, snap);
    expect(recruitMomentsSince(r, snap)).toEqual([]);       // second sees nothing
  });

  it('carries undefined through, so a run that never fired stays quiet', () => {
    const snap = recruitSeqsOf(run({ rubyLandedFxSeq: 2 }) as RunState);
    captureRecruitSeqs(run() as RunState, snap);
    expect(snap).toEqual({ rubyLanded: undefined, recruitFx: undefined });
  });
});
