import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HERO_ATTACK_STYLES } from '../heroBlast/heroAttackStyle';
import { ATTACK_FX_CLIPS, CODE_FX_CLIPS } from './codeClips';

/** Re-run the scan `codeClips.ts` is a snapshot of: every `'fx/<slug>'` literal in a non-test source file whose clip
 *  is in `audio/fx/`, split by where it is named: inside a `hero<Style>/` folder (that attack style's own clips) or
 *  anywhere else (shared). */
function scan(): { shared: string[]; byStyle: Record<string, string[]> } {
  const root = path.join(__dirname, '..');
  const bank = new Set(fs.readdirSync(path.join(__dirname, 'fx')).map((f) => f.replace(/\.(mp3|wav)$/, '')));
  const shared = new Set<string>();
  const by: Record<string, Set<string>> = {};
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && p !== path.join(__dirname, 'codeClips.ts')) {
        const top = path.relative(root, p).split(path.sep)[0]!;
        const style = /^hero([A-Z][A-Za-z0-9]*)$/.exec(top)?.[1]?.toLowerCase();
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/['"`]fx\/([A-Za-z0-9_-]+)['"`]/g)) {
          if (!bank.has(m[1]!)) continue;
          if (style) (by[style] ??= new Set()).add(`fx/${m[1]}`);
          else shared.add(`fx/${m[1]}`);
        }
      }
    }
  };
  walk(root);
  return { shared: [...shared].sort(), byStyle: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, [...v].sort()])) };
}

describe('CODE_FX_CLIPS / ATTACK_FX_CLIPS (R-TOUCH-AUDIO-QUALITY-01, R-AUDIO-PREWARM-ATTACKS-01)', () => {
  it('match a fresh scan of the source (update codeClips.ts with these lists when it fails)', () => {
    const s = scan();
    expect([...CODE_FX_CLIPS].sort()).toEqual(s.shared);
    expect(Object.fromEntries(Object.entries(ATTACK_FX_CLIPS).map(([k, v]) => [k, [...v].sort()]))).toEqual(s.byStyle);
  });

  it('every attack folder with clips is a real hero-attack style (so the prewarm can find it by style)', () => {
    for (const style of Object.keys(ATTACK_FX_CLIPS)) expect(HERO_ATTACK_STYLES as readonly string[], style).toContain(style);
  });
});
