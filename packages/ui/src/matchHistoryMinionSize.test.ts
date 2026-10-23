import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// R-MATCH-MINION-SIZE-01 (owner 2026-10-23: "minion sizes are really small here and in recent games"): the selected
// game's board (Career Match History + Recent Games) grows with the window instead of a fixed 100px card, and the
// lobby tiles' mini boards may grow past their old 40px cap.
const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');

const ruleBody = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `missing rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};

describe('match history minion size', () => {
  it('derives the detail board card from the layout viewport (width and height), capped at 200px', () => {
    const body = ruleBody('.gc.gc-detail .gc-board .cv2-team.cv2-team');
    const tw = /--tw:\s*([^;]+);/.exec(body)?.[1] ?? '';
    expect(tw).toContain('var(--lvw, 100vw)');
    expect(tw).toContain('var(--lvh, 100vh)');
    expect(tw).toContain('100cqw'); // the host's own width still bounds it (a phone)
    expect(tw).toContain('200px');
    expect(tw).not.toMatch(/^min\(100px,/); // the old fixed 100px card
  });

  it('lets the lobby mini board portraits grow with their tile', () => {
    const body = ruleBody('.lp-mini-m');
    const cap = Number(/max-width:\s*(\d+)px/.exec(body)?.[1]);
    expect(cap).toBeGreaterThanOrEqual(64);
  });
});
