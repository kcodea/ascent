// @vitest-environment jsdom
/**
 * R-TOUCH-RUN-MEMORY-01 (owner 2026-10-22: "I still can't even play it because of the crashing"). From hero select to
 * the first shop a phone kept the stage `transform`, so every composited layer inside it cost its full stage size
 * times 3x3 on iOS (about 87 MB for a full-screen one), and up to five were up at once (`npm run perf:phone-run`).
 *   1. A phone shrinks the stage in games without a transform too (CSS zoom then; the page scale since
 *      R-PHONE-PAGESCALE-01).
 *   2. The parked falling gate, the hero ceremony's finished entrances and the hero select under the opaque launch
 *      curtain stop holding layers (touchUi.css, phone only).
 * Desktop is untouched: `stageModeFor` is the transform off a phone whatever else is passed, every CSS rule is keyed off
 * `html[data-touch-ui][data-phone-gpu]`, and `setLaunchCovered` / the fade's cancel are gated on PHONE_GPU.
 */
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { afterEach, describe, expect, it } from 'vitest';
import { stageModeFor } from './stage';
import { setLaunchCovered } from './hero-select/HeroLaunchCurtain';

const src = (f: string): string => fs.readFileSync(path.join(__dirname, f), 'utf8');

describe('the stage in games (phone only)', () => {
  it('desktop always takes the transform, whatever the switches say', () => {
    for (const menus of [true, false]) {
      expect(stageModeFor(false, menus, { zoom: 1 })).toBe('transform');
      expect(stageModeFor(false, menus, {})).toBe('transform');
    }
  });
  it('a phone page-scales hero select and the run (R-PHONE-PAGESCALE-01), never the stage transform by default', () => {
    expect(stageModeFor(true, false, {})).toBe('page');
  });
  it('gamexf keeps the games on the transform; zoom forces the old CSS zoom; the menus are unchanged', () => {
    expect(stageModeFor(true, false, { gamexf: 1 })).toBe('transform');
    expect(stageModeFor(true, false, { zoom: 1 })).toBe('zoom');
    expect(stageModeFor(true, true, {})).toBe('page');
    expect(stageModeFor(true, true, { gamexf: 1 })).toBe('page');
    expect(stageModeFor(true, true, { nozoom: 1 })).toBe('transform');
  });
  it('stage.ts asks for the mode only on a phone', () => {
    expect(src('stage.ts')).toMatch(/return PHONE_GPU \? stageModeFor\(true, menuZoom, PHONE_DIAG\) : 'transform';/);
  });
});

describe('phone layer rules (touchUi.css)', () => {
  const css = src('touchUi.css');
  const rules: { sel: string; body: string }[] = [];
  postcss.parse(css).walkRules((r) => { for (const sel of r.selectors) rules.push({ sel: sel.trim(), body: r.nodes.map(String).join(';') }); });
  const find = (part: string) => rules.filter((r) => r.sel.includes(part));
  it('every new rule is phone-only', () => {
    for (const part of ['.wipecurtain', '.hsc-', 'data-launch-covered']) {
      const hit = find(part);
      expect(hit.length, part).toBeGreaterThan(0);
      for (const r of hit) expect(r.sel.startsWith('html[data-touch-ui][data-phone-gpu]'), r.sel).toBe(true);
    }
  });
  it('the parked falling gate hides, and only while parked (never while it falls, holds or cranks)', () => {
    const sels = find('.wipecurtain').map((r) => r.sel);
    expect(sels).toContain('html[data-touch-ui][data-phone-gpu] .wipecurtain:not(.full):not(.gone)');
    expect(sels).toContain('html[data-touch-ui][data-phone-gpu] .wipecurtain.gone.parked');
    for (const r of find('.wipecurtain')) expect(r.body).toMatch(/visibility:\s*hidden/);
  });
  it('the ceremony entrances let go of their layer (filled backwards, end state as the element style)', () => {
    for (const part of ['.hsc-scrim', '.hsc-glow', '.hsc-ring', '.hsc-flash', '.hsc-plate']) {
      expect(find(part)[0]?.body, part).toMatch(/animation-fill-mode:\s*backwards/);
    }
    // The two whose desktop keyframes leave the start implicit get explicit-start twins.
    const ceremony = src('hero-select/heroCeremony.css');
    expect(ceremony).toMatch(/@keyframes hscFadeInFrom \{ from \{ opacity: 0; \}/);
    expect(ceremony).toMatch(/@keyframes hscGlowInFrom \{ from \{ opacity: 0; transform: scale\(0\.85\); \}/);
  });
  it('the hero select under the opaque launch curtain stops painting', () => {
    expect(find('[data-launch-covered] .heroselect')[0]?.body).toMatch(/visibility:\s*hidden/);
  });
});

describe('setLaunchCovered', () => {
  afterEach(() => document.documentElement.removeAttribute('data-launch-covered'));
  it('marks the page on a phone and clears it', () => {
    setLaunchCovered(true, true);
    expect(document.documentElement.hasAttribute('data-launch-covered')).toBe(true);
    setLaunchCovered(false, true);
    expect(document.documentElement.hasAttribute('data-launch-covered')).toBe(false);
  });
  it('is a no-op on desktop', () => {
    setLaunchCovered(true, false);
    expect(document.documentElement.hasAttribute('data-launch-covered')).toBe(false);
  });
  it('the curtain clears it before every reveal and on unmount', () => {
    const s = src('hero-select/HeroLaunchCurtain.tsx');
    const reveals = s.match(/await fade\(el, 1, 0, t\.launchRevealMs\)/g)?.length ?? 0;
    const cleared = s.match(/setLaunchCovered\(false\);\s*\n\s*await fade\(el, 1, 0, t\.launchRevealMs\)/g)?.length ?? 0;
    expect(reveals).toBeGreaterThan(0);
    expect(cleared).toBe(reveals);
    expect(s).toMatch(/return \(\) => \{ dead = true; setLaunchCovered\(false\);/);
  });
});
