import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { createAssetQueue, type AssetQueue, type Lane } from './assetQueue';

/**
 * ART PRELOAD — the image flavour of the asset queue (owner report 2026-09-29: "a lot of pop in when i watch my
 * friends play when they roll into a fresh shop"). Two halves:
 *
 *   1. ORDER. Every art URL the game can show is requested through ONE queue (`assetQueue.ts`, 6 in flight), in
 *      lanes: what is on screen now, then the card chrome (frames / plates / stars), then the run's early cards
 *      and the heroes, then the rest of the run's pinned SET, then the audio bank, then everything else. The
 *      old warm-up fired every request at once, so the card in the shop waited behind the whole bundle.
 *   2. NEVER SHOW AN UNDECODED IMAGE. `useArtReady(url)` tells a renderer whether its art has been fetched AND
 *      decoded. A card whose art is not ready keeps the <img> invisible over a styled placeholder, and fades
 *      it in once decoded (`Card.tsx` `.artimg.art-pending` / `.art-fadein`). Art that is already ready renders
 *      exactly as before, with no fade and no extra work: that is the common case once the preload has run.
 *
 * DECODED lanes (`now` … `set`: the chrome, the heroes, the run's pinned pool) are fetched AND decoded, and their
 * Image object is held for the session so the browser keeps the bytes to hand (the same hold the old warm-up
 * did). The `idle` lane — other sets, runes, quests, Ancients — only FETCHES, with `fetch()`, into the HTTP
 * cache: no decode, no Image, no renderer memory held (measured: holding them as Images cost ~250 MB of renderer
 * memory for art a run mostly never shows). An idle-lane URL is therefore NOT "ready"; when a card does render
 * it, `useArtReady` raises it to `now`, which decodes it straight from the disk cache in a few milliseconds —
 * behind the placeholder, then a fade — never a blank frame.
 */

const queue: AssetQueue = createAssetQueue(6);
const KEEP = new Map<string, HTMLImageElement>();
/** Every URL ever requested in a DECODED lane (the idle fetch skips these). */
const decodeRequested = new Set<string>();
/** decode() can stall in a backgrounded / throttled tab. Never let one hold a lane (or a card hidden) forever. */
const DECODE_TIMEOUT_MS = 15000;

/** Fetch + decode, and hold the Image for the session. Settles on success, failure or timeout alike: a missing
 *  or broken file must never keep a card hidden (the card then shows whatever the <img> itself manages). */
function decodeImage(url: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    const timer = setTimeout(resolve, DECODE_TIMEOUT_MS);
    const end = (): void => { clearTimeout(timer); resolve(); };
    KEEP.set(url, img);
    img.src = url;
    img.decode().then(end, end);
  });
}

/** Warm the HTTP cache only. The body is read to the end (so the cache entry completes) and dropped. */
function fetchOnly(url: string): Promise<void> {
  if (typeof fetch !== 'function') return Promise.resolve();
  return fetch(url).then((r) => r.arrayBuffer()).then(() => undefined, () => undefined);
}

/** Queue `url` (or raise it to `lane`). Cheap to call repeatedly: a known URL is a Map lookup. The queue key
 *  for a decode is the URL itself (so `queue.ready(url)` means DECODED); an idle fetch is keyed `f:<url>`. */
export function requestArt(url: string | undefined, lane: Lane): void {
  if (!url) return;
  if (lane === 'idle') {
    // Never fetch() a URL the decoded lanes own: it is a wasted request at best, and on a no-cache server the
    // fetch's revalidation made the next <img> for that URL revalidate too (a blank frame, measured 2026-09-29).
    if (!decodeRequested.has(url)) queue.request(`f:${url}`, 'idle', () => fetchOnly(url));
    return;
  }
  decodeRequested.add(url);
  queue.request(url, lane, () => decodeImage(url));
}

/** Queue a list, in order, all in one lane. */
export function requestArtList(urls: Iterable<string | undefined>, lane: Lane): void {
  for (const u of urls) requestArt(u, lane);
}

