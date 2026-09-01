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
  /** One or more Rubies were played per-card — a drag from hand, a board-wide gem (Frenzied Excavator), OR a
   *  lone Ruby onto a single tavern offer. Each detonates on its own card; the cue cascades down them. */
  | 'rubyLanded'
  /**
   * VEINSTORM gemmed the shop — one event across the whole row, not a per-card cascade. Driven by the sim's
   * `veinstormFx` signal (NOT by zone): a lone Ruby on an offer is `rubyLanded`, only Veinstorm is this. The
   * cue reads the gemmed offers' horizontal extent and plays its bound def once across it, with a single
   * sound (see `recruitCues.ts`). `onRefresh` (carried on the moment) delays the span so a re-stamped shop
   * lands its gems with the offers rather than while they slide in.
   */
  | 'shopRubied'
  /**
   * The whole SHOP was buffed by a run-wide source — "minions in the Shop get +A/+H" (Staff of Guel's cast,
   * Contract Butcher's Shout, Soul Defiler at End of Turn, a quest's `shopBuff` reward). One moment for the
   * row, not a per-offer cascade, and camera-anchored: this is a shop-wide event, so the bound def frames on
   * the viewport rather than on any one card.
   *
   * Driven by the sim's `tavernBuyBonus` diff, which is what makes it mean ALL shop units. Market Tormentor
   * growing the right-most offer rides the per-offer channel and never produces this; Veinstorm's gemming was
   * deliberately kept off that channel, so it stays on its own `shopRubied` span and never doubles up here.
   */
  | 'shopBuffAll'
  /** A board minion gained stats from a shop-phase source — a Shout, a spell, an End of Turn. */
  | 'minionBuffed'
  /**
   * A minion buffed ITSELF in the shop (Ashscribe). This is the "pulse channel" — the self-buffs `captureBuffFx`
   * skips (they have no source→target pair for a tendril) and `Recruit.tsx` shows as a green stat-glow — promoted
   * to a bindable def. The recipient IS the source, so it is emitted one moment per self-buffing minion (like
   * `shout`) and keyed by that card, letting each resolve its OWN binding over the kind default (`self-buff-gold`).
   */
  | 'minionSelfBuffed'
  /**
   * A minion's Shout fired as it was played. Its source is the same signal that already drives the medallion
   * pulse in `Recruit.tsx`: a minion newly on the board whose def carries an `onPlay` effect (or a Choose One).
   *
   * The recipient IS the source — a Shout happens ON the card that shouted, with nothing to travel between —
   * so this is emitted one moment per shouting minion rather than one moment with several recipients. That is
   * what lets each card resolve its OWN binding: two different minions played in the same action would
   * otherwise have to share one, and the second would silently take the first's effect.
   */
  | 'shout'
  /** A tavern spell was cast; anchored at the release `point`, keyed by the spell's card id. */
  | 'spellCast';

export const RECRUIT_MOMENT_KINDS: readonly RecruitMomentKind[] = ['rubyLanded', 'shopRubied', 'shopBuffAll', 'minionBuffed', 'minionSelfBuffed', 'shout', 'spellCast'];

/**
 * A `shout` moment, built here rather than inline at the call site so the kind has a NAMED emitter in this
 * module — the invariant `recruitMoments.test.ts` guards is "no declared kind without a source", and a kind
 * assembled as an object literal somewhere in `Recruit.tsx` would satisfy the type checker while leaving that
 * guard unable to see it.
 *
 * Not folded into `recruitMomentsSince` because its source is not a counter: a Shout is detected by diffing
 * the BOARD (a minion is new, and its def has an `onPlay`), which `Recruit.tsx` already does to drive the
 * medallion pulse. Duplicating that diff here to satisfy one function's shape would mean two detectors for
 * one signal, and the second one would be the one that drifts.
 */
export function shoutMoment(uid: string, cardId: string): RecruitMoment {
  return { kind: 'shout', sourceCardId: cardId, recipients: [{ uid, count: 1 }] };
}

/**
 * A `minionSelfBuffed` moment — a minion that buffed itself in the shop. Same shape as `shoutMoment`: the
 * recipient IS the source, keyed by its card so each self-buffer resolves its OWN binding over the kind default.
 * Emitted from `Recruit.tsx`'s stat-diff (the green-pulse detector), not `recruitMomentsSince` — a self-buff is a
 * board diff, not a counter, exactly like a Shout.
 */
export function selfBuffMoment(uid: string, cardId: string): RecruitMoment {
  return { kind: 'minionSelfBuffed', sourceCardId: cardId, recipients: [{ uid, count: 1 }] };
}

