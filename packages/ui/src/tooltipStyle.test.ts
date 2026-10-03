import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { GEM_COLOUR_EXCEPTIONS, NOT_TIP_CLASSES, OWN_SIZE_EXCEPTIONS, PAINT_EXCEPTIONS, TIP_CLASSES } from './tooltipRegistry';
import { DEFAULT_THEME, UI_THEMES, UI_THEME_IDS, UI_THEME_KEYS, UI_THEME_VARS, type UiThemeTokens } from './uiThemeConfig';
import { TOOLTIP_DEFAULTS, TOOLTIP_VARS, sanitizeTooltipConfig, type TooltipConfig } from './tooltipConfig';

/**
 * ONE TOOLTIP STYLE (owner 2026-10-02: "unify our tooltips everywhere stylistically so that they all match").
 * Source-scanning tripwires, so a NEW tooltip cannot quietly bring its own look back:
 *  1. no CSS rule aimed at a tip panel paints it (background / border colour / shadow / text colour / font family)
 *     unless the value comes from the shared `--atip-*` tokens;
 *  2. every class that looks like a tip is registered (tooltipRegistry.ts), so the rule above can see it;
 *  3. every `role="tooltip"` element in the UI wears a registered tip class;
 *  4. no native `title=` attribute on a DOM element (owner rule: no OS tooltips; ESLint also bans it);
 *  5. the tuner's baked defaults match the stylesheet's tokens, so production plays what the CSS declares;
 *  6. no tip (or a part of one) sets its own font-size / padding / line-height: sizes come from the `--atip-*` dials
 *     (or `em`, which is relative to them), so the 💬 Tooltips tuner moves every tip uniformly.
 *  7. THE UI THEME (owner 2026-10-02): tooltips.css and the Gem plate HUD pill rules carry no literal colour, only the
 *     shared `--ui-*` tokens (exceptions: black / white shading, GEM_COLOUR_EXCEPTIONS in tooltipRegistry.ts); the
 *     baked uiTheme.css block equals DEFAULT_THEME; and every theme keeps its text readable (contrast floors).
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

  it('no tip sets its own text size, padding or line height (the tuner dials move them all)', () => {
    const SIZE_PROPS = /^(font-size|line-height|padding(-(top|right|bottom|left|block|inline)(-(start|end))?)?)$/;
    const relatedTo = (sel: string): boolean => [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)]
      .some(([, c]) => TIP_CLASSES.some((t) => c === t || c.startsWith(`${t}-`)));
    /** Relative or dial-driven: `var(--atip-*)`, or only unitless numbers / `em` / 0 / keywords. */
    const okValue = (v: string): boolean => v.includes('var(--atip-')
      || v.replace(/calc\(|\)|[*/+]/g, ' ').split(/\s+/).filter(Boolean).every((t) => /^(-?[\d.]+(em)?|normal|inherit|initial|unset)$/.test(t));
    const bad: string[] = [];
    for (const r of [...ALL_RULES, ...rules(join(SRC, 'tooltips.css'))]) {
      for (const sel of r.selector.split(',').map((x) => x.trim())) {
        if (!relatedTo(sel) || OWN_SIZE_EXCEPTIONS.some((e) => sel.includes(e))) continue;
        for (const decl of r.body.split(';')) {
          const i = decl.indexOf(':');
          if (i < 0) continue;
          const prop = decl.slice(0, i).trim().toLowerCase();
          const value = decl.slice(i + 1).trim();
          if (SIZE_PROPS.test(prop) && !okValue(value)) bad.push(`${relative(SRC, r.file)}: ${sel} { ${prop}: ${value} }`);
        }
      }
    }
    expect(bad, 'size a tooltip from the --atip-* dials (or em) so the Tooltips tuner reaches it').toEqual([]);
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

/* ── 7. THE UI THEME ── */

