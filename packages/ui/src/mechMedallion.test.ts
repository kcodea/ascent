import { describe, expect, it } from 'vitest';
import { MECH_MEDALLION_PNGS, mechMedallionArtScale, mechMedallionSrc } from './mechMedallion';

describe('mechMedallionSrc', () => {
  it('returns a webp URL for a wired mechanic', () => {
    expect(mechMedallionSrc('shout')).toBe('/medallions/shout.webp');
    expect(mechMedallionSrc('spend')).toBe('/medallions/spend.webp');
    expect(mechMedallionSrc('rebirth')).toBe('/medallions/rebirth.webp');
    expect(mechMedallionSrc('pummel')).toBe('/medallions/pummel.webp');
    expect(mechMedallionSrc('execute')).toBe('/medallions/execute.webp'); // the two-sword art (ex-flurry)
    expect(mechMedallionSrc('sell')).toBe('/medallions/sell.webp');
    expect(mechMedallionSrc('equip')).toBe('/medallions/equip.webp');
  });
  it('aliases Overflow to the Watcher eye art', () => {
    expect(mechMedallionSrc('overflow')).toBe('/medallions/watcher.webp');
  });
  it('returns null for a mechanic with no art (keeps its SVG)', () => {
    expect(mechMedallionSrc('taunt')).toBeNull();
    expect(mechMedallionSrc('ward')).toBeNull();
    expect(mechMedallionSrc('flurry')).toBeNull(); // art repurposed for Execute; Flurry has its own animation
    expect(mechMedallionSrc('nonsense')).toBeNull();
  });
  it('has exactly the 19 wired ids', () => {
    expect(MECH_MEDALLION_PNGS.size).toBe(19);
  });
});

describe('mechMedallionArtScale', () => {
  it('enlarges shout (its art reads small) and shrinks endTurn (reads large)', () => {
    expect(mechMedallionArtScale('shout')).toBe(1.15);
    expect(mechMedallionArtScale('endTurn')).toBe(0.9);
  });
  it('defaults to 1 for a mechanic with no correction', () => {
    expect(mechMedallionArtScale('echo')).toBe(1);
    expect(mechMedallionArtScale('nonsense')).toBe(1);
  });
});
