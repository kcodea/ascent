/**
 * CRISP ENLARGED CARDS ON A PHONE (owner 2026-10-25, R-PHONE-CRISP-01: "the inspect looks grainy/not crisp. please fix
 * this to make sure the game looks pristine").
 *
 * A phone loads the build's downscaled art copies (`phoneArt.ts`: card art at 256 px, frames and plates at 512) so the
 * whole run fits in an iPhone's memory. That is right for a card at its board size, but the enlarged views draw ONE
 * card far bigger: the Inspect card's art at ~450 device px and its plate at ~850 on an iPhone 15 Pro, so the copies
 * were stretched 1.7x. `upgradeImages` swaps every phone copy under one element for its original, only after the
 * original has decoded (the low copy stays on screen until then: never an empty frame), and `restore` puts the copies
 * back (the popped hand card, when the finger lifts) so the originals can be dropped again. Desktop and any build
 * without phone copies: a no-op.
 */
import { LITE_ART, fullResUrl, type PhoneArtManifest } from './phoneArt';
import { requestArt, useArtReady } from './artPreload';

const ATTR = 'data-lowsrc';

/** Swap the phone copies under `root` for their originals once decoded. Returns a function that puts the copies back. */
export function upgradeImages(root: Element | null, lite: boolean = LITE_ART): () => void {
  if (!lite || !root || typeof Image === 'undefined') return () => {};
  let live = true;
  const swapped: HTMLImageElement[] = [];
  for (const img of root.querySelectorAll('img')) {
    const low = img.getAttribute('src') ?? '';
    const full = fullResUrl(low);
    if (!low || full === low) continue;
    const pre = new Image();
    pre.decoding = 'async';
    pre.src = full;
    const swap = (): void => {
      if (!live || !img.isConnected || img.getAttribute('src') !== low) return;
      img.setAttribute(ATTR, low);
      img.setAttribute('src', full);
      swapped.push(img);
    };
    (pre.decode ? pre.decode() : Promise.resolve()).then(swap, () => { /* missing original: keep the copy */ });
  }
  return () => {
    live = false;
    for (const img of swapped) {
      const low = img.getAttribute(ATTR);
      // Only where the original is still the src: React may have moved the element to another image since.
      if (low && fullResUrl(low) === img.getAttribute('src')) img.setAttribute('src', low);
      img.removeAttribute(ATTR);
    }
    swapped.length = 0;
  };
}

/**
 * THE BIG HERO SLOTS ON A PHONE (owner 2026-10-31: "Hero art in mobile is blurry", R-PHONE-HERO-SHARP-01). Hero select's
 * cards, the hero pick ceremony, your portrait, the combat foe's and the wipe poster's face draw a hero at about
 * 260-630 device px, past what the 384 px phone copy holds (see `phoneArt.ts`). This returns the 512 px master for
 * such a slot once it has decoded, and the phone copy until then (never an empty frame). The master goes through the
 * art pipe in the `now` lane, so it decodes into the phone's bounded keep (LITE_KEEP_BYTES) like every on-screen image.
 * Desktop and any URL that is not a phone copy: returned unchanged, no work.
 */
export function useSharpArt(url: string | undefined, lite: boolean = LITE_ART, manifest?: PhoneArtManifest | null): string | undefined {
  const full = lite && url ? (manifest === undefined ? fullResUrl(url) : fullResUrl(url, manifest)) : url;
  const sharp = full !== url ? full : undefined;
  const ready = useArtReady(sharp);
  return sharp && ready ? sharp : url;
}

/** Warm (fetch only on a phone) the masters of portraits that are about to be shown big: the lobby's seats, whose
 *  faces become the combat foe's portrait. A no-op on desktop. */
export function warmSharpArt(urls: Iterable<string | undefined>, lite: boolean = LITE_ART, manifest?: PhoneArtManifest | null): void {
  if (!lite) return;
  for (const u of urls) {
    const full = u ? (manifest === undefined ? fullResUrl(u) : fullResUrl(u, manifest)) : u;
    if (full && full !== u) requestArt(full, 'early');
  }
}
