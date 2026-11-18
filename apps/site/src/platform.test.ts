// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTALLER_URL } from './download';
import { applyPlatform, detectPlatform } from './platform';

const INDEX = resolve(dirname(fileURLToPath(import.meta.url)), '../index.html');
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15';

// A fresh document for every test so one test's applyPlatform never leaks into the next.
beforeEach(() => {
  const parsed = new DOMParser().parseFromString(readFileSync(INDEX, 'utf8'), 'text/html');
  document.replaceChild(document.importNode(parsed.documentElement, true), document.documentElement);
});

afterEach(() => {
  vi.useRealTimers();
});

const copyButtons = () => [...document.querySelectorAll<HTMLButtonElement>('[data-copy-link]')];
const downloadLinks = () => [...document.querySelectorAll<HTMLAnchorElement>('a[data-download]')];

describe('detectPlatform', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 0, 'windows'],
    [MAC, 0, 'other-desktop'],
    ['Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/131.0', 0, 'other-desktop'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 5, 'mobile'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', 5, 'mobile'],
    [MAC, 5, 'mobile'],
    ['', 0, 'other-desktop'],
  ])('detectPlatform(%s, %i) is %s', (ua, touch, want) => expect(detectPlatform(ua, touch)).toBe(want));
});

describe('the inline <head> classifier', () => {
  // The same cases as detectPlatform: the inline script must reach the same answer before the page paints.
  const script = (): string => {
    const s = [...document.querySelectorAll('head script:not([src])')];
    expect(s).toHaveLength(1);
    return s[0]!.textContent!;
  };
  const classFor = { windows: [], 'other-desktop': ['is-other'], mobile: ['is-mobile'] } as const;

  it('sits in <head> before the stylesheet', () => {
    const head = [...document.head.children];
    const inline = head.findIndex((e) => e.matches('script:not([src])'));
    const sheet = head.findIndex((e) => e.matches('link[rel="stylesheet"]'));
    expect(inline).toBeGreaterThanOrEqual(0);
    expect(inline).toBeLessThan(sheet);
  });

  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 0],
    [MAC, 0],
    ['Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/131.0', 0],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 5],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', 5],
    [MAC, 5],
    ['', 0],
  ])('agrees with detectPlatform for (%s, %i)', (ua, touch) => {
    const added: string[] = [];
    const doc = { documentElement: { classList: { add: (c: string) => added.push(c) } } };
    new Function('navigator', 'document', script())({ userAgent: ua, maxTouchPoints: touch }, doc);
    expect(added).toEqual(classFor[detectPlatform(ua, touch)]);
  });
});

describe('applyPlatform', () => {
  it('non-Windows visitors see a Windows-only label and a copy-link button', () => {
    applyPlatform(document, 'mobile');
    expect(document.documentElement.classList.contains('is-mobile')).toBe(true);
    expect(downloadLinks()).toHaveLength(2);
    for (const a of downloadLinks()) {
      expect(a.textContent).toMatch(/Windows only/i);
      expect(a.getAttribute('href')).toBe(INSTALLER_URL);
      expect(a.hasAttribute('data-download')).toBe(true);
      expect(a.getAttribute('aria-describedby')).toMatch(/^download-note-/);
    }
    for (const b of copyButtons()) expect(b.hidden).toBe(false);
  });

  it('other desktops get is-other', () => {
    applyPlatform(document, 'other-desktop');
    expect(document.documentElement.classList.contains('is-other')).toBe(true);
    expect(document.documentElement.classList.contains('is-mobile')).toBe(false);
    for (const a of downloadLinks()) expect(a.textContent).toMatch(/Windows only/i);
  });

  it('Windows visitors see the page unchanged', () => {
    applyPlatform(document, 'windows');
    expect(document.documentElement.className).toBe('');
    for (const a of downloadLinks()) expect(a.textContent).toMatch(/Download free/i);
    for (const b of copyButtons()) expect(b.hidden).toBe(true);
  });

  it('copies the page URL and shows "Link copied", then reverts after 2 seconds', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    applyPlatform(document, 'mobile');
    const b = copyButtons()[0]!;
    const original = b.textContent;
    b.click();
    // Called inside the click itself: Safari only honours the user gesture synchronously.
    expect(writeText).toHaveBeenCalledWith(location.origin + location.pathname);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.textContent).toBe('Link copied');
    vi.advanceTimersByTime(1999);
    expect(b.textContent).toBe('Link copied');
    vi.advanceTimersByTime(1);
    expect(b.textContent).toBe(original);
  });

  it.each([
    ['is refused', { writeText: () => Promise.reject(new Error('denied')) }],
    [
      'throws synchronously',
      {
        writeText: () => {
          throw new Error('boom');
        },
      },
    ],
    ['is undefined (non-secure origin)', undefined],
  ])('falls back to showing the URL below the button when the clipboard %s', async (_name, clipboard) => {
    Object.assign(navigator, { clipboard });
    applyPlatform(document, 'mobile');
    const b = copyButtons()[0]!;
    const shown = b.nextElementSibling as HTMLElement;
    expect(shown.matches('[data-copy-url]')).toBe(true);
    b.click();
    await vi.waitFor(() => expect(shown.textContent).toBe(location.origin + location.pathname));
    expect(shown.hidden).toBe(false);
    expect(b.textContent).toBe('Copy it from below');
  });

  it('keeps child elements inside the download link when relabelling', () => {
    const a = downloadLinks()[0]!;
    a.append(Object.assign(document.createElement('span'), { className: 'icon' }));
    applyPlatform(document, 'mobile');
    expect(a.querySelector('span.icon')).not.toBeNull();
    expect(a.textContent).toMatch(/Windows only for now/);
  });
});
