import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE AWAKENING NEVER TRANSFORMS THE GAME TREE (owner report 2026-09-25: mid-omen on 21:9 the whole game collapsed
 * into a 16:9 box — the omen tremor animated `.app`, which made it the containing block for every fixed-positioned
 * descendant and broke the stage scaler). Every Ancients effect must be an overlay layer or a leaf; nothing in
 * `ancients/` may animate, transform or filter `.app`, `.statusbar` or the stage root.
 */
const DIR = __dirname;
const FORBIDDEN = [/querySelector(?:All)?(?:<[^>]+>)?\(\s*['"]\.app['"]/, /querySelector(?:All)?(?:<[^>]+>)?\(\s*['"]\.statusbar['"]\s*\)/, /querySelector(?:All)?(?:<[^>]+>)?\(\s*['"]#root['"]/];

describe('the Ancients awakening leaves the game tree alone', () => {
  it('no Ancients module reaches for the app root / status bar / stage root to move it', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(DIR)) {
      if (!/\.(ts|tsx)$/.test(f) || f.endsWith('.test.ts')) continue;
      const src = readFileSync(join(DIR, f), 'utf8');
      for (const re of FORBIDDEN) if (re.test(src)) offenders.push(`${f}: ${re.source}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the stylesheet never transforms or filters `.app` for the awakening', () => {
    const css = readFileSync(join(DIR, 'ancients.css'), 'utf8');
    const appRules = css.match(/[^{}]*\.app[^{}]*\{[^}]*\}/g) ?? [];
    for (const r of appRules) expect(r, r).not.toMatch(/transform|filter|will-change|translate|scale|perspective|contain/);
  });
});
