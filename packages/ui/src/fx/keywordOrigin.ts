import { heroSlotRuneEl, runeNodeEl } from '../heroSlotRune';

/**
 * WHERE A GIVEN KEYWORD'S BEAM STARTS when no minion gave it (R-FX-KEYWORD-ORIGIN-01, owner 2026-11-13):
 *  - a TARGETED spell: the mouse pointer, where the spell was released;
 *  - an UNTARGETED spell: the hero portrait;
 *  - a HERO POWER (Lord of the Risen): the hero power slot;
 *  - a RUNE: the rune's own slot.
 *
 * A mid-turn Shop action carries no presentation batch in production, so the Shop cannot ask "who gave this". The
 * store notes each action as it is dispatched (`noteShopActionOrigin`); the Shop reads the note when the board shows a
 * keyword gained. Every action overwrites the note, so a gain is only ever matched to the action that caused it.
 */
export type ShopKeywordOrigin =
  | { kind: 'pointer' }
  | { kind: 'portrait' }
  | { kind: 'heroPower'; slot: number }
  | null;

export interface Point { x: number; y: number }

/** Pure: which origin an action implies. `spell` = the acted card is a spell; `targeted` = it named a target. */
export function classifyKeywordOrigin(actionType: string, spell: boolean, targeted: boolean, slot = 0): ShopKeywordOrigin {
  if (actionType === 'heroPower') return { kind: 'heroPower', slot };
  if (!spell) return null; // a minion's own play, a buy, a sell: not a spell, so no borrowed origin
  return targeted ? { kind: 'pointer' } : { kind: 'portrait' };
}

let origin: ShopKeywordOrigin = null;
let pointer: Point | null = null;
let listening = false;

/** Two numbers per pointer event, no layout read: the last place the pointer was. */
function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const on = (e: PointerEvent): void => { pointer = { x: e.clientX, y: e.clientY }; };
  window.addEventListener('pointermove', on, { capture: true, passive: true });
  window.addEventListener('pointerup', on, { capture: true, passive: true });
  window.addEventListener('pointerdown', on, { capture: true, passive: true });
}
listen();

/** Called by the store for EVERY dispatched action, before it resolves. */
export function noteShopActionOrigin(actionType: string, spell: boolean, targeted: boolean, slot = 0): void {
  origin = classifyKeywordOrigin(actionType, spell, targeted, slot);
}

/** The origin the latest action implies (not consumed: the Rise / Execute and the Ward readers share it). */
export function shopKeywordOrigin(): ShopKeywordOrigin {
  return origin;
}

const centreOf = (el: Element | null): Point | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** The hero power button for `slot` (0 = the first power, 1 = the second). */
export function heroPowerPoint(slot = 0): Point | null {
  if (typeof document === 'undefined') return null;
  const el = slot === 1
    ? document.querySelector('.statusbar .heropanel2 .heropowerbtn')
    : document.querySelector('.statusbar .heropanel:not(.heropanel2):not(.equipslot) .heropowerbtn');
  return centreOf(el ?? document.querySelector('.statusbar .heropowerbtn'));
}

/** The hero portrait. */
export function heroPortraitPoint(): Point | null {
  if (typeof document === 'undefined') return null;
  return centreOf(document.querySelector('.statusbar .hero .f') ?? document.querySelector('.statusbar .hero'));
}

/** A rune's own slot: its rack badge, else the hero power slot when the rune lives there. */
export function runeSlotPoint(runeId: string): Point | null {
  return centreOf(runeNodeEl(runeId) ?? heroSlotRuneEl(runeId));
}

/** The screen point for an origin, or null when its element is not on screen. */
export function keywordOriginPoint(o: ShopKeywordOrigin): Point | null {
  if (!o) return null;
  if (o.kind === 'pointer') return pointer;
  if (o.kind === 'heroPower') return heroPowerPoint(o.slot);
  return heroPortraitPoint();
}
