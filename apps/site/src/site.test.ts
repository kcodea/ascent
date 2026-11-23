// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { INSTALLER_URL } from './download';

// Resolve from the path, not `new URL(...)`: under jsdom the global URL is jsdom's, which node's fileURLToPath rejects.
const INDEX = resolve(dirname(fileURLToPath(import.meta.url)), '../index.html');
const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

beforeAll(() => {
  const parsed = new DOMParser().parseFromString(readFileSync(INDEX, 'utf8'), 'text/html');
  document.replaceChild(document.importNode(parsed.documentElement, true), document.documentElement);
});

describe('index.html', () => {
  it('sections appear in the approved order', () => {
    expect([...document.querySelectorAll('main > section, header#top, footer#get')].map((e) => e.id)).toEqual([
      'top',
      'async',
      'runeforge',
      'ancients',
      'tracking',
      'earn',
      'modes',
      'get',
    ]);
  });

  it('has exactly two download links, both to the installer', () => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a[data-download]')];
    expect(links).toHaveLength(2);
    for (const a of links) expect(a.getAttribute('href')).toBe(INSTALLER_URL);
    expect(document.querySelector('#top a[data-download]')).not.toBeNull();
    expect(document.querySelector('#get a[data-download]')).not.toBeNull();
  });

  it('each download link is followed by the unsigned-installer note and a hidden copy-link button', () => {
    for (const a of document.querySelectorAll('a[data-download]')) {
      expect(a.textContent!.trim()).toBe('Download free');
      const note = a.nextElementSibling!;
      expect(note.matches('p[data-download-note]')).toBe(true);
      expect(note.textContent).toMatch(/unknown publisher/i);
      expect(note.textContent).toMatch(/More info/);
      expect(note.textContent).toMatch(/Run anyway/);
      expect(note.id).toBeTruthy();
      expect(a.getAttribute('aria-describedby')).toBe(note.id);
      expect(document.querySelectorAll(`[id="${note.id}"]`)).toHaveLength(1);
      const copy = note.nextElementSibling as HTMLButtonElement;
      expect(copy.matches('button[data-copy-link]')).toBe(true);
      expect(copy.hidden).toBe(true);
      expect(copy.textContent!.trim()).toBe('Copy link for your PC');
      expect(copy.getAttribute('aria-live')).toBe('polite');
      const url = copy.nextElementSibling as HTMLElement;
      expect(url.matches('p[data-copy-url].download__url')).toBe(true);
      expect(url.hidden).toBe(true);
      expect(url.textContent).toBe('');
      expect(a.parentElement!.textContent).toMatch(/Windows, free to play/);
    }
  });

  it('the Runeforge section says a rune is taken at every forge visit', () => {
    expect(document.querySelector('#runeforge h2')!.textContent).toBe('Runes that last the whole run');
    expect(document.querySelector('#runeforge .lede')!.textContent).toBe(
      'Each time the forge opens it offers four runes and you take one. Its power stays with you for the rest of the run.',
    );
    expect(document.querySelector('#runeforge')!.textContent).not.toMatch(/One rune for the whole run/);
  });

  it('the async points keep list semantics with their list styling removed', () => {
    expect(document.querySelector('ol.points')!.getAttribute('role')).toBe('list');
  });

  it('the top scene is a sky and four team layers, each with a depth for the mouse to slide it by, nearest last', () => {
    const scene = document.querySelector('.top .top__scene[aria-hidden="true"]')!;
    const layers = [...scene.querySelectorAll<HTMLImageElement>('img[data-depth]')];
    expect(layers.map((l) => l.getAttribute('src'))).toEqual([
      '/hero/sky.webp',
      '/hero/left-back.webp',
      '/hero/right-back.webp',
      '/hero/left-front.webp',
      '/hero/right-front.webp',
    ]);
    const depths = layers.map((l) => Number(l.dataset.depth));
    // The sky slides least, then the two far pairs, then the two near pairs.
    const [sky, backA, backB, frontA, frontB] = depths;
    expect(sky).toBeLessThan(Math.min(backA, backB));
    expect(Math.max(backA, backB)).toBeLessThan(Math.min(frontA, frontB));
    for (const l of layers) {
      expect(l.alt).toBe('');
      expect(existsSync(resolve(PUBLIC_DIR, l.getAttribute('src')!.slice(1))), l.getAttribute('src')!).toBe(true);
    }
  });

  it('the logo is the owner\'s painted mark, sized to match the file, and silent beside the ASCENT heading', () => {
    const crest = document.querySelector<HTMLImageElement>('img.top__crest')!;
    expect(crest.getAttribute('src')).toBe('/hero/logo.webp');
    expect(crest.getAttribute('width')).toBe('480');
    expect(crest.getAttribute('height')).toBe('524');
    expect(crest.alt).toBe('');
  });

  it('chest images declare their real pixel sizes', () => {
    const want: Record<string, string> = {
      standard: '840x457',
      rare: '840x410',
      epic: '840x402',
      legendary: '840x393',
      ancient: '840x400',
      'standard-lid': '819x238',
      'rare-lid': '823x238',
      'epic-lid': '816x242',
      'legendary-lid': '795x250',
      'ancient-lid': '819x246',
    };
    for (const img of document.querySelectorAll<HTMLImageElement>('#earn img[src^="/art/chests/"]')) {
      const name = img.getAttribute('src')!.replace(/^\/art\/chests\/|\.webp$/g, '');
      expect(`${img.getAttribute('width')}x${img.getAttribute('height')}`, name).toBe(want[name]);
    }
  });

  it('has a favicon, a touch icon and a theme colour matching the night token', () => {
    expect(document.querySelector('link[rel="icon"][type="image/png"]')!.getAttribute('href')).toBe('/art/icon-192.png');
    expect(document.querySelector('link[rel="apple-touch-icon"]')!.getAttribute('href')).toBe('/art/apple-touch-icon.png');
    const tokens = readFileSync(resolve(dirname(INDEX), 'src/styles/tokens.css'), 'utf8');
    const night = /--night:\s*(#[0-9a-f]{3,8})\s*;/i.exec(tokens)![1];
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')!.toLowerCase()).toBe(night.toLowerCase());
  });

  it('every capture slot has a poster image with alt text', () => {
    const slots: [string, string][] = [
      ['discover-timer', 'async'],
      ['gold-fuse', 'async'],
      ['rearrange', 'async'],
      ['save-continue', 'async'],
      ['runeforge', 'runeforge'],
      ['ancient-select', 'ancients'],
      ['career-chart', 'tracking'],
      ['chest-opening', 'earn'],
    ];
    expect(document.querySelectorAll('figure[data-capture]')).toHaveLength(slots.length);
    for (const [s, section] of slots) {
      const img = document.querySelector<HTMLImageElement>(`#${section} figure[data-capture="${s}"] img[data-poster]`)!;
      expect(img, s).not.toBeNull();
      expect(img.getAttribute('src')).toBe(`/captures/${s}.jpg`);
      expect(img.alt.length).toBeGreaterThan(10);
      expect(img.getAttribute('width')).toBeTruthy();
      expect(img.getAttribute('height')).toBeTruthy();
      expect(img.getAttribute('loading')).toBe('lazy');
    }
  });

  it('the async section lists its four points in order, each with a game medallion and its own clip', () => {
    const points = [...document.querySelectorAll('#async .point')];
    expect(points.map((p) => p.getAttribute('data-point'))).toEqual(['clock', 'fuse', 'swap', 'save']);
    for (const p of points) {
      expect(p.querySelector('.point__icon img[alt=""]')!.getAttribute('src'), p.getAttribute('data-point')!).toMatch(/^\/art\/medallions\/\w+\.webp$/);
      expect(p.querySelector('.point__text h3')!.textContent!.length).toBeGreaterThan(8);
      expect(p.querySelector('.point__text p')!.textContent!.length).toBeGreaterThan(30);
    }
    expect([...document.querySelectorAll('#async figure[data-capture]')].map((f) => f.getAttribute('data-capture'))).toEqual(['discover-timer', 'gold-fuse', 'rearrange', 'save-continue']);
  });

  it('the Ancients section states the real rule', () => {
    const t = document.querySelector('#ancients')!.textContent!;
    expect(t).toMatch(/16 points/);
    expect(t).toMatch(/hero power/i);
    expect(t).toMatch(/six Ancients\./);
    const imgs = [...document.querySelectorAll<HTMLImageElement>('#ancients [data-ancient] img')];
    expect(imgs).toHaveLength(6);
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(
      ['bonds', 'death', 'fortune', 'genesis', 'time', 'war'].map((n) => `/art/ancients/${n}.webp`),
    );
    for (const name of ['Bonds', 'Death', 'Fortune', 'Genesis', 'Time', 'War']) expect(t).toContain(name);
  });

  it('shows the ladder medals and the five chest tiers', () => {
    const tracking = document.querySelector('#tracking')!.textContent!;
    for (const r of ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant']) expect(tracking).toContain(r);
    expect(document.querySelectorAll('#tracking img[src^="/art/ranks/"]')).toHaveLength(6);
    const earn = document.querySelector('#earn')!.textContent!;
    expect(earn).toMatch(/free to earn and unlock, always/i);
    expect(document.querySelector('#earn .lede')!.textContent).toMatch(/Aether and cosmetics are free to earn and unlock, always\./);
    for (const c of ['Standard', 'Rare', 'Epic', 'Legendary', 'Ancient']) expect(earn).toContain(c);
    expect(document.querySelectorAll('#earn img.chestpic__body')).toHaveLength(5);
    expect(document.querySelectorAll('#earn img.chestpic__lid')).toHaveLength(5);
  });

  it('names all three other modes', () => {
    expect(document.querySelector('#modes h2')!.textContent).toBe('Other game modes');
    const imgs = [...document.querySelectorAll<HTMLImageElement>('#modes img[data-mode]')];
    expect(imgs.map((i) => i.getAttribute('data-mode'))).toEqual(['versus', 'duos', 'gauntlet']);
    for (const i of imgs) expect(i.getAttribute('src')).toBe(`/captures/mode-${i.getAttribute('data-mode')}.jpg`);
  });

  it('every section has an eyebrow and exactly one h2', () => {
    for (const s of document.querySelectorAll('main > section, footer#get')) {
      expect(s.querySelectorAll('h2'), s.id).toHaveLength(1);
      expect(s.querySelector('.eyebrow'), s.id).not.toBeNull();
    }
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelector('h1')!.textContent).toBe('ASCENT');
  });

  it('never makes a banned claim or uses a native tooltip', () => {
    // The whole document (head included) plus every meta content, so share text is held to the same rules.
    const metas = [...document.querySelectorAll('meta[content]')].map((m) => m.getAttribute('content')!);
    const t = [document.documentElement.textContent!, ...metas].join('\n');
    expect(t).not.toMatch(/pay to win/i);
    expect(t).not.toMatch(/never (played )?live|always offline/i);
    expect(t).not.toMatch(/what is an auto-?battler/i);
    expect(t).not.toMatch(/[\u2013\u2014]/);
    expect(document.querySelectorAll('[title], svg title')).toHaveLength(0);
    expect(document.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('never claims every lobby seat is a live player or that you face all seven', () => {
    const metas = [...document.querySelectorAll('meta[content]')].map((m) => m.getAttribute('content')!);
    const t = [document.documentElement.textContent!, ...metas].join('\n');
    expect(t).not.toMatch(/real players/i);
    expect(t).not.toMatch(/seven other players/i);
    expect(t).not.toMatch(/eight-player/i);
    expect(t).toMatch(/lobby of eight/);
    expect(t).toMatch(/other players' boards/);
  });

  it('save copy never implies quitting without saving keeps your game', () => {
    const t = document.querySelector('#async [data-point="save"]')!.textContent!;
    expect(t).toMatch(/Save and quit, then continue where you left off\./);
    expect(t).not.toMatch(/close the game/i);
  });

  it('has share metadata and the fonts', () => {
    expect(document.title.length).toBeGreaterThan(0);
    expect(document.querySelector('meta[property="og:image"]')!.getAttribute('content')).toBe('/share.jpg');
    expect(document.querySelector('meta[name="description"]')!.getAttribute('content')!.length).toBeGreaterThan(50);
    expect(document.querySelector('meta[property="og:title"]')!.getAttribute('content')).toBeTruthy();
    expect(document.querySelector('meta[property="og:description"]')!.getAttribute('content')).toBeTruthy();
    expect(document.querySelector('meta[name="twitter:card"]')!.getAttribute('content')).toBe('summary_large_image');
    const fonts = document.querySelector<HTMLLinkElement>('link[href^="https://fonts.googleapis.com/css2"]')!.href;
    expect(fonts).toContain('Outfit:wght@500;700;800;900');
    expect(fonts).toContain('Nunito+Sans:wght@400;600;700');
    expect(fonts).toContain('display=swap');
  });

  it('keeps the module entry script', () => {
    expect(document.querySelector('script[type="module"][src="/src/main.ts"]')).not.toBeNull();
  });
});