/** A literal colour in a CSS value: hex, rgb/rgba/hsl/hsla, or a named colour. Pure black / white shading is allowed. */
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)|(?<![-\w])(?:white|black|red|gold|orange|purple|silver|gray|grey|yellow|pink|blue|green)(?![-\w])/g;
const SHADING = /^(#000|#000000|#fff|#ffffff|rgba?\(\s*(0,\s*0,\s*0|255,\s*255,\s*255)\s*(,\s*[\d.]+\s*)?\))$/i;
/** Literal colours in a declaration value, minus `var(--x, fallback)` fallbacks (the token is what paints). */
const literalsIn = (value: string): string[] => (value.replace(/var\(--[\w-]+,[^()]*(\([^()]*\))?[^()]*\)/g, 'var()').match(LITERAL) ?? [])
  .filter((c) => !SHADING.test(c.replace(/\s+/g, ' ').trim()));

const hexRgb = (c: string): [number, number, number] => {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) throw new Error(`not #rrggbb: ${c}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = (c: string): number => {
  const [r, g, b] = hexRgb(c).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('one shared UI theme (tooltips + HUD pills)', () => {
  it('tooltips.css paints with the --ui-* tokens only', () => {
    const bad: string[] = [];
    for (const r of rules(join(SRC, 'tooltips.css'))) {
      for (const decl of r.body.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        for (const c of literalsIn(decl.slice(i + 1))) bad.push(`${r.selector.slice(0, 60)} { ${decl.trim().slice(0, 80)} } -> ${c}`);
      }
    }
    expect(bad, 'theme a tooltip colour through uiTheme.css (--ui-*), not a literal').toEqual([]);
  });

  it('the Gem plate HUD pill rules paint with the --ui-* tokens only', () => {
    const bad: string[] = [];
    for (const r of rules(join(SRC, 'healthPills.css'))) {
      if (!r.selector.includes('[data-hp-look="gem"]')) continue;
      if (GEM_COLOUR_EXCEPTIONS.some((e) => r.selector.includes(e))) continue;
      for (const decl of r.body.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        if (decl.slice(0, i).trim().startsWith('--')) continue; // a local custom property is checked where it is used
        for (const c of literalsIn(decl.slice(i + 1))) bad.push(`${r.selector.slice(0, 70)} { ${decl.trim().slice(0, 80)} } -> ${c}`);
      }
    }
    expect(bad, 'theme a HUD pill colour through uiTheme.css (--ui-*), or register a state colour in GEM_COLOUR_EXCEPTIONS').toEqual([]);
  });

  it('the Gem lobby rail rules paint with the --ui-* tokens only', () => {
    // lobbyRail.css (owner ask 2026-10-02): the Gem rail is every rule NOT scoped to the Classic look.
    const bad: string[] = [];
    const gem = rules(join(SRC, 'lobbyRail.css')).filter((r) => r.selector.includes(':not([data-lobby-rail="classic"])'));
    expect(gem.length, 'lobbyRail.css should carry the Gem rail rules').toBeGreaterThan(10);
    for (const r of gem) {
      for (const decl of r.body.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        if (decl.slice(0, i).trim().startsWith('--')) continue; // a local custom property is checked where it is used
        for (const c of literalsIn(decl.slice(i + 1))) bad.push(`${r.selector.slice(0, 70)} { ${decl.trim().slice(0, 80)} } -> ${c}`);
      }
    }
    expect(bad, 'theme a lobby rail colour through uiTheme.css (--ui-*), not a literal').toEqual([]);
  });

  it('the baked uiTheme.css block equals DEFAULT_THEME, token for token', () => {
    const css = readFileSync(join(SRC, 'uiTheme.css'), 'utf8');
    const t: UiThemeTokens = UI_THEMES[DEFAULT_THEME];
    for (const k of UI_THEME_KEYS) {
      const m = css.match(new RegExp(`${UI_THEME_VARS[k]}:\s*([^;]+);`));
      expect(m, UI_THEME_VARS[k]).not.toBeNull();
      expect(m![1]!.trim(), UI_THEME_VARS[k]).toBe(t[k]);
    }
  });

  it('every theme sets every token to a colour', () => {
    for (const id of UI_THEME_IDS) {
      const t: UiThemeTokens = UI_THEMES[id];
      for (const k of UI_THEME_KEYS) expect(t[k], `${id}.${k}`).toMatch(/^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, [\d.]+\))$/);
    }
  });

  it('every theme keeps its text readable (WCAG contrast on the plate)', () => {
    const lows: string[] = [];
    const need = (id: string, what: string, fg: string, bg: string, min: number): void => {
      const r = contrast(fg, bg);
      if (r < min) lows.push(`${id}: ${what} ${r.toFixed(2)} < ${min}`);
    };
    for (const id of UI_THEME_IDS) {
      const t: UiThemeTokens = UI_THEMES[id];
      // The plate's LIGHTEST stop is the worst case for light text.
      for (const bg of [t.plateTop, t.plateMid, t.plateBot]) {
        need(id, 'body text', t.text, bg, 7);
        need(id, 'title', t.title, bg, 7);
        need(id, 'highlight', t.hl, bg, 4.5);
        need(id, 'muted', t.muted, bg, 4.5);
        need(id, 'warn', t.warn, bg, 4.5);
      }
      need(id, 'chip text', t.chipText, t.chipBg, 7);
      need(id, 'armor number', t.armorInk, t.armorMid, 4.5);
    }
    expect(lows).toEqual([]);
  });
});
