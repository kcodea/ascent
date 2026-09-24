/**
 * GILD TRAIL — what plays when copies combine into a gilded card (owner redesign 2026-09-24).
 *
 * Each consumed copy POOFS into golden sparks where it stood and throws an arcing golden trail into the new
 * gilded card, which forms in its slot as the last trail lands. It replaces `plateGild`'s centre-screen fuse.
 *
 * The LOOK is entirely the committed `gild-trail` def (fx/defs/gild-trail.json), authored in the FX workbench:
 * the poof (a `source` burst), the arc (a `travel` ribbon and its `bow`), the landing (a `target` burst), and
 * the pop-pop-pop between copies (each layer's `stagger`, driven by the `index` passed per copy). This module
 * only works out the anchors, hides the card, and shows it again. `gildTrailSources.ts` is the pure half.
 */
import { canPlayDefs, playDef } from './fx/playDef';
import { getDef } from './fx/fxDefs';
import { gildArrivalMs, type Pt } from './gildTrailSources';

/** How the gilded card forms as the last trail lands. `scale` rather than `transform`, so the pop composes
 *  with the hand fan's own translate/rotate instead of snapping the card out of it for the duration. */
const FORM_KEYFRAMES: Keyframe[] = [
  { scale: '0.55', opacity: 0 },
  { scale: '1.1', opacity: 1, offset: 0.55 },
  { scale: '1', opacity: 1 },
];
const FORM_MS = 280;

/**
 * Play the gild: one `gild-trail` from each source into `card`.
 *
 * @param sources Where each consumed copy stood (see `resolveGildSources`), one trail each.
 * @param card    The real gilded card element. Hidden until the trails land, then popped in.
 * @param goldUid Its uid, for any `react` layer the def carries on its target.
 */
export function playGildTrail(sources: readonly Pt[], card: HTMLElement, goldUid: string): void {
  if (typeof window === 'undefined' || !sources.length || !canPlayDefs()) return;
  const r = card.getBoundingClientRect();
  if (r.width <= 0) return;
  const target = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const camera = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  // `!important`: a freshly gilded card mounts with `.popin`, whose keyframes animate opacity and would
  // otherwise outrank a plain inline style (the same fight `plateGild` had).
  card.style.setProperty('opacity', '0', 'important');
  let shown = false;
  const show = (): void => {
    if (shown) return;
    shown = true;
    card.style.removeProperty('opacity');
    if (card.isConnected && typeof card.animate === 'function') {
      card.animate(FORM_KEYFRAMES, { duration: FORM_MS, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
    }
  };

  let played = 0;
  sources.forEach((source, index) => {
    // `onDone` is the safety net: every play retires, so the card is shown even if the timer below is lost.
    const retire = playDef('gild-trail', { source, target, camera }, { uids: { target: goldUid }, index, onDone: show });
    if (retire) played++;
  });
  // Nothing could play (budget, no renderer): never leave the gilded card invisible.
  if (!played) { show(); return; }
  window.setTimeout(show, gildArrivalMs(getDef('gild-trail'), sources.length - 1));
}
