import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODE_FX_CLIPS } from './codeClips';

/** Re-run the scan `codeClips.ts` is a snapshot of: every `'fx/<slug>'` literal in a non-test source file whose clip
 *  is in `audio/fx/`. */
function scan(): string[] {
  const root = path.join(__dirname, '..');
  const bank = new Set(fs.readdirSync(path.join(__dirname, 'fx')).map((f) => f.replace(/\.(mp3|wav)$/, '')));
  const out = new Set<string>();
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && p !== path.join(__dirname, 'codeClips.ts')) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/['"`]fx\/([A-Za-z0-9_-]+)['"`]/g)) if (bank.has(m[1]!)) out.add(`fx/${m[1]}`);
      }
    }
  };
  walk(root);
  return [...out].sort();
}

describe('CODE_FX_CLIPS (R-TOUCH-AUDIO-QUALITY-01)', () => {
  it('matches a fresh scan of the source (update codeClips.ts with this list when it fails)', () => {
    expect([...CODE_FX_CLIPS].sort()).toEqual(scan());
  });
});
