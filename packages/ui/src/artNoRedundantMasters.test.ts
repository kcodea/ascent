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

  it('the art tree stays well under itch.io’s 1000-file zip cap', () => {
    // Art is the bulk of the bundle's file count; the rest (js/css/audio/icons) is well under 100. A budget
    // here catches the trend long before a package is built and rejected. Raise it deliberately if the card
    // pool genuinely grows — but a jump of a hundred usually means un-optimized masters crept back in.
    const total = artDirs().reduce((n, d) => n + readdirSync(join(ART, d)).length, 0);
    // Budget raised 960 → 985 on 2026-08-20: the 16 rune-only minions + Arnold + 2 spells + 24 rune arts
    // landed. 985 keeps a real margin under the hard 1000 cap — next raise should force the conversation
    // about splitting art out of the zip instead.
    // Budget raised 900 → 960 on 2026-08-18 as the Set 2 pool grew (Dragon batch + Hawkus/Spots art). Still a
    // ~40-file margin under itch's 1000 cap — a redundant-master regression would blow well past it.
    expect(total, `art files: ${total} — itch's whole-zip cap is 1000`).toBeLessThan(985);
  });
});
