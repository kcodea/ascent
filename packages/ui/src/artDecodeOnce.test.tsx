// @vitest-environment jsdom
/**
 * R-PERF-ART-DECODE-ONCE-01 (perf degradation hunt, 2026-10-30): a card image whose URL the art pipe has already
 * decoded never asks the browser to decode it again when its <img> loads. Every card image mount used to call
 * `img.decode()` on load, ~1,300 compositor decode requests a round for pictures the pipe already held. Art the pipe
 * has NOT decoded yet still waits on decode() before it unhides, so it never paints undecoded.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';

interface Decode { src: string; el: boolean; resolve: () => void }
const decodes: Decode[] = [];
HTMLImageElement.prototype.decode = function decode(this: HTMLImageElement): Promise<void> {
  const src = this.getAttribute('src') ?? this.src;
  return new Promise<void>((resolve) => { decodes.push({ src, el: this.isConnected, resolve }); });
};
// Not complete at commit: the element waits (hidden) for its own load event, the path that called decode().
Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => false });

import { FadeImg } from './FadeImg';
import { artReady, requestArt } from './artPreload';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; decodes.length = 0; });
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); }); };
const img = (): HTMLImageElement => ui!.container.querySelector('img')!;
const elementDecodes = (url: string): number => decodes.filter((d) => d.el && d.src === url).length;

describe('card art decodes once (R-PERF-ART-DECODE-ONCE-01)', () => {
  it('an <img> for art the pipe already decoded unhides on load without a second decode()', async () => {
    const url = '/art/ready-once.webp';
    requestArt(url, 'set');
    decodes.find((d) => d.src === url)!.resolve();
    await flush();
    expect(artReady(url)).toBe(true);
    ui = mount(<FadeImg className="artimg" src={url} alt="" />);
    expect(img().className).toBe('artimg art-pending'); // not complete yet: hidden, never an undecoded paint
    act(() => { img().dispatchEvent(new Event('load')); });
    await flush();
    expect(elementDecodes(url)).toBe(0);
    expect(img().className).toBe('artimg');
  });

  it('art the pipe has NOT decoded still waits on decode() before it shows', async () => {
    const url = '/art/not-ready.webp';
    ui = mount(<FadeImg className="artimg" src={url} alt="" />);
    // The pipe's own decode is pending: the URL is not ready.
    expect(artReady(url)).toBe(false);
    act(() => { img().dispatchEvent(new Event('load')); });
    await flush();
    expect(elementDecodes(url)).toBe(1);
    expect(img().className).toBe('artimg art-pending');
    decodes.find((d) => d.el && d.src === url)!.resolve();
    await flush();
    expect(img().className).toBe('artimg art-fadein');
  });
});
