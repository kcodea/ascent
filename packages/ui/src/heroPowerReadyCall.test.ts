import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// THE READY CALL (owner 2026-10-23: "a more aggressive glow around any hero power that is activateable/targetable during
// the shop phase that hasnt yet been used ... make it pretty aggressive"). A usable power shouts with a hot throbbing
// halo, a ring bursting outward and an arc racing round its rim, in the Shop only, and every loop stays on the
// compositor (opacity / transform), per the performance rules in CLAUDE.md.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'styles.css'), 'utf8');
const statusBar = readFileSync(join(here, 'StatusBar.tsx'), 'utf8');

describe('the hero power ready call', () => {
  it('only plays in the Shop, on a power that is usable right now', () => {
    expect(statusBar).toContain("className={`statusbar${run.phase === 'recruit' ? ' shopphase' : ''}`}");
    for (const part of ['.heropowerbtn.ready .hpb-glow {', '.heropowerbtn.ready::before {', '.heropowerbtn.ready::after {']) {
      expect(css, part).toContain(`.statusbar.shopphase ${part}`);
    }
    // every power you press to use wears `ready` when usable: the hero power, a second power, the Equipment
    expect((statusBar.match(/className=\{`heropowerbtn\$\{[^}]*ready/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('moves only opacity and transform in its loops', () => {
    for (const k of ['hpbcallglow', 'hpbcallring', 'hpbcallspin']) {
      const frames = new RegExp(`@keyframes ${k} \\{([^\\n]*)\\}`).exec(css)?.[1] ?? '';
      expect(frames, k).toMatch(/opacity|transform/);
      expect(frames.replace(/(transform|opacity): [^;]*;/g, ''), k).not.toMatch(/:\s*[^;{}]+;/);
    }
  });

  it("bursts its ring at the halo's brightest: the two share one beat", () => {
    const glow = /animation: hpbcallglow ([\d.]+)s/.exec(css)?.[1];
    const ring = /animation: hpbcallring ([\d.]+)s/.exec(css)?.[1];
    expect(glow).toBeTruthy();
    expect(ring).toBe(glow);
    expect(css).toContain('@keyframes hpbcallglow { 0%, 100% { opacity: 1; }');
    expect(css).toContain('@keyframes hpbcallring { 0% { transform: scale(1); opacity: 0.95; }');
  });

  it('stills itself for reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n {2}\.statusbar\.shopphase \.heropowerbtn\.ready \.hpb-glow \{ animation: none;/);
  });
});
