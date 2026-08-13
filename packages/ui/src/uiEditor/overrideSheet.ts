import { ruleText, type EditEntry, type Scratchpad } from './scratchpad';

/**
 * A single injected stylesheet the editor owns. Rules here survive React reconciliation and GSAP's inline
 * writes (they live outside the element's `style` prop) — the whole reason Approach A works. Each edited
 * selector maps to exactly one rule, replaced wholesale on every change.
 */
const STYLE_ID = 'ui-editor-overrides';
const ruleIndex = new Map<string, number>(); // selector -> index in sheet.cssRules

function sheet(): CSSStyleSheet {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  return el.sheet as CSSStyleSheet;
}

export function applyEntry(entry: EditEntry): void {
  const s = sheet();
  clearRule(entry.selector); // idempotent replace
  const idx = s.insertRule(ruleText(entry), s.cssRules.length);
  ruleIndex.set(entry.selector, idx);
}

export function clearRule(selector: string): void {
  const s = sheet();
  const idx = ruleIndex.get(selector);
  if (idx === undefined) return;
  // Rebuild the index map because deleteRule shifts every following index.
  s.deleteRule(idx);
  ruleIndex.clear();
  for (let i = 0; i < s.cssRules.length; i++) {
    const sel = (s.cssRules[i] as CSSStyleRule).selectorText;
    ruleIndex.set(sel, i);
  }
}

export function clearAll(): void {
  const s = sheet();
  while (s.cssRules.length) s.deleteRule(0);
  ruleIndex.clear();
}

export function applyAll(sp: Scratchpad): void {
  clearAll();
  for (const entry of Object.values(sp)) applyEntry(entry);
}
