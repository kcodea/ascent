/**
 * OUTLINED TEXT WITH A GLOW, ON iPHONE (R-WEBKIT-SHADOW-01; owner 2026-10-26: "build the iPhone-friendly versions").
 *
 * The game's big readable labels (damage numbers, tribe labels, spell / Ruby power floats, Collection skin tiles) draw
 * a thick outline UNDER the fill (`-webkit-text-stroke` + `paint-order: stroke fill`) and a glow or drop shadow
 * (`text-shadow`). Chromium paints that as: the outline, then the shadows of the letters, then the letters. WebKit
 * (every iPhone browser, and Safari) draws NO text-shadow at all on text whose paint-order is not `normal`, so on an
 * iPhone those labels lost their glow.
 *
 * The WebKit path rebuilds Chromium's three layers out of the label's own text, keyed by `data-wkt` (the text) and
 * `html[data-webkit-text]` (set here, on WebKit only):
 *   ::before   the outline alone  (`--wk-stroke`, transparent fill)
 *   ::after    the shadows alone  (`--wk-ts`, no stroke, transparent fill; paint-order normal, so WebKit draws them)
 *   the label  its letters alone  (stroke 0, no shadow), on top, with its own spans and colours
 * The CSS lives in styles.css ("OUTLINED TEXT WITH A GLOW ON WEBKIT"). Every other browser never sees the attribute's
 * rules, so it renders exactly as before. Nothing animates: the layers are static paint inside the label, which keeps
 * its own transform / opacity animation.
 */

/** True for the WebKit engine: Safari, and every iPhone / iPad browser (all are WebKit, whatever their name). */
export function isWebKitEngine(ua: string): boolean {
  return /AppleWebKit\//.test(ua) && !/(Chrome|Chromium|Edg|OPR|SamsungBrowser|Android)\//.test(ua);
}

/** Marks `<html data-webkit-text>` on WebKit, once at boot (the styles.css WebKit layering keys off it). */
export function installWebKitText(doc: Document = document, ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): void {
  if (isWebKitEngine(ua)) doc.documentElement.setAttribute('data-webkit-text', '');
}

/** Sets a glowing label's text AND its WebKit layering copy (`data-wkt`), which must always match it. */
export function setGlowText(el: HTMLElement, text: string): void {
  el.textContent = text;
  el.setAttribute('data-wkt', text);
}
