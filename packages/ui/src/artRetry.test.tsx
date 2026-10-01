// @vitest-environment jsdom
/**
 * FAILED ART LOADS RETRY (owner report 2026-09-30: a friend's round-12 shop showed six blank ovals and an empty
 * spell frame, "why did this happen?"). An image request that failed used to be final: the card painted its broken
 * <img> (a blank oval) for the rest of the session. Rendered under jsdom with `HTMLImageElement.decode` held by the
 * test, so a failed fetch is a state we control:
 *  - a failed decode RETRIES through the pipe after 1 s / 3 s / 8 s and the card shows its art when one succeeds;
 *  - only the LAST try busts the cache (the earlier ones reuse the URL, so a copy cached elsewhere is used);
 *  - an on-screen <img> that errors hides over the dark placeholder and re-requests once the pipe has the image;
 *  - the network coming back (`online`) or the tab being shown again re-queues every failed URL;
 *  - the cap holds: a permanently failing URL ends on the PLACEHOLDER (never a visible broken image) and stops;
 *  - any OTHER <img> (an icon, the title logo) that errors is hidden and retried through the same pipe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';

interface Decode { src: string; resolve: () => void; reject: () => void }
const decodes: Decode[] = [];
HTMLImageElement.prototype.decode = function decode(this: HTMLImageElement): Promise<void> {
  const src = this.getAttribute('src') ?? this.src;
  return new Promise<void>((resolve, reject) => { decodes.push({ src, resolve, reject: () => reject(new Error('EncodingError')) }); });
};
Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true });

import { FadeImg } from './FadeImg';
import { ART_RETRY_DELAYS, artFailed, artReady, requestArt, useArtFade } from './artPreload';

/** A card art window in miniature: the same `useArtFade` wiring Card.tsx uses, with its placeholder flag exposed. */
function ArtWindow({ src }: { src: string }): React.ReactElement {
  const f = useArtFade(src);
  return (
    <div className={f.waiting ? 'art art-wait' : 'art'}>
      <img ref={f.ref} className={`artimg${f.cls}`} src={src} alt="" decoding="sync" onLoad={f.onLoad} onError={f.onError} />
    </div>
  );
}

let ui: Mounted | null = null;
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); decodes.length = 0; });

const tick = async (ms = 0): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const forUrl = (url: string): Decode[] => decodes.filter((d) => d.src.startsWith(url));
const lastFor = (url: string): Decode => { const all = forUrl(url); return all[all.length - 1]!; };
const img = (): HTMLImageElement => ui!.container.querySelector('img')!;
const box = (): HTMLElement => ui!.container.querySelector('.art')!;

