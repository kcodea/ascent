import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

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

  it('no NEW rule pairs paint-order: stroke with a text-shadow (it draws without the shadow on every iPhone)', () => {
    // Known, older than this guard: each draws its outline but loses its shadow on iPhone. Shrink this list, never grow it.
    const KNOWN = new Set([
      'heroAttack/damageFormation.css :: .dform-chip b',
      'heroAttack/damageFormation.css :: .dform-merge b',
      'heroAttack/damageFormation.css :: .dform-hero b',
      'heroAttack/damageFormation.css :: .hblast-total-n',
      'heroAttack/damageFormation.css :: .hblast-hit',
      'styles.css :: .card.compact.showtext .drawer .dtribe',
      'progression/collection.css :: .colls-tile.skin .colls-tile-for, .colls-tile.skin .colls-tile-rar, .colls-tile.skin.owned .colls-tile-name',
      'styles.css :: .card.plated .plate-tribe',
      'styles.css :: .spellpower-float, .rubypower-float',
    ]);
    const found: string[] = [];
    for (const f of cssFiles(SRC)) {
      for (const { sel, body } of rules(readFileSync(f, 'utf8'))) {
        const po = decl(body, 'paint-order'); const ts = decl(body, 'text-shadow');
        if (po && /^stroke/.test(po) && ts && ts !== 'none') found.push(`${relative(SRC, f).replace(/\\/g, '/')} :: ${sel}`);
      }
    }
    expect(found.filter((k) => !KNOWN.has(k))).toEqual([]);
  });
});
