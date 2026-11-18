// @vitest-environment jsdom
/**
 * THE SHOP SLICE (owner ask 2026-11-18, R-SHOP-SLICE-01): the rail-style "Shop | Tier N" plate on the shop frame's top
 * edge replaced the floating "Tier N" pill over the Tavern Up stone. Shop phase only; on the return from a fight it
 * mounts tucked under the cover and rises (a one-shot transform/opacity transition) as the Shop is revealed.
 *
 * Pins: (1) the slice reads SHOP and the live tier; (2) `tucked` is the only motion state, and only the return trip's
 * covered hold sets it; (3) Recruit mounts it with the shop furniture (gone in combat); (4) the old pill is gone from
 * the stone; (5) its motion is transform/opacity only and nothing loops; (6) no bare cursor.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from './renderedText.mount';
import { ShopTierSlice } from './ShopTierSlice';

const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8');
const css = src('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
const rulesFor = (sel: RegExp): string[] => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => sel.test(m[1])).map((m) => m[2]);

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

describe('the Shop slice (R-SHOP-SLICE-01)', () => {
  it('reads SHOP and the current tier, and re-renders the tier live', () => {
    ui = mount(<ShopTierSlice tier={1} tucked={false} />);
    const el = ui.container.querySelector('.shopslice')!;
    expect(el.querySelector('.shopslice-label')?.textContent).toBe('Shop');
    expect(el.querySelector('.shopslice-tier')?.textContent).toBe('Tier 1');
    expect(el.getAttribute('aria-label')).toBe('Shop tier 1');
    expect(el.classList.contains('tucked')).toBe(false);
    ui.render(<ShopTierSlice tier={4} tucked={false} />);
    expect(ui.container.querySelector('.shopslice-tier')?.textContent).toBe('Tier 4');
  });

  it('mounts tucked under the return trip cover, then untucks', () => {
    ui = mount(<ShopTierSlice tier={2} tucked />);
    expect(ui.container.querySelector('.shopslice')!.classList.contains('tucked')).toBe(true);
    ui.render(<ShopTierSlice tier={2} tucked={false} />);
    expect(ui.container.querySelector('.shopslice')!.classList.contains('tucked')).toBe(false);
  });

  it('Recruit mounts it with the shop furniture, tucked only in the covered hold of the return trip', () => {
    const recruit = src('Recruit.tsx');
    expect(recruit).toContain('{!combatBgShown && <ShopTierSlice tier={tier} tucked={shopSliceTucked} />}');
    expect(recruit).toContain("shopSliceTucked={wipe === 'coveredOut'}");
  });

  it('the old Tier pill is gone from the Tavern Up stone', () => {
    expect(src('TavernUpButton.tsx')).not.toMatch(/className="tvb-tierpill/);
    expect(css).not.toMatch(/\.tvb-tierpill\s*\{/);
  });

  it('moves by transform + opacity only, as a one-shot transition, and sets no cursor', () => {
    const bodies = rulesFor(/\.shopslice/);
    expect(bodies.length).toBeGreaterThan(3);
    for (const b of bodies) {
      expect(b).not.toMatch(/animation\s*:/);
      expect(b).not.toMatch(/cursor\s*:/);
      const t = /transition\s*:([^;]+)/.exec(b)?.[1];
      if (t && t.trim() !== 'none') for (const part of t.split(/,(?![^(]*\))/)) expect(part.trim()).toMatch(/^(transform|opacity)\b/);
    }
    // It never takes the pointer (a label on the board; a dropped card passes through).
    expect(rulesFor(/^\s*\.shopslice\s*$/).join('')).toMatch(/pointer-events:\s*none/);
  });
});