describe('failed art loads retry with backoff', () => {
  it('the policy is 3 retries at about 1 s, 3 s and 8 s', () => {
    expect(ART_RETRY_DELAYS).toEqual([1000, 3000, 8000]);
  });

  it('a failed decode retries after its backoff, with the SAME url, and the art is ready once a later attempt succeeds', async () => {
    const url = '/art/flaky-a.webp';
    requestArt(url, 'now');
    expect(forUrl(url)).toHaveLength(1);
    lastFor(url).reject();
    await tick();
    expect(artReady(url)).toBe(false);
    await tick(999);
    expect(forUrl(url)).toHaveLength(1);
    await tick(1);
    expect(forUrl(url)).toHaveLength(2);
    expect(lastFor(url).src).toBe(url); // not busted: the cache answers if the bytes made it elsewhere
    lastFor(url).resolve();
    await tick();
    expect(artReady(url)).toBe(true);
  });

  it('a card whose art failed shows the dark placeholder (never a blank) while the retry is pending, then fades in', async () => {
    const url = '/art/flaky-card.webp';
    ui = mount(<ArtWindow src={url} />);
    expect(box().className).toBe('art art-wait');
    lastFor(url).reject();
    await tick();
    expect(box().className).toBe('art art-wait');
    expect(img().className).toBe('artimg art-pending');
    await tick(1000);
    lastFor(url).resolve();
    await tick();
    expect(box().className).toBe('art');
    expect(img().className).toBe('artimg art-fadein');
  });

  it('an on-screen <img> that errors re-requests: the pipe fetches again, then the element re-sets its src and reloads', async () => {
    const url = '/art/drop-mid-session.webp';
    requestArt(url, 'set');
    lastFor(url).resolve();
    await tick();
    expect(artReady(url)).toBe(true);
    ui = mount(<FadeImg className="artimg" src={url} alt="" />);
    expect(img().className).toBe('artimg');
    const setSrc = vi.spyOn(HTMLImageElement.prototype, 'src', 'set');
    try {
      act(() => { img().dispatchEvent(new Event('error')); });
      await tick();
      expect(img().className).toBe('artimg art-pending'); // hidden, never a broken image
      expect(artReady(url)).toBe(false);
      const before = forUrl(url).length;
      await tick(1000);
      expect(forUrl(url).length).toBe(before + 1); // the pipe asked again, after the backoff
      lastFor(url).resolve();
      await tick();
      expect(setSrc).toHaveBeenCalledWith(url); // the element reloads from the cache
      expect(img().className).toBe('artimg art-pending'); // until its own load event
      act(() => { img().dispatchEvent(new Event('load')); });
      lastFor(url).resolve();
      await tick();
      expect(img().className).toBe('artimg art-fadein');
    } finally {
      setSrc.mockRestore();
    }
  });

  it('respects the cap: 4 tries, only the last one cache-busted, then the URL FAILS and the card keeps its placeholder', async () => {
    const url = '/art/gone-for-good.webp';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ui = mount(<ArtWindow src={url} />);
    for (const wait of ART_RETRY_DELAYS) {
      lastFor(url).reject();
      await tick(wait);
    }
    lastFor(url).reject();
    await tick(60_000);
    const tries = forUrl(url);
    expect(tries).toHaveLength(4);
    expect(tries.slice(0, 3).every((d) => d.src === url)).toBe(true);
    expect(tries[3]!.src).toMatch(/^\/art\/gone-for-good\.webp\?retry=3-/);
    expect(artFailed(url)).toBe(true);
    expect(box().className).toBe('art art-wait'); // the dark placeholder, not a blank oval
    expect(img().className).toBe('artimg art-pending');
    act(() => { img().dispatchEvent(new Event('error')); }); // the element erroring too changes nothing
    await tick(60_000);
    expect(forUrl(url)).toHaveLength(4);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('the network coming back (`online`) or the tab being shown again re-queues every failed URL', async () => {
    const url = '/art/offline-shop.webp';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ui = mount(<ArtWindow src={url} />);
    for (const wait of ART_RETRY_DELAYS) { lastFor(url).reject(); await tick(wait); }
    lastFor(url).reject();
    await tick();
    expect(artFailed(url)).toBe(true);
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(forUrl(url)).toHaveLength(5); // a fresh attempt, at once
    expect(lastFor(url).src).toBe(url);
    lastFor(url).reject(); // still flaky: it backs off again with a fresh budget
    await tick();
    expect(artFailed(url)).toBe(false);
    // Visibility: a tab shown again cuts the backoff short.
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(forUrl(url)).toHaveLength(6);
    lastFor(url).resolve();
    await tick();
    expect(artReady(url)).toBe(true);
    expect(box().className).toBe('art');
    warn.mockRestore();
  });

  it('the safety net: a plain <img> outside useArtFade (an icon, a logo) hides on error and reloads once the pipe has it', async () => {
    const url = '/icons/rules-question.png';
    ui = mount(<button type="button"><img className="icon" src={url} alt="" /></button>);
    const setSrc = vi.spyOn(HTMLImageElement.prototype, 'src', 'set');
    try {
      act(() => { img().dispatchEvent(new Event('error')); });
      expect(img().className).toBe('icon img-retrying'); // invisible, never a broken image
      expect(forUrl(url)).toHaveLength(1); // fetched through the pipe, at the front
      lastFor(url).reject();
      await tick(1000);
      expect(forUrl(url)).toHaveLength(2);
      lastFor(url).resolve();
      await tick();
      expect(setSrc).toHaveBeenCalledWith(url);
      act(() => { img().dispatchEvent(new Event('load')); });
      expect(img().className).toBe('icon');
    } finally {
      setSrc.mockRestore();
    }
  });
});
