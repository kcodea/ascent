import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * THE CRYSTAL FUSE'S BURN IS TRANSFORM-ONLY (R-PERF-FUSE-BURN-01, perf pass 2026-11-18). It used to be a mask gradient
 * whose stops read `--burn`, written every display frame: the whole fuse repainted for the last 20 s of every turn.
 * jsdom does not paint, so this pins the CSS the fix is made of: which element carries the mask, and what moves.
 */
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');
/** The declarations of the first rule whose selector is EXACTLY `selector`. */
const rule = (selector: string): string => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`^${esc}\\s*\\{([^}]*)\\}`, 'm'));
  if (!m) throw new Error(`no rule for selector: ${selector}`);
  return m[1]!;
};

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