/** A generic (non-image) task through the SAME pipe — the SFX bank uses this so its ~430 fetches queue behind
 *  the art a player is looking at instead of racing it. Keyed so a repeat request is a no-op. */
export function requestAssetTask(key: string, lane: Lane, task: () => Promise<unknown>): void {
  queue.request(key, lane, () => task());
}

export const artReady = (url: string | undefined): boolean => !url || queue.ready(url);

/** An on-screen <img> finished loading + decoding before the queue got to it: mark it ready. */
export function markArtReady(url: string | undefined): void {
  if (url) queue.resolve(url);
}

const noop = (): void => {};
/**
 * True when `url` is fetched + decoded (or absent). A pending URL is raised to the `now` lane on the first
 * render that asks — whatever a player can see is always the next thing the pipe fetches.
 */
export function useArtReady(url: string | undefined): boolean {
  const subscribe = useCallback((cb: () => void) => (url ? queue.subscribe(url, cb) : noop), [url]);
  const ready = useSyncExternalStore(
    subscribe,
    () => artReady(url),
    () => true,
  );
  if (!ready) requestArt(url, 'now');
  return ready;
}

/** For tests / the perf HUD: queue depth. */
export const artQueueStats = (): ReturnType<AssetQueue['stats']> => queue.stats();

/**
 * Everything an <img> needs to never show undecoded art: `cls` is `art-pending` (invisible over its placeholder)
 * until the art is ready, then `art-fadein` (a one-shot 180 ms opacity fade, compositor-only) IF it was ever seen
 * pending, else nothing (already-ready art renders exactly as before, no fade). `waiting` lets the container show
 * its placeholder. Spread `ref`, `onLoad` and `onError` onto the <img>.
 *
 * TWO checks, because "the pipe decoded this URL" is not the same as "THIS element can paint it":
 *   1. the URL — `useArtReady` (fetched + decoded by the preload's own Image);
 *   2. the ELEMENT — at commit, before the browser paints, `ref` reads `img.complete`. A brand-new <img> for an
 *      already-decoded URL can still load asynchronously: when the server says `no-cache` / `max-age=0` (the Vite
 *      dev server, `vite preview`, and Netlify before `_headers`), Chrome revalidates the URL for the new element
 *      once the document's memory-cache copy is out of its reuse window, and that element paints BLANK until the
 *      304 lands (measured 2026-09-29: 1-2 blank frames per new card on localhost). Not complete → treated
 *      exactly like a pending URL: hidden over the placeholder, faded in on load. Complete → painted this frame
 *      (`decoding="sync"` makes the paint wait for the decode rather than skip the image).
 * Local-only React state; the ref callback's state update is flushed synchronously in the same commit, so the
 * blank element never reaches a paint.
 */
export function useArtFade(url: string | undefined): {
  cls: string;
  waiting: boolean;
  ref: (el: HTMLImageElement | null) => void;
  onLoad: (e: { currentTarget: HTMLImageElement }) => void;
  onError: () => void;
} {
  const ready = useArtReady(url);
  const [elWait, setElWait] = useState<string | undefined>(undefined);
  const seenPending = useRef<string | undefined>(undefined);
  const ref = useCallback((el: HTMLImageElement | null) => {
    if (el && url && !el.complete) setElWait(url);
  }, [url]);
  const waiting = !!url && (!ready || elWait === url);
  if (waiting) seenPending.current = url;
  const settle = (): void => { markArtReady(url); setElWait(undefined); };
  return {
    cls: waiting ? ' art-pending' : seenPending.current === url && url ? ' art-fadein' : '',
    waiting,
    ref,
    onLoad: (e) => {
      const img = e.currentTarget;
      // decode() on a loaded <img> resolves once its pixels are ready to paint; never gate on it failing.
      if (typeof img.decode === 'function') img.decode().then(settle, settle);
      else settle();
    },
    onError: settle,
  };
}
