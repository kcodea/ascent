import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * R-RAIL-DOCKED-CLICKTHROUGH-01 (owner 2026-10-31: "i cant interact with anything in scene builder right now, like i cant
 * buy cards etc."). The Docked rail turns the rail element into a full-size layer over the board, so every element of it
 * that spans the board must be click-through, and only the seat slices may take the pointer. The trap: styles.css gives
 * every DIRECT child of the rail `pointer-events: auto` (`.lobbyrail > *`), so the seats wrapper (`.lobbyseats`, a direct
 * child that fills the layer) has to switch it back off itself. jsdom has no layout, so this holds the stylesheet
 * contract; the live check (elementFromPoint at the shop / board / hand card centres, and a drag-buy) is in the PR notes.
 */
const css = readFileSync(join(__dirname, 'lobbyRailDocked.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const styles = readFileSync(join(__dirname, 'styles.css'), 'utf8');

describe('Docked rail stays click-through over the board (R-RAIL-DOCKED-CLICKTHROUGH-01)', () => {
  it('the full-size layer and the seats wrapper both switch pointer events off', () => {
    const layer = rules.find((r) => r.sel === 'html:root .lobbyrail.lrv-docked:not(.guidesview)');
    expect(layer?.body).toMatch(/pointer-events:\s*none/);
    const seats = rules.find((r) => r.sel === 'html:root .lobbyrail.lrv-docked .lobbyseats');
    expect(seats?.body).toMatch(/inset:\s*0/);
    expect(seats?.body, 'the seats wrapper fills the layer, so it must be click-through').toMatch(/pointer-events:\s*none/);
    // The reason it must say so itself: the rail turns its direct children back on.
    expect(styles).toMatch(/\.lobbyrail\s*>\s*\*\s*\{\s*pointer-events:\s*auto;/);
  });

  it('every other docked rule that spans the layer is click-through, and only the slices take the pointer', () => {
    for (const r of rules) {
      if (!/inset:\s*0[;\s]/.test(`${r.body};`) || /\.lobbyseat\b(?!s)/.test(r.sel) || /::(before|after)/.test(r.sel) || /\.lrv-tileart/.test(r.sel)) continue;
      expect(r.body, `${r.sel} spans the layer`).toMatch(/pointer-events:\s*none/);
    }
    const slice = rules.find((r) => /\.lobbyrail\.lrv-docked \.lobbyseat:is\(/.test(r.sel) && /position:\s*absolute/.test(r.body));
    expect(slice?.body).toMatch(/pointer-events:\s*auto/);
  });

  it('the End Turn gem and the Refresh pill take the pointer only through their own shapes (in every layout since R-HIT-SHAPE-01)', () => {
    // The Docked-only rules moved to hitShapes.css and now hold in every rail look (hitShapes.test.ts holds the shapes).
    const hit = readFileSync(join(__dirname, 'hitShapes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(hit).toMatch(/:is\(\.tvbwrap, \.frzwrap, \.rfbwrap, \.etbwrap\) \{ pointer-events: none; \}/);
    expect(hit).toMatch(/\.etbwrap::after \{ clip-path: polygon\(/);
    expect(hit).toMatch(/\.rfbwrap::after \{ clip-path: polygon\(/);
    expect(rules.some((r) => /\.(etbwrap|rfbwrap)/.test(r.sel)), 'no Docked-only copy left to drift').toBe(false);
  });

  it('sits under the board HUD, so every board hover and tooltip draws over the slices', () => {
    // The HUD pieces (Refresh, End Turn, Gold...) are `position: fixed; z-index: 41` stacking contexts holding their tips.
    expect(styles).toMatch(/\.goldpill \{[^}]*z-index: 41;/);
    const z = rules.find((r) => r.sel.includes('html:root .lobbyrail.lrv-docked:not(.guidesview)') && /z-index/.test(r.body));
    expect(z?.sel).toContain('.lobbyrailhead.lrv-docked');
    expect(Number(/z-index:\s*(\d+)/.exec(z!.body)![1])).toBeLessThan(41);
  });
});