/** A `spellCast` moment: a tavern spell cast, anchored at the release `point` and keyed by the spell's card
 *  id so each spell resolves its own binding. `recipients` defaults to empty — the anchor is the raw point, not
 *  a unit — but a BUFF ale (Champion's/Defensive/Bloody) passes the buffed minions here so the cue can fire once
 *  per recipient, cursor→minion, instead of a single point burst (Golden/Reinforcing stay point-only).
 *
 *  `casts` is how many times the spell RESOLVED (the play site's `spellCasts` total). One action can be several
 *  casts — Yazzus, Rune of Hoardflame, Spell Thesis — and the point burst plays once per cast so a doubled cast
 *  visibly procs twice (owner ask 2026-09-01). Defaults to 1, which is every caller that has no count to give. */
export function spellCastMoment(
  cardId: string,
  point: { x: number; y: number },
  recipients: RecruitRecipient[] = [],
  casts = 1,
): RecruitMoment {
  return { kind: 'spellCast', sourceCardId: cardId, recipients, point, casts };
}

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
  /** The card that CAUSED this moment, when it is source-attributed (a `minionBuffed` wave names the buffer).
   *  Present → the cue runner resolves the binding by THIS card rather than by each recipient, which is what
   *  lets Karwind ring every Dragon it pumps (`cards.karwind.minionBuffed`) instead of every Dragon carrying
   *  its own binding. Absent (rubyLanded) → recipient-keyed, as before. `''` is a sourceless wave (a spell or
   *  a dead Deathrattle) — it keys nothing and so only ever resolves a kind-level binding. */
  sourceCardId?: string;
  /** A CRIT wave — a doubled buff (Karwind's 20% roll). The cue runner plays the binding's `critDef` instead
   *  of its `def` when this is set. Only `minionBuffed` produces it today; absent everywhere else. */
  crit?: boolean;
  /** `shopRubied` only: the gemming was a shop REFRESH re-stamp, not the Veinstorm cast. The cue holds the
   *  span a beat when true, so it lands with the offers rather than while they are still sliding in. */
  onRefresh?: boolean;
  /** spellCast only: the release point (page coords) the effect fires from — the `cursor` anchor. */
  point?: { x: number; y: number };
  /** spellCast only: how many times the spell resolved. The point burst plays once per cast, so a multicast
   *  reads as several procs rather than one (owner ask 2026-09-01). Absent = once. */
  casts?: number;
  /** `shopBuffAll` only: how much the run-wide shop channel rose. Carried for a future def that wants to
   *  scale with the size of the buff (and for the cue's own logging); the shipped aura is a fixed play. */
  attack?: number;
  health?: number;
}

/**
 * The counter values a `RunState` was last read at. Compared rather than stored on the run, so this module
 * needs no lifecycle of its own and a caller can hold one ref.
 */
export interface RecruitSeqs {
  rubyLanded?: number;
  recruitFx?: number;
  veinstorm?: number;
  shopBuffAll?: number;
}

/** The counters as they stand right now. For creating a caller's initial ref — steady-state updates should
 *  go through {@link captureRecruitSeqs}, which writes in place. */
export function recruitSeqsOf(run: Pick<RunState, 'rubyLandedFxSeq' | 'recruitFxSeq' | 'veinstormFxSeq' | 'shopBuffAllFxSeq'>): RecruitSeqs {
  return { rubyLanded: run.rubyLandedFxSeq, recruitFx: run.recruitFxSeq, veinstorm: run.veinstormFxSeq, shopBuffAll: run.shopBuffAllFxSeq };
}

/**
 * Advance a caller's snapshot IN PLACE, allocating nothing.
 *
 * The shop is the hot phase — a drag re-renders the largest component in the app at ~90fps — so the
 * bookkeeping on the path that runs per player action allocates zero objects. Same out-param discipline as
 * `emissionOffset`/`spawnVelocity`.
 */
