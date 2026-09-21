/**
 * The GSAP execution of a planned rank sequence (`rankSequence.ts`). Compositor-only: the bar is a `scaleX`
 * on the fill, the crest swap is transform (scale / y) + opacity, every text beat is an opacity fade; the
 * counter writes `textContent` from a tweened proxy (no React re-render per frame, no layout reads). Sounds —
 * the cues AND the authored defs (`rank-up` / `down-rank`, whose own `sound` layers play) — are fired from
 * `.call()`s so a skip (`progress(1, true)`) stays silent.
 */
import { gsap } from 'gsap';
import { canPlayDefs, playDef } from '../fx/playDef';
import { POINTS_PER_DIVISION, rankLabel } from './types';
import type { RankStep } from './rankSequence';

/** When the owner's `rank-up` def lands its burst (its shard layer's `at`): the ring collapses onto the crest
 *  for this long, then the NEW crest appears at the hit — never before. */
export const RANK_UP_HIT_MS = 280;
/** The def's full length — the transition beat stretches to cover it so the burst is not cut off. */
export const RANK_UP_FX_MS = 900;
/** When the owner's `down-rank` def (2026-09-21) lets its shards fall (its burst layer's `at`; the shockwave
 *  precedes it at 60 ms and the sound layer starts at 0): the OLD crest holds until then, then drops out. */
export const RANK_DOWN_HIT_MS = 90;
/** The def's full length — the down transition beat covers it so the falling shards are not cut off. */
export const RANK_DOWN_FX_MS = 900;

export interface RankTimelineTargets {
  placement: HTMLElement | null;
  crestOld: HTMLElement | null;
  crestNew: HTMLElement | null;
  label: HTMLElement | null;
  track: HTMLElement | null;
  fill: HTMLElement | null;
  tip: HTMLElement | null;
  points: HTMLElement | null;
  delta: HTMLElement | null;
  detail: HTMLElement | null;
  outcome: HTMLElement | null;
}

export interface RankTimelineCues {
  progress: () => void;
  gate: () => void;
  promote: () => void;
  medal: () => void;
  /** The rank-up HIT — the authored clang as the new crest lands (fired for both promotion kinds). */
  hit: () => void;
}

