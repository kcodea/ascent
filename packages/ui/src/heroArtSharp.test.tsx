// @vitest-environment jsdom
/**
 * R-PHONE-HERO-SHARP-01 (owner 2026-10-31: "Hero art in mobile is blurry"). On a phone a hero portrait loads the
 * variant its DISPLAY SLOT needs: the big slots (hero select, the pick ceremony, your portrait, the combat foe, the wipe
 * poster) the 512 px master once decoded (the 384 px copy until then), the lobby rail's tiny faces a 160 px thumbnail.
 * Desktop never changes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { PHONE_THUMB_CAPS, PHONE_THUMB_DIR, phoneThumbAssetUrl, type PhoneArtManifest } from './phoneArt';
import { useSharpArt } from './fullResArt';
import { artReady, markArtReady } from './artPreload';
import { heroThumb } from './art';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MANIFEST: PhoneArtManifest = {
  dir: 'm1', assets: ['art/heroes/indy.webp', 'art/minions/whelp.webp'], public: [],
  thumbDir: 't1', thumbs: ['art/heroes/indy.webp', 'art/skins/skin_indy_1.webp'],
};
const ORIG = 'https://x.test/assets/indy-AbC123.webp';
const COPY = 'https://x.test/assets/m1/indy-AbC123.webp';

describe('the tiny slots: a 160 px thumbnail', () => {
  it('only heroes and their skins get one, at 160 px, in its own versioned folder', () => {
    expect(PHONE_THUMB_CAPS).toEqual({ heroes: 160, skins: 160 });
    expect(PHONE_THUMB_DIR).toBe('t1');
  });

  it('a phone gets the thumbnail for a file the build thumbnailed; anything else gets none', () => {
    expect(phoneThumbAssetUrl('./art/heroes/indy.webp', ORIG, true, MANIFEST)).toBe('https://x.test/assets/t1/indy-AbC123.webp');
    expect(phoneThumbAssetUrl('./art/minions/whelp.webp', 'https://x.test/assets/whelp-1.webp', true, MANIFEST)).toBeUndefined();
  });

  it('desktop, or a build without thumbnails, never gets one', () => {
    expect(phoneThumbAssetUrl('./art/heroes/indy.webp', ORIG, false, MANIFEST)).toBeUndefined();
    expect(phoneThumbAssetUrl('./art/heroes/indy.webp', ORIG, true, null)).toBeUndefined();
    const { thumbDir: _d, thumbs: _t, ...old } = MANIFEST;
    expect(phoneThumbAssetUrl('./art/heroes/indy.webp', ORIG, true, old)).toBeUndefined();
  });

  it('heroThumb leaves a URL with no thumbnail alone (desktop, tests, an avatar)', () => {
    expect(heroThumb(ORIG)).toBe(ORIG);
    expect(heroThumb(undefined)).toBeUndefined();
  });
});

describe('the big slots: the master once decoded, the phone copy until then', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

  function render(url: string, lite: boolean): { current: () => string | undefined } {
    let seen: string | undefined;
    const Probe = (): null => { seen = useSharpArt(url, lite, MANIFEST); return null; };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(Probe)));
    return { current: () => seen };
  }

  it('a phone shows the copy, then swaps to the master the moment it has decoded (never an empty frame)', () => {
    const r = render(COPY, true);
    expect(r.current()).toBe(COPY);
    expect(artReady(ORIG)).toBe(false); // asked for, not decoded yet
    act(() => markArtReady(ORIG));
    expect(r.current()).toBe(ORIG);
  });

  it('desktop (or a URL that is not a phone copy) is returned unchanged', () => {
    expect(render(ORIG, false).current()).toBe(ORIG);
    act(() => root?.unmount()); host?.remove();
    expect(render(ORIG, true).current()).toBe(ORIG);
  });
});

describe('each hero slot loads its variant', () => {
  const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8');

  it('the big slots go through useSharpArt / SharpImg', () => {
    expect(src('StatusBar.tsx')).toMatch(/const heroImg = useSharpArt\(heroPortrait\(/);
    expect(src('FoePortraitDisc.tsx')).toMatch(/useSharpArt\(gauntlet \? undefined : art\)/);
    expect(src('hero-select/HeroSelectCeremony.tsx')).toMatch(/const art = useSharpArt\(heroPortrait\(/);
    expect(src('HeroSelect.tsx')).toMatch(/<SharpImg fade className=\{`hcframe-art/);
    expect(src('Recruit.tsx')).toMatch(/<SharpImg className="wipevs-face"/);
  });

  it('the lobby rail loads the thumbnail and warms the master for the fight', () => {
    const lp = src('LobbyPanel.tsx');
    expect(lp).toMatch(/const src = heroThumb\(full\);/);
    expect(lp).toMatch(/warmSharpArt\(\[full\]\)/);
  });
});
