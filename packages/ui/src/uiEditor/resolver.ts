/**
 * Click-target → nearest meaningful element. A raw pointer target is usually a leaf glyph; the editor should
 * select the pill/card/row it belongs to. "Meaningful" = carries an anchor data-attr, or has a known component
 * class. Ranked by proximity (nearest wins), so a `.cgem` inside a `.card` selects the cgem.
 */
export const ANCHOR_ATTRS = ['data-uid', 'data-zone', 'data-ui', 'data-hud', 'data-pill'] as const;
export const ANCHOR_CLASSES = ['card', 'cgem', 'badge', 'pill', 'row', 'hud'] as const;

export function isAnchor(el: Element): boolean {
  for (const a of ANCHOR_ATTRS) if (el.getAttribute(a) !== null) return true;
  for (const c of ANCHOR_CLASSES) if (el.classList.contains(c)) return true;
  return false;
}

export function resolveAnchor(el: Element): Element {
  let cur: Element | null = el;
  while (cur) {
    if (isAnchor(cur)) return cur;
    cur = cur.parentElement;
  }
  return el; // nothing up-chain qualifies — edit the clicked element directly
}

export function selectParent(el: Element): Element | null {
  let cur: Element | null = el.parentElement;
  while (cur) {
    if (isAnchor(cur)) return cur;
    cur = cur.parentElement;
  }
  return null;
}
