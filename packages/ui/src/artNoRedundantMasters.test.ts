import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ART SHIPPING GUARD (owner report 2026-08-08: itch refused the upload — "Too many files in zip (1094 > 1000)").
 *
 * The cause was 166 PNG art MASTERS still committed beside their `.webp` builds. `art.ts` globs
 * `*.{png,webp}` and `indexArt` prefers the `.webp` when both exist — so every one of those PNGs was bundled
 * into the build and served to nobody: 104 MB of dead weight, and the 94 files that broke itch's cap.
 *
 * `npm run optimize-art` deletes a master once it has converted it, so a redundant pair only appears when one
 * is re-added by hand. This test fails the moment that happens, at the point it is cheap to fix, rather than
 * at upload time weeks later.
 *
 * The old art-tree FILE-COUNT ceiling (the itch.io 1000-file zip cap tripwire, last raised to 1469 in #2194) was
 * removed 2026-10-21 (owner: "we dont care about this"). The redundant-master check below guards real waste and stays.
 */
const ART = join(__dirname, 'art');

const artDirs = (): string[] =>
  readdirSync(ART).filter((d) => statSync(join(ART, d)).isDirectory());

describe('no redundant PNG masters ship alongside their WebP builds', () => {
  it('every art directory is WebP-only where a WebP exists', () => {
    const redundant: string[] = [];
    for (const dir of artDirs()) {
      const files = readdirSync(join(ART, dir));
      const webp = new Set(files.filter((f) => f.toLowerCase().endsWith('.webp')).map((f) => f.replace(/\.webp$/i, '')));
      for (const f of files) {
        if (f.toLowerCase().endsWith('.png') && webp.has(f.replace(/\.png$/i, ''))) redundant.push(`${dir}/${f}`);
      }
    }
    expect(redundant, redundant.length
      ? `${redundant.length} PNG master(s) duplicate a .webp and would ship unused — run \`npm run optimize-art\`:\n  ${redundant.slice(0, 12).join('\n  ')}`
      : '').toEqual([]);
  });
});
