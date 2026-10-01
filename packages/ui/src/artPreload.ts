import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createAssetQueue, type AssetQueue, type Attempt, type Lane } from './assetQueue';

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
 * EVERY lane fetches AND decodes, and the Image object is held for the session so the browser keeps the bytes to
 * hand. Since 2026-09-30 the boot splash is a real LOADING GATE (owner: "i think id rather load everything. i dont
 * want blurry images, i wanna stop pop in."): `Boot` waits on `whenArtReady` for everything a session on the
 * live set can show before the menu appears, and the rest (other sets' cards for the Collection's set picker)
 * keeps decoding behind it in the `idle` lane. The old `idle` lane only FETCHED (no decode, no held Image) to
 * save ~250 MB of renderer memory; the owner chose zero pop-in over that saving, and the cost is measured in
 * docs/devlog/2026-09-30-art-loading-gate.md. The placeholder above stays as a safety net only.
 *
 * FAILED LOADS RETRY (owner report 2026-09-30: a friend's round-12 shop showed six blank ovals and an empty spell
 * frame, "why did this happen?"). An image request that fails (a network hiccup, a dropped connection, a timeout)
 * used to be final: the old build never asked again, and the pipe above settled the URL as "ready" so the card
 * painted its broken <img> (a blank oval) for the rest of the session. Now a failed decode RETRIES through the
 * same pipe after 1 s, 3 s and 8 s (the same URL, so a copy that reached the cache elsewhere is used; only the last
 * try adds a cache-busting query). An on-screen <img> that errors reports it (`queue.fail`), shows the dark
 * placeholder, and re-sets its src once the pipe has the image. After the last try the URL is FAILED: the card
 * keeps the placeholder (never a blank), and the network coming back (`online`) or the tab being shown again
 * re-queues every failed URL. Nothing here ever blocks play: a failed URL is `settled` for the loading gate.
 */

/** Backoff before each retry of a failed art load (ms): 4 tries in all, about 12 s end to end. */
export const ART_RETRY_DELAYS: readonly number[] = [1000, 3000, 8000];

const queue: AssetQueue = createAssetQueue(6, {
  onGiveUp: (url, attempts) => {
    // No asset telemetry channel exists; the console line lands in a pasted bug report, the counter in stats.
    console.warn(`[art] gave up loading ${url} after ${attempts} attempts; showing the placeholder until the network returns`);
  },
});
const KEEP = new Map<string, HTMLImageElement>();
/** The URL that actually decoded, when it was the cache-busted last try (an on-screen <img> reloads from it). */
const LOADED_AS = new Map<string, string>();
/** decode() can stall in a backgrounded / throttled tab, or a request can hang. Treated as a failed try. */
const DECODE_TIMEOUT_MS = 15000;

/** The last try's URL: the same file with a query the browser cache has never seen. Not for data: / blob: URLs. */
export function cacheBust(url: string, attempt: number): string {
  if (/^(data|blob):/i.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}-${Date.now().toString(36)}`;
}

/** Fetch + decode, and hold the Image for the session. REJECTS on a failed load or a timeout so the pipe retries. */
function decodeImage(url: string, attempt: number, last: boolean): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  const src = last && attempt > 0 ? cacheBust(url, attempt) : url;
  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    const timer = setTimeout(() => reject(new Error('timeout')), DECODE_TIMEOUT_MS);
    img.src = src;
    img.decode().then(() => {
      clearTimeout(timer);
      KEEP.set(url, img);
      if (src !== url) LOADED_AS.set(url, src);
      resolve();
    }, (err: unknown) => { clearTimeout(timer); reject(err); });
  });
}

/** Queue `url` (or raise it to `lane`). Cheap to call repeatedly: a known URL is a Map lookup. The queue key is
 *  the URL itself, so `queue.ready(url)` means fetched AND decoded; a failure retries (ART_RETRY_DELAYS). */
export function requestArt(url: string | undefined, lane: Lane): void {
  if (!url) return;
  queue.request(url, lane, artTask(url), { retryDelays: ART_RETRY_DELAYS });
}

const artTask = (url: string) => (_lane: Lane, { attempt, last }: Attempt): Promise<void> => decodeImage(url, attempt, last);

/** An on-screen <img> for `url` errored: the pipe fetches it again (backoff + cap) if it thought it was ready. */
export function reportArtError(url: string | undefined): void {
  if (url) queue.fail(url, artTask(url), { retryDelays: ART_RETRY_DELAYS, lane: 'now' });
}

/** Re-queue every art URL that failed or is backing off (the network came back, or the tab is visible again). */
export function retryFailedArt(): number {
  return queue.retryFailed();
}

/** <img>s wired through `useArtFade` (cards, frames, plates, FadeImg). They handle their own errors. */
const MANAGED = new WeakSet<HTMLImageElement>();

/**
 * THE SAFETY NET for every OTHER <img> in the game (an icon, a button, the title logo): one capture-phase `error`
 * listener on the document. The failed element hides (`.img-retrying`, never a broken image), its URL goes through
 * the same pipe with the same backoff and cap, and once the pipe has it the element re-sets its src. Nothing runs
 * unless an image actually fails.
 */
function onAnyImgError(ev: Event): void {
  const el = ev.target;
  if (typeof HTMLImageElement === 'undefined' || !(el instanceof HTMLImageElement) || MANAGED.has(el)) return;
  const src = el.getAttribute('src');
  if (!src || /^(data|blob):/i.test(src)) return;
  el.classList.add('img-retrying');
  requestArt(src, 'now');
  reportArtError(src);
  const off = queue.subscribe(src, () => {
    if (!queue.ready(src)) return; // failed for good: stays hidden until the network returns
    off();
    if (el.getAttribute('src') !== src) return; // React moved it on to another image
    el.src = LOADED_AS.get(src) ?? src;
  });
}
function onAnyImgLoad(ev: Event): void {
  const el = ev.target;
  if (typeof HTMLImageElement !== 'undefined' && el instanceof HTMLImageElement && !MANAGED.has(el)) el.classList.remove('img-retrying');
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', () => { retryFailedArt(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retryFailedArt(); });
  document.addEventListener('error', onAnyImgError, true);
  document.addEventListener('load', onAnyImgLoad, true);
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
/** The URL gave up (every retry failed): it shows the placeholder until `retryFailedArt`. */
export const artFailed = (url: string | undefined): boolean => !!url && queue.failed(url);

/** An on-screen <img> finished loading + decoding before the queue got to it: mark it ready. */
export function markArtReady(url: string | undefined): void {
  if (url) queue.resolve(url);
}

const noop = (): void => {};
/**
 * True when `url` is fetched + decoded (or absent). A pending URL is raised to the `now` lane on the first
 * render that asks — whatever a player can see is always the next thing the pipe fetches. The subscription is
 * live for the component's life, so a URL that flips back to pending (an on-screen error) and then loads on a
 * retry re-renders the card both times.
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

/**
 * Resolve once every URL in `urls` is SETTLED (decoded, or failed after every retry: the pipe gives up after
 * ART_RETRY_DELAYS, so this always resolves). `onProgress(done, total)` is called once up front and after each settle. A URL not yet
 * queued is requested in the `set` lane (a URL already queued keeps its lane: never demoted), so the promise can
 * never wait on a key nobody asked for. Used by the boot LOADING GATE (Boot.tsx).
 */
export function whenArtReady(urls: readonly string[], onProgress?: (done: number, total: number) => void): Promise<void> {
  const unique = [...new Set(urls.filter(Boolean))];
  const total = unique.length;
  let done = 0;
  return new Promise<void>((resolve) => {
    const tick = (): void => {
      done++;
      onProgress?.(done, total);
      if (done === total) resolve();
    };
    onProgress?.(0, total);
    if (total === 0) { resolve(); return; }
    for (const u of unique) {
      requestArt(u, 'set');
      if (queue.settled(u)) { queueMicrotask(tick); continue; }
      let off: (() => void) | null = null;
      let ticked = false;
      off = queue.subscribe(u, () => {
        if (ticked || !queue.settled(u)) return;
        ticked = true;
        off?.();
        tick();
      });
    }
  });
}

/** How many art/audio tasks the pipe runs at once. The boot gate opens it wider while the splash is up (no
 *  frame to protect, only throughput), then puts it back. */
export function setArtConcurrency(n: number): void {
  queue.setConcurrency(n);
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
 *
 * An ELEMENT that errors is never painted broken (retry fix 2026-09-30): it hides over the placeholder, tells the
 * pipe (`queue.fail`, which re-fetches the URL through the same ordered, capped queue with backoff), and once the
 * pipe has the image re-sets its own src so it reloads from the cache. A URL that gave up keeps the placeholder.
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
  /** The URL this element failed to load: hidden over the placeholder until the pipe has it again. */
  const [elFailed, setElFailed] = useState<string | undefined>(undefined);
  const seenPending = useRef<string | undefined>(undefined);
  const elRef = useRef<HTMLImageElement | null>(null);
  const ref = useCallback((el: HTMLImageElement | null) => {
    elRef.current = el;
    if (el) MANAGED.add(el);
    if (el && url && !el.complete) setElWait(url);
  }, [url]);
  // The pipe has the image again after this element errored: reload the element from it (same URL, so the cache
  // answers; or the cache-busted URL the last try used). Stays hidden until its own load event.
  useEffect(() => {
    const el = elRef.current;
    if (!url || !ready || elFailed !== url || !el) return;
    setElWait(url);
    setElFailed(undefined);
    el.src = LOADED_AS.get(url) ?? url;
  }, [url, ready, elFailed]);
  // `loading`: the URL itself is not decoded yet, or this element errored (both show the dark art placeholder,
  // and fade in when the art lands). `hidden`: also covers the few-ms element re-check below, which just stays
  // invisible and then appears.
  const loading = !!url && (!ready || elFailed === url);
  const hidden = loading || (!!url && elWait === url);
  // FADE ONLY ART THAT WAS GENUINELY NOT LOADED (owner 2026-09-30: "a ton of that fading pop in on my local
  // server"). A new <img> for a URL we already decoded can still read `complete === false` for a moment (the dev
  // server and vite preview send no-cache, so the browser re-checks the file). That wait is a few ms: the image
  // stays hidden for it (never an undecoded paint) and then appears INSTANTLY, with no fade. The 180 ms fade is
  // kept for art whose URL was not decoded yet, which after the loading gate should almost never happen.
  if (!ready && url) seenPending.current = url;
  const settle = (): void => { markArtReady(url); setElWait(undefined); };
  return {
    cls: hidden ? ' art-pending' : seenPending.current === url && url ? ' art-fadein' : '',
    waiting: loading,
    ref,
    onLoad: (e) => {
      const img = e.currentTarget;
      // decode() on a loaded <img> resolves once its pixels are ready to paint; never gate on it failing.
      if (typeof img.decode === 'function') img.decode().then(settle, settle);
      else settle();
    },
    // NEVER mark a broken element ready (that was the blank oval): hide it, and have the pipe fetch the URL again.
    onError: () => {
      if (!url) return;
      setElWait(undefined);
      setElFailed(url);
      reportArtError(url);
    },
  };
}
