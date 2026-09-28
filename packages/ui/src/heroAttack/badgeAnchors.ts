import type { Pt } from './easing';

/**
 * Where a minion's tier lives on screen, for the damage formation: the centre of its tier badge (the star plaque) and
 * the badge elements that pulse. Measured ONCE when a formation starts (never per frame). Falls back to the top
 * centre of the card when it has no badge (a token or a plain card), and to null when the card is not on screen.
 */
export interface BadgeAnchor { at: Pt; badges: HTMLElement[] }

export function tierBadgeAnchor(card: Element | null | undefined): BadgeAnchor | null {
  if (!card) return null;
  const cr = card.getBoundingClientRect();
  if (!(cr.width > 0 && cr.height > 0)) return null;
  // The stars (or the text pill) are what reads as "the tier"; the plaque and the Tier 7 halo pulse with them.
  const star = card.querySelector<HTMLElement>('.tierbadge.tierstars') ?? card.querySelector<HTMLElement>('.tierbadge:not(.tierglow):not(.tierplate)');
  const badges = [...card.querySelectorAll<HTMLElement>('.tierbadge')];
  const r = star?.getBoundingClientRect();
  const at = r && r.width > 0 && r.height > 0
    ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    : { x: cr.left + cr.width / 2, y: cr.top + Math.min(14, cr.height * 0.08) };
  return { at, badges };
}
