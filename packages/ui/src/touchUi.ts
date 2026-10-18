/**
 * THE TOUCH UI (owner 2026-10-18, R-TOUCH-UISCALE-01: "I want to make sure it's a AAA experience, seamless 1:1 from
 * mobile to desktop"). On a phone in landscape the stage scale is about 0.36, so the tuned 1080p HUD lands at 13 to 25
 * px buttons and 4 to 9 px text. This module decides, once per resize / rotation (never per frame), whether the TOUCH
 * UI is on, and writes it onto `<html>` for touchUi.css:
 *
 *  - `data-touch-ui="normal|large|larger"`: the device is a TOUCH device (no hover, a coarse pointer) AND the stage is
 *    scaled down (`s < 1`). Every touch-only rule is keyed off this attribute, so a mouse device never matches any of
 *    them: DESKTOP IS PIXEL-IDENTICAL (the attribute is never written there, and nothing else changes).
 *  - `data-touch-small`: the stage scale is under `SMALL_STAGE_S` (a phone). The card views (Inspect, Discover, Choose
 *    One, the Runeforge offers, hero select) render enlarged so their text reads.
 *  - `--touch-k`: the HUD enlargement for the chosen size (1 / 1.3 / 1.6).
 *  - `--touch-p`: the menu-page zoom for the chosen size (1 / 1.5 / 1.8): the pages reflow into the narrower box.
 *  - `--touch-card` / `--touch-forge` / `--touch-inspect`: the card-view enlargements on a phone (1 elsewhere).
 *  - `--touch-inv-s`: `1 / s`, so a rule can size something in SCREEN px (a 44 px touch target, 16 px input text).
 *
 * The size is a LOCAL preference (Settings, "Touch UI size", shown on touch devices only), defaulting by device: a phone
 * gets Larger, a tablet Large. Normal keeps the desktop proportions (the hit slop and the text-entry lift still apply).
 */
import { onStageChange, stageFit, windowSize, type StageFit } from './stage';
import { isTouchDevice } from './touchInput';

export type TouchUiSize = 'normal' | 'large' | 'larger';
export const TOUCH_UI_SIZES: readonly TouchUiSize[] = ['normal', 'large', 'larger'];
export const TOUCH_UI_LABEL: Record<TouchUiSize, string> = { normal: 'Normal', large: 'Large', larger: 'Larger' };
/** The HUD enlargement per size (touchUi.css `--touch-k`). */
export const TOUCH_UI_FACTOR: Record<TouchUiSize, number> = { normal: 1, large: 1.3, larger: 1.6 };
/** The menu-page zoom per size (touchUi.css `--touch-p`). */
export const TOUCH_PAGE_ZOOM: Record<TouchUiSize, number> = { normal: 1, large: 1.5, larger: 1.8 };
/** The card views on a phone (`data-touch-small`): Discover / Choose One, the Runeforge, Inspect. */
export const CARD_VIEW_SCALE = { card: 1.6, forge: 1.4, inspect: 1.3 } as const;
/** localStorage key for the chosen size (absent = the device default). */
export const TOUCH_UI_KEY = 'ascent.touchUiSize';
/** Below this stage scale the card views render enlarged (`data-touch-small`). */
export const SMALL_STAGE_S = 0.5;
/** A window whose shorter side is under this is a PHONE (default Large). */
export const PHONE_MAX_SIDE = 600;

/** Pure: does the touch UI apply? A touch device on a scaled stage. A mouse device never, at any window size. */
export function touchUiApplies(touch: boolean, s: number): boolean {
  return touch && s < 1;
}

/** Pure: the default size for a `w` x `h` window: Larger on a phone (scale ~0.36), Large on a tablet (~0.6 to 0.75). */
export function defaultTouchUiSize(w: number, h: number): TouchUiSize {
  return Math.min(w, h) < PHONE_MAX_SIDE ? 'larger' : 'large';
}

/** Pure: a stored value back to a size (anything unknown is "no choice yet"). */
export function parseTouchUiSize(v: string | null | undefined): TouchUiSize | null {
  return v === 'normal' || v === 'large' || v === 'larger' ? v : null;
}

