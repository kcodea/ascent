/**
 * SPECTATOR CURSOR SPACE (owner 2026-10-15: "our cursor position is kinda off for someone viewing at a different aspect
 * ratio, like my friend playing in 16:9 moves his mouse to a different area on screen to end turn and upgrade the
 * shop"; R-SPECTATE-CURSOR-01).
 *
 * A pointer used to travel as WINDOW fractions. The game is not laid out against the window: it is a centred 16:9 box
 * (`stage.ts gameBox`), letterboxed on any other aspect, so a window fraction landed on different UI on a 16:10 or 21:9
 * screen. A point now travels three ways, best first:
 *   - `an`: ANCHORED to the UI element under it (a card / minion by `data-uid`, a button / rune / quest by `data-spec`),
 *     as a fraction of that element's box, so it lands on the same element on any screen, wherever that element sits;
 *   - `gx / gy`: a fraction of the game box (design space), for a point over no anchor;
 *   - `x / y`: the old window fractions, still sent so an older spectator keeps working (no protocol version: every
 *     new field is optional, and an older sender's sample still decodes).
 * The anchor key doubles as the HOVER key: the element the player's pointer is over is the one whose hover preview
 * the spectator opens (R-SPECTATE-HOVER-01).
 */
import type { StreamAnchor } from '@game/sim';
import { gameBox } from '../stage';

/** A point anchored to an element: its key and the point as a fraction of the element's box (the replay stream's own
 *  type, so a recorded anchor and a live one can never differ; R-REPLAY-STREAM-01). */
export type CursorAnchor = StreamAnchor;
/** A point as it travels. */
export interface CursorPointWire { x: number; y: number; gx?: number; gy?: number; an?: CursorAnchor | null }

/** What makes an element an anchor. */
export const ANCHOR_SELECTOR = '[data-uid],[data-spec]';
/** Elements whose anchors never count: hover popups, drag ghosts (their copies are not the player's real UI). */
const SKIP = '.cardref, .replay-dragghost, .castprev-layer';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** The anchor element at or above `el`, and its key (`u:<uid>` or `s:<spec>`), or null. */
export function anchorOf(el: Element | null | undefined): { key: string; el: HTMLElement } | null {
  const hit = el && typeof (el as Element).closest === 'function' ? (el as Element).closest<HTMLElement>(ANCHOR_SELECTOR) : null;
  if (!hit || hit.closest(SKIP)) return null;
  const uid = hit.getAttribute('data-uid');
  if (uid) return { key: `u:${uid}`, el: hit };
  const spec = hit.getAttribute('data-spec');
  return spec ? { key: `s:${spec}`, el: hit } : null;
}

const esc = (v: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&'));
/** The CSS selector that finds an anchor key's element on this screen. */
export function anchorSelector(key: string): string | null {
  if (key.startsWith('u:')) return `[data-uid="${esc(key.slice(2))}"]`;
  if (key.startsWith('s:')) return `[data-spec="${esc(key.slice(2))}"]`;
  return null;
}

/** This screen's element for an anchor key (the first live, visible one), or null. */
export function findAnchor(key: string, root: ParentNode = document): HTMLElement | null {
  const sel = anchorSelector(key);
  if (!sel) return null;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(sel))) if (!el.closest(SKIP)) return el;
  return null;
}

/**
 * The SENDER: a screen point (px) and the element under it, as it travels. One rect read for the anchor (called on the
 * sample timer, ~20 Hz while the pointer moves, never per frame). `rects` shares the reads across the points of one
 * message (they are usually over the same element); `anchor: false` sends the design-space point alone (while a card
 * is held or an aim is out the rows under the pointer slide, so an anchor would ride a moving card; the game box does
 * not move, R-SPECTATE-SMOOTH-01).
 */
export function encodePoint(x: number, y: number, target: Element | null | undefined, rects?: Map<Element, DOMRect>, anchor = true): CursorPointWire {
  const vw = window.innerWidth || 1, vh = window.innerHeight || 1;
  const box = gameBox();
  const out: CursorPointWire = { x: r3(x / vw), y: r3(y / vh), gx: r3((x - box.left) / (box.w || 1)), gy: r3((y - box.top) / (box.h || 1)) };
  const a = anchor ? anchorOf(target) : null;
  if (a) {
    let r = rects?.get(a.el);
    if (!r) { r = a.el.getBoundingClientRect(); rects?.set(a.el, r); }
    if (r.width > 0 && r.height > 0) out.an = { k: a.key, fx: r3((x - r.left) / r.width), fy: r3((y - r.top) / r.height) };
  }
  return out;
}

/**
 * The RECEIVER: where a travelled point lands on THIS screen (screen px). The anchor's element when it is on screen,
 * else the game box, else (an older sender) the window. One rect read per anchor per received message (`rects` shares
 * them across a message's points), never per frame.
 */
export function decodePoint(p: CursorPointWire, root: ParentNode = document, rects?: Map<string, DOMRect | null>): { x: number; y: number; el: HTMLElement | null } {
  if (p.an) {
    const el = findAnchor(p.an.k, root);
    let r = rects?.get(p.an.k);
    if (r === undefined) { r = el?.getBoundingClientRect() ?? null; rects?.set(p.an.k, r); }
    if (el && r && r.width > 0 && r.height > 0) return { x: r.left + p.an.fx * r.width, y: r.top + p.an.fy * r.height, el };
  }
  if (typeof p.gx === 'number' && typeof p.gy === 'number') {
    const box = gameBox();
    return { x: box.left + p.gx * box.w, y: box.top + p.gy * box.h, el: null };
  }
  return { x: p.x * (window.innerWidth || 1), y: p.y * (window.innerHeight || 1), el: null };
}
