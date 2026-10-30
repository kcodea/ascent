/**
 * R-ENDSCREEN-FIT-01 (owner 2026-10-30: "at the end of the game, i noticed that not all elements can fit onto the screen
 * as well, causing the same full screen scroll experience, we want to always avoid that", "how about we shrink the
 * height of the Account XP breakdown screen, and if there are too many details to fit, that box gets a scroll?", "the
 * level bar should not be INSIDE that box. it should always be visible"). Checked live at 2000x1077: overlay scrollHeight
 * == clientHeight, the breakdown scrolling inside a 151px box, the level bar and Continue on screen.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string): string => readFileSync(join(__dirname, f), 'utf8');
const css = read('styles.css');
const ruleOf = (selector: string): string => {
  const m = new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1]!;
};

describe('the end-of-game rank screen fits the window', () => {
  it('the overlay never scrolls; the column is capped and only the Account XP box gives up height', () => {
    for (const line of [
      '.heroselect.rankend { overflow: hidden; }',
      '.rankend .endbox { max-height: 100%; min-height: 0; }',
      '.rankend-panel { max-height: 100%; min-height: 0; }',
      '.rankend-panel > * { flex-shrink: 0; }',
      '.rankend-panel > .acctxp { flex-shrink: 1; min-height: 0; }',
    ]) expect(css, line).toContain(`\n${line}\n`);
  });

  it('inside the box only the breakdown scrolls; the heading and the level bar are outside it', () => {
    expect(ruleOf('.acctxp-scroll')).toMatch(/overflow-y: auto;/);
    expect(ruleOf('.rankend-panel > .acctxp > :not(.acctxp-scroll)')).toMatch(/flex-shrink: 0;/);
    const src = read('progression/ProgressionPostgame.tsx');
    const scrollAt = src.indexOf('<div className="acctxp-scroll">');
    const head = src.indexOf('className="acctxp-head"');
    const lines = src.indexOf('<ul className="acctxp-lines"');
    const aether = src.indexOf('className="acctxp-aether"');
    const bar = src.indexOf('<div className="acctxp-barrow">');
    expect(head).toBeLessThan(scrollAt);
    expect(scrollAt).toBeLessThan(lines);
    expect(lines).toBeLessThan(aether);
    // The scroll area closes before the level bar opens, so the bar is never inside it.
    expect(src.slice(aether, bar)).toMatch(/<\/div>\s*\)\}\s*<\/div>\s*$/);
  });
});
