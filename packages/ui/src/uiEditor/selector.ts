export type Scope = 'this-element' | 'all-like-this';

const VOLATILE_CLASSES = ['dragging', 'buffpop', 'flip', 'selected', 'active', 'hover'];

function stableClass(el: Element): string | null {
  const list = el.classList;
  for (let i = 0; i < list.length; i++) {
    const c = list.item(i);
    if (c && !VOLATILE_CLASSES.includes(c)) return c;
  }
  return null;
}

function tag(el: Element): string {
  return el.tagName.toLowerCase();
}

function zoneAncestor(el: Element): string | null {
  let cur: Element | null = el;
  while (cur) {
    const z = cur.getAttribute('data-zone');
    if (z !== null) return z;
    cur = cur.parentElement;
  }
  return null;
}

/** Index of `el` among its same-tag siblings, 1-based (for `:nth-of-type`). */
function nthOfType(el: Element): number {
  let i = 1;
  let sib = el.previousElementSibling;
  while (sib) {
    if (sib.tagName === el.tagName) i++;
    sib = sib.previousElementSibling;
  }
  return i;
}

/**
 * A selector that matches EXACTLY the given element — the point of 'this-element' scope, so a single node
 * can be adjusted in isolation. A unique id/attr wins outright; otherwise we walk up building a structural
 * `tag:nth-of-type(n)` path, stopping at (and anchoring to) the nearest ancestor that carries a stable
 * `data-uid`/`data-ui`/`data-zone`, or the top of the tree. This is what makes "this element" genuinely
 * differ from "all like this" for chrome that has no id of its own.
 */
export function uniqueSelector(el: Element): string {
  const uid = el.getAttribute('data-uid');
  if (uid !== null) { const c = stableClass(el); return `${c ? `.${c}` : ''}[data-uid="${uid}"]`; }
  const ui = el.getAttribute('data-ui');
  if (ui !== null) return `[data-ui="${ui}"]`;

  const segs: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName !== 'BODY' && cur.tagName !== 'HTML') {
    if (cur !== el) {
      const aUid = cur.getAttribute('data-uid');
      const aUi = cur.getAttribute('data-ui');
      const aZone = cur.getAttribute('data-zone');
      if (aUid !== null) { segs.unshift(`[data-uid="${aUid}"]`); return segs.join(' > '); }
      if (aUi !== null) { segs.unshift(`[data-ui="${aUi}"]`); return segs.join(' > '); }
      if (aZone !== null) { segs.unshift(`[data-zone="${aZone}"]`); return segs.join(' > '); }
    }
    segs.unshift(`${tag(cur)}:nth-of-type(${nthOfType(cur)})`);
    cur = cur.parentElement;
  }
  return segs.length ? segs.join(' > ') : tag(el);
}

export function buildSelector(el: Element, scope: Scope): string {
  const ui = el.getAttribute('data-ui');
  const cls = stableClass(el);

  // 'this-element' must match exactly one node — delegate to the structural unique-path builder.
  if (scope === 'this-element') return uniqueSelector(el);

  // all-like-this
  if (ui !== null) return `[data-ui="${ui}"]`;
  const zone = zoneAncestor(el);
  if (zone !== null && cls) return `[data-zone="${zone}"] .${cls}`;
  return cls ? `.${cls}` : tag(el);
}

export function matchCount(selector: string, root: ParentNode = document): number {
  try {
    return root.querySelectorAll(selector).length;
  } catch {
    return 0; // invalid selector typed into the editable field
  }
}
