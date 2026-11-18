// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { INSTALLER_URL } from './download';

// Resolve from the path, not `new URL(...)`: under jsdom the global URL is jsdom's, which node's fileURLToPath rejects.
const INDEX = resolve(dirname(fileURLToPath(import.meta.url)), '../index.html');

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
      expect(copy.textContent!.trim().length).toBeGreaterThan(0);
      expect(a.parentElement!.textContent).toMatch(/Windows, free to play/);
    }
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

  it('the async section lists its four points in order', () => {
    expect([...document.querySelectorAll('#async figure[data-capture]')].map((f) => f.getAttribute('data-capture'))).toEqual([
      'discover-timer',
      'gold-fuse',
      'rearrange',
      'save-continue',
    ]);
  });

  it('the Ancients section states the real rule', () => {
    const t = document.querySelector('#ancients')!.textContent!;
    expect(t).toMatch(/16 points/);
    expect(t).toMatch(/hero power/i);
    expect(t).toMatch(/six Ancients\./);
    const imgs = [...document.querySelectorAll<HTMLImageElement>('#ancients img[data-ancient]')];
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
    for (const c of ['Standard', 'Rare', 'Epic', 'Legendary', 'Ancient']) expect(earn).toContain(c);
    expect(document.querySelectorAll('#earn img[src^="/art/chests/"]')).toHaveLength(5);
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
    expect(document.querySelector('h1')!.textContent).toBe('The auto-battler that waits for you.');
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
    const t = document.querySelector('figure[data-capture="save-continue"]')!.textContent!;
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
