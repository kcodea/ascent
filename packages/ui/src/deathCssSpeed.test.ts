import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Beat holds divide by `combatSpeed`, but CSS durations are fixed seconds. A DYING unit is unmounted when its
// beat advances, so any fixed-duration death animation gets CUT above some speed — the blink, returning at
// 1.31x+ before this guard. Every `.unit.dying*` time value must therefore divide by `--combat-speed` (either
// directly, or via the inherited `--death-dur`, which is itself defined that way).
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');
const deathRules = css.split('\n').filter((l) => /^\.unit\.dying/.test(l.trim()));

/** Drop every calc() that divides by --combat-speed; a bare time literal left behind is unscaled. */
const stripScaled = (line: string): string => line.replace(/calc\([^()]*var\(--combat-speed[^()]*\)[^()]*\)/g, '');

describe('death CSS scales with --combat-speed', () => {
  it('finds the death rules (guard against a silent selector rename)', () => {
    expect(deathRules.length).toBeGreaterThanOrEqual(8);
  });

  it('has no unscaled time literal in any .unit.dying rule', () => {
    for (const line of deathRules) {
      const decl = line.slice(line.indexOf('{'));
      // `--death-dur` is defined as calc(.../var(--combat-speed)) and stripped above; var(--death-dur) is fine.
      const leftover = stripScaled(decl).match(/\d*\.?\d+m?s/g);
      expect(leftover, `unscaled duration in: ${line.trim()}`).toBeNull();
    }
  });

  it('every animated death rule references a scaled duration', () => {
    for (const line of deathRules) {
      if (!/animation(-delay)?:/.test(line) || /animation: none/.test(line)) continue;
      expect(line, `unscaled: ${line.trim()}`).toMatch(/var\(--death-dur\)|var\(--combat-speed/);
    }
  });
});
