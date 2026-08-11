import { cascade, scheduleLands, type Land } from '../fx/land';
import { sfx } from '../sfx';
import { canPlayDefs, playDef } from '../fx/playDef';
import { bindingFor, type FxBinding } from './bindings';
import { RUBY_BEAT_MS, RUBY_GAP_MS } from './channels/rubyLanded';
import type { RecruitMoment } from './recruitMoments';

/**
 * The SHOP cue runner — the recruit-phase counterpart to `runMomentCues`.
 *
 * What a bespoke shop effect used to do by hand, once: diff a counter, wait a frame so the re-rendered cards
 * have been laid out, walk the recipients on a cascade, measure each card at fire time, and play a def. The
 * one thing it does differently is the important one — WHICH def plays comes from `bindings.json` via
 * `bindingFor`, not from a hardcoded id, so a shop effect is re-bindable from the workbench exactly like a
 * combat one.
 *
 * DOM-measuring and timer-owning, so it is not unit-testable in this repo (no jsdom) — the pure halves it
 * leans on are: `recruitMoments.ts` (what happened), `fx/land.ts` (when each land fires) and `bindings.ts`
 * (what plays). This file is the glue those three were factored out of, and holds no logic of its own worth
 * testing separately.
 */

/** How a caller measures a unit. Injected rather than imported so this module stays free of `Recruit.tsx`'s
 *  transform-aware `restingCenterOf`, which reads layout in a way only that component's DOM guarantees. */
export type MeasureUnit = (uid: string) => { x: number; y: number } | null;

export interface RecruitCueContext {
  /** uid → cardId for the board, so a per-CARD binding can be resolved. Without it only the kind-level
   *  binding applies — the same fallback `score.ts` makes when the replay has no card map. */
  cardIdOf: (uid: string) => string | null;
  measure: MeasureUnit;
  /** Fired once per land alongside the def, for the cue's own sound. */
  onLand?: (uid: string) => void;
}

/**
 * Schedule every land for one moment. Returns a teardown that cancels anything still pending.
 *
 * The cascade shape and timing are the Ruby sweep's (`gap` walks recipients, `beat` repeats within one),
 * reused rather than re-tuned: the shop already had exactly one authored cascade and its numbers are the
 * owner-tuned ones. When a second shop effect wants a different rhythm, that is the moment to make these
 * per-kind rather than guessing a second set now.
 */
export function runRecruitMomentCues(moment: RecruitMoment, ctx: RecruitCueContext): () => void {
  if (!canPlayDefs()) return () => {};

  // Resolved UP FRONT, so an unbound moment costs one table lookup and schedules nothing — and so the
  // binding is read once rather than separately per land, which is two chances to disagree.
  //
  // A source-attributed moment (a `minionBuffed` wave names its buffer) keys by the SOURCE card, so Karwind's
  // binding fires on every Dragon it pumped rather than each Dragon needing its own. A recipient-keyed moment
  // (rubyLanded) has no `sourceCardId` and keys by the first recipient, exactly as before.
  const first = moment.recipients[0];
  if (!first) return () => {};
  const bindingCard = moment.sourceCardId ?? ctx.cardIdOf(first.uid);
  const binding = bindingFor(bindingCard, moment.kind);
  if (!binding) return () => {};

  const timers: ReturnType<typeof setTimeout>[] = [];
  // ONE rAF before anything is measured: the buffed/gemmed cards re-render in this commit, and measuring
  // before the browser has laid them out reads the PREVIOUS geometry — the bug every hand-written shop
  // effect had to learn about individually.
  const raf = requestAnimationFrame(() => {
    for (const land of scheduleLands(cascade(moment.recipients), { gap: RUBY_GAP_MS, beat: RUBY_BEAT_MS })) {
      const fire = (): void => fireLand(land, binding, ctx);
      if (land.at <= 0) fire();
      else timers.push(setTimeout(fire, land.at));
    }
  });

  return () => {
    cancelAnimationFrame(raf);
    for (const t of timers) clearTimeout(t);
  };
}

/** One land. Measured INSIDE the timer so a stagger that outlives a re-render — a triple collapsing three
 *  bodies into one, a sold minion — misses cleanly instead of firing at a stale rect. */
function fireLand(land: Land, binding: FxBinding, ctx: RecruitCueContext): void {
  const p = ctx.measure(land.uid);
  if (!p) return;
  // Both anchors are the minion itself: a shop effect lands ON a card, with nothing to travel between.
  // `uids` names it so a `react` layer has a subject — the shop path was the one that had none.
  playDef(binding.def, { source: p, target: p }, { uids: { source: land.uid, target: land.uid }, index: land.group });
  // The binding's own sound, fired WITH the visual rather than by the caller, so the two cannot drift apart
  // and a re-bind carries its sound along. Whitelisted at parse time (see `BINDING_SFX`), so this lookup is
  // total; the `?.` guards a name whose sfx entry was removed without updating the list.
  if (binding.sfx !== undefined) sfx[binding.sfx]?.();
  ctx.onLand?.(land.uid);
}
