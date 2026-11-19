// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import postcss from 'postcss';
import { afterEach, describe, expect, it } from 'vitest';
import { installPointedBoards, pointedBoardsOf, POINTED_ATTR } from './pointedBoard';

// R-PERF-HOVER-SUBJECT-01 (perf commit floor, 2026-11-19): a rule shaped `A:hover B` (or `A:not(:hover) B`) where B, the
// part the rule styles, has no class, id, tag or attribute (`*`, `*::before`, `:not(.x)`). Blink keeps ONE invalidation
// set per pseudo-class for the whole stylesheet, so a single such rule makes EVERY hover change, on ANY element, restyle
// that element's whole subtree. Three menu rules (`.lb-row:not(:hover) .lb-team *` and two like it) did exactly that to
// the game: every card the pointer entered or left restyled its 100 to 150 elements, two or three times per action.
// The same holds for `:active` and the focus pseudos (every click flips them on the whole ancestor chain).

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
/** Does a compound carry something Blink can key an invalidation on (a class, id, attribute or tag)? (As featureSubjects.test.ts.) */
function compoundHasFeature(c: string): boolean {
  const stripped = c
    .replace(/::?[a-z-]+\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/gi, (m) => (/^:(is|where)\(/i.test(m) && /[.#[]|\(\s*[a-z]/i.test(m) ? '.x' : ''))
    .replace(/::?[a-z-]+/gi, '');
  return /[.#[]/.test(stripped) || /^[a-z][a-z0-9-]*/i.test(stripped);
}
const USER_ACTION = /:(hover|active|focus|focus-within|focus-visible)\b/;

/** Every selector that puts a user-action pseudo-class on an ancestor (or sibling) of a featureless subject. */
export function featurelessUserActionSubjects(css: string): string[] {
  const bad: string[] = [];
  postcss.parse(css).walkRules((r) => {
    const parent = r.parent as { type?: string; name?: string } | undefined;
    if (parent?.type === 'atrule' && /keyframes/i.test(parent.name ?? '')) return;
    for (const sel of splitTop(r.selector, ',')) {
      const cs = compounds(sel);
      if (cs.length < 2) continue;
      if (!cs.slice(0, -1).some((x) => USER_ACTION.test(x))) continue;
      if (!compoundHasFeature(cs[cs.length - 1]!)) bad.push(sel.trim());
    }
  });
  return bad;
}

describe('R-PERF-HOVER-SUBJECT-01: no :hover / :active / :focus rule styles a featureless subject', () => {
  it('the detector catches the shape that restyled every hovered card, and passes its fix', () => {
    expect(featurelessUserActionSubjects('.lb-row:not(:hover) .lb-team * { animation-play-state: paused }')).toHaveLength(1);
    expect(featurelessUserActionSubjects('.gc:not(:hover) .cv2-team *::before { animation-play-state: paused }')).toHaveLength(1);
    expect(featurelessUserActionSubjects('.a:hover > * { color: red }')).toHaveLength(1);
    expect(featurelessUserActionSubjects('.a:active :not(.b) { color: red }')).toHaveLength(1);
    expect(featurelessUserActionSubjects('.a:focus-within ::after { color: red }')).toHaveLength(1);
    expect(featurelessUserActionSubjects('.lb-row:not([data-pointed]) .lb-team * { animation-play-state: paused }')).toEqual([]);
    expect(featurelessUserActionSubjects('.card:hover .cglow { opacity: 1 }')).toEqual([]);
    expect(featurelessUserActionSubjects('.a:hover { color: red } .a .b:hover::before { color: red }')).toEqual([]);
    expect(featurelessUserActionSubjects('.a:hover :is(.c, .d) { color: red }')).toEqual([]);
  });
  it('every stylesheet in the UI package is clean', () => {
    const files = (readdirSync(__dirname, { recursive: true }) as string[]).filter((x) => x.endsWith('.css'));
    expect(files.length).toBeGreaterThan(20);
    const bad: string[] = [];
    for (const f of files) {
      const path = join(__dirname, f);
      for (const sel of featurelessUserActionSubjects(readFileSync(path, 'utf8'))) bad.push(`${relative(__dirname, path)}: ${sel}`);
    }
    expect(bad).toEqual([]);
  });
  it('the menu boards read the attribute, inside the hover media query the build guard used to add', () => {
    const src = readFileSync(join(__dirname, 'styles.css'), 'utf8') + readFileSync(join(__dirname, 'partyHome/pages/gamesPages.css'), 'utf8');
    const found: string[] = [];
    postcss.parse(src).walkRules((r) => {
      if (!r.selector.includes('[data-pointed]')) return;
      const media = r.parent as { type?: string; name?: string; params?: string } | undefined;
      expect(media?.type === 'atrule' && media.name === 'media' && media.params === '(hover: hover)').toBe(true);
      expect(r.toString()).toContain('animation-play-state: paused !important');
      found.push(...splitTop(r.selector, ',').map((s) => s.trim()));
    });
    for (const [host, team] of [['.lb-row', '.lb-team'], ['.gc', '.cv2-team'], ['.rgp-board', '.cv2-team']]) {
      for (const tail of ['*', '*::before', '*::after']) expect(found).toContain(`${host}:not([data-pointed]) ${team} ${tail}`);
    }
  });
});

describe('pointedBoard: the menu board under the mouse wears data-pointed', () => {
  let off: (() => void) | null = null;
  afterEach(() => { off?.(); off = null; document.body.innerHTML = ''; });
  const over = (el: Element, related: Element | null = null): void => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: related })); };
  const out = (el: Element, related: Element | null): void => { el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: related })); };

  it('marks every matching ancestor, moves with the mouse, and clears when the mouse leaves the window', () => {
    document.body.innerHTML = `
      <div class="lb-row gc" id="a"><div class="lb-team"><span id="a1"></span></div></div>
      <div class="gc" id="b"><div class="rgp-board" id="b0"><span id="b1"></span></div></div>
      <div class="app"><div class="card" id="c"></div></div>`;
    const $ = (id: string): Element => document.getElementById(id)!;
    off = installPointedBoards();
    over($('a1'));
    expect($('a').hasAttribute(POINTED_ATTR)).toBe(true);
    expect($('b').hasAttribute(POINTED_ATTR)).toBe(false);
    over($('b1'), $('a1'));
    expect($('a').hasAttribute(POINTED_ATTR)).toBe(false);
    expect($('b').hasAttribute(POINTED_ATTR)).toBe(true);
    expect($('b0').hasAttribute(POINTED_ATTR)).toBe(true);
    expect(pointedBoardsOf($('b1')).map((e) => e.id)).toEqual(['b0', 'b']);
    // Onto something that is not a menu board (the game): nothing is marked.
    over($('c'), $('b1'));
    expect(document.querySelectorAll(`[${POINTED_ATTR}]`)).toHaveLength(0);
    over($('a1'));
    out($('a1'), null);
    expect(document.querySelectorAll(`[${POINTED_ATTR}]`)).toHaveLength(0);
  });

  it('writes nothing in a game: a hover between cards touches no attribute', () => {
    document.body.innerHTML = `<div class="app"><div class="card" id="c1"><i id="x"></i></div><div class="card" id="c2"></div></div>`;
    off = installPointedBoards();
    let writes = 0;
    const mo = new MutationObserver((r) => { writes += r.length; });
    mo.observe(document.body, { subtree: true, attributes: true });
    over(document.getElementById('x')!);
    over(document.getElementById('c2')!, document.getElementById('x'));
    out(document.getElementById('c2')!, null);
    expect(mo.takeRecords().length + writes).toBe(0);
    mo.disconnect();
  });

  it('uninstalling clears the mark', () => {
    document.body.innerHTML = `<div class="rgp-board" id="r"><span id="s"></span></div>`;
    off = installPointedBoards();
    over(document.getElementById('s')!);
    expect(document.getElementById('r')!.hasAttribute(POINTED_ATTR)).toBe(true);
    off(); off = null;
    expect(document.getElementById('r')!.hasAttribute(POINTED_ATTR)).toBe(false);
  });
});
