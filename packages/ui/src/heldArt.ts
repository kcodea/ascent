/**
 * HELD ART (R-PERF-PHASE-ART-HELD-01, 2026-11-18): a full-screen picture that a phase change shows, painted ONCE onto a
 * canvas that the page keeps.
 *
 * Why a canvas. A CSS background or an <img> is drawn from the compositor's own decode cache. That cache has a budget,
 * and the game's full-screen pictures are a lot to hold in it: the backdrop, the two boards and their shadows, the gate
 * and the return trip's five 2560 x 1440 layers. Whichever of them is off screen for a phase is dropped (measured), and
 * the next phase change decodes it again (25 to 73 ms a picture) while the main thread waits on the commit behind it:
 * the hitch at the end of every fight and on some End Turns (measured 2026-11-18,
 * docs/devlog/2026-11-18-perf-phase-transitions.md). Holding the HTMLImageElement does not
 * help (`img.decode()` fills the same cache and it empties the same way, R-PRESENT-36).
 *
 * A canvas owns its pixels. The compositor shows it as a texture: nothing to decode, nothing to raster, however long
 * it was hidden. The picture is decoded once, off the main thread (`createImageBitmap`), drawn into the canvas on an
 * idle slot, and the bitmap is closed. The canvas elements live for the session (module level), so a new run moves the
 * same canvases into its own DOM instead of decoding again.
 *
 * Memory: one canvas = width x height x 4 bytes of GPU memory. A canvas is no bigger than the picture, and no bigger
 * than `maxW` x `maxH` asks for (the size it is drawn at, in device pixels), so a 1920 x 1080 window holds 8 MB a
 * layer, not 14. Desktop only: the callers keep phones on their one small flattened picture (R-TOUCH-RUN-MEMORY-02).
 *
 * ONE HOST AT A TIME: a canvas element has one parent, so each picture can be shown in one place. That is the vista
 * (one per Shop screen, and there is one Shop screen). A second simultaneous user of the same picture needs its own copy.
 */

interface Held {
  canvas: HTMLCanvasElement;
  url: string;
  /** The picture's own size, once known. */
  natW: number;
  natH: number;
  /** The size it is drawn at, in device px (asked again on a window resize). No layout read: the caller computes it. */
  want: () => { w: number; h: number };
  painting: boolean;
  painted: boolean;
  failed: boolean;
}

const held = new Map<string, Held>();
let listening = false;

/** The canvas size for a picture of `natW` x `natH` that is drawn `wantW` x `wantH` device px: the picture's own aspect,
 *  big enough to cover the drawn size, never bigger than the picture. Pure (tested). */
export function heldArtSize(natW: number, natH: number, wantW: number, wantH: number): { w: number; h: number } {
  if (!(natW > 0 && natH > 0)) return { w: 0, h: 0 };
  const scale = Math.min(1, Math.max(wantW / natW, wantH / natH));
  if (!(scale > 0)) return { w: natW, h: natH };
  return { w: Math.max(1, Math.round(natW * scale)), h: Math.max(1, Math.round(natH * scale)) };
}

/** Whether a canvas of `curW` should be painted again for a new wanted size: only when it must GROW by a real margin
 *  (a shrinking window keeps its sharper copy; a few px of growth is not worth a decode). Pure (tested). */
export function heldArtNeedsRepaint(curW: number, nextW: number): boolean {
  return nextW > curW * 1.08;
}

const idle = (fn: () => void): void => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') ric(fn, { timeout: 1500 });
  else setTimeout(fn, 0);
};

/** The picture as a decoded bitmap. From the bytes when they can be fetched (the HTTP cache has them: the boot gate
 *  loaded every public picture); else through an image element, whose `decode()` is also off the main thread. */
async function decodeBitmap(url: string): Promise<ImageBitmap> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    return await createImageBitmap(await res.blob());
  } catch {
    const img = new Image();
    img.src = url;
    await img.decode();
    return createImageBitmap(img);
  }
}

