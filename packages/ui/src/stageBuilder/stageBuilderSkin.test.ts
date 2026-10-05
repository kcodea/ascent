import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Stage Builder panel wears the Scene Builder skin (`.scenebuilder` on the same root) and adds its own rules in
 * styles.css. sceneBuilder.css is imported by SceneBuilder.tsx, so it lands AFTER styles.css: any Stage Builder rule
 * no more specific than a skin rule (`.scenebuilder .sb-search { width: 100% }`, `.scenebuilder .sb-row { flex-wrap:
 * wrap }`) silently loses. That is what broke the Run buffs rows on 2026-10-04 (owner: "the changes to the UI made this
 * section very unusable"): every buff input went full width under its name. So every Stage Builder rule is scoped
 * `.scenebuilder.stagebuilder`, one class above the skin's `.scenebuilder` (R-GAUNTLET-07).
 */
const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');

/** Every selector in styles.css that targets the Stage Builder panel (not the `.stbc` board canvas). */
function stageBuilderSelectors(): string[] {
  const out: string[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const sel of m[1].split(',').map((s) => s.trim())) {
      if (/\.stagebuilder\b/.test(sel)) out.push(sel);
    }
  }
  return out;
}

describe('Stage Builder skin specificity', () => {
  it('scopes every Stage Builder rule above the Scene Builder skin', () => {
    const sels = stageBuilderSelectors();
    expect(sels.length).toBeGreaterThan(40);
    const weak = sels.filter((s) => !/^(\.sfxmix)?\.scenebuilder\.stagebuilder\b/.test(s));
    expect(weak, 'scope these as `.scenebuilder.stagebuilder …` so sceneBuilder.css cannot override them').toEqual([]);
  });

  it('keeps a Run buffs row on one line: a name/inputs/tail grid with fixed-size inputs', () => {
    expect(css).toMatch(/\.scenebuilder\.stagebuilder \.stb-buff \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) auto auto;/);
    expect(css).toMatch(/\.scenebuilder\.stagebuilder \.stb-buffin \{[^}]*width: calc\(44 \* var\(--u\)\);/);
    expect(css).toMatch(/\.sfxmix\.scenebuilder\.stagebuilder:not\(\.collapsed\) \{[^}]*min-width:/);
  });
});
