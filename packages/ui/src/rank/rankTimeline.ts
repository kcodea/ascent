/**
 * The GSAP execution of a planned rank sequence (`rankSequence.ts`). Compositor-only: the bar is a `scaleX`
 * on the fill, the crest swap is scale + opacity, every text beat is an opacity fade; the counter writes
 * `textContent` from a tweened proxy (no React re-render per frame, no layout reads). Sounds are fired from
 * `.call()`s so a skip (`progress(1, true)`) stays silent.
 */
import { gsap } from 'gsap';
import { POINTS_PER_DIVISION, rankLabel } from './types';
import type { RankStep } from './rankSequence';

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
        const half = sec(step.ms) / 2;
        const upCue = step.medal ? cues.medal : cues.promote;
        // The old crest + label leave; the bar is dimmed while it snaps to the new division's starting edge.
        tl.to([...el(t.crestOld), ...el(t.label)], { opacity: 0, scale: step.direction === 'up' ? 0.7 : 0.9, duration: half, ease: 'power2.in' }, '>');
        tl.to([...el(t.track), ...el(t.points)], { opacity: 0.25, duration: half, ease: 'power1.in' }, '<');
        tl.call(() => {
          if (t.label) t.label.textContent = rankLabel(step.to);
          if (t.fill) gsap.set(t.fill, { scaleX: step.direction === 'up' ? 0 : 1 });
          if (t.points) t.points.textContent = pointsLabel(step.direction === 'up' ? 0 : POINTS_PER_DIVISION, false);
          if (step.direction === 'up') upCue();
        }, undefined, '>');
        tl.fromTo(el(t.crestNew), { opacity: 0, scale: step.direction === 'up' ? 1.35 : 0.8 }, { opacity: 1, scale: 1, duration: half, ease: step.direction === 'up' ? 'back.out(1.8)' : 'power2.out' }, '<');
        tl.to([...el(t.label), ...el(t.track), ...el(t.points)], { opacity: 1, duration: half, ease: 'power1.out' }, '<');
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
