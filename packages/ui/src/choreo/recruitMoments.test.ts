import { describe, expect, it } from 'vitest';
import type { RunState } from '@game/sim';
import {
  captureRecruitSeqs, RECRUIT_MOMENT_KINDS, recruitMomentsSince, recruitSeqsOf, type RecruitSeqs, shoutMoment,
  selfBuffMoment, spellCastMoment } from './recruitMoments';

/** Only the FX fields are read; the rest of a RunState is irrelevant to this scan. `rubyLanded` is per-card
 *  (board or a lone shop offer); the shop SPAN comes from the sim's `veinstormFx`, not from any zone here. */
type Src = Parameters<typeof recruitMomentsSince>[0];
const run = (o: Partial<Src> = {}): Src => ({
  rubyLandedFxSeq: undefined, rubyLandedFx: undefined,
  recruitFxSeq: undefined, recruitBuffFx: [],
  veinstormFxSeq: undefined, veinstormFx: undefined,
  shopBuffAllFxSeq: undefined, shopBuffAllFx: undefined,
  ...o,
} as Src);

/** A veinstormFx payload. attack/health default to 1/1 — the moment layer ignores them (the badge hold
 *  reads them, not the moment), so any value keeps these tests focused on uids + onRefresh. */
const vfx = (uids: string[], onRefresh: boolean, attack = 1, health = 1) => ({ uids, onRefresh, attack, health });

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

  describe('shopRubied (the Veinstorm span)', () => {
    /** Driven by the sim's `veinstormFx`, NOT by any shop-vs-board zone — a lone Ruby on an offer stays
     *  `rubyLanded` (above). One moment carrying every gemmed offer, for one spanning play. */
    it('emits one shopRubied carrying every gemmed offer', () => {
      const r = run({ veinstormFxSeq: 1, veinstormFx: vfx(['s1', 's2', 's3'], false) });
      const moments = recruitMomentsSince(r, NONE);
      expect(moments).toHaveLength(1);
      expect(moments[0]?.kind).toBe('shopRubied');
      expect(moments[0]?.recipients).toEqual([{ uid: 's1', count: 1 }, { uid: 's2', count: 1 }, { uid: 's3', count: 1 }]);
    });

    it('carries the onRefresh flag through, for the span delay', () => {
      const cast = run({ veinstormFxSeq: 1, veinstormFx: vfx(['s1'], false) });
      const refresh = run({ veinstormFxSeq: 1, veinstormFx: vfx(['s1'], true) });
      expect(recruitMomentsSince(cast, NONE)[0]?.onRefresh).toBe(false);
      expect(recruitMomentsSince(refresh, NONE)[0]?.onRefresh).toBe(true);
    });

    it('fires only when the veinstorm seq moves, not the ruby one', () => {
      const r = run({ rubyLandedFxSeq: 2, rubyLandedFx: [{ uid: 'b1', count: 1 }], veinstormFxSeq: 5, veinstormFx: vfx(['s1'], false) });
      // Same veinstorm seq as prev → no shopRubied, even though ruby moved.
      const moments = recruitMomentsSince(r, { rubyLanded: 0, veinstorm: 5 });
      expect(moments.map((m) => m.kind)).toEqual(['rubyLanded']);
    });

    it('yields nothing for an empty gemmed-offer list', () => {
      const r = run({ veinstormFxSeq: 1, veinstormFx: vfx([], false) });
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
      // A per-card Ruby ('a'), a Veinstorm gemming ('s1' via veinstormFx), a run-wide shop buff, and a buff
      // wave — so `rubyLanded`, `shopRubied`, `shopBuffAll` and `minionBuffed` all appear from
      // `recruitMomentsSince`.
      ...recruitMomentsSince(run({
        rubyLandedFxSeq: 1, rubyLandedFx: [{ uid: 'a', count: 1 }],
        veinstormFxSeq: 1, veinstormFx: vfx(['s1'], false),
        shopBuffAllFxSeq: 1, shopBuffAllFx: { uids: ['s1'], attack: 2, health: 2 },
        recruitFxSeq: 1, recruitBuffFx: [buff('b')],
      }), NONE).map((m) => m.kind),
      shoutMoment('a', 'dw_pimm').kind,
      selfBuffMoment('a', 'ashscribe').kind,
      spellCastMoment('wo_mine', { x: 0, y: 0 }).kind,
    ]);
    expect([...produced].sort()).toEqual([...RECRUIT_MOMENT_KINDS].sort());
  });

  describe('shopBuffAll — the whole shop buffed by a run-wide source', () => {
    it('fires once for the row, carrying the offers and the size of the buff', () => {
      const r = run({ shopBuffAllFxSeq: 1, shopBuffAllFx: { uids: ['s1', 's2', 's3'], attack: 2, health: 2 } });
      const m = recruitMomentsSince(r, NONE);
      expect(m).toHaveLength(1);
      expect(m[0]!.kind).toBe('shopBuffAll');
      expect(m[0]!.recipients.map((x) => x.uid)).toEqual(['s1', 's2', 's3']);
      expect(m[0]!.attack).toBe(2);
      expect(m[0]!.health).toBe(2);
    });

    it('still fires with an EMPTY shop — the run-wide buff happened even with no offers to show it on', () => {
      // The cue is camera-anchored and never measures a card, so this must not be filtered out here either
      // (a buff bought mid-reroll is the reachable case).
      const m = recruitMomentsSince(run({ shopBuffAllFxSeq: 1, shopBuffAllFx: { uids: [], attack: 1, health: 1 } }), NONE);
      expect(m.map((x) => x.kind)).toEqual(['shopBuffAll']);
    });

    it('does not fire when the seq is unchanged, so one buff plays once', () => {
      const r = run({ shopBuffAllFxSeq: 3, shopBuffAllFx: { uids: ['s1'], attack: 1, health: 1 } });
      expect(recruitMomentsSince(r, { shopBuffAll: 3 })).toEqual([]);
    });

    it('ignores a zero-magnitude payload — a bumped seq that bought no stats is not a moment', () => {
      const r = run({ shopBuffAllFxSeq: 1, shopBuffAllFx: { uids: ['s1'], attack: 0, health: 0 } });
      expect(recruitMomentsSince(r, NONE)).toEqual([]);
    });

    it('is independent of the Veinstorm gem span — neither implies the other', () => {
      // The two channels are disjoint by construction (`spellBuffShopByRuby` deliberately avoids
      // `tavernBuyBonus`), and this pins that the moment layer keeps them apart too: a gemming alone must
      // never produce the aura, or Veinstorm would fire both the gem span and the shop-buff aura.
      const gems = recruitMomentsSince(run({ veinstormFxSeq: 1, veinstormFx: vfx(['s1'], false) }), NONE);
      expect(gems.map((m) => m.kind)).toEqual(['shopRubied']);
      const buff = recruitMomentsSince(run({ shopBuffAllFxSeq: 1, shopBuffAllFx: { uids: ['s1'], attack: 1, health: 1 } }), NONE);
      expect(buff.map((m) => m.kind)).toEqual(['shopBuffAll']);
    });
  });

  it('a shout names its own card as the source, so each minion resolves its own binding', () => {
    const m = shoutMoment('u1', 'dw_pimm');
    expect(m).toEqual({ kind: 'shout', sourceCardId: 'dw_pimm', recipients: [{ uid: 'u1', count: 1 }] });
  });

  it('a self-buff names its own card as the source (recipient IS the source)', () => {
    const m = selfBuffMoment('u1', 'ashscribe');
    expect(m).toEqual({ kind: 'minionSelfBuffed', sourceCardId: 'ashscribe', recipients: [{ uid: 'u1', count: 1 }] });
  });

  it('a spellCast names its card as the source and carries the release point', () => {
    const m = spellCastMoment('wo_mine', { x: 120, y: 340 });
    // `casts` defaults to 1 — one action, one resolution — and rises with the play site's multicast total.
    expect(m).toEqual({ kind: 'spellCast', sourceCardId: 'wo_mine', recipients: [], point: { x: 120, y: 340 }, casts: 1 });
  });

  it('carries recipients when the cast buffed minions (trail targets)', () => {
    const m = spellCastMoment('wo_champion', { x: 10, y: 20 }, [{ uid: 'm1', count: 1 }]);
    expect(m).toEqual({ kind: 'spellCast', sourceCardId: 'wo_champion', recipients: [{ uid: 'm1', count: 1 }], point: { x: 10, y: 20 }, casts: 1 });
  });

  it('marks a minionBuffed moment `crit` when a contributing event came from the body that critted', () => {
    // `karwindCritUid` is the UID of the body whose buff doubled; an event with that `sourceUid` makes its
    // wave a crit, which the cue runner turns into the binding's `critDef`.
    const critBuff = { targetUid: 't', attack: 6, health: 6, sourceUid: 'kw1', sourceCardId: 'karwind', sourceTribe: 'dragon', kind: 'minion' } as RunState['recruitBuffFx'][number];
    const r = run({ recruitFxSeq: 1, recruitBuffFx: [critBuff], karwindCritUid: 'kw1' });
    const m = recruitMomentsSince(r, NONE);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: 'minionBuffed', sourceCardId: 'karwind', crit: true });
  });

  it('leaves `crit` off an ordinary (non-crit) buff wave', () => {
    const normal = { targetUid: 't', attack: 3, health: 3, sourceUid: 'kw1', sourceCardId: 'karwind', sourceTribe: 'dragon', kind: 'minion' } as RunState['recruitBuffFx'][number];
    const r = run({ recruitFxSeq: 1, recruitBuffFx: [normal], karwindCritUid: undefined });
    expect(recruitMomentsSince(r, NONE)[0].crit).toBeUndefined();
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
