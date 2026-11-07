/**
 * R-HERO-PICK-CLEAN-01 (owner 2026-11-07): a hero pick leaves nothing behind. The other cards' difficulty words hide once the
 * ceremony starts, the travelling copy's square art fades as the round portrait takes over, and the portrait is held to a
 * soft circle the size of its ring clip BEFORE the flash, so no square corner ever shows outside the ring.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const css = read('./heroSelectPh.css').replace(/\s+/g, ' ');
const ceremony = read('./HeroSelectCeremony.tsx');

describe('R-HERO-PICK-CLEAN-01: a hero pick leaves nothing behind', () => {
  it('hides the offered cards’ difficulty words while the ceremony runs', () => {
    expect(css).toMatch(/\.heroselect\.phhs\.hsc-active :is\(\.hsrow \.hcmeta, \.hcslot > \.hcdiff-out\) \{ opacity: 0;/);
  });
  it('fades the clone’s square art as its chrome dissolves', () => {
    expect(css).toMatch(/\.heroselect\.phhs \.hsc-clone\.hsc-chrome-out \.hcframe-art \{ opacity: 0; \}/);
  });
  it('masks the portrait to the clip circle before the flash', () => {
    expect(ceremony).toMatch(/: \(\(\) => \{\s*const m = `radial-gradient\(circle \$\{clipR/);
    expect(ceremony).toMatch(/maskImage: m, WebkitMaskImage: m/);
  });
});
