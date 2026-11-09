/**
 * Spring curves for the chat bubbles, as Web Animations keyframes. Transform and opacity only, so every one runs on the
 * compositor (docs/performance.md); each is one-shot, nothing loops. Pure (no DOM) except `play`.
 *
 * A spring is SPEED (wobbles a second) and BOUNCE (0 = no overshoot, near 1 = rings): a damped spring with
 * damping ratio 1 - bounce, sampled at 60 fps until it has settled.
 */

const FPS = 60;
const MAX_S = 2;

interface Spring { duration: number; step: (t: number) => number; kick: (t: number) => number }

/** `step`: 0 -> 1 with overshoot. `kick`: 0 -> about 1 -> 0, a single push that wobbles out. */
export function spring(speedHz: number, bounce: number): Spring {
  const w0 = 2 * Math.PI * Math.max(0.1, speedHz);
  const zeta = Math.min(1, Math.max(0.05, 1 - bounce));
  const decay = zeta * w0;
  const duration = Math.min(MAX_S, Math.max(0.12, Math.log(400) / decay));
  if (zeta >= 1) {
    const step = (t: number): number => 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    // peak of t·e^(-w0 t) is at t = 1/w0: normalise to 1.
    const kick = (t: number): number => w0 * t * Math.exp(1 - w0 * t);
    return { duration, step, kick };
  }
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const step = (t: number): number => 1 - Math.exp(-decay * t) * (Math.cos(wd * t) + (decay / wd) * Math.sin(wd * t));
  const peakT = Math.atan(wd / decay) / wd;
  const peak = Math.exp(-decay * peakT) * Math.sin(wd * peakT) || 1;
  const kick = (t: number): number => (Math.exp(-decay * t) * Math.sin(wd * t)) / peak;
  return { duration, step, kick };
}

/** Sample `frame(t)` over `duration` seconds; the last frame is exact rest. */
function sample(duration: number, frame: (t: number) => Keyframe, rest: Keyframe): Keyframe[] {
  const n = Math.max(2, Math.round(duration * FPS));
  const out: Keyframe[] = [];
  for (let i = 0; i < n; i++) out.push(frame((i / n) * duration));
  out.push(rest);
  return out;
}

const r = (v: number): string => v.toFixed(4);

/** Pop in from its tail: grows from `from`, squashes on the overshoot, rocks by `tilt` degrees. */
export function popIn(o: { speed: number; bounce: number; from: number; squash: number; tilt: number }): { frames: Keyframe[]; ms: number } {
  const s = spring(o.speed, o.bounce);
  const frames = sample(s.duration, (t) => {
    const x = s.step(t);
    const size = o.from + (1 - o.from) * x;
    const over = x - 1;
    const sx = size * (1 + o.squash * over);
    const sy = size * (1 - o.squash * over);
    return { transform: `rotate(${r(o.tilt * s.kick(t))}deg) scale(${r(sx)}, ${r(sy)})`, opacity: Math.min(1, t * 25) };
  }, { transform: 'none', opacity: 1 });
  return { frames, ms: s.duration * 1000 };
}

/** The words land: spring from the old size (as a share of the new) to full size, with a kick on top. */
export function land(o: { speed: number; bounce: number; kick: number; fromX: number; fromY: number }): { frames: Keyframe[]; ms: number } {
  const s = spring(o.speed, o.bounce);
  const frames = sample(s.duration, (t) => {
    const x = s.step(t);
    const k = o.kick * s.kick(t);
    const sx = (o.fromX + (1 - o.fromX) * x) * (1 + k);
    const sy = (o.fromY + (1 - o.fromY) * x) * (1 + k * 0.5);
    return { transform: `scale(${r(sx)}, ${r(sy)})` };
  }, { transform: 'none' });
  return { frames, ms: s.duration * 1000 };
}

/** Slide from an offset back to where it now sits. */
export function slide(o: { speed: number; bounce: number; dx: number; dy: number }): { frames: Keyframe[]; ms: number } {
  const s = spring(o.speed, o.bounce);
  const frames = sample(s.duration, (t) => {
    const left = 1 - s.step(t);
    return { transform: `translate(${(o.dx * left).toFixed(2)}px, ${(o.dy * left).toFixed(2)}px)` };
  }, { transform: 'none' });
  return { frames, ms: s.duration * 1000 };
}

/** Leave: a quick puff, then shrink into the tail and fade. */
export function leave(o: { puff: number; to: number }): Keyframe[] {
  return [
    { transform: 'none', opacity: 1, easing: 'ease-out' },
    { transform: `scale(${r(1 + o.puff)})`, opacity: 1, offset: 0.3, easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)' },
    { transform: `scale(${r(o.to)})`, opacity: 0 },
  ];
}

export const reducedMotion = (): boolean => {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
