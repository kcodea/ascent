import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

// R-PHONE-DRAG-02 (owner 2026-10-29, real phone: "Mobile dragging still feels stutter/janky ... Feels like it is
// stuttering trying to catch up"). A selector that puts a class in front of a FEATURELESS subject (`.x *`, `.x > *`,
// `.x ::before`) makes the browser restyle the whole subtree of ANY element that gains or loses that class, wherever
// the rule was meant to apply: the invalidation is keyed on the class name alone. `.roundrail-wrap.dragging *` (the
// replay rail's own grab cursor) shared its class with `body.dragging`, so every card pickup and every drop restyled
// the whole document (476 elements, ~20 ms on a 4x-throttled phone profile). A class that the game toggles on <body>
// or <html> must never sit in front of a featureless subject in any stylesheet.

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

const compounds = (sel: string): string[] => splitTop(sel.replace(/\s*([>+~])\s*/g, ' ').trim(), ' ').filter(Boolean);

/** A compound the browser cannot key an invalidation on: `*`, or only pseudo-classes / pseudo-elements. */
function featureless(c: string): boolean {
  return c.replace(/::?[a-z-]+(\((?:[^()]|\([^()]*\))*\))?/gi, '').replace(/^\*/, '') === '';
}

/** The classes a compound names directly (not inside a :not() / :has() / :is() argument). */
const classesOf = (c: string): string[] =>
  [...c.replace(/:[a-z-]+\((?:[^()]|\([^()]*\))*\)/gi, '').matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]!);

/** Every class that sits in a non-subject compound of a selector whose subject is featureless. */
export function wholeSubtreeClasses(css: string): { cls: string; sel: string }[] {
  const out: { cls: string; sel: string }[] = [];
  postcss.parse(css).walkRules((r) => {
    const parent = r.parent as { type?: string; name?: string } | undefined;
    if (parent?.type === 'atrule' && /keyframes/i.test(parent.name ?? '')) return;
    for (const sel of splitTop(r.selector, ',')) {
      const cs = compounds(sel);
      if (cs.length < 2 || !featureless(cs[cs.length - 1]!)) continue;
      for (const c of cs.slice(0, -1)) for (const cls of classesOf(c)) out.push({ cls, sel: sel.trim() });
    }
  });
  return out;
}

const SRC = __dirname;
const files = (ext: RegExp): string[] =>
  (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => ext.test(f) && !/\.test\.tsx?$/.test(f));

/** The classes the game puts on <body> / <html>: from `body.x` selectors and from `document.body.classList` calls. */
function rootClasses(): Set<string> {
  const out = new Set<string>();
  for (const f of files(/\.css$/)) {
    for (const m of readFileSync(join(SRC, f), 'utf8').matchAll(/\b(?:body|html)((?:\.[a-zA-Z0-9_-]+|:not\(\.[a-zA-Z0-9_-]+\))+)/g)) {
      for (const c of m[1]!.matchAll(/\.([a-zA-Z0-9_-]+)/g)) out.add(c[1]!);
    }
  }
  for (const f of files(/\.tsx?$/)) {
    for (const m of readFileSync(join(SRC, f), 'utf8').matchAll(/document\.(?:body|documentElement)\.classList\.(?:add|toggle)\((['"])([a-zA-Z0-9_-]+)\1/g)) out.add(m[2]!);
  }
  return out;
}

describe('R-PHONE-DRAG-02: no class toggled on <body> keys a whole-subtree restyle', () => {
  it('the detector finds the shape that restyled the document on every pickup, and passes the fix', () => {
    expect(wholeSubtreeClasses('.roundrail-wrap.dragging, .roundrail-wrap.dragging * { cursor: grab }').map((x) => x.cls)).toEqual(['roundrail-wrap', 'dragging']);
    expect(wholeSubtreeClasses('.a > * { color: red } .b ::before { color: red } .c *:hover { color: red }').map((x) => x.cls)).toEqual(['a', 'b', 'c']);
    expect(wholeSubtreeClasses('body.dragging .row .card { transition: none } .a .b:hover { color: red }')).toEqual([]);
  });

  it('the collector sees the classes the game toggles on <body>', () => {
    const roots = rootClasses();
    for (const c of ['dragging', 'aiming', 'modalup']) expect(roots.has(c), c).toBe(true);
  });

  it('every stylesheet in the UI package is clean', () => {
    const roots = rootClasses();
    const bad: string[] = [];
    for (const f of files(/\.css$/)) {
      for (const { cls, sel } of wholeSubtreeClasses(readFileSync(join(SRC, f), 'utf8'))) {
        if (roots.has(cls)) bad.push(`${relative(SRC, join(SRC, f))}: .${cls} in "${sel}"`);
      }
    }
    expect(bad).toEqual([]);
  });
});
