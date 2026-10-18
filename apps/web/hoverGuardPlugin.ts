import type { AtRule, Declaration, Plugin, Rule } from 'postcss';

/**
 * HOVER GUARD (owner 2026-10-18, R-TOUCH-HOVERGUARD-01: "a AAA experience, seamless 1:1 from mobile to desktop").
 *
 * A phone has no hover, but it EMULATES one: the element a finger last tapped keeps matching `:hover` until the next
 * tap lands elsewhere. Every hover glow, lift and brighten in the stylesheets therefore "sticks" on a phone after a
 * tap. This build-time PostCSS pass moves the hover half of each such rule inside `@media (hover: hover)`, which a
 * mouse (and a touchscreen laptop with a mouse) always matches, so DESKTOP RENDERS EXACTLY AS BEFORE: same rules, same
 * order, same specificity. A phone simply stops matching them.
 *
 * What is NOT guarded, so a finger keeps its way in:
 *  - a hover REVEAL with no tap twin. Tap = hover on touch (touchInput.ts): a rule that opens a tip or a panel
 *    (opacity / visibility / display / pointer-events / max-height / clip-path) and has no `.tt-on` selector beside its
 *    `:hover` one may be the only way a finger opens it, so it stays as authored.
 *    A purely DECORATIVE target is still guarded even when it animates opacity: a glow, swirl, pulse, sheen or shine
 *    layer, or a `::before` / `::after` that is not a tip (the breathing-glow pattern fades a pseudo-element in).
 *  - anything already inside an `@media (hover…)` / `(any-hover…)` / `(pointer…)` query, and `@keyframes`.
 *
 * A rule whose selector list mixes hovered and plain selectors is split in place: the plain selectors stay where they
 * were, the hovered ones go into the guard directly after, so the cascade order is unchanged.
 */

export const HOVER_MEDIA = '(hover: hover)';
const REVEAL_PROPS = new Set(['opacity', 'visibility', 'display', 'pointer-events', 'max-height', 'clip-path', 'content']);

/** Split a selector list on top-level commas (not the ones inside `:is()`, `:not()`, `:has()`, `[attr="a,b"]`). */
export function splitSelectors(sel: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (const ch of sel) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const HOVER_RE = /:hover\b/;
/** Is this rule already conditioned on the input device (so it needs no guard)? */
function insideDeviceQuery(rule: Rule): boolean {
  for (let p = rule.parent; p; p = p.parent) {
    if (p.type === 'atrule') {
      const a = p as AtRule;
      if (/keyframes$/i.test(a.name)) return true;
      if (a.name === 'media' && /\b(any-)?(hover|pointer)\b/.test(a.params)) return true;
    }
  }
  return false;
}

/** The last compound of a selector (what the rule styles): `.a:hover .b-glow` -> `.b-glow`. */
function lastCompound(sel: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && (ch === ' ' || ch === '\n' || ch === '>' || ch === '+' || ch === '~')) start = i + 1;
  }
  return sel.slice(start).trim() || sel;
}
const DECOR_RE = /glow|swirl|pulse|-lit\b|sheen|shine/i;
/** Is a hovered selector's target a purely decorative layer (a glow, or a pseudo-element that is not a tip)? */
export function decorativeTarget(sel: string): boolean {
  const last = lastCompound(sel);
  if (DECOR_RE.test(last)) return true;
  return /::?(before|after)\b/.test(last) && !/tip/i.test(sel);
}

/** Should the hovered selectors of this rule be guarded? (pure, see the header) */
export function shouldGuard(selectors: string[], props: string[]): boolean {
  const hovered = selectors.filter((s) => HOVER_RE.test(s));
  if (!hovered.length) return false;
  const reveals = props.some((p) => REVEAL_PROPS.has(p));
  if (!reveals) return true;
  if (hovered.every(decorativeTarget)) return true; // a glow fading in is a look, not a way in
  return selectors.some((s) => s.includes('.tt-on')); // a reveal keeps its touch way in through the tap twin
}

export function hoverGuardPlugin(): Plugin {
  return {
    postcssPlugin: 'ascent-hover-guard',
    OnceExit(root, { atRule }) {
      // Collect first, then rewrite: mutating the tree mid-walk can make the walker skip the next sibling.
      const rules: Rule[] = [];
      root.walkRules((rule) => { if (HOVER_RE.test(rule.selector) && !insideDeviceQuery(rule)) rules.push(rule); });
      for (const rule of rules) {
        const sels = splitSelectors(rule.selector);
        const props = (rule.nodes ?? []).filter((n): n is Declaration => n.type === 'decl').map((d) => d.prop.toLowerCase());
        if (!shouldGuard(sels, props)) continue;
        const hovered = sels.filter((s) => HOVER_RE.test(s));
        const plain = sels.filter((s) => !HOVER_RE.test(s));
        const guard = atRule({ name: 'media', params: HOVER_MEDIA });
        if (plain.length) {
          const copy = rule.clone({ selector: hovered.join(', ') });
          rule.selector = plain.join(', ');
          guard.append(copy);
          rule.after(guard);
        } else {
          rule.replaceWith(guard);
          guard.append(rule);
        }
      }
    },
  };
}
hoverGuardPlugin.postcss = true;
