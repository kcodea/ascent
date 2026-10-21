import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  detectLiteArt, normaliseArtKey, phoneAssetUrl, phonePublicCap, phonePublicUrl, toPhoneAssetUrl, LITE_ART, PIXI_ANTIALIAS,
  type DeviceProbe, type PhoneArtManifest,
} from './phoneArt';

/**
 * PHONE ART (owner 2026-10-18: "the iPhone crashes a lot"; the phone-only relaxation of "load everything, no pop-in"
 * is approved). Pins who counts as a phone, that a phone gets the build's small copy ONLY where one exists, and that
 * desktop never does.
 */
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const probe = (p: Partial<DeviceProbe>): DeviceProbe => ({ ua: WIN, maxTouchPoints: 0, coarse: false, shortSide: 1080, ...p });

describe('detectLiteArt: who is a phone', () => {
  it('any iOS device, including iPadOS reporting a Mac UA with touch', () => {
    expect(detectLiteArt(probe({ ua: IPHONE, maxTouchPoints: 5, coarse: true, shortSide: 390 }))).toEqual({ lite: true, reason: 'ios' });
    expect(detectLiteArt(probe({ ua: MAC_UA, maxTouchPoints: 5, coarse: true, shortSide: 820 }))).toEqual({ lite: true, reason: 'ios' });
  });

  it('a real Mac (no touch) is desktop', () => {
    expect(detectLiteArt(probe({ ua: MAC_UA, maxTouchPoints: 0 })).lite).toBe(false);
  });

  it('a coarse pointer on a small screen (Android phone) is a phone; a tablet or touch laptop is not', () => {
    expect(detectLiteArt(probe({ ua: ANDROID, maxTouchPoints: 5, coarse: true, shortSide: 360 }))).toEqual({ lite: true, reason: 'touch-small-screen' });
    expect(detectLiteArt(probe({ ua: ANDROID, maxTouchPoints: 5, coarse: true, shortSide: 800 })).lite).toBe(false);
    expect(detectLiteArt(probe({ ua: WIN, maxTouchPoints: 10, coarse: true, shortSide: 1080 })).lite).toBe(false);
  });

  it('a desktop browser is desktop; the override wins either way', () => {
    expect(detectLiteArt(probe({}))).toEqual({ lite: false, reason: null });
    expect(detectLiteArt(probe({ override: 'lite' }))).toEqual({ lite: true, reason: 'override' });
    expect(detectLiteArt(probe({ ua: IPHONE, override: 'full' }))).toEqual({ lite: false, reason: 'override' });
  });

  it('the test environment (no phone) is desktop: MSAA on, originals', () => {
    expect(LITE_ART).toBe(false);
    expect(PIXI_ANTIALIAS).toBe(true);
  });
});

describe('variant selection', () => {
  const manifest: PhoneArtManifest = { dir: 'm1', assets: ['art/minions/whelp.webp'], public: ['frames/oval-beast.webp', 'augustfullboard.webp'] };
  const url = 'https://x.test/game/assets/whelp-AbC123.webp';

  it('a phone gets the copy one folder down, only for a file the build copied', () => {
    expect(phoneAssetUrl('./art/minions/whelp.webp', url, true, manifest)).toBe('https://x.test/game/assets/m1/whelp-AbC123.webp');
    expect(phoneAssetUrl('./art/minions/pup.webp', 'https://x.test/assets/pup-1.webp', true, manifest)).toBe('https://x.test/assets/pup-1.webp');
    expect(phonePublicUrl('frames/oval-beast.webp', './', true, manifest)).toBe('./m1/frames/oval-beast.webp');
    expect(phonePublicUrl('frames/title-logo.png', './', true, manifest)).toBe('./frames/title-logo.png');
  });

  it('desktop, or a build without copies, always gets the original', () => {
    expect(phoneAssetUrl('./art/minions/whelp.webp', url, false, manifest)).toBe(url);
    expect(phoneAssetUrl('./art/minions/whelp.webp', url, true, null)).toBe(url);
    expect(phonePublicUrl('frames/oval-beast.webp', '/', false, manifest)).toBe('/frames/oval-beast.webp');
    expect(phonePublicUrl('frames/oval-beast.webp', '/', true, null)).toBe('/frames/oval-beast.webp');
  });

  it('glob keys normalise to the path under packages/ui/src; data: urls are never rewritten', () => {
    expect(normaliseArtKey('../art/frames/x.webp')).toBe('art/frames/x.webp');
    expect(normaliseArtKey('./art/minions/x.webp')).toBe('art/minions/x.webp');
    expect(toPhoneAssetUrl('data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA');
  });

  it('public caps: boards 1920, card frames 512; the title logo, Compendium frame and ranked gate get none', () => {
    expect(phonePublicCap('augustfullboard.webp')).toBe(1920);
    expect(phonePublicCap('frames/oval-beast.webp')).toBe(512);
    expect(phonePublicCap('frames/title-logo.png')).toBeNull();
    expect(phonePublicCap('frames/compendium-frame.webp')).toBeNull();
    expect(phonePublicCap('frames/ranked-gate-crystal.webp')).toBeNull();
    expect(phonePublicCap('medallions/echo.webp')).toBeNull();
  });

  it('the painted chests the Chest Shop and the Collection bay draw get a 512 px phone copy; nothing else in collection/', () => {
    for (const t of ['crate', 'chest_rare', 'chest_epic', 'chest_legendary', 'chest_ancient']) {
      expect(phonePublicCap(`collection/${t}_body.webp`)).toBe(512);
      expect(phonePublicCap(`collection/${t}_lid.webp`)).toBe(512);
    }
    expect(phonePublicCap('collection/chest_epic_body.png')).toBeNull();
    expect(phonePublicCap('collection/other.webp')).toBeNull();
  });

  it('the DOM chest picture loads through publicArt (the phone copy); only the Pixi theatre keeps the originals', () => {
    const pic = readFileSync(join(__dirname, 'progression', 'ChestPicture.tsx'), 'utf8');
    expect(pic).toContain('chestPictureUrl(art.bodyUrl)');
    expect(pic).toContain('chestPictureUrl(art.lidUrl)');
    expect(pic).not.toMatch(/chestArtUrl|BASE_URL/);
  });
});

describe('every public frame / button image in UI code goes through publicArt()', () => {
  // A raw `${BASE_URL}frames/...` would load the original on a phone while the preloader fetched the phone copy:
  // two downloads, and the big one decoded. Only files that never get a copy may stay raw.
  const SRC = __dirname;
  // Title logo, ranked gate and the cosmetic card plates (frames/plates/, not in the preload list): no phone copy.
  const ALLOWED = new Set(['AscentLogo.tsx', 'rankedGate/RankedGate.tsx', 'cardPlate/cardPlateLook.ts']);
  const walk = (d: string, out: string[] = []): string[] => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
    }
    return out;
  };

  it('no raw BASE_URL + frames/ outside the allow-list', () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).split('\\').join('/');
      if (ALLOWED.has(rel) || rel === 'phoneArt.ts') continue;
      const t = readFileSync(f, 'utf8');
      if (/BASE_URL\}frames\//.test(t) || /BASE\}frames\//.test(t)) bad.push(rel);
    }
    expect(bad).toEqual([]);
  });
});
