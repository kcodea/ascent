import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));
const STYLES = resolve(SRC, 'styles');
const PUBLIC = resolve(SRC, '../public');
const SHEETS = ['tokens.css', 'base.css', 'sections.css'];

const read = (f: string): string => readFileSync(resolve(STYLES, f), 'utf8');
const allSiteCss = (): string => SHEETS.map(read).join('\n');

/** Strip comments so prose inside them never trips a check. */
const uncomment = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `@keyframes` block, with its name and the raw text between its outer braces. */
function keyframesIn(css: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const src = uncomment(css);
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = re.lastIndex;
    while (depth > 0 && i < src.length) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    out.push({ name: m[1], body: src.slice(re.lastIndex, i - 1) });
  }
  return out;
}

/** The property names declared inside a keyframes body (`transform: ...;` gives `transform`). */
function propertiesIn(body: string): string[] {
  return [...body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
}

describe('site stylesheets', () => {
  it('all three sheets exist and are imported from main.ts', () => {
    const main = readFileSync(resolve(SRC, 'main.ts'), 'utf8');
    for (const f of SHEETS) {
      expect(existsSync(resolve(STYLES, f)), f).toBe(true);
      expect(main).toContain(`./styles/${f}`);
    }
  });

  it('declares at least one looping animation to check', () => {
    expect(keyframesIn(allSiteCss()).length).toBeGreaterThan(0);
  });

  it('looping animations touch only transform and opacity', () => {
    for (const { name, body } of keyframesIn(allSiteCss()))
      for (const prop of propertiesIn(body)) expect(['transform', 'opacity'], `${name}: ${prop}`).toContain(prop);
  });

  it('animation only runs inside a prefers-reduced-motion: no-preference block', () => {
    const css = uncomment(allSiteCss());
    const outside = css.replace(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{[\s\S]*?\n\}/g, '');
    expect(outside).not.toMatch(/animation(-name)?\s*:/);
  });

  it('no literal colours outside tokens.css', () => {
    for (const f of ['base.css', 'sections.css']) expect(read(f)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it('no bare keyword cursor on controls', () => {
    expect(allSiteCss()).not.toMatch(/cursor:\s*pointer\s*;/);
  });

  it('the download button uses the gauntlet cursor and body the default gauntlet', () => {
    const css = allSiteCss();
    expect(css).toContain("cursor: url('/art/cursors/gauntlet_open.svg') 6 2, pointer");
    expect(css).toMatch(/cursor:\s*url\('\/art\/cursors\/gauntlet_default\.svg'\)/);
  });

  it('styles the platform states Task 5 sets on <html>', () => {
    const css = allSiteCss();
    expect(css).toMatch(/\.is-other/);
    expect(css).toMatch(/\.is-mobile/);
  });
});

describe('placeholder stills', () => {
  const stills = [
    'discover-timer',
    'gold-fuse',
    'rearrange',
    'save-continue',
    'runeforge',
    'ancient-select',
    'career-chart',
    'chest-opening',
    'mode-versus',
    'mode-duos',
    'mode-gauntlet',
  ].map((s) => `captures/${s}.jpg`);

  it('every poster the page references exists, and each is under 200 KB', () => {
    for (const f of [...stills, 'share.jpg']) {
      const p = resolve(PUBLIC, f);
      expect(existsSync(p), f).toBe(true);
      expect(statSync(p).size, f).toBeLessThan(200 * 1024);
    }
  });
});
