/**
 * THE MENU BOARD UNDER THE MOUSE (R-PERF-HOVER-SUBJECT-01, 2026-11-19).
 *
 * A menu board (a Hall banner, a Recent Games / Career game card, the party home's game view) keeps its cards' looping
 * effects still until it is pointed at. That used to be `.lb-row:not(:hover) .lb-team * { animation-play-state: paused }`.
 * The browser keeps ONE invalidation set per pseudo-class for the whole stylesheet, so that single universal subject
 * behind `:hover` made every hover change on ANY element restyle that element's whole subtree: in a game, each card the
 * pointer entered or left was 100 to 150 elements restyled, two or three times per action (the largest part of an
 * action's 200 to 370 element style recalculation, docs/devlog/2026-11-19-perf-commit-floor.md).
 *
 * So "pointed at" is an ATTRIBUTE here, `data-pointed`, and the stylesheets read `:not([data-pointed])`. An attribute's
 * invalidation set is only consulted when that attribute changes, which never happens in a game.
 *
 * One delegated `mouseover` / `mouseout` pair on the document, the events `:hover` itself follows (the browser also
 * dispatches them when content moves under a still pointer). Every matching ancestor of the element under the mouse is
 * stamped, as `:hover` matches every ancestor. An attribute, not a class: React never rewrites an attribute it did not
 * render, so a row re-rendering under the mouse keeps its mark.
 */

/** The menu boards whose stylesheets read `[data-pointed]` (styles.css, partyHome/pages/gamesPages.css). */
export const POINTED_BOARD_SELECTOR = '.lb-row, .gc, .rgp-board';
export const POINTED_ATTR = 'data-pointed';

/** Every menu board at or above `el`, innermost first. */
export function pointedBoardsOf(el: Element | null): Element[] {
  const out: Element[] = [];
  for (let cur = el?.closest(POINTED_BOARD_SELECTOR) ?? null; cur; cur = cur.parentElement?.closest(POINTED_BOARD_SELECTOR) ?? null) out.push(cur);
  return out;
}

/** Install the listeners. Returns the uninstaller (which also clears every mark). */
export function installPointedBoards(doc: Document = document): () => void {
  let marked: Element[] = [];
  const set = (next: Element[]): void => {
    if (next.length === marked.length && next.every((el, i) => el === marked[i])) return;
    for (const el of marked) if (!next.includes(el)) el.removeAttribute(POINTED_ATTR);
    for (const el of next) if (!el.hasAttribute(POINTED_ATTR)) el.setAttribute(POINTED_ATTR, '');
    marked = next;
  };
  const over = (e: MouseEvent): void => {
    const t = e.target;
    // In a game nothing matches: one `closest` walk up from the element under the mouse, no write.
    set(t instanceof Element ? pointedBoardsOf(t) : []);
  };
  // The mouse left the window (no element entered): nothing is pointed at, as `:hover` clears.
  const out = (e: MouseEvent): void => { if (e.relatedTarget === null) set([]); };
  doc.addEventListener('mouseover', over, { passive: true });
  doc.addEventListener('mouseout', out, { passive: true });
  return () => {
    doc.removeEventListener('mouseover', over);
    doc.removeEventListener('mouseout', out);
    set([]);
  };
}