export function captureRecruitSeqs(
  run: Pick<RunState, 'rubyLandedFxSeq' | 'recruitFxSeq' | 'veinstormFxSeq' | 'shopBuffAllFxSeq'>,
  into: RecruitSeqs,
): void {
  into.rubyLanded = run.rubyLandedFxSeq;
  into.recruitFx = run.recruitFxSeq;
  into.veinstorm = run.veinstormFxSeq;
  into.shopBuffAll = run.shopBuffAllFxSeq;
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
  run: Pick<RunState, 'rubyLandedFxSeq' | 'rubyLandedFx' | 'recruitFxSeq' | 'recruitBuffFx' | 'karwindCritUid' | 'veinstormFxSeq' | 'veinstormFx' | 'shopBuffAllFxSeq' | 'shopBuffAllFx'>,
  prev: RecruitSeqs,
): RecruitMoment[] {
  const out: RecruitMoment[] = [];

  // Per-card gems — a hand Ruby, a board-wide play, or a lone Ruby on ONE offer. The reducer has already
  // pulled Veinstorm-gemmed offers OUT of this list (they are the span below), so everything here cascades on
  // its own card. A Ruby carries its own per-uid count, so a 2-stack arrives as one recipient with count 2.
  if (run.rubyLandedFxSeq !== undefined && run.rubyLandedFxSeq !== prev.rubyLanded) {
    const recipients = (run.rubyLandedFx ?? [])
      .filter((r) => r.count > 0)
      .map((r) => ({ uid: r.uid, count: r.count }));
    if (recipients.length > 0) out.push({ kind: 'rubyLanded', recipients });
  }

  // VEINSTORM gemmed the shop — one spanning play, keyed off the sim's dedicated signal rather than by zone,
  // so a lone Ruby on an offer (above, `rubyLanded`) and Veinstorm gemming the whole row are never confused.
  // The recipients are the gemmed offers; the cue reads their extent. `onRefresh` rides along for the delay.
  if (run.veinstormFxSeq !== undefined && run.veinstormFxSeq !== prev.veinstorm) {
    const uids = run.veinstormFx?.uids ?? [];
    if (uids.length > 0) {
      out.push({ kind: 'shopRubied', recipients: uids.map((uid) => ({ uid, count: 1 })), onRefresh: !!run.veinstormFx?.onRefresh });
    }
  }

  // The whole SHOP was buffed by the run-wide channel — one camera-anchored moment for the row. The
  // recipients are the offers on screen, carried so a re-authored def could span them; the shipped aura is
  // camera-anchored and ignores them. Emitted even when the shop is EMPTY (a buff bought with no offers up
  // still happened), so the cue never depends on measuring a card.
  if (run.shopBuffAllFxSeq !== undefined && run.shopBuffAllFxSeq !== prev.shopBuffAll) {
    const f = run.shopBuffAllFx;
    if (f !== undefined && (f.attack > 0 || f.health > 0)) {
      out.push({ kind: 'shopBuffAll', recipients: f.uids.map((uid) => ({ uid, count: 1 })), attack: f.attack, health: f.health });
    }
  }

  // A buff wave is split into ONE moment per SOURCE card, mirroring how combat gives each buff wave its own
  // source-keyed moment — so a source-attributed binding (Karwind → flame-ring on every Dragon it pumps)
  // resolves by the BUFFER rather than by each buffed card. Two sources buffing in one action are two moments;
  // a source that hits the same target twice is a STACK on that target (a cascade over duplicate recipients
  // would visit one card twice as if they were different bodies). Source order and per-source target order are
  // both first-appearance, so the cascade sweeps the board the way the events arrived.
  if (run.recruitFxSeq !== undefined && run.recruitFxSeq !== prev.recruitFx) {
    const bySource = new Map<string, { byUid: Map<string, RecruitRecipient>; order: string[]; crit: boolean }>();
    const sourceOrder: string[] = [];
    for (const e of run.recruitBuffFx ?? []) {
      if (e.attack === 0 && e.health === 0) continue; // a zero buff changes no digit and reads as nothing
      let group = bySource.get(e.sourceCardId);
      if (!group) {
        group = { byUid: new Map(), order: [], crit: false };
        bySource.set(e.sourceCardId, group);
        sourceOrder.push(e.sourceCardId);
      }
      // A crit is the doubled-buff roll (Karwind's `karwindCritUid` = the uid of the body that critted). An
      // event belongs to that crit when its own `sourceUid` matches — precise for the common one-buffer case.
      // Events grouped by cardId can span two same-name buffers (two Karwinds); if EITHER critted the whole
      // wave reads as a crit, which over-reddens the rare double-Karwind case and is a deliberate simplification.
      if (e.sourceUid !== undefined && e.sourceUid === run.karwindCritUid) group.crit = true;
      const seen = group.byUid.get(e.targetUid);
      if (seen) seen.count += 1;
      else {
        group.byUid.set(e.targetUid, { uid: e.targetUid, count: 1 });
        group.order.push(e.targetUid);
      }
    }
    for (const sourceCardId of sourceOrder) {
      const group = bySource.get(sourceCardId)!;
      const moment: RecruitMoment = { kind: 'minionBuffed', sourceCardId, recipients: group.order.map((u) => group.byUid.get(u)!) };
      if (group.crit) moment.crit = true;
      out.push(moment);
    }
  }

  return out;
}