/** The screen centre of the crest the FX collapses onto — read ONCE at the beat, never per frame. */
function crestCentre(el: HTMLElement | null): { x: number; y: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

const pointsLabel = (v: number, uncapped: boolean): string =>
  uncapped ? `${Math.round(v)} RP` : `${Math.round(v)} / ${POINTS_PER_DIVISION}`;

const frac = (points: number): number => Math.min(1, Math.max(0, points / POINTS_PER_DIVISION));

/** Build (paused) the timeline for `steps` over `t`. The caller plays it, and MUST `kill()` it on unmount. */
export function buildRankTimeline(steps: readonly RankStep[], t: RankTimelineTargets, cues: RankTimelineCues, onComplete: () => void): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true, onComplete });
  const sec = (ms: number): number => ms / 1000;
  const el = (x: HTMLElement | null): HTMLElement[] => (x ? [x] : []);

  for (const step of steps) {
    switch (step.kind) {
      case 'reveal': {
        // Placement settles in from slightly large; the pre-match crest fades up. Everything else stays hidden.
        tl.fromTo(el(t.placement), { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: sec(step.ms) * 0.8, ease: 'power3.out' }, '<');
        tl.fromTo(el(t.crestOld), { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: sec(step.ms), ease: 'back.out(1.4)' }, '<0.08');
        break;
      }
      case 'establish': {
        tl.fromTo([...el(t.label), ...el(t.track), ...el(t.points)], { opacity: 0 }, { opacity: 1, duration: sec(step.ms), ease: 'power1.out' }, '>');
        tl.fromTo([...el(t.delta), ...el(t.detail)], { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: sec(step.ms), ease: 'power2.out' }, '<0.06');
        break;
      }
      case 'bar': {
        const proxy = { v: step.from };
        const from = step.uncapped ? 1 : frac(step.from);
        const to = step.uncapped ? 1 : frac(step.to);
        tl.call(cues.progress, undefined, '>');
        tl.set(el(t.fill), { scaleX: from }, '<');
        tl.to(el(t.fill), { scaleX: to, duration: sec(step.ms), ease: 'power2.inOut' }, '<');
        tl.to(proxy, {
          v: step.to, duration: sec(step.ms), ease: 'power2.inOut',
          onUpdate: () => { if (t.points) t.points.textContent = pointsLabel(proxy.v, step.uncapped); },
        }, '<');
        break;
      }
      case 'gate': {
        // The endpoint lights (opacity only) and holds a soft glow — the "you are on the gate" cue.
        tl.call(cues.gate, undefined, '>');
        tl.fromTo(el(t.tip), { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1.25, duration: sec(step.ms) * 0.4, ease: 'power2.out' }, '<');
        tl.to(el(t.tip), { scale: 1, opacity: 0.85, duration: sec(step.ms) * 0.6, ease: 'power1.inOut' }, '>');
        break;
      }
      case 'transition': {
        // Where the landing bar STARTS: the next bar step's `from` (100 for a plain demotion's retreat, 0 for a
        // promotion's fill or a lost demotion game's landing).
        const next = steps[steps.indexOf(step) + 1];
        const landing = next && next.kind === 'bar' ? next.from : step.direction === 'up' ? 0 : POINTS_PER_DIVISION;
        const swap = (): void => {
          if (t.label) t.label.textContent = rankLabel(step.to);
          if (t.fill) gsap.set(t.fill, { scaleX: frac(landing) });
          if (t.points) t.points.textContent = pointsLabel(landing, false);
        };
        if (step.direction === 'up') {
          // A PROMOTION (division or medal) is the owner-authored `rank-up` FX (2026-09-20): the OLD crest HOLDS
          // while the ring collapses onto it (0 → 280 ms), then at the HIT the burst fires, the crest swaps to the
          // new division / medal, the label + bar snap to the new division and the clang plays. The beat is the
          // def's full length so the shards are not cut off; the plain fade-and-replace is the no-canvas fallback.
          const fxPlayed = { v: false };
          tl.call(() => {
            const at = crestCentre(t.crestOld);
            if (at && canPlayDefs()) fxPlayed.v = !!playDef('rank-up', { source: at, target: at, cursor: at });
          }, undefined, '>');
          tl.to([...el(t.track), ...el(t.points)], { opacity: 0.25, duration: sec(RANK_UP_HIT_MS), ease: 'power1.in' }, '<');
          tl.call(() => {
            swap();
            cues.hit();
            (step.medal ? cues.medal : cues.promote)();
          }, undefined, `<${sec(RANK_UP_HIT_MS)}`);
          // At the hit: old crest out, new crest in — a snap when the FX played (the burst IS the flourish), a
          // short cross-fade when it could not.
          tl.to(el(t.crestOld), { opacity: 0, duration: fxPlayed.v ? 0.05 : 0.18, ease: 'power2.in' }, '<');
          tl.fromTo(el(t.crestNew), { opacity: 0, scale: 1.2 }, { opacity: 1, scale: 1, duration: 0.24, ease: 'back.out(1.8)' }, '<');
          tl.to([...el(t.label), ...el(t.track), ...el(t.points)], { opacity: 1, duration: 0.24, ease: 'power1.out' }, '<');
          tl.to({}, { duration: Math.max(0, sec(step.ms) - sec(RANK_UP_HIT_MS) - 0.24) }, '>'); // let the burst finish
        } else {
          // A DEMOTION (division or medal — every `direction: 'down'` transition) is the owner-authored `down-rank`
          // FX (2026-09-21): the OLD crest HOLDS while the shockwave leaves it (0 → 90 ms), then at the HIT the
          // shards fall, the old crest drops away, the crest swaps to the new division / medal and the label + bar
          // snap to it. The def's own `sound` layer IS the sound — there is no demotion cue, and `cues.hit` is the
          // promotion clang, so nothing is fired from here. The beat is the def's full length so the fall is not
          // cut off. With no canvas (`playDef` declines) the same hold → drop → replace plays without particles —
          // that is the plain fade-and-replace fallback. The play sits inside a `.call()`, so a skip
          // (`progress(1, true)`) never starts it and stays silent.
          tl.call(() => {
            const at = crestCentre(t.crestOld);
            if (at && canPlayDefs()) playDef('down-rank', { source: at, target: at, cursor: at });
          }, undefined, '>');
          tl.to([...el(t.track), ...el(t.points)], { opacity: 0.25, duration: sec(RANK_DOWN_HIT_MS), ease: 'power1.in' }, '<');
          tl.call(swap, undefined, `<${sec(RANK_DOWN_HIT_MS)}`);
          // At the hit: the old crest drops and shrinks out (transform + opacity only) while the new one settles
          // in from slightly small — a demotion lands, it does not burst in.
          tl.to(el(t.crestOld), { opacity: 0, scale: 0.86, y: 22, duration: 0.18, ease: 'power2.in' }, '<');
          tl.fromTo(el(t.crestNew), { opacity: 0, scale: 0.92, y: -6 }, { opacity: 1, scale: 1, y: 0, duration: 0.24, ease: 'power2.out' }, '<');
          tl.to([...el(t.label), ...el(t.track), ...el(t.points)], { opacity: 1, duration: 0.24, ease: 'power1.out' }, '<');
          tl.to({}, { duration: Math.max(0, sec(step.ms) - sec(RANK_DOWN_HIT_MS) - 0.24) }, '>'); // let the shards fall
        }
        break;
      }
      case 'outcome': {
        if (step.text) tl.fromTo(el(t.outcome), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: sec(step.ms), ease: 'power2.out' }, '>');
        else tl.to({}, { duration: sec(step.ms) }, '>'); // the hold beat, so a plain result still settles on time
        break;
      }
    }
  }
  return tl;
}