export interface TouchUiState {
  on: boolean;
  size: TouchUiSize;
  /** HUD enlargement. */
  k: number;
  /** Menu-page zoom. */
  p: number;
  /** Phone-scale stage: the card views enlarge. */
  small: boolean;
  /** 1 / stage scale. */
  inv: number;
}

/** Pure: the touch UI state for a device + fit + stored choice. */
export function touchUiState(touch: boolean, fit: Pick<StageFit, 's'>, stored: TouchUiSize | null, w: number, h: number): TouchUiState {
  const on = touchUiApplies(touch, fit.s);
  const size = stored ?? defaultTouchUiSize(w, h);
  return { on, size, k: on ? TOUCH_UI_FACTOR[size] : 1, p: on ? TOUCH_PAGE_ZOOM[size] : 1, small: on && fit.s < SMALL_STAGE_S, inv: fit.s > 0 ? 1 / fit.s : 1 };
}

/** How far the touch buy line rises above the board midline, as a share of the game box height. */
export const TOUCH_BUY_LIFT = 0.06;
/**
 * Pure: the buy line for a shop drag (R-TOUCH-BUYZONE-01). A shop card released BELOW it buys. A mouse keeps the board
 * midline exactly; a finger on the touch UI gets a line lifted by `TOUCH_BUY_LIFT` of the box height, so the buy zone
 * (the warband half) is taller and a short pull down off the offer buys.
 */
export function touchBuyLine(midlineY: number, boxH: number, touchOn: boolean): number {
  return touchOn ? midlineY - TOUCH_BUY_LIFT * boxH : midlineY;
}

export function readTouchUiSize(): TouchUiSize | null {
  try { return parseTouchUiSize(localStorage.getItem(TOUCH_UI_KEY)); } catch { return null; }
}

let current: TouchUiState = { on: false, size: 'normal', k: 1, p: 1, small: false, inv: 1 };
const listeners = new Set<(s: TouchUiState) => void>();
/** The touch UI state as last applied. */
export function touchUi(): TouchUiState { return current; }
export function onTouchUiChange(fn: (s: TouchUiState) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const TOUCH_VARS = ['--touch-k', '--touch-p', '--touch-inv-s', '--touch-card', '--touch-forge', '--touch-inspect'];
/** Write the state onto `<html>` (or clear every trace of it on a mouse device). */
export function applyTouchUi(fit: StageFit = stageFit()): TouchUiState {
  if (typeof document === 'undefined') return current;
  const { w, h } = windowSize();
  const next = touchUiState(isTouchDevice(), fit, readTouchUiSize(), w, h);
  current = next;
  const de = document.documentElement;
  if (next.on) {
    de.setAttribute('data-touch-ui', next.size);
    de.toggleAttribute('data-touch-small', next.small);
    de.style.setProperty('--touch-k', String(next.k));
    de.style.setProperty('--touch-p', String(next.p));
    de.style.setProperty('--touch-inv-s', String(next.inv));
    de.style.setProperty('--touch-card', String(next.small ? CARD_VIEW_SCALE.card : 1));
    de.style.setProperty('--touch-forge', String(next.small ? CARD_VIEW_SCALE.forge : 1));
    de.style.setProperty('--touch-inspect', String(next.small ? CARD_VIEW_SCALE.inspect : 1));
  } else {
    de.removeAttribute('data-touch-ui');
    de.removeAttribute('data-touch-small');
    for (const v of TOUCH_VARS) de.style.removeProperty(v);
  }
  listeners.forEach((l) => l(next));
  return next;
}

/** Store the player's choice (Settings) and apply it at once. */
export function setTouchUiSize(size: TouchUiSize): void {
  try { localStorage.setItem(TOUCH_UI_KEY, size); } catch { /* private mode: it holds for this page */ }
  applyTouchUi();
}

let installed = false;
/** Apply now and on every stage change (resize / rotation). Safe to call repeatedly. */
export function installTouchUi(): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;
  applyTouchUi();
  const off = onStageChange((f) => { applyTouchUi(f); });
  return () => { off(); installed = false; };
}
