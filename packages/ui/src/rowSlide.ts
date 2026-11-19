/**
 * THE ROW SLIDE RUNS ON THE COMPOSITOR (R-PERF-ROW-SLIDE-01, 2026-11-19).
 *
 * When a shop / board row changes (a buy, a play, a sale, a summon), the survivors slide from their old spot to their
 * new one in `flipConfig.commitMs` (200 ms). Until this module that slide was a GSAP tween writing `transform` on each
 * moved card every frame. Measured on the APM bench (docs/devlog/2026-11-19-perf-commit-floor.md): at four actions a
 * second those 200 ms slides covered 83% of all frames, and EVERY frame in which script moves a layer costs the main
 * thread a full compositing update. Blink only moves a layer directly (no re-layerization, no overlap testing) when
 * the layer's transform is ANIMATING; a script write of `transform` on a `will-change: transform` layer is not that,
 * so it rebuilt the layer list of the whole page: `PaintArtifactCompositor::Update`, 0.6 ms a frame, 104 ms a second,
 * 26 ms of main thread per action, plus a style recalculation of each moved card and a full commit to the compositor.
 *
 * The same slide as a Web Animation is a compositor animation: the main thread starts it and is done.
 *
 *  - It animates the `translate` PROPERTY, not `transform`. `translate` composes with whatever `transform` the card
 *    carries (the drag's `slideDir` shift, a hover lift, the buy slide's own Web Animation on `transform`) exactly as
 *    GSAP's `x` composed with the transform it parsed: applied outermost, in the row's space. No card rule sets
 *    `translate`, and the base `.card { transition: transform }` does not cover it, so no transition has to be killed
 *    around the slide.
 *  - Same curve: GSAP's `power2.out` is `1 - (1 - t)^3`. It is given as a `linear()` easing sampled at 48 points (off
 *    by less than a tenth of a pixel on a 300 px slide), with the cubic-bezier form of the same curve where
 *    `linear()` is not parsed.
 *  - Same hold: a death holds the row before it closes (`delayMs`); `fill: 'backwards'` keeps the survivors at their
 *    old spot for the hold, as GSAP's immediate render of the from-value did.
 *  - A card that is asked to slide again mid-slide starts the new slide from the new offset (the offsets come from
 *    layout positions, never from where the card is on screen), which is what the second GSAP tween did by writing
 *    last. The earlier animation is cancelled so two never add up.
 *
 * Nothing reads these animations: a rect read mid-slide sees the card where the animation has it, as before.
 */

/** GSAP `power2.out`, exactly: `1 - (1 - t)^3`. */
export const power2Out = (t: number): number => 1 - (1 - t) ** 3;

const SAMPLES = 48;
/** `power2.out` as a CSS `linear()` easing (piecewise-linear through the real curve). */
export const POWER2_OUT_LINEAR = `linear(${Array.from({ length: SAMPLES + 1 }, (_, i) => {
  const v = power2Out(i / SAMPLES);
  return i === 0 ? '0' : i === SAMPLES ? '1' : v.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
}).join(', ')})`;
/** The standard cubic-bezier fit of the same curve (easeOutCubic), for an engine that does not parse `linear()`. */
export const POWER2_OUT_BEZIER = 'cubic-bezier(0.215, 0.61, 0.355, 1)';

const live = new WeakMap<Element, Animation>();
let liveCount = 0;

/** Row slides that have not finished (a backlog counter for the bench; 0 at rest). */
export const liveRowSlides = (): number => liveCount;

/**
 * Slide each element home from `deltas[i]` px (stage px, along the row) over `ms`, after `delayMs`.
 * A no-op where Web Animations are missing (a test DOM): the cards simply stand at their new slots.
 */
export function slideHome(els: readonly HTMLElement[], deltas: readonly number[], ms: number, delayMs = 0): void {
  for (let i = 0; i < els.length; i++) {
    const el = els[i]!;
    const from = deltas[i] ?? 0;
    const prev = live.get(el);
    if (prev) { live.delete(el); liveCount--; prev.cancel(); }
    if (typeof el.animate !== 'function') continue;
    const frames = [{ translate: `${from}px 0px` }, { translate: '0px 0px' }];
    const timing = { duration: ms, delay: delayMs, fill: 'backwards' as const };
    let anim: Animation;
    try { anim = el.animate(frames, { ...timing, easing: POWER2_OUT_LINEAR }); }
    catch { anim = el.animate(frames, { ...timing, easing: POWER2_OUT_BEZIER }); }
    live.set(el, anim);
    liveCount++;
    const done = (): void => { if (live.get(el) === anim) { live.delete(el); liveCount--; } };
    anim.addEventListener('finish', done);
    anim.addEventListener('cancel', done);
  }
}
