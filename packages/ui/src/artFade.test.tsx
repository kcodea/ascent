// @vitest-environment jsdom
/**
 * NEVER SHOW UNDECODED ART (art pop-in fix 2026-09-29). Rendered under jsdom with `HTMLImageElement.decode`
 * held open by the test, so "not decoded yet" is a state we control:
 *  - art that is not decoded renders INVISIBLE (`art-pending`) — the placeholder shows, never a half-loaded image;
 *  - once decoded it fades in ONCE (`art-fadein`, a one-shot opacity transition);
 *  - art already decoded before it renders gets neither class: no fade, no flash, identical to a plain <img>;
 *  - a NEW element that is not `complete` yet is hidden too, even when the URL is decoded (a no-cache server
 *    makes a new <img> revalidate: the local-build pop-in);
 *  - a broken file settles too (the card is never held hidden);
 *  - the Card wires the rule onto its art window, its frame and its hand plate, and the CSS keeps it
 *    compositor-only (opacity) with a static placeholder.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount, type Mounted } from './renderedText.mount';

const decodes: (() => void)[] = [];
HTMLImageElement.prototype.decode = function decode(): Promise<void> {
  return new Promise<void>((resolve) => { decodes.push(resolve); });
};
/** Whether a freshly mounted <img> element reports `complete` (jsdom never loads images, so the test decides). */
let elementComplete = true;
Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => elementComplete });

import { FadeImg } from './FadeImg';
import { artReady, markArtReady, requestArt, whenArtReady } from './artPreload';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; elementComplete = true; });
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const img = (): HTMLImageElement => ui!.container.querySelector('img')!;

describe('FadeImg / useArtFade', () => {
  it('hides art until it is decoded, then fades it in once', async () => {
    ui = mount(<FadeImg className="hcframe-art" src="/art/pending-hero.webp" alt="" />);
    expect(img().className).toBe('hcframe-art art-pending');
    expect(img().getAttribute('decoding')).toBe('sync');
    expect(artReady('/art/pending-hero.webp')).toBe(false);
    // The render itself queued it at the front of the pipe: its decode is in flight.
    expect(decodes.length).toBeGreaterThan(0);
    decodes.splice(0).forEach((d) => d());
    await flush();
    expect(artReady('/art/pending-hero.webp')).toBe(true);
    expect(img().className).toBe('hcframe-art art-fadein');
  });

  it('art decoded BEFORE it renders shows immediately — no fade, no placeholder', async () => {
    requestArt('/art/warm.webp', 'set');
    decodes.splice(0).forEach((d) => d());
    await flush();
    expect(artReady('/art/warm.webp')).toBe(true);
    ui = mount(<FadeImg className="mcframe-art" src="/art/warm.webp" alt="" />);
    expect(img().className).toBe('mcframe-art');
  });

  it('a NEW element for an already-decoded URL that is not complete yet (a no-cache revalidation) is hidden until it loads', async () => {
    requestArt('/art/revalidating.webp', 'set');
    decodes.splice(0).forEach((d) => d());
    await flush();
    expect(artReady('/art/revalidating.webp')).toBe(true);
    elementComplete = false; // the new element must wait for a 304 before it can paint
    ui = mount(<FadeImg className="lobbyface" src="/art/revalidating.webp" alt="" />);
    expect(img().className).toBe('lobbyface art-pending'); // never painted blank
    act(() => { img().dispatchEvent(new Event('load')); });
    decodes.splice(0).forEach((d) => d());
    await flush();
    expect(img().className).toBe('lobbyface art-fadein');
  });

  it('the on-screen <img> finishing first settles it (markArtReady), and a broken file never stays hidden', async () => {
    ui = mount(<FadeImg className="x" src="/art/broken.webp" alt="" />);
    expect(img().className).toBe('x art-pending');
    act(() => { img().dispatchEvent(new Event('error')); });
    await flush();
    expect(img().className).toBe('x art-fadein');
    markArtReady('/art/other.webp');
    expect(artReady('/art/other.webp')).toBe(true);
  });
});

describe('the Card and the CSS keep the rule', () => {
  const card = readFileSync(join(__dirname, 'Card.tsx'), 'utf8');
  const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');

  it('Card fades its art, its frame and its hand plate, and shows the placeholder while the art waits', () => {
    expect(card).toMatch(/const artFade = useArtFade\(artUrl\)/);
    expect(card).toMatch(/className=\{artFade\.waiting \? 'art art-wait' : 'art'\}/);
    expect(card).toMatch(/className=\{`artimg\$\{artFade\.cls\}`\}/);
    expect(card).toMatch(/const frameFade = useArtFade\(frameSrc\)/);
    expect((card.match(/\$\{frameFade\.cls\}/g) ?? []).length).toBe(6); // taunt / oval / spell, each with its shadow copy
    expect(card).toMatch(/const plateFade = useArtFade\(/);
  });

  it('pending = opacity 0, the fade animates opacity only, and the placeholder is static (no looping paint)', () => {
    expect(css).toMatch(/\.art-pending \{ opacity: 0 !important; \}/);
    expect(css).toMatch(/\.art-fadein \{ transition: opacity 180ms ease-out; \}/);
    const wait = /\.art\.art-wait \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(wait).toMatch(/background:/);
    expect(wait).not.toMatch(/animation|transition/);
  });
});

describe('whenArtReady: the boot loading gate (owner 2026-09-30: "i think id rather load everything")', () => {
  it('reports real progress and resolves only once EVERY image has decoded (or failed)', async () => {
    const urls = ['/art/gate-a.webp', '/art/gate-b.webp', '/art/gate-c.webp', '/art/gate-a.webp'];
    const seen: [number, number][] = [];
    let open = false;
    const start = decodes.length;
    void whenArtReady(urls, (d, t) => seen.push([d, t])).then(() => { open = true; });
    await flush();
    expect(seen[0]).toEqual([0, 3]); // deduped total, painted before anything lands
    expect(decodes.length - start).toBe(3); // it queued what nobody had asked for yet
    decodes[start]!();
    await flush();
    expect(open).toBe(false);
    expect(seen.at(-1)).toEqual([1, 3]);
    decodes[start + 1]!();
    decodes[start + 2]!();
    await flush();
    expect(seen.at(-1)).toEqual([3, 3]);
    expect(open).toBe(true);
    for (const u of urls) expect(artReady(u)).toBe(true);
  });

  it('opens at once when everything is already decoded (a returning visit, or an empty list)', async () => {
    let open = 0;
    void whenArtReady([], () => {}).then(() => { open++; });
    void whenArtReady(['/art/gate-a.webp'], () => {}).then(() => { open++; });
    await flush();
    expect(open).toBe(2);
  });
});
