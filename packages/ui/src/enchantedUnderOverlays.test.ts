import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { overlayCoversShop } from './useCiaEnchantedFx';

/** Ayse's Enchanted shop-card loop (`cia-hp`) hides while an overlay covers the shop (owner report 2026-09-26:
 *  "an ayse card bleeds through the animation", the Ancient awakening). */
afterEach(() => { vi.unstubAllGlobals(); });
const body = (...classes: string[]): void => {
  vi.stubGlobal('document', { body: { classList: { contains: (c: string) => classes.includes(c) } } });
};

describe('the Enchanted loop hides under overlays', () => {
  it('covered while Discover / an offer (modalup) or the Ancient awakening (ancgate / ancoffer) is up', () => {
    body('modalup'); expect(overlayCoversShop()).toBe(true);
    body('ancgate'); expect(overlayCoversShop()).toBe(true);
    body('ancoffer'); expect(overlayCoversShop()).toBe(true);
    body(); expect(overlayCoversShop()).toBe(false);
  });
  it('the loop follow reads it every frame (a null follow hides the effect without ending the loop)', () => {
    const src = readFileSync(join(__dirname, 'useCiaEnchantedFx.ts'), 'utf8');
    expect(src).toContain('const at = (): { x: number; y: number } | null => (overlayCoversShop() ? null : pos());');
    expect(src).toContain("{ loop: true, follow: at }");
  });
});
