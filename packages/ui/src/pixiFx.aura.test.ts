import { describe, expect, it } from 'vitest';
import { pixiFx } from './pixiFx';

// pixiFx's WebGL app never initializes in the node test env (`this.ready` stays false), so setShield is a
// no-op and no bubble is registered. These queries must therefore SAFELY report "no aura" without throwing —
// which is exactly the contract the aura channel relies on (it no-ops when a unit carries no bubble).
describe('pixiFx aura registry queries', () => {
  it('hasAura reports false for an unknown uid/kind and never throws', () => {
    expect(pixiFx.hasAura('nobody', 'shield')).toBe(false);
    expect(pixiFx.hasAura('nobody', 'reborn')).toBe(false);
  });
  it('auraRect returns null for an unknown uid/kind and never throws', () => {
    expect(pixiFx.auraRect('nobody', 'shield')).toBeNull();
  });
  it('shatterAt is a safe no-op before the WebGL app is ready (headless test env)', () => {
    expect(() => pixiFx.shatterAt(100, 100, 80, 100, 'shield')).not.toThrow();
  });
});
