// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setClipsForTest, CAPTURE_SLOTS, CLIPS, initCaptures } from './captures';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

beforeEach(() => {
  const parsed = new DOMParser().parseFromString(readFileSync(resolve(SITE, 'index.html'), 'utf8'), 'text/html');
  document.replaceChild(document.importNode(parsed.documentElement, true), document.documentElement);
});

afterEach(() => __setClipsForTest());

const visibleNow = (_el: Element, cb: () => void) => cb();
const withClips = (ids: string[], fn: () => void) => {
  __setClipsForTest(ids);
  fn();
};
const poster = (fig: Element) => fig.querySelector<HTMLImageElement>('img[data-poster]')!;

describe('captures', () => {
  it('the page has exactly the eight known slots', () => {
    const found = [...document.querySelectorAll('figure[data-capture]')].map((f) => f.getAttribute('data-capture'));
    expect(found.sort()).toEqual([...CAPTURE_SLOTS].sort());
  });

  it('leaves every slot as a poster when no clips exist', () => {
    withClips([], () => {
      initCaptures(document, { reducedMotion: false, observe: visibleNow });
      expect(document.querySelectorAll('video')).toHaveLength(0);
    });
  });

  it('reduced motion never inserts a video', () => {
    withClips(['runeforge'], () => {
      initCaptures(document, { reducedMotion: true, observe: visibleNow });
      expect(document.querySelectorAll('video')).toHaveLength(0);
    });
  });

  it('waits until the slot is visible before inserting a video', () => {
    withClips(['runeforge'], () => {
      let show = () => {};
      initCaptures(document, { reducedMotion: false, observe: (_el, cb) => (show = cb) });
      expect(document.querySelectorAll('video')).toHaveLength(0);
      show();
      expect(document.querySelectorAll('video')).toHaveLength(1);
      show();
      expect(document.querySelectorAll('video')).toHaveLength(1);
    });
  });

  it('a slot with a clip gets a muted looping video and keeps its poster until playing', () => {
    withClips(['runeforge'], () => {
      initCaptures(document, { reducedMotion: false, observe: visibleNow });
      const fig = document.querySelector('figure[data-capture="runeforge"]')!;
      const v = fig.querySelector('video')!;
      expect(v.muted && v.loop).toBe(true);
      expect(v.hasAttribute('muted') && v.hasAttribute('playsinline') && v.hasAttribute('autoplay')).toBe(true);
      expect(v.getAttribute('preload')).toBe('none');
      expect(v.getAttribute('poster')).toBe('/captures/runeforge.jpg');
      expect([...v.querySelectorAll('source')].map((s) => s.getAttribute('src'))).toEqual([
        '/captures/runeforge.webm',
        '/captures/runeforge.mp4',
      ]);
      expect(poster(fig).hidden).toBe(false);
      v.dispatchEvent(new Event('playing'));
      expect(poster(fig).hidden).toBe(true);
    });
  });

  it('a clip sits where its poster is, above the caption, and carries the poster alt text', () => {
    withClips(['discover-timer'], () => {
      initCaptures(document, { reducedMotion: false, observe: visibleNow });
      const fig = document.querySelector('figure[data-capture="discover-timer"]')!;
      const v = fig.querySelector('video')!;
      expect(poster(fig).nextElementSibling).toBe(v);
      expect(v.compareDocumentPosition(fig.querySelector('figcaption')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(v.getAttribute('aria-label')).toBe(poster(fig).alt);
      expect(v.hasAttribute('aria-hidden')).toBe(false);
    });
  });

  it('a clip with no poster goes first in its figure', () => {
    withClips(['discover-timer'], () => {
      const fig = document.querySelector('figure[data-capture="discover-timer"]')!;
      poster(fig).remove();
      initCaptures(document, { reducedMotion: false, observe: visibleNow });
      expect(fig.firstElementChild!.tagName).toBe('VIDEO');
    });
  });

  it('a clip that fails to load is removed and the poster stays', () => {
    withClips(['runeforge'], () => {
      initCaptures(document, { reducedMotion: false, observe: visibleNow });
      const fig = document.querySelector('figure[data-capture="runeforge"]')!;
      fig.querySelector('video')!.dispatchEvent(new Event('error'));
      expect(fig.querySelector('video')).toBeNull();
      expect(poster(fig).hidden).toBe(false);
    });
  });

  it('the last source failing removes the video too', () => {
    withClips(['runeforge'], () => {
      initCaptures(document, { reducedMotion: false, observe: visibleNow });
      const fig = document.querySelector('figure[data-capture="runeforge"]')!;
      fig.querySelector('video source:last-of-type')!.dispatchEvent(new Event('error'));
      expect(fig.querySelector('video')).toBeNull();
      expect(poster(fig).hidden).toBe(false);
    });
  });

  it('every capture slot has a committed poster file', () => {
    for (const s of CAPTURE_SLOTS) expect(existsSync(resolve(SITE, 'public/captures', `${s}.jpg`)), s).toBe(true);
  });

  it('every clip listed has both video files on disk', () => {
    for (const s of CLIPS)
      for (const ext of ['webm', 'mp4'])
        expect(existsSync(resolve(SITE, 'public/captures', `${s}.${ext}`)), `${s}.${ext}`).toBe(true);
  });
});
