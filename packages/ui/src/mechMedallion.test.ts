import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MECH_MEDALLION_PNGS, mechMedallionArtId, mechMedallionArtScale, mechMedallionMaskCss, mechMedallionSrc } from './mechMedallion';

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

// R-PERF-MEDALLION-MASK-01 (perf degradation hunt 2026-10-30): the tint overlay's mask url() lives in ONE stylesheet rule
// per art, never in an inline custom property (which re-fetched + re-decoded the art for every medallion that mounted).
describe('medallion tint mask (R-PERF-MEDALLION-MASK-01)', () => {
  it('the mask sheet holds one literal url() rule for every medallion art, aliases included', () => {
    const css = mechMedallionMaskCss('/');
    for (const id of MECH_MEDALLION_PNGS) {
      const art = mechMedallionArtId(id)!;
      expect(css).toContain(`.cgem-tint[data-art="${art}"]{-webkit-mask-image:url("/medallions/${art}.webp");mask-image:url("/medallions/${art}.webp")}`);
    }
    expect(mechMedallionArtId('overflow')).toBe('watcher');
    expect(mechMedallionArtId('taunt')).toBeNull();
    expect(css.match(/data-art="watcher"/g)).toHaveLength(1);
  });
  it('no component sets the overlay mask through an inline url(), and the stylesheet never reads it from a var()', () => {
    for (const f of ['Card.tsx', 'MedallionTuner.tsx']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src).not.toMatch(/--cgem-artsrc/);
      expect(src).toMatch(/className="cgem-tint" data-art=/);
    }
    const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');
    const rule = /\.cgem > \.cgem-tint \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).not.toBe('');
    expect(rule).not.toMatch(/mask(?:-image)?\s*:\s*var\(/);
    expect(rule).not.toMatch(/url\(/);
  });
});
