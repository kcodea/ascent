import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Owner, 2026-09-24: "why does the discover not have the actual live board" and "also remove the window tooltips
 * on these buttons (and every button they break immersion so badly)".
 *
 * 1. The Discover-family overlay (`.discover-ov`: Discover, Choose One, quest / hero-power offers, the scout
 *    reveal, commissions) must sit over the REAL board. It used to paint an opaque `::before` of the static board
 *    art, which hid the shop, warband, hero, hand and rail behind an empty table.
 * 2. No native `title` tooltips on rendered DOM. ESLint (`banTitleTooltips` in eslint.config.mjs) is the day-to-day
 *    gate; this scan is the belt-and-braces twin that also runs under `npm test`.
 */
const SRC = fileURLToPath(new URL('.', import.meta.url));
const CSS = readFileSync(join(SRC, 'styles.css'), 'utf8');

/** Every top-level rule whose selector list names exactly `selector` (comments stripped). */
function rulesFor(selector: string): string[] {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    if (m[1]!.split(',').map((s) => s.trim()).includes(selector)) out.push(m[2]!);
  }
  return out;
}

describe('Discover backdrop shows the live board', () => {
  it('paints no opaque board-art layer over the board', () => {
    expect(rulesFor('.discover-ov::before').join(' ')).not.toMatch(/var\(--board\)/);
    expect(rulesFor('.discover-ov::after').join(' ')).not.toMatch(/var\(--board\)/);
  });

  it('is a translucent scrim with no per-frame blur over the live board (perf)', () => {
    const body = rulesFor('.discover-ov').join(' ');
    const bg = /background:\s*rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(body);
    expect(bg, '.discover-ov keeps a plain rgba scrim').not.toBeNull();
    const alpha = Number(bg![1]);
    expect(alpha).toBeGreaterThan(0.4);
    expect(alpha).toBeLessThan(0.9);
    expect(body).not.toMatch(/backdrop-filter/);
    expect(body).not.toMatch(/(^|[\s;])filter:/);
  });
});

describe('no native title tooltips on rendered DOM', () => {
  function tsxFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return tsxFiles(p);
      return /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) ? [p] : [];
    });
  }

  it('no lowercase JSX element carries a title attribute, and no SVG <title> child', () => {
    const hits: string[] = [];
    for (const file of tsxFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('title')) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node): void => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(sf);
          const where = `${file.slice(SRC.length)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
          if (tag === 'title') hits.push(`${where} <title>`);
          if (/^[a-z]/.test(tag) && node.attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'title')) {
            hits.push(`${where} <${tag} title=…>`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(hits).toEqual([]);
  });
});
