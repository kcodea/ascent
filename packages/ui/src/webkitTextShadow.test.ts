import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// R-WEBKIT-SHADOW-01 (tester report 2026-10-26, iPhone: "the return to shop is missing the glow on the lettering").
// WebKit, so every iPhone browser, draws NO text-shadow at all on text whose `paint-order` is not `normal`. Checked in
// Playwright WebKit: the same text with `paint-order: normal` draws the glow, and with `stroke fill` it draws none.
//
// Until 2026-11-22 the outlined labels (a text stroke under the fill needs `paint-order: stroke fill`) were rebuilt on
// WebKit from layered copies (`data-wkt`, webkitText.ts). That is gone: an outline is now a ring of text-shadow copies
// (R-OUTLINE-ROUND-01, heroAttack/roundOutline.test.ts), which needs no stroke and no paint-order, so WebKit draws
// outline, shadow and glow natively. What must stay true is simply: NO HTML text rule sets a non-normal paint-order.

const SRC = __dirname;
const cssFiles = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) return cssFiles(p);
  return f.endsWith('.css') ? [p] : [];
});
/** Every innermost `selector { body }` block of a stylesheet (comments stripped; @media bodies yield their inner rules). */
const rules = (css: string): Array<{ sel: string; body: string }> =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim().replace(/\s+/g, ' '), body: m[2]! }));
const decl = (body: string, prop: string): string | null => {
  const m = body.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1]!.trim() : null;
};

describe('WebKit drops text-shadow under a non-normal paint-order (R-WEBKIT-SHADOW-01)', () => {
  it('no rule sets a non-normal paint-order on HTML text (SVG shapes and text, which set an SVG `stroke`, are the one exception)', () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of cssFiles(SRC)) {
      for (const { sel, body } of rules(readFileSync(f, 'utf8'))) {
        const po = decl(body, 'paint-order');
        if (!po) continue;
        seen++;
        if (po === 'normal') continue;
        // SVG (a chart label, the tutorial focus ring): outlined with the SVG `stroke` property, where
        // `stroke-linejoin` works, and SVG takes no text-shadow for WebKit to drop.
        if (decl(body, 'stroke') && !decl(body, 'text-shadow')) continue;
        bad.push(`${relative(SRC, f).split('\\').join('/')} :: ${sel} { paint-order: ${po} }`);
      }
    }
    expect(seen).toBeGreaterThan(0); // the scan reads real rules
    expect(bad).toEqual([]);
  });

  it('the old WebKit layering is gone with the strokes it served: no data-wkt copy, no --wk-* variable', () => {
    for (const f of cssFiles(SRC)) {
      const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, f).not.toMatch(/data-wkt|data-webkit-text|--wk-(stroke|ts)/);
    }
  });
});
