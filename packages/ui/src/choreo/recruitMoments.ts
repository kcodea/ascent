import type { RunState } from '@game/sim';

/**
 * RECRUIT MOMENTS — the shop phase's answer to a combat `Moment`.
 *
 * ── the gap this closes ──────────────────────────────────────────────────────────────────────────────
 * Moments, kinds and cues are slices of the COMBAT event log, so the shop had nowhere to bind: every
 * shop-phase effect became a bespoke `useEffect` in `Recruit.tsx` watching a run-state counter and calling
 * `playDef` with a HARDCODED def id. Sixteen of those counters exist today (`rubyLandedFxSeq`, `weldFxSeq`,
 * `karwindFlashSeq`, `swapFxSeq`, `buffGustSeq`, `auraFxSeq`, `questTendrilSeq`, `fodderEatenSeq`, …) — one
 * per effect, each costing a reducer field, a bump site and ~50 lines of React, and none of it re-bindable
 * from the workbench.
 *
 * That matters more than the line count: counting Set 2's content, `onPlay` (Shout) is its single most
 * common trigger at 31 cards, and with the shop-economy tail roughly 60% of Set 2's trigger instances fire
 * in the shop. The most common mechanic in the set could not have an authored effect attached to it.
 *
 * ── what this is, and what it is NOT (yet) ───────────────────────────────────────────────────────────
 * A moment here is the same shape a combat moment presents to the cue runner: a KIND (what happened) plus
 * the units it happened to. The binding table is shared with combat — `bindings.json` gains rows keyed by
 * these kinds, so "which def plays when a Ruby lands in the shop" is data, exactly as it is in combat.
 *
 * This slice DERIVES moments from the counters the reducer already emits, rather than adding emission to
 * `reducer.ts`/`state.ts`. That is deliberate and temporary: those two are the repo's hottest conflict files
 * (see CLAUDE.md) with another session actively landing content through them, and an adapter buys the whole
 * binding surface without touching either. The follow-up is to emit `RecruitMoment`s at the real sites and
 * retire the ad-hoc counters — at which point this file keeps its vocabulary and loses its adapter.
 *
 * PURE and React-free, so it is unit-testable headlessly like `channels/rallyFired.ts`.
 */

/**
 * What happened in the shop, in GAME terms rather than replay terms.
 *
 * Deliberately named for what a designer would say ("a Ruby landed", "a minion was buffed") rather than for
 * the counter it currently reads. The counters are an implementation detail this file is here to hide, and
 * the names have to survive their removal.
 *
 * Only the kinds an existing signal can actually supply are declared. Adding one without a source would
 * publish a binding slot that silently never fires — the exact failure this subsystem keeps producing.
 */
export type RecruitMomentKind =
  /** One or more Rubies were played onto board minions (drag from hand, a card that gems the board, an offer). */
  | 'rubyLanded'
  /** A board minion gained stats from a shop-phase source — a Shout, a spell, an End of Turn. */
  | 'minionBuffed';

export const RECRUIT_MOMENT_KINDS: readonly RecruitMomentKind[] = ['rubyLanded', 'minionBuffed'];

/** One recipient of a moment, and how many times it received. `count` above 1 is a STACK — two Rubies on
 *  one body — which the cue walks as repeats rather than collapsing (see `fx/land.ts`). */
export interface RecruitRecipient {
  uid: string;
  count: number;
}

export interface RecruitMoment {
  kind: RecruitMomentKind;
  /** In board order where the source provides one, so a cascade sweeps the line left to right. */
  recipients: RecruitRecipient[];
}

/**
 * The counter values a `RunState` was last read at. Compared rather than stored on the run, so this module
 * needs no lifecycle of its own and a caller can hold one ref.
 */
export interface RecruitSeqs {
  rubyLanded?: number;
  recruitFx?: number;
}

/** The counters as they stand right now. For creating a caller's initial ref — steady-state updates should
 *  go through {@link captureRecruitSeqs}, which writes in place. */
export function recruitSeqsOf(run: Pick<RunState, 'rubyLandedFxSeq' | 'recruitFxSeq'>): RecruitSeqs {
  return { rubyLanded: run.rubyLandedFxSeq, recruitFx: run.recruitFxSeq };
}

/**
 * Advance a caller's snapshot IN PLACE, allocating nothing.
 *
 * The shop is the hot phase — a drag re-renders the largest component in the app at ~90fps — so the
 * bookkeeping on the path that runs per player action allocates zero objects. Same out-param discipline as
 * `emissionOffset`/`spawnVelocity`.
 */
export function captureRecruitSeqs(
  run: Pick<RunState, 'rubyLandedFxSeq' | 'recruitFxSeq'>,
  into: RecruitSeqs,
): void {
  into.rubyLanded = run.rubyLandedFxSeq;
  into.recruitFx = run.recruitFxSeq;
}

/**
 * The moments that have happened since `prev`.
 *
 * A counter that is unchanged yields nothing, so a re-render with no new action is free — the same
 * "did the sequence move" test each bespoke effect was making for itself, done once.
 *
 * Returns them in a stable order (declaration order of the kinds) so two effects landing on the same action
 * always play in the same order, rather than in whatever order the fields happen to be read.
 */
export function recruitMomentsSince(
  run: Pick<RunState, 'rubyLandedFxSeq' | 'rubyLandedFx' | 'recruitFxSeq' | 'recruitBuffFx'>,
  prev: RecruitSeqs,
): RecruitMoment[] {
  const out: RecruitMoment[] = [];

  // A Ruby carries its own per-uid count, so a 2-stack arrives as one recipient with count 2.
  if (run.rubyLandedFxSeq !== undefined && run.rubyLandedFxSeq !== prev.rubyLanded) {
    const recipients = (run.rubyLandedFx ?? [])
      .filter((r) => r.count > 0)
      .map((r) => ({ uid: r.uid, count: r.count }));
    if (recipients.length > 0) out.push({ kind: 'rubyLanded', recipients });
  }

  // A buff wave names one target per event and can name the same one twice (two sources in one action), so
  // repeats are COUNTED into a stack rather than emitted as duplicate recipients — otherwise the cascade
  // would visit the same card twice as if they were different minions.
  if (run.recruitFxSeq !== undefined && run.recruitFxSeq !== prev.recruitFx) {
    const byUid = new Map<string, RecruitRecipient>();
    const order: string[] = [];
    for (const e of run.recruitBuffFx ?? []) {
      if (e.attack === 0 && e.health === 0) continue; // a zero buff changes no digit and reads as nothing
      const seen = byUid.get(e.targetUid);
      if (seen) seen.count += 1;
      else {
        byUid.set(e.targetUid, { uid: e.targetUid, count: 1 });
        order.push(e.targetUid);
      }
    }
    if (order.length > 0) out.push({ kind: 'minionBuffed', recipients: order.map((u) => byUid.get(u)!) });
  }

  return out;
}
