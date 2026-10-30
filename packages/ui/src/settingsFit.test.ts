/**
 * R-SETTINGS-FIT-01 (owner 2026-10-30: "i need the settings menu to be contained within the bounds of my screen without
 * scrolling", "its when i have advanced controls selected, it pushes everythign down", then "can we re-increase the
 * sizing of the elements inside?"). The Settings page lays its sections out in two columns at full size; touch keeps one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string): string => readFileSync(join(__dirname, f), 'utf8');

describe('the Settings page fits the screen', () => {
  it('the panel is two columns: Combat, Audio, Cosmetics left; Friends onward right', () => {
    const esc = read('EscMenu.tsx');
    const panel = esc.slice(esc.indexOf('<div className="escpanel">'));
    const cols = panel.split('<div className="esccol">');
    expect(cols.length).toBe(3); // two columns
    const [left, right] = [cols[1]!, cols[2]!];
    for (const s of ['Combat', 'Audio', 'Cosmetics']) expect(left, s).toContain(`<div className="escsec">${s}</div>`);
    for (const s of ['Friends', 'Board', 'Performance', 'Account']) expect(right, s).toContain(`<div className="escsec">${s}</div>`);
  });

  it('on the page the columns sit side by side at full size; touch keeps one column', () => {
    const css = read('styles.css');
    const page = /\n#root \.lbpage\.set-page \.escpanel \{([^}]*display: grid[^}]*)\}/.exec(css)?.[1] ?? '';
    expect(page).toMatch(/--esc-k: 1;/);
    expect(page).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(read('touchUi.css')).toMatch(/html\[data-touch-ui\] #root \.lbpage\.set-page \.escpanel \{ display: block; \}/);
  });
});
