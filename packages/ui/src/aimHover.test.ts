import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// R-AIM-HOVER-01 (owner 2026-11-13): while a card effect waits for its target, the minions show no hover, the same
// as under a targeted spell drag.
const css = readFileSync(join(__dirname, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const recruit = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');

describe('no card hover while a card effect is aimed', () => {
  it('the warband and Shop minions take no pointer while the aim is open', () => {
    expect(css).toMatch(/body\.aimpick \.zone\[data-zone='warband'\] \.card,\s*body\.aimpick \.zone\[data-zone='tavern'\] \.card \{ pointer-events: none; \}/);
  });
  it('the flag is on exactly for the life of the aim, set by the effect that owns the aim listeners', () => {
    const start = recruit.indexOf("window.addEventListener('pointerdown', pick);");
    const body = recruit.slice(start, recruit.indexOf('}, [pendingTarget, timeUp, dispatch, inCombat, run.board, captureCoalesce, viewing]);', start));
    expect(body).toContain("document.body.classList.add('aimpick');");
    expect(body).toContain("document.body.classList.remove('aimpick');");
    expect(recruit.split("classList.add('aimpick')").length).toBe(2); // nowhere else turns it on
  });
  it('the aim does not need the cards to take the pointer: it picks from cached rects on window listeners', () => {
    expect(recruit).toContain("const boardRects = createAimRectCache('[data-zone=\"warband\"] .row .card[data-uid]');");
    expect(recruit).toContain("window.addEventListener('pointerdown', pick);");
  });
  it('nothing keys on the hand, and no rule under the flag reaches a whole subtree', () => {
    const rules = css.match(/[^{}]*\.aimpick[^{}]*\{/g) ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]).not.toMatch(/\*|hand/);
  });
});
