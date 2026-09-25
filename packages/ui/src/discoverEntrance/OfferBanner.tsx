import { Flourish } from '../goodLuck/GoodLuckIntro';
import { offerSubtitle } from './offerSource';

/**
 * THE ORNATE OFFER TITLE (owner pick 2026-09-25): the Discover / Choose One heading as a gold filigree banner in the
 * Good Luck intro's style (the Cinzel Decorative gold words between two drawn flourishes), sized for a heading.
 * Replaces the flat dark-glass `.disc-banner` box on those two overlays only (the quest shop, Runeforge and the
 * rest keep theirs).
 *
 * Static by contract: no animation of its own (the overlay's one-shot fade carries it in), and its glow is a STATIC
 * filter rasterized once. Positioned absolutely above the card row, so the row sits exactly where it always did and
 * the Minimize pill (pinned to the viewport) still clears it. Size is the 💫 tuner's `lookBannerSize`.
 */
export function OfferBanner({ title, source }: { title: string; source?: string | null }): JSX.Element {
  const sub = offerSubtitle(source);
  return (
    <div className="disc-ornate">
      <div className="disc-ornate-row">
        <span className="disc-ornate-flour" aria-hidden="true"><Flourish /></span>
        <span className="disc-ornate-title" role="heading" aria-level={2}>{title}</span>
        <span className="disc-ornate-flour disc-ornate-flour-r" aria-hidden="true"><Flourish /></span>
      </div>
      {sub && <div className="disc-ornate-sub">{sub}</div>}
    </div>
  );
}
