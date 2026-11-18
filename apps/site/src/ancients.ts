/** The Ancients showcase: pointing at, focusing or tapping a portrait brings up that Ancient's card below the row. */

function select(doc: Document, id: string): void {
  for (const tile of doc.querySelectorAll('[data-ancient]')) {
    tile.setAttribute('aria-pressed', String(tile.getAttribute('data-ancient') === id));
  }
  for (const panel of doc.querySelectorAll<HTMLElement>('[data-ancient-panel]')) {
    const on = panel.getAttribute('data-ancient-panel') === id;
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

export function initAncients(doc: Document): void {
  for (const tile of doc.querySelectorAll('[data-ancient]')) {
    const id = tile.getAttribute('data-ancient');
    if (!id) continue;
    const pick = (): void => select(doc, id);
    tile.addEventListener('mouseenter', pick);
    tile.addEventListener('focus', pick);
    tile.addEventListener('click', pick);
  }
}
