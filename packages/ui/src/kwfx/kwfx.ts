import type { CSSProperties } from 'react';
import { useSyncExternalStore } from 'react';
import { isPhone } from '../deviceClass';
import manifest from './manifest.json';

/**
 * BAKED KEYWORD AURAS (perf 2026-11-18, R-PERF-KEYWORD-AURA-01).
 *
 * Rise, Flurry, Execute and Rebirth's crown are AUTHORED as DOM + CSS (Card.tsx's live markup, styles.css between the
 * KWFX-LIVE markers, executeConfig / flurryConfig / rebirthConfig). Live, each one is 10 to 40 animating compositor
 * layers and as many running CSS animations PER CARD: every keyword on 14 cards was 1,500 layers and 1,225 animations
 * and held an idle shop at 37 to 64 ms a frame on an RTX 4080. So the card shows a CAPTURE of the live aura instead:
 * one looping animated AVIF per aura (`/kwfx/<id>.avif`, made by `scripts/kwfx/capture.mjs` from the live markup),
 * on ONE layer with NO CSS animation. Chrome advances an animated image on the compositor and decodes each frame once
 * for every card that shows it, so the cost no longer scales with the element count or runs on the main thread.
 *
 * The live markup stays, and is what renders when:
 *  - the pictures have not loaded (or cannot: a browser without animated AVIF never reports them ready, so it keeps
 *    the live aura; nothing is ever blank);
 *  - the aura is being RETUNED (a DEV tuner has moved a value away from the shipped one: the picture would be stale);
 *  - `localStorage['ascent.kwfx'] = 'live'` (the capture script sets it: it photographs the live aura; also the switch
 *    to compare the two by eye);
 *  - the device is a phone (unchanged there until the capture is checked on WebKit: its animated-image path is not
 *    Chrome's, see the devlog);
 *  - under test (nothing loads there, so the suite keeps asserting the authored markup).
 * A change to the authored look needs `node scripts/kwfx/capture.mjs` run again: `kwfx.test.ts` fails until the
 * manifest's signature matches the sources.
 */
export type AuraId = 'rise' | 'flurry' | 'execute' | 'rebirth';

function forcedLive(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('ascent.kwfx') === 'live'; } catch { return false; }
}
/**
 * WHICH AURAS STAY LIVE BY DEFAULT: Flurry. Its blades are the one fast thing here (about 260 px a second), and an
 * animated image tops out at 90 pictures a second in Chromium, each held for an uneven 1 to 4 refreshes of a 240 Hz
 * display (a frame of 10 ms or less is shown for 100 ms; measured 2026-11-19). The live rings turn on every display
 * frame at any refresh rate, and with their no-op blend mode and idle breathe layer removed (styles.css) 14 Flurry
 * cards idle at the frame budget. The slow, soft auras move under a pixel per picture at 60 a second, so they bake.
 * `localStorage['ascent.kwfx.live']` overrides the list (comma separated; empty = bake all four) to compare by eye.
 */
const DEFAULT_LIVE = 'flurry';
function liveList(): ReadonlySet<string> {
  let v: string | null = null;
  try { v = typeof localStorage !== 'undefined' ? localStorage.getItem('ascent.kwfx.live') : null; } catch { /* default */ }
  return new Set((v ?? DEFAULT_LIVE).split(',').map((s) => s.trim()).filter(Boolean));
}
const LIVE_AURAS = liveList();

/** Decided once per page: may this device show the baked auras at all? */
export const KWFX_ENABLED: boolean = typeof window !== 'undefined' && !forcedLive() && !isPhone();

/** Every picture is in memory and decodable. Until then (and forever, where one fails) the live aura renders. */
let ready = false;
const retuned = new Set<AuraId>();
const listeners = new Set<() => void>();
const notify = (): void => { for (const fn of listeners) fn(); };
const subscribe = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };

/** A tuner moved this aura away from its shipped values (or back): show the live markup while it differs. */
export function markAuraRetuned(id: AuraId, on: boolean): void {
  if (retuned.has(id) === on) return;
  if (on) retuned.add(id); else retuned.delete(id);
  notify();
}

/** Pure: which markup an aura renders. Exported for the test. */
export function auraIsLive(enabled: boolean, loaded: boolean, moved: boolean): boolean {
  return !enabled || !loaded || moved;
}

/** True when this aura must render its live DOM (see above). In production it flips once, when the pictures land. */
export function useAuraLive(id: AuraId): boolean {
  return useSyncExternalStore(subscribe, () => auraIsLive(KWFX_ENABLED, ready, retuned.has(id) || LIVE_AURAS.has(id)), () => true);
}

type Baked = { w: number; h: number };
const AURAS = (manifest as { auras: Record<string, Baked> }).auras;
const box = (id: string): CSSProperties => {
  const a = AURAS[id];
  return a ? { width: `calc(var(--ccw) * ${a.w})`, height: `calc(var(--ccw) * ${a.h})` } : {};
};
/** The baked picture's box per file, in card-art widths (`--ccw`), from the capture's manifest. Static objects, so a
 *  card's props stay referentially stable. The picture itself is chosen by CLASS in styles.css (a literal `url()` in a
 *  stylesheet rule is one shared image; an inline url would be a new image per element, docs/performance.md 3m). */
export const KWFX_BOX = {
  rise: box('rise'),
  flurry: box('flurry'),
  execute: box('execute'),
  rebirth: box('rebirth'),
  rebirthShield: box('rebirth-shield'),
} as const;

/** The pictures, held for the page's life so Blink's memory cache keeps them: a card that mounts later, or a board
 *  that swaps to its stills, paints from memory. */
const held: HTMLImageElement[] = [];
let loading = false;
/** Load every animated picture and every still, then flip `ready`. Called once, a moment after boot. */
export function loadKwfx(): void {
  if (loading || !KWFX_ENABLED || typeof Image === 'undefined') return;
  loading = true;
  // Only where the browser says it decodes AVIF through the same decoder family it animates images with (Chromium,
  // recent Firefox). A browser that showed an animated AVIF as a still would freeze every aura: it keeps the live ones.
  const dec = (globalThis as { ImageDecoder?: { isTypeSupported?: (t: string) => Promise<boolean> } }).ImageDecoder;
  if (!dec?.isTypeSupported) return;
  // Public-folder files carry BASE_URL (itch serves from a sub-path, the desktop shell from a file root).
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  const one = (src: string): Promise<void> => new Promise((res, rej) => {
    const img = new Image();
    held.push(img);
    img.onload = () => res();
    img.onerror = () => rej(new Error(src));
    img.src = src;
  });
  // An aura that stays live never shows its picture: do not fetch it.
  const ids = Object.keys(AURAS).filter((id) => !LIVE_AURAS.has(id.split('-')[0]!));
  void dec.isTypeSupported('image/avif')
    .then((ok) => (ok ? Promise.all(ids.flatMap((id) => [one(`${base}kwfx/${id}.avif`), one(`${base}kwfx/${id}-still.webp`)])) : Promise.reject(new Error('no AVIF decoder'))))
    .then(() => { ready = true; notify(); })
    .catch((err: unknown) => { if (import.meta.env?.DEV) console.warn('[kwfx] a baked aura did not load; the live auras stay', err); });
}
if (KWFX_ENABLED && import.meta.env?.MODE !== 'test') setTimeout(loadKwfx, 1500);
