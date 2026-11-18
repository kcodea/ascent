/** A showcase row: pointing at, focusing or tapping a tile brings up that tile's card below the row. The Ancients
 *  ('ancient') and the rune rewards ('rune') are each one row, keyed by data-<key> tiles and data-<key>-panel cards. */

function select(doc: Document, key: string, id: string): void {
  for (const tile of doc.querySelectorAll(`[data-${key}]`)) {
    tile.setAttribute('aria-pressed', String(tile.getAttribute(`data-${key}`) === id));
  }
  for (const panel of doc.querySelectorAll<HTMLElement>(`[data-${key}-panel]`)) {
    const on = panel.getAttribute(`data-${key}-panel`) === id;
    if (on === panel.classList.contains('is-on') && on !== panel.hidden) continue;
    panel.hidden = !on;
    // Dropping the class first restarts the card's entrance when it is shown again.
    panel.classList.remove('is-on');
    if (on) {
      void panel.offsetWidth;
      panel.classList.add('is-on');
    }
  }
}

export function initShowcase(doc: Document, key: 'ancient' | 'rune'): void {
  for (const tile of doc.querySelectorAll(`[data-${key}]`)) {
    const id = tile.getAttribute(`data-${key}`);
    if (!id) continue;
    const pick = (): void => select(doc, key, id);
    tile.addEventListener('mouseenter', pick);
    tile.addEventListener('focus', pick);
    tile.addEventListener('click', pick);
  }
}

export const initAncients = (doc: Document): void => initShowcase(doc, 'ancient');
export const initRunes = (doc: Document): void => initShowcase(doc, 'rune');
