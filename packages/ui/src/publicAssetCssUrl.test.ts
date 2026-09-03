import { describe, it, expect } from 'vitest';
import { publicAssetCssUrl } from './floatConfig';

/** The value that goes into `--dmg-splash-img` must be ABSOLUTE, whatever the page's address — a relative
 *  url() inside a custom property is resolved against the stylesheet (assets/) by Chromium, not the page. */
describe('publicAssetCssUrl', () => {
  it('is absolute against the page under a CDN sub-path (itch)', () => {
    const v = publicAssetCssUrl('fx/damage-splash-2.png', 'https://html.itch.zone/html/123/index.html');
    expect(v).toMatch(/^url\('https:\/\/[^']+\/fx\/damage-splash-2\.png'\)$/);
    expect(v).not.toContain('/assets/');
  });
  it('is absolute under the desktop app:// scheme', () => {
    const v = publicAssetCssUrl('fx/damage-splash.png', 'app://ascent/index.html');
    expect(v).toBe("url('app://ascent/fx/damage-splash.png')");
  });
});