async function paint(h: Held): Promise<void> {
  if (h.painting) return;
  h.painting = true;
  try {
    if (typeof createImageBitmap !== 'function') throw new Error('no createImageBitmap');
    // Decoded off the main thread; nothing below blocks a frame on the decode.
    const first = await decodeBitmap(h.url);
    h.natW = first.width; h.natH = first.height;
    const want = h.want();
    const { w, h: hh } = heldArtSize(first.width, first.height, want.w, want.h);
    // Scaled copies are resized by the decoder (high quality), again off the main thread.
    let bmp = first;
    if (w !== first.width || hh !== first.height) {
      try {
        bmp = await createImageBitmap(first, { resizeWidth: w, resizeHeight: hh, resizeQuality: 'high' });
        first.close();
      } catch { bmp = first; }
    }
    await new Promise<void>((done) => idle(() => {
      const ctx = h.canvas.getContext('2d');
      if (!ctx) { h.failed = true; done(); return; }
      if (h.canvas.width !== w || h.canvas.height !== hh) { h.canvas.width = w; h.canvas.height = hh; }
      else ctx.clearRect(0, 0, w, hh);
      ctx.imageSmoothingQuality = 'high'; // only matters if the decoder could not resize the bitmap itself
      ctx.drawImage(bmp, 0, 0, w, hh);
      bmp.close();
      h.painted = true;
      h.canvas.dataset.held = '1';
      done();
    }));
  } catch {
    // No canvas copy: the host element shows its own CSS background again (see `.heldart-off`).
    h.failed = true;
  } finally {
    h.painting = false;
    if (h.failed) h.canvas.parentElement?.classList.add('heldart-off');
  }
}

function onResize(): void {
  for (const h of held.values()) {
    if (!h.painted || h.failed || !h.natW) continue;
    const want = h.want();
    if (!(want.w > 0 && want.h > 0)) continue;
    const next = heldArtSize(h.natW, h.natH, want.w, want.h);
    if (heldArtNeedsRepaint(h.canvas.width, next.w)) void paint(h);
  }
}

/**
 * The session's canvas for `url`, created (and its paint started) on first ask. `want` gives the size it is drawn at,
 * in device px. Append it to its host: a canvas has one parent, so a later host takes it over.
 */
export function heldArtCanvas(url: string, want: () => { w: number; h: number }): HTMLCanvasElement {
  let h = held.get(url);
  if (!h) {
    const canvas = document.createElement('canvas');
    canvas.className = 'heldart';
    canvas.setAttribute('aria-hidden', 'true');
    // Start tiny: the real size is set when the picture is drawn in.
    canvas.width = 1; canvas.height = 1;
    h = { canvas, url, natW: 0, natH: 0, want, painting: false, painted: false, failed: false };
    held.set(url, h);
    const mine = h;
    // A lost GPU context empties an accelerated canvas: paint it again when the context is back.
    canvas.addEventListener('contextrestored', () => { mine.painted = false; void paint(mine); });
    void paint(h);
    if (!listening && typeof window !== 'undefined') {
      listening = true;
      let t: ReturnType<typeof setTimeout> | undefined;
      window.addEventListener('resize', () => { if (t) clearTimeout(t); t = setTimeout(onResize, 600); });
    }
  }
  return h.canvas;
}

/** Put the session's canvas for `url` inside `host` (idempotent). Reads no layout. */
export function mountHeldArt(host: HTMLElement, url: string, want: () => { w: number; h: number }): void {
  const canvas = heldArtCanvas(url, want);
  if (canvas.parentElement !== host) host.appendChild(canvas);
  const h = held.get(url);
  host.classList.toggle('heldart-off', !!h?.failed);
}

/** What is held right now (DEV / perf probes): each picture's canvas size and its bytes. */
export function heldArtStats(): { count: number; bytes: number; items: Array<{ url: string; w: number; h: number; painted: boolean; failed: boolean }> } {
  const items = [...held.values()].map((h) => ({ url: h.url, w: h.canvas.width, h: h.canvas.height, painted: h.painted, failed: h.failed }));
  return { count: items.length, bytes: items.reduce((s, i) => s + (i.painted ? i.w * i.h * 4 : 0), 0), items };
}
