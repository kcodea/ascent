/**
 * TOUCH TEXT ENTRY (owner 2026-10-18, R-TOUCH-KEYBOARD-01: "a AAA experience, seamless 1:1 from mobile to desktop").
 *
 * The sign-in email / code fields, the name editor and the Versus room name are drawn inside the scaled stage: on a
 * phone that is ~5 px text in a ~12 px box, and iOS zooms the whole page in on any input whose font is under 16 px,
 * then the on-screen keyboard covers the field. On touch (`data-touch-ui` on) a focused text field is LIFTED instead:
 *
 *  - it moves (position: fixed, inline style, restored on blur) to a big bar along the BOTTOM of the VISIBLE viewport
 *    (`visualViewport`), i.e. sitting right on top of the keyboard like a chat composer, in either rotation, clear of
 *    the safe area. The bottom (not the top) keeps whatever the field drives in view: a search's result list drops
 *    below its field near the top of the screen, and the panel a sign-in field belongs to stays readable above it;
 *  - its text is 17 SCREEN px (computed font size 17 / scale, so iOS never zooms) in a 52 px tall box;
 *  - it reads as the focused thing: a gold edge and a deep shadow (touchUi.css, `.tkb-lifted`).
 *
 * Focus never moves, so every field keeps its own handlers exactly (Enter submits, the name editor commits on blur).
 * Repositioning runs on focus and on `visualViewport` resize / scroll only, never per frame.
 */
import { cssSafeInsets, pageScale } from './stage';
import { rectScreenToGame, sidewaysOn, sidewaysWidth } from './sideways';

/** The field kinds that bring up a text keyboard. */
const TEXT_TYPES = new Set(['', 'text', 'email', 'search', 'url', 'tel', 'password', 'number']);
/** Screen px: the lifted field's height, its text size, and its margin from the visible edges. */
export const LIFT_H = 52;
export const LIFT_FONT = 17;
export const LIFT_MARGIN = 12;
/** The widest the lifted field gets, screen px (a 13" iPad landscape still reads as a field, not a banner). */
export const LIFT_MAX_W = 720;

export interface ViewportBox { left: number; top: number; width: number; height: number }

/** Is this element a text field the lift applies to? */
export function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return TEXT_TYPES.has(((el as HTMLInputElement).getAttribute('type') ?? '').toLowerCase());
}

/**
 * Pure: the lifted field's box in SCREEN px: centred along the bottom of the visible viewport `vv` (the keyboard's top
 * edge when it is up), clear of the safe area (`safeL` / `safeR` / `safeB` screen px), `LIFT_H` tall, at most
 * `LIFT_MAX_W` wide.
 */
export function liftBox(vv: ViewportBox, safeL = 0, safeR = 0, safeB = 0): ViewportBox {
  const left0 = vv.left + Math.max(LIFT_MARGIN, safeL);
  const right0 = vv.left + vv.width - Math.max(LIFT_MARGIN, safeR);
  const avail = Math.max(120, right0 - left0);
  const width = Math.min(LIFT_MAX_W, avail);
  const left = left0 + (avail - width) / 2;
  return { left, top: vv.top + vv.height - LIFT_H - Math.max(LIFT_MARGIN, safeB), width, height: LIFT_H };
}

/**
 * Pure: a screen-px box expressed in the CSS px of a fixed element's containing block, given where that block's
 * origin lands on screen (`ox`, `oy`) and its scale (screen px per CSS px).
 */
export function toContainingBlock(b: ViewportBox, ox: number, oy: number, scale: number): ViewportBox {
  const k = scale > 0 ? scale : 1;
  return { left: (b.left - ox) / k, top: (b.top - oy) / k, width: b.width / k, height: b.height / k };
}

let installed = false;
export function installTouchKeyboard(enabled: () => boolean): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;
  let lifted: HTMLInputElement | HTMLTextAreaElement | null = null;
  let savedStyle = '';

  const place = (): void => {
    const el = lifted;
    if (!el) return;
    // Everything below is SCREEN px. On the page scale (R-PHONE-PAGESCALE-01) the viewport and rects are layout px,
    // `k` screen px each; everywhere else `k` is 1.
    const k = pageScale();
    const vv = window.visualViewport;
    // Turned (R-PHONE-SIDEWAYS-01): the visible viewport is reported upright; the field is placed in the game's frame,
    // along the game's bottom edge beside the keyboard (which covers the game's right-hand side).
    const vr = vv ? { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height } : null;
    const vg = vr && sidewaysOn() ? rectScreenToGame(vr, sidewaysWidth()) : vr;
    const view: ViewportBox = vg
      ? { left: vg.left * k, top: vg.top * k, width: vg.width * k, height: vg.height * k }
      : { left: 0, top: 0, width: window.innerWidth * k, height: window.innerHeight * k };
    const ins = cssSafeInsets();
    const target = liftBox(view, ins.left * k, ins.right * k, ins.bottom * k);
    // Where does the fixed element's containing block sit, and at what scale? Two probes (focus / resize only).
    const st = el.style;
    st.left = '0px'; st.top = '0px';
    const a = el.getBoundingClientRect();
    st.left = '100px';
    const b = el.getBoundingClientRect();
    const scale = ((b.left - a.left) / 100 || 1) * k;
    const box = toContainingBlock(target, a.left * k, a.top * k, scale);
    st.left = `${box.left}px`; st.top = `${box.top}px`;
    st.width = `${box.width}px`; st.height = `${box.height}px`;
    st.fontSize = `${LIFT_FONT / scale}px`;
    st.padding = `0 ${14 / scale}px`;
    st.borderRadius = `${10 / scale}px`;
    st.borderWidth = `${2 / scale}px`;
  };
  const lift = (el: HTMLInputElement | HTMLTextAreaElement): void => {
    if (lifted === el) return;
    drop();
    lifted = el;
    savedStyle = el.getAttribute('style') ?? '';
    const st = el.style;
    st.position = 'fixed'; st.margin = '0'; st.boxSizing = 'border-box'; st.zIndex = '2147483000';
    st.maxWidth = 'none'; st.minWidth = '0'; st.transform = 'none'; st.right = 'auto'; st.bottom = 'auto';
    el.classList.add('tkb-lifted');
    document.documentElement.setAttribute('data-touch-kb', '');
    place();
  };
  function drop(): void {
    const el = lifted;
    if (!el) return;
    lifted = null;
    el.classList.remove('tkb-lifted');
    if (savedStyle) el.setAttribute('style', savedStyle); else el.removeAttribute('style');
    document.documentElement.removeAttribute('data-touch-kb');
  }
  const onFocusIn = (e: FocusEvent): void => {
    const el = e.target as Element | null;
    if (!isTextField(el) || !enabled()) return;
    if ((el as HTMLInputElement).readOnly || (el as HTMLInputElement).disabled) return;
    lift(el);
  };
  const onFocusOut = (e: FocusEvent): void => { if (e.target === lifted) drop(); };
  const onViewport = (): void => { if (lifted) place(); };

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.visualViewport?.addEventListener('resize', onViewport);
  window.visualViewport?.addEventListener('scroll', onViewport);
  window.addEventListener('resize', onViewport);
  // A field that already has focus when the touch UI turns on (autoFocus at mount) is lifted too.
  if (isTextField(document.activeElement) && enabled()) lift(document.activeElement);
  return () => {
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    window.visualViewport?.removeEventListener('resize', onViewport);
    window.visualViewport?.removeEventListener('scroll', onViewport);
    window.removeEventListener('resize', onViewport);
    drop();
    installed = false;
  };
}
