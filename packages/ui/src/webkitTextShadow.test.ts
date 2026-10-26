import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isWebKitEngine, setGlowText } from './webkitText';

// R-WEBKIT-SHADOW-01 (tester report 2026-10-26, iPhone: "the return to shop is missing the glow on the lettering").
// WebKit, so every iPhone browser, draws NO text-shadow at all on text whose `paint-order` is not `normal`. The
// return trip's title inherited `paint-order: stroke fill` from `.wipevs-label`, so its magic glow never drew on
// iPhone while desktop Chrome showed it. Checked in Playwright WebKit: the same text with `paint-order: normal`
// draws the glow, and with `stroke fill` it draws none (`fill stroke` and a `filter: drop-shadow` both survive).

const SRC = __dirname;
const cssFiles = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) return cssFiles(p);
  return f.endsWith('.css') ? [p] : [];
});
/** Every innermost `selector { body }` block of a stylesheet (comments stripped; @media bodies yield their inner rules). */
const rules = (css: string): Array<{ sel: string; body: string }> =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
const decl = (body: string, prop: string): string | null => {
  const m = body.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

describe('WebKit drops text-shadow under a non-normal paint-order (R-WEBKIT-SHADOW-01)', () => {
  const styles = rules(readFileSync(join(SRC, 'styles.css'), 'utf8'));
  const rule = (sel: string): string => {
    const r = styles.find((x) => x.sel === sel && decl(x.body, 'text-shadow'));
    if (!r) throw new Error(`no rule ${sel} with a text-shadow`);
    return r.body;
  };

  it('the return trip title (glow) and the gate poster lettering (inked bleed) reset paint-order to normal', () => {
    // Both inherit `paint-order: stroke fill` from `.wipevs-label` / `.wipevs-name` and draw no stroke of their own.
    expect(decl(styles.find((x) => x.sel === '.wipevs-label, .wipevs-name')!.body, 'paint-order')).toBe('stroke fill');
    for (const sel of ['.wipevista .wipevista-title', '.wipeposter .wipevs-label, .wipeposter .wipevs-name']) {
      const body = rule(sel);
      expect(decl(body, 'paint-order'), sel).toBe('normal');
      expect(decl(body, '-webkit-text-stroke'), sel).toBe('0');
    }
  });

  it('every rule that pairs paint-order: stroke with a text-shadow draws them through --wk-stroke / --wk-ts (no exceptions)', () => {
    // The WebKit layering (styles.css "OUTLINED TEXT WITH A GLOW ON WEBKIT", webkitText.ts) rebuilds the outline and the
    // shadows from those two variables. A rule that writes them directly would draw no glow on iPhone. The list of
    // exceptions is EMPTY (owner 2026-10-26: "build the iPhone-friendly versions"); keep it that way.
    const bad: string[] = [];
    let paired = 0;
    for (const f of cssFiles(SRC)) {
      for (const { sel, body } of rules(readFileSync(f, 'utf8'))) {
        const po = decl(body, 'paint-order'); const ts = decl(body, 'text-shadow');
        if (!(po && /^stroke/.test(po) && ts && ts !== 'none')) continue;
        paired++;
        const stroke = decl(body, '-webkit-text-stroke');
        if (ts !== 'var(--wk-ts)' || !decl(body, '--wk-ts') || (stroke && (stroke !== 'var(--wk-stroke)' || !decl(body, '--wk-stroke')))) {
          bad.push(`${relative(SRC, f).split('\\').join('/')} :: ${sel}`);
        }
      }
    }
    expect(paired).toBeGreaterThanOrEqual(9); // the damage numbers, tribe labels, power floats, skin tiles
    expect(bad).toEqual([]);
  });

  it('the WebKit layering: outline on ::before, shadows on ::after (paint-order normal), letters on top', () => {
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
    const body = (sel: string): string => styles.find((x) => x.sel === sel)?.body ?? '';
    expect(css).toContain(':where(html[data-webkit-text] [data-wkt]) { position: relative; }');
    expect(decl(body('html[data-webkit-text] [data-wkt]'), 'text-shadow')).toBe('none !important');
    const both = body('html[data-webkit-text] [data-wkt]::before, html[data-webkit-text] [data-wkt]::after');
    expect(decl(both, 'content')).toBe('attr(data-wkt)');
    expect(decl(both, 'paint-order')).toBe('normal');
    expect(decl(both, 'z-index')).toBe('-1');
    expect(decl(body('html[data-webkit-text] [data-wkt]::before'), '-webkit-text-stroke')).toBe('var(--wk-stroke)');
    expect(decl(body('html[data-webkit-text] [data-wkt]::after'), 'text-shadow')).toBe('var(--wk-ts)');
  });
});

describe('the WebKit switch (webkitText.ts)', () => {
  it('is on for Safari and every iPhone browser, off for Chromium, Edge, Android and Firefox', () => {
    const on = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    ];
    const off = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    ];
    for (const ua of on) expect(isWebKitEngine(ua), ua).toBe(true);
    for (const ua of off) expect(isWebKitEngine(ua), ua).toBe(false);
  });

  it('a glowing label keeps its copy in step with its text', () => {
    const el = { textContent: '', attrs: new Map<string, string>(), setAttribute(k: string, v: string) { this.attrs.set(k, v); } };
    setGlowText(el as unknown as HTMLElement, '+12');
    expect(el.textContent).toBe('+12');
    expect(el.attrs.get('data-wkt')).toBe('+12');
  });
});
