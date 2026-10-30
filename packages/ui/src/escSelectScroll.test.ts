/**
 * R-ESCSELECT-SCROLL-01 (owner 2026-10-30: "the select dropdown needs a scroll. it causes the entire settings menu to
 * scroll, not just the menu. can you have it have multiple columns as well? 2 columns?"). A Settings dropdown list
 * scrolls inside itself and never hands its wheel on to the Settings page; the Board backdrop list is two columns.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');
const esc = readFileSync(join(__dirname, 'EscMenu.tsx'), 'utf8');

/** The declarations of the top-level rule whose selector is exactly `selector`. */
const ruleOf = (selector: string): string => {
  const m = new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1]!;
};

describe('Settings dropdown scrolling', () => {
  it('every list has a capped height and its own scroll that never carries on into the page', () => {
    const list = ruleOf('.escselect-list');
    expect(list).toMatch(/max-height: min\(/);
    expect(list).toMatch(/overflow-y: auto;/);
    expect(list).toMatch(/overscroll-behavior: contain;/);
  });

  it('the Board backdrop list is two columns, right-aligned to its row', () => {
    const two = ruleOf('.escselect-list.cols2');
    expect(two).toMatch(/display: grid;/);
    expect(two).toMatch(/grid-template-columns: repeat\(2,/);
    expect(two).toMatch(/right: 0;/);
    expect(esc).toMatch(/labelledBy="esc-backdrop-label"\s*columns=\{2\}/);
    expect(esc).toContain("className={`escselect-list${columns === 2 ? ' cols2' : ''}`}");
  });
});
