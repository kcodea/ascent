import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { NOT_TIP_CLASSES, PAINT_EXCEPTIONS, TIP_CLASSES } from './tooltipRegistry';
import { TOOLTIP_DEFAULTS, TOOLTIP_VARS, sanitizeTooltipConfig, type TooltipConfig } from './tooltipConfig';

/**
 * ONE TOOLTIP STYLE (owner 2026-10-02: "unify our tooltips everywhere stylistically so that they all match").
 * Source-scanning tripwires, so a NEW tooltip cannot quietly bring its own look back:
 *  1. no CSS rule aimed at a tip panel paints it (background / border colour / shadow / text colour / font family)
 *     unless the value comes from the shared `--atip-*` tokens;
 *  2. every class that looks like a tip is registered (tooltipRegistry.ts), so the rule above can see it;
 *  3. every `role="tooltip"` element in the UI wears a registered tip class;
 *  4. no native `title=` attribute on a DOM element (owner rule: no OS tooltips; ESLint also bans it);
 *  5. the tuner's baked defaults match the stylesheet's tokens, so production plays what the CSS declares.
 */

const SRC = __dirname;
const walk = (dir: string, ext: RegExp, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (ext.test(name)) out.push(p);
  }
  return out;
};
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule { file: string; selector: string; body: string }
/** Flat rules (`selector { body }`); an @media block's inner rules come out as their own rules. */
function rules(file: string): Rule[] {
  const css = stripComments(readFileSync(file, 'utf8'));
  const out: Rule[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].replace(/^[\s\S]*\{/, '').replace(/^\s*@[^{]*$/, '').trim();
    if (selector && !selector.startsWith('@') && !/^(from|to|\d+%)/.test(selector)) out.push({ file, selector, body: m[2] });
  }
  return out;
}

const CSS_FILES = walk(SRC, /\.css$/).filter((f) => !f.endsWith('tooltips.css'));
const ALL_RULES = CSS_FILES.flatMap(rules);
const PAINT_PROPS = new Set([
  'background', 'background-color', 'background-image', 'border', 'border-color', 'border-top', 'border-right',
  'border-bottom', 'border-left', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'box-shadow', 'color', 'font-family', 'backdrop-filter', '-webkit-backdrop-filter',
]);
/** Values that carry no colour of their own. */
const NEUTRAL = /^(none|transparent|inherit|0|initial|unset)$/;
const hasClass = (compound: string, cls: string): boolean => new RegExp(`\\.${cls.replace(/-/g, '\\-')}(?![\\w-])`).test(compound);
/** The rightmost compound selector: the element the declarations actually land on. */
const subjectOf = (sel: string): string => sel.split(/\s*[>+~]\s*|\s+/).filter(Boolean).pop() ?? '';
const isTipSubject = (sel: string): boolean => {
  const subj = subjectOf(sel);
  if (TIP_CLASSES.some((c) => hasClass(subj, c))) return true;
  // the `data-tip` bubbles are pseudo-elements of their owner
  return /\[data-tip\][^\s]*::(after|before)$/.test(subj);
};

describe('one shared tooltip style', () => {
  it('no tip rule paints itself outside the shared --atip-* tokens', () => {
    const bad: string[] = [];
    for (const r of ALL_RULES) {
      for (const sel of r.selector.split(',').map((s) => s.trim())) {
        if (!isTipSubject(sel) || (PAINT_EXCEPTIONS as readonly string[]).includes(sel)) continue;
        for (const decl of r.body.split(';')) {
          const i = decl.indexOf(':');
          if (i < 0) continue;
          const prop = decl.slice(0, i).trim().toLowerCase();
          const value = decl.slice(i + 1).trim();
          if (!PAINT_PROPS.has(prop) || value.includes('var(--atip-')) continue;
          // a border made only of width / style / a neutral colour (the caret triangles' `6px solid transparent`)
          if (prop.startsWith('border') && /^[\d.]+px\s+solid\s+transparent$/.test(value)) continue;
          if (NEUTRAL.test(value)) continue;
          bad.push(`${relative(SRC, r.file)}: ${sel} { ${prop}: ${value} }`);
        }
      }
    }
    expect(bad, 'paint a tooltip through the shared skin in tooltips.css (or register a deliberate exception in tooltipRegistry.ts)').toEqual([]);
  });

  it('every tip-looking class is registered', () => {
    const known = new Set<string>([...TIP_CLASSES, ...NOT_TIP_CLASSES]);
    const unknown = new Set<string>();
    for (const r of ALL_RULES) {
      for (const m of r.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
        const cls = m[1];
        if (!/(tip$|tip-|-tip|tooltip)/.test(cls) || cls === 'tt-on') continue;
        if (known.has(cls) || TIP_CLASSES.some((t) => cls.startsWith(`${t}-`))) continue;
        unknown.add(cls);
      }
    }
    expect([...unknown], 'a new tooltip class: add it to TIP_CLASSES (tooltipRegistry.ts) and the skin groups in tooltips.css').toEqual([]);
  });

  const TSX = walk(SRC, /\.tsx$/).filter((f) => !/\.test\.tsx$/.test(f));

  it('every role="tooltip" element wears a registered tip class', () => {
    const bad: string[] = [];
    for (const f of TSX) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<[a-z][\w.]*\b[^<>]*?role=(?:"tooltip"|\{[^}]*'tooltip'[^}]*\})[^<>]*>/g)) {
        const tag = m[0];
        if (!TIP_CLASSES.some((c) => new RegExp(`[\\s"'\`{]${c.replace(/-/g, '\\-')}(?![\\w-])`).test(tag))) bad.push(`${relative(SRC, f)}: ${tag.slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no native title= tooltip on a DOM element', () => {
    const bad: string[] = [];
    for (const f of TSX) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<([a-z][\w-]*)\b[^<>]*?\stitle=/g)) bad.push(`${relative(SRC, f)}: <${m[1]} title=…>`);
    }
    expect(bad).toEqual([]);
  });

  it('the tuner defaults match the stylesheet tokens', () => {
    const css = readFileSync(join(SRC, 'tooltips.css'), 'utf8');
    for (const [k, [name, unit]] of Object.entries(TOOLTIP_VARS) as [keyof TooltipConfig, [string, string]][]) {
      const m = css.match(new RegExp(`${name}:\\s*([\\d.]+)(px)?;`));
      expect(m, name).not.toBeNull();
      expect(Number(m![1]), name).toBe(TOOLTIP_DEFAULTS[k]);
      expect(m![2] ?? '', name).toBe(unit);
    }
  });

  it('a stored tuner blob is sanitised (unknown keys dropped, out-of-range clamped)', () => {
    expect(sanitizeTooltipConfig({ bodySize: 999, junk: 1 })).toEqual({ ...TOOLTIP_DEFAULTS, bodySize: 26 });
    expect(sanitizeTooltipConfig('nope')).toEqual(TOOLTIP_DEFAULTS);
  });
});
