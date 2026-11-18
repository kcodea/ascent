import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * STATIC PAINT ON A PLAIN BOX, MOTION ON THE ANIMATED ONE (docs/performance.md 3f), pinned for the three places the
 * 2026-11-18 perf pass moved a paint cost off a per-frame path. jsdom does not paint, so this pins the CSS the fix is
 * made of: which element carries the filter / mask, and which one moves.
 */
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');
/** The declarations of the first rule whose selector is EXACTLY `selector`. */
const rule = (selector: string): string => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`^${esc}\\s*\\{([^}]*)\\}`, 'm'));
  if (!m) throw new Error(`no rule for selector: ${selector}`);
  return m[1]!;
};
const SHADOW = 'drop-shadow(0 0 11px rgba(255, 255, 255, 0.75)) drop-shadow(0 0 26px rgba(255, 255, 255, 0.45)) drop-shadow(0 12px 28px rgba(0, 0, 0, 0.45))';

describe('the hover preview: the bob does not re-blur the haze (R-PERF-HOVER-SHADOW-01)', () => {
  it('the haze is the same three drop-shadows, on the box that never animates', () => {
    expect(rule('.cardref-shadow')).toContain(`filter: ${SHADOW}`);
    expect(rule('.cardref-shadow')).not.toMatch(/animation|transition|transform|translate/);
  });
  it('the moving element carries no filter: the slide-in and the bob are transform / translate / opacity only', () => {
    expect(rule('.cardref')).not.toContain('filter');
    expect(rule('.cardref')).toContain('cardreffloat');
    expect(rule('.cardref-inner')).not.toMatch(/animation|filter/);
    const bob = css.match(/@keyframes cardreffloat \{([\s\S]*?)\n\}/)![1]!;
    expect(bob).toContain('translate:');
    expect(bob).not.toMatch(/transform|filter|opacity/); // `transform` belongs to the slide-in: the two never fight
  });
  it('the bob travels the same distance: 4 px times the popup zoom the bobbing element used to carry', () => {
    const bob = css.match(/@keyframes cardreffloat \{([\s\S]*?)\n\}/)![1]!;
    expect(bob).toContain('calc(-4px * var(--inspect-zoom, 1) * var(--z-inspect-s, 1.52))');
    expect(rule('.cardref-inner')).toContain('zoom: calc(var(--inspect-zoom, 1) * var(--z-inspect-s, 1.52))');
  });
});

describe('damage numbers: the shadow rides a static inner box (R-PERF-DMG-SHADOW-01)', () => {
  it('the animated float carries no filter; `.dmgbody` carries the same shadow and never animates', () => {
    expect(rule('.float.dmg')).not.toContain('filter');
    expect(rule('.float.dmg .dmgbody')).toContain('filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.5))');
    expect(rule('.float.dmg .dmgbody')).not.toMatch(/animation|transition|transform/);
    expect(rule('.floatanchor .float.dmg')).toContain('animation: floatupc');
  });
});

describe('the crystal fuse: the burn repaints nothing (R-PERF-FUSE-BURN-01)', () => {
  it('--burn drives two transforms; no mask reads it', () => {
    const burn = rule('.chargeglyph .fuse-burn');
    const body = rule('.chargeglyph .fuse-body');
    expect(burn).toContain('transform: translateX(calc(var(--burn) * 100%))');
    expect(body).toContain('transform: translateX(calc(var(--burn) * -100%))');
    expect(burn).toContain('will-change: transform');
    expect(body).toContain('will-change: transform');
    // The mask is static: the same soft edge, now in the sliding box's own coordinates.
    expect(burn).toContain('mask: linear-gradient(90deg, transparent 0, #fff var(--feather), #fff 100%)');
    expect(burn.match(/mask:[^;]*/g)!.every((m) => !m.includes('--burn'))).toBe(true);
    expect(body).not.toMatch(/(^|[\s;])(-webkit-)?mask:/);
  });
});
