import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHONE_CSS_VARS, phonePublicCap, phonePublicUrl, type PhoneArtManifest } from './phoneArt';

/**
 * THE RETURN TRIP'S VISTA ON A PHONE (R-TOUCH-RUN-MEMORY-02; owner 2026-10-24: "Phone-sized return-trip images: yea
 * send em"). The flattened picture is a 2560 x 1440 master (14.1 MB decoded) that the Shop decodes on mount and holds
 * for the run. A phone gets the build's 1280 px copy, still decoded up front; desktop keeps the original. (The door's
 * cut-out was a second picture until 2026-10-25; it is a vector clip now, R-PRESENT-36, so it needs no copy.)
 */
const SRC = __dirname;
const MANIFEST: PhoneArtManifest = { dir: 'm1', assets: [], public: ['vista-flat.webp'] };

describe('phone vista art', () => {
  it('the flat picture gets a 1280 px phone copy; the desktop layers get none', () => {
    expect(phonePublicCap('vista-flat.webp')).toBe(1280);
    for (const n of ['sky', 'far', 'mid', 'shop', 'fore', 'doorfill', 'doorglow']) expect(phonePublicCap(`vista-${n}.webp`)).toBeNull();
  });

  it('a phone resolves the small copy; desktop (or a build without copies) the original', () => {
    expect(phonePublicUrl('vista-flat.webp', '/', true, MANIFEST)).toBe('/m1/vista-flat.webp');
    expect(phonePublicUrl('vista-flat.webp', '/', false, MANIFEST)).toBe('/vista-flat.webp');
    expect(phonePublicUrl('vista-flat.webp', '/', true, null)).toBe('/vista-flat.webp');
  });

  it('the stylesheet reads it through a CSS var a phone re-points, defaulting to the original', () => {
    expect(PHONE_CSS_VARS).toContainEqual(['--vista-flat', 'vista-flat.webp']);
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
    expect(css).toContain(".wipevista-flat { background-image: var(--vista-flat, url('/vista-flat.webp'));");
    // No other rule names the picture directly (it would bypass the phone copy), and no rule uses a cut-out picture.
    const bare = css.replace(/var\(--vista-flat, url\('\/vista-flat\.webp'\)\)/g, '');
    expect(bare).not.toMatch(/url\(['"]?\/vista-(?:flat\.webp|doormask\.png)/);
  });

  it('the Shop still decodes them up front, through publicArt (the same URL the CSS var points at)', () => {
    const recruit = readFileSync(join(SRC, 'Recruit.tsx'), 'utf8');
    const block = recruit.slice(recruit.indexOf('vistaArtRef.current = art.map('));
    expect(block.slice(0, 400)).toContain('img.src = publicArt(f);');
    expect(block.slice(0, 400)).toContain('img.decode()');
  });
});
