/**
 * CARD SLIDE — the "into the slot from where you released it" transition.
 *
 * The quietest of the card transitions, and the most reused. Its first home was the shop → hand BUY (a
 * bought card was already in front of you in the tavern — ACQUIRED, not conjured, so no arcane dust; that is
 * `plateCoalesce`, for cards that appear from nowhere). The gild hands off to it, and it also drives PLACING
 * a minion on the board and REARRANGING one — every case where a real card you were dragging lands in a slot
 * and should glide the last stretch home rather than teleport (owner call 2026-07-24). Placement/rearrange
 * run it 30% faster than a buy (see `durationScale`), since you already know exactly where it's going.
 *
 * Deliberately NOT tunable and not a canvas effect: it is a single compositor-only transform tween on the
 * real card element. No clone, no dust, no layout reads per frame.
 *
 * ## Why it composes with the card's own transform
 *
 * A hand card already carries a resting transform (the tuck, `translateY(var(--hand-tuck))`, plus any fan
 * rotation). Animating `transform` outright would drop all of that for the length of the slide and the card
 * would visibly jump to an untucked pose. So the current computed matrix is read once and every keyframe is
 * written OUTSIDE it: `translate(…) scale(…) <base>`. The base is a resolved matrix, so this is exact.
 *
 * ## Why the mount-pop is suppressed
 *
 * A freshly bought card mounts with `.popin`, whose `handpop` keyframes animate transform and opacity. The
 * slide would be fighting it for the same property, and a running CSS animation outranks a plain inline
 * style. `animation: none !important` for the duration takes it out of the running; the card slides in
 * solid instead of fading in.
 */

/** Where the card was when you let go of it — the floating drag card's box, in viewport px. */
export interface BuyFrom { x: number; y: number; w: number; h: number }

/** Slide length, ms. Short by design: this is a state change you already committed to, not a moment. */
const MS = 170;
/** Fast out of the gate, settling into the slot — no overshoot, nothing to wait for. */
const EASE = 'cubic-bezier(.22,.9,.28,1)';

/**
 * Slide a real card from its release point into the slot it now occupies.
 *
 * @param from          The floating drag card's box at the moment of release.
 * @param card          The real card element, already laid out in its committed slot.
 * @param durationScale Multiplies the base length. 1 for a buy; placement/rearrange pass 0.7 (30% faster)
 *                      because there's no "reveal" to read — you already saw the card, it's just seating.
 */
export function playBuySlide(from: BuyFrom, card: HTMLElement, durationScale = 1): void {
  const dest = card.getBoundingClientRect();
  if (dest.width <= 0 || from.w <= 0) return;

  // Centre-to-centre, because the scale below is about the element's centre (the default origin). Using
  // top-left deltas here would leave the card visibly off by half the size difference on the first frame.
  const dx = (from.x + from.w / 2) - (dest.left + dest.width / 2);
  const dy = (from.y + from.h / 2) - (dest.top + dest.height / 2);
  const sc = from.w / dest.width;
  // Already home (a drop right on the slot): nothing to animate, and a zero-distance tween would still cost
  // a compositor layer for 170ms.
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sc - 1) < 0.02) return;

  const cs = getComputedStyle(card);
  const base = cs.transform && cs.transform !== 'none' ? cs.transform : '';
  card.style.setProperty('animation', 'none', 'important');   // take `handpop` out of the running
  card.style.setProperty('opacity', '1', 'important');        // …including its 0 → 1 fade

  const anim = card.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sc}) ${base}`.trim() },
      { transform: base || 'none' },
    ],
    { duration: Math.max(1, MS * durationScale), easing: EASE },
  );
  const done = (): void => {
    card.style.removeProperty('animation');
    card.style.removeProperty('opacity');
  };
  anim.addEventListener('finish', done);
  anim.addEventListener('cancel', done);
}
