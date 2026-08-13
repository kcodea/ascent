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

export function buildSelector(el: Element, scope: Scope): string {
  const ui = el.getAttribute('data-ui');
  const cls = stableClass(el);

  if (scope === 'this-element') {
    const uid = el.getAttribute('data-uid');
    if (uid !== null) return `${cls ? `.${cls}` : ''}[data-uid="${uid}"]`;
    if (ui !== null) return `[data-ui="${ui}"]`;
    return cls ? `${tag(el)}.${cls}` : tag(el);
  }

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
