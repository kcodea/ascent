/**
 * R-ESCSELECT-LAYER-01 (owner 2026-10-28): an open Settings dropdown paints over the rows below it. Every
 * `.escselectrow` shares one z-index, so a later row (Max Frame Rate) covered the Board backdrop list until the row
 * whose list is open was lifted above the rest.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');

/** The z-index of the top-level rule whose selector is exactly `selector`. */
const zOf = (selector: string): number => {
  for (const line of css.split('\n')) {
    if (!line.startsWith(`${selector} {`)) continue;
    const m = /z-index:\s*(\d+)/.exec(line);
    if (m) return Number(m[1]);
  }
  throw new Error(`no z-index rule for ${selector}`);
};

describe('Settings dropdown layering', () => {
  it('the row whose list is open sits above every other dropdown row', () => {
    expect(zOf('.escselectrow:has(.escselect.open)')).toBeGreaterThan(zOf('.escselectrow'));
  });

  it('the open list itself sits above its own row content', () => {
    expect(zOf('.escselect-list')).toBeGreaterThan(0);
  });
});
