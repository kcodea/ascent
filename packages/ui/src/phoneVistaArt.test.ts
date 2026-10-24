import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHONE_CSS_VARS, phonePublicCap, phonePublicUrl, type PhoneArtManifest } from './phoneArt';

/**
 * THE RETURN TRIP'S VISTA ON A PHONE (R-TOUCH-RUN-MEMORY-02; owner 2026-10-24: "Phone-sized return-trip images: yea
 * send em"). The flattened picture and the door's cut-out are 2560 x 1440 masters (14.1 MB each decoded) that the Shop
 * decodes on mount and holds for the run so the trip never pops in (R-PRESENT-36). A phone gets the build's 1280 px
 * copies, still decoded up front; desktop keeps the originals.
 */
const SRC = __dirname;
const MANIFEST: PhoneArtManifest = { dir: 'm1', assets: [], public: ['vista-doormask.png', 'vista-flat.webp'] };

describe('phone vista art', () => {
  it('both pictures get a 1280 px phone copy; the six desktop layers get none', () => {
    expect(phonePublicCap('vista-flat.webp')).toBe(1280);
    expect(phonePublicCap('vista-doormask.png')).toBe(1280);
    for (const n of ['sky', 'far', 'mid', 'shop', 'fore', 'doorfill', 'doorglow']) expect(phonePublicCap(`vista-${n}.webp`)).toBeNull();
  });

  it('a phone resolves the small copy; desktop (or a build without copies) the original', () => {
    expect(phonePublicUrl('vista-flat.webp', '/', true, MANIFEST)).toBe('/m1/vista-flat.webp');
    expect(phonePublicUrl('vista-doormask.png', '/', true, MANIFEST)).toBe('/m1/vista-doormask.png');
    expect(phonePublicUrl('vista-flat.webp', '/', false, MANIFEST)).toBe('/vista-flat.webp');
    expect(phonePublicUrl('vista-doormask.png', '/', false, MANIFEST)).toBe('/vista-doormask.png');
    expect(phonePublicUrl('vista-flat.webp', '/', true, null)).toBe('/vista-flat.webp');
  });

  it('the stylesheet reads both through a CSS var a phone re-points, defaulting to the original', () => {
    expect(PHONE_CSS_VARS).toContainEqual(['--vista-flat', 'vista-flat.webp']);
    expect(PHONE_CSS_VARS).toContainEqual(['--vista-doormask', 'vista-doormask.png']);
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
    expect(css).toContain(".wipevista-flat { background-image: var(--vista-flat, url('/vista-flat.webp'));");
    expect(css).toContain("-webkit-mask: var(--vista-doormask, url('/vista-doormask.png')) 0 0 / 100% 100% no-repeat; mask: var(--vista-doormask, url('/vista-doormask.png'))");
    // No other rule names either picture directly (it would bypass the phone copy).
    const bare = css.replace(/var\(--vista-(?:flat|doormask), url\('\/vista-(?:flat\.webp|doormask\.png)'\)\)/g, '');
    expect(bare).not.toMatch(/url\(['"]?\/vista-(?:flat\.webp|doormask\.png)/);
  });

  it('the Shop still decodes them up front, through publicArt (the same URL the CSS var points at)', () => {
    const recruit = readFileSync(join(SRC, 'Recruit.tsx'), 'utf8');
    const block = recruit.slice(recruit.indexOf("vistaArtRef.current = [...art, 'vista-doormask.png']"));
    expect(block.slice(0, 400)).toContain('img.src = publicArt(f);');
    expect(block.slice(0, 400)).toContain('img.decode()');
  });
});
