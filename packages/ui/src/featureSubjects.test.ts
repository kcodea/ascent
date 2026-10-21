import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

// R-PERF-HAS-SUBJECT-01 (desktop jank pass 2026-10-20): a rule shaped `A:has(B) C` where C (the part the rule styles)
// has no class, id, tag or attribute (`:not(.card)`, `*`, `::before`) makes Blink restyle the WHOLE subtree of every
// element whose `:has()` state changes. `.app` and `<body>` carry `:has()` rules that change on nearly every commit, so
// one such rule (`.cardref:has(.plate-frosted) .cardref-inner > :not(.card)`, #2173) restyled the whole document
// (700-1,000 elements, 5-21 ms) on every buy, sell, play, hover and combat entry. Name what the rule styles instead.

/** Split on top-level occurrences of any char in `chars` (outside parentheses and brackets). */
function splitTop(s: string, chars: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (depth === 0 && chars.includes(c)) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** The compounds of one complex selector, left to right. */
const compounds = (sel: string): string[] => splitTop(sel.replace(/\s*([>+~])\s*/g, ' ').trim(), ' ').filter(Boolean);

/** Does a compound carry something Blink can key an invalidation on (a class, id, attribute or tag)? */
export function compoundHasFeature(c: string): boolean {
  // :is()/:where() give their arguments' features; every other functional pseudo (:not, :has, :nth-child...) gives none.
  const stripped = c
    .replace(/::?[a-z-]+\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/gi, (m) => (/^:(is|where)\(/i.test(m) && /[.#[]|\(\s*[a-z]/i.test(m) ? '.x' : ''))
    .replace(/::?[a-z-]+/gi, '');
  return /[.#[]/.test(stripped) || /^[a-z][a-z0-9-]*/i.test(stripped);
}

/** Every selector in the UI's stylesheets that puts `:has()` on an ancestor of a featureless subject. */
export function featurelessHasSubjects(css: string): string[] {
  const bad: string[] = [];
  postcss.parse(css).walkRules((r) => {
    const parent = r.parent as { type?: string; name?: string } | undefined;
    if (parent?.type === 'atrule' && /keyframes/i.test(parent.name ?? '')) return;
    for (const sel of splitTop(r.selector, ',')) {
      const cs = compounds(sel);
      if (cs.length < 2) continue;
      if (!cs.slice(0, -1).some((x) => x.includes(':has('))) continue;
      if (!compoundHasFeature(cs[cs.length - 1]!)) bad.push(sel.trim());
    }
  });
  return bad;
}

describe('R-PERF-HAS-SUBJECT-01: no :has() rule styles a featureless subject', () => {
  it('the detector catches the shape that restyled the whole document, and passes its fix', () => {
    expect(featurelessHasSubjects('.cardref:has(.plate-frosted) .cardref-inner > :not(.card) { filter: none }')).toHaveLength(1);
    expect(featurelessHasSubjects('body:has(.x) * { color: red }')).toHaveLength(1);
    expect(featurelessHasSubjects('.a:has(.b) ::before { color: red }')).toHaveLength(1);
    expect(featurelessHasSubjects('.cardref:has(.plate-frosted) .cardref-inner > .kwdefs { filter: none }')).toEqual([]);
    expect(featurelessHasSubjects('.a:has(.b) div { color: red }')).toEqual([]);
    expect(featurelessHasSubjects('.a:has(.b) :is(.c, .d) { color: red }')).toEqual([]);
    expect(featurelessHasSubjects('.a:has(.b) { color: red } .a .c:has(.d) { color: red }')).toEqual([]);
  });
  it('every stylesheet in the UI package is clean', () => {
    const files = (readdirSync(__dirname, { recursive: true }) as string[]).filter((x) => x.endsWith('.css'));
    expect(files.length).toBeGreaterThan(20);
    const bad: string[] = [];
    for (const f of files) {
      const path = join(__dirname, f);
      for (const sel of featurelessHasSubjects(readFileSync(path, 'utf8'))) bad.push(`${relative(__dirname, path)}: ${sel}`);
    }
    expect(bad).toEqual([]);
  });
});
