import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { listPublicAssets } from '../../tools/src/public-manifest.lib';
import { PUBLIC_ASSETS } from './publicAssets.generated';

/**
 * THE MANIFEST MUST MATCH THE FOLDER. The boot preloader warms exactly `PUBLIC_ASSETS`, so a file added to
 * `apps/web/public/` without regenerating would be the one that pops in on first use — this fails first.
 */
describe('publicAssets.generated.ts', () => {
  it('lists every image/SVG under apps/web/public (run `npm run assets:manifest` to refresh)', () => {
    const publicDir = resolve(__dirname, '../../../apps/web/public');
    expect([...PUBLIC_ASSETS]).toEqual(listPublicAssets(publicDir));
  });

  it('covers the assets that used to pop in', () => {
    for (const p of ['fx/damage-splash-2.png', 'frames/cardplate.webp', 'opp-rune-slot-1.webp', 'return-to-shop.webp']) {
      expect(PUBLIC_ASSETS, p).toContain(p);
    }
  });

  it('never lists a root-absolute or backslash path', () => {
    for (const p of PUBLIC_ASSETS) {
      expect(p.startsWith('/'), p).toBe(false);
      expect(p.includes('\\'), p).toBe(false);
    }
  });
});
