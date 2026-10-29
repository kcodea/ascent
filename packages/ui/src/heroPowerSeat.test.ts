import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// R-HUD-HEROPOWER-01 (owner 2026-10-29: the hero power was "missing" and "not clickable" in every game). The hero power
// seats (`.statusbar .heropanel`, the second power, the Equipment slot) are `position: fixed` children of `.statusbar`,
// placed on the board's socket in STAGE coordinates. Any property that gives `.statusbar` itself a containing block for
// fixed descendants (a translate / transform / filter / perspective / contain / backdrop-filter / will-change on it)
// silently re-anchors those seats to the bar's own box, and they land below the screen. #2399 did exactly that with a
// `.statusbar { translate }` group nudge. The nudge now rides the bar's `left`/`bottom` and the seats' own translate.

const SRC = __dirname;
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const cssFiles = walk(SRC).filter((f) => f.endsWith('.css'));
const rel = (f: string): string => relative(SRC, f).replace(/\\/g, '/');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every innermost `selector { body }` rule (rules inside @media / @supports included). */
function rules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push({ selector: m[1]!.trim(), body: m[2]! });
  return out;
}

/** Does this one selector style the `.statusbar` element ITSELF (not a descendant)? */
function targetsStatusbar(sel: string): boolean {
  const flat = sel.replace(/:(where|is|has|not)\((?:[^()]|\([^()]*\))*\)/g, '');
  const last = flat.trim().split(/\s+|>|\+|~/).filter(Boolean).pop() ?? '';
  return /(^|[^\w-])\.statusbar(?![\w-])/.test(last);
}

const CONTAINING_BLOCK = /(^|;|\s)(translate|transform|filter|perspective|contain|backdrop-filter|-webkit-backdrop-filter|will-change)\s*:/;

describe('R-HUD-HEROPOWER-01: the hero power seats stay on the board', () => {
  it('nothing gives .statusbar a containing block for its fixed hero power seats', () => {
    const offenders: string[] = [];
    for (const f of cssFiles) {
      for (const r of rules(stripComments(readFileSync(f, 'utf8')))) {
        if (!r.selector.split(',').some(targetsStatusbar)) continue;
        if (CONTAINING_BLOCK.test(r.body)) offenders.push(`${rel(f)}: ${r.selector} { ${r.body.trim().slice(0, 120)} }`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the hero power seat is fixed to the stage and carries the Hero group nudge itself', () => {
    const css = stripComments(readFileSync(join(SRC, 'styles.css'), 'utf8'));
    const seat = rules(css).find((r) => r.selector === '.statusbar .heropanel');
    expect(seat, 'the .statusbar .heropanel seat rule').toBeDefined();
    expect(seat!.body).toMatch(/position:\s*fixed/);
    expect(seat!.body).toMatch(/translate:[^;]*--herogrp-x[^;]*--herogrp-y/);
    const bar = rules(css).find((r) => r.selector === '.statusbar' && /position:\s*fixed/.test(r.body));
    expect(bar, 'the .statusbar placement rule').toBeDefined();
    expect(bar!.body).toMatch(/left:[^;]*--herogrp-x/);
    expect(bar!.body).toMatch(/bottom:[^;]*--herogrp-y/);
  });
});
