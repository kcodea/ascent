/**
 * THE PHONE MENUS (R-PHONE-MENUS-03, owner 2026-10-26: "the menus just aren't fit to work on the screen size ... We need a
 * better mobile ui for the various menus"). phoneMenus.css lays the menu pages out for a phone. These guards keep its
 * contract:
 *   - DESKTOP IS UNTOUCHED: every rule is keyed on the phone page scale (`html[data-touch-ui][data-touch-small][data-page-scale]`),
 *     which a desktop never carries (stage.ts `stageModeFor` is the transform off a phone), so desktop stays pixel-identical.
 *   - NO ZOOM: WebKit zooms a registered card length a second time inside a CSS zoom (R-PHONE-MENUS-02); the phone menus
 *     size in points (`--pt`) and only ever reset a zoom to 1.
 *   - STATIC: nothing animates (performance contract, CLAUDE.md), and no bare keyword cursor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stageModeFor } from './stage';

const css = fs.readFileSync(path.join(__dirname, 'phoneMenus.css'), 'utf8');
const PREFIX = 'html[data-touch-ui][data-touch-small][data-page-scale]';

/** The selector lists of every rule (comments stripped), split on top-level commas. */
function selectors(text: string): string[] {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  for (const m of bare.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    let depth = 0; let cur = '';
    for (const ch of m[1]!) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

describe('phone menus (R-PHONE-MENUS-03)', () => {
  it('is imported by the game', () => {
    expect(fs.readFileSync(path.join(__dirname, 'Game.tsx'), 'utf8')).toMatch(/import '\.\/phoneMenus\.css'/);
  });

  it('keys every rule on the phone page scale, so desktop never matches one', () => {
    const sel = selectors(css);
    expect(sel.length).toBeGreaterThan(100);
    const stray = sel.filter((s) => !s.startsWith(PREFIX));
    expect(stray).toEqual([]);
  });

  it('a desktop window never takes the page scale those rules need', () => {
    for (const onMenus of [true, false]) expect(stageModeFor(false, onMenus, {})).toBe('transform');
  });

  it('never zooms (only resets a zoom to 1), never animates, and paints no bare keyword cursor', () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const zooms = [...bare.matchAll(/(?<![-\w])zoom\s*:\s*([^;}]+)/g)].map((m) => m[1]!.trim());
    expect(zooms.every((z) => z === '1')).toBe(true);
    expect(bare).not.toMatch(/\b(animation|transition)\s*:/);
    expect(bare).not.toMatch(/cursor\s*:\s*(pointer|default|auto)\b/);
  });

  it('sizes text in screen points, at least 8 pt anywhere (the level badge "Lv") and 11 pt or more for most of it', () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const sizes = [...bare.matchAll(/font-size:\s*calc\(([\d.]+) \* var\(--pt\)/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(40);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(8);
    expect(sizes.filter((s) => s >= 11).length / sizes.length).toBeGreaterThan(0.6);
  });
});
