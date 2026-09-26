/**
 * REBIRTH's pillar of phoenix fire (owner 2026-09-26: the trigger was "not noticeable"): the pre-rendered flame
 * sheaf (`--rb-pillar`, rebirthCrown.ts) erupting up from the returning unit's slot. It is a pair of short-lived
 * DOM nodes, not a class on the unit, so it burns its full length even when the reborn beat (and with it the
 * `rebirthing` class) ends early at a fast combat speed:
 *  · BACK — behind the card, the tall column the body rises out of;
 *  · FRONT — a white-hot copy over the body that burns off as it forms.
 * Hosted on the combat `.unit` (NOT the `.card`, whose own re-form animates opacity and scale and would hide
 * and shrink the fire with it), else on the shop `.card`, else a fixed-position node at the rect (the tuner's
 * screen-centre burst). One-shot transform/opacity animations (styles.css "REBIRTH PILLAR"); each node removes
 * itself after its run. Presentation only.
 */
import { getRebirthConfig } from '../rebirthConfig';

type Rect = { cx: number; cy: number; w: number; h: number };

/** The element the pillar should live in for `uid`: its combat `.unit`, else its shop `.card`, else null. */
export function pillarHostFor(uid: string | null): HTMLElement | null {
  if (!uid || typeof document === 'undefined') return null;
  const card = document.querySelector<HTMLElement>(`.card[data-uid="${uid.replace(/["\\]/g, '\\$&')}"]`);
  if (!card) return null;
  const parent = card.parentElement;
  return parent && parent.classList.contains('unit') ? parent : card;
}

export function spawnRebirthPillar(host: HTMLElement | null, rect: Rect | null): void {
  if (typeof document === 'undefined') return;
  const durMs = 1050 * getRebirthConfig().burstTime;
  const made: HTMLElement[] = [];
  if (host) {
    const back = document.createElement('div');
    back.className = 'rbpillar back';
    back.setAttribute('aria-hidden', 'true');
    host.insertBefore(back, host.firstChild);
    const front = document.createElement('div');
    front.className = 'rbpillar front';
    front.setAttribute('aria-hidden', 'true');
    host.appendChild(front);
    made.push(back, front);
  } else if (rect) {
    const el = document.createElement('div');
    el.className = 'rbpillar fixed';
    el.setAttribute('aria-hidden', 'true');
    el.style.left = `${rect.cx}px`;
    el.style.top = `${rect.cy + rect.h * 0.46}px`;
    el.style.setProperty('--cw', `${Math.max(rect.w, rect.h * 0.75)}px`);
    document.body.appendChild(el);
    made.push(el);
  }
  if (made.length) window.setTimeout(() => { for (const el of made) el.remove(); }, durMs + 80);
}
