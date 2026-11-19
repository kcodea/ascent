/**
 * DECODE AHEAD (R-PERF-PHASE-ART-HELD-01, 2026-11-18): ask the compositor to decode a picture a moment BEFORE the frame
 * that first draws it.
 *
 * The compositor drops big off-screen pictures from its decode cache (heldArt.ts has the why). When the frame that
 * shows one again arrives, the decode (45 to 60 ms for the 3840 px combat board) runs with the main thread stuck behind
 * it. `img.decode()` runs the same decode on a worker thread WITHOUT holding a frame, and the result sits at the fresh
 * end of that cache for the few hundred ms until it is drawn. Already decoded: the call costs nothing.
 *
 * This is for pictures that stay CSS backgrounds (the board keeps the browser's own high-quality scaling). The return
 * trip's layers are held canvases instead (heldArt.ts): they never decode again at all.
 */
import { PHONE_GPU } from './phoneDiag';

const images = new Map<string, HTMLImageElement>();

/** Start (or refresh) an off-thread decode of each picture. Safe to call often. */
export function decodeAhead(urls: readonly string[]): void {
  if (typeof Image === 'undefined') return;
  for (const url of urls) {
    let img = images.get(url);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.src = url;
      images.set(url, img);
    }
    if (typeof img.decode === 'function') img.decode().catch(() => { /* not loaded yet, or gone: the draw decodes it as before */ });
  }
}

/** How many pictures are tracked (tests). */
export const decodeAheadCount = (): number => images.size;

/** What the End Turn transition draws that the shop does not: the pressed (cracked) gem, the falling gate, its poster,
 *  the combat board and its shadow. Desktop only: a phone draws its own small copies and keeps its bounded picture
 *  memory as it is. (The gem is a 1196 x 1312 file drawn about 74 px wide: an 18 to 21 ms decode in the press frame
 *  whenever it had been dropped, measured 2026-11-18.) */
const END_TURN_ART: readonly string[] = PHONE_GPU ? []
  : ['frames/end_button_gem_cracked.webp', 'transition-gate.webp', 'transition-poster.webp', 'playingboard-combat.webp', 'playingboard-combat-shadow.webp']
    .map((f) => `${import.meta.env.BASE_URL}${f}`);

/** Called as End Turn is hovered, pressed, and again as the gate falls: the combat board is decoded by the time the gate
 *  has landed and the scene swaps behind it. */
export function warmEndTurnArt(): void {
  decodeAhead(END_TURN_ART);
}

/** The return trip's two small CSS pictures (the doorway's interior and its glow). Its five big layers are held canvases. */
const VISTA_DOOR_ART: readonly string[] = PHONE_GPU ? [] : ['vista-doorfill.webp', 'vista-doorglow.webp'].map((f) => `${import.meta.env.BASE_URL}${f}`);

/** Called as a fight's replay ends: the door's pictures are decoded before End Combat can be pressed. */
export function warmVistaDoorArt(): void {
  decodeAhead(VISTA_DOOR_ART);
}
