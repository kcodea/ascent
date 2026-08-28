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
    // THE MARGIN IS GONE — READ BEFORE RAISING AGAIN (2026-08-20). Owner has DEPRIORITISED the web zip
    // ("we will likely use the exe repack from now on"); the desktop package has no file cap. Kept as a
    // trend tripwire because a hundred-file jump still means un-optimized masters crept back in.
    // This budget counts ONLY the art dirs, and its old premise ("the rest is well under 100") is now false:
    // a real `build:web` dist ships **1168 files** (art + 86 frames + 23 fx + cursors/manifest/js/css), and
    // `package-itch.ps1` zips the whole dist. The last packaged `ascent-itch.zip` held 929 entries; the next
    // one would hold ~1168 — OVER itch.io's 1000-file cap. So the honest statement is: the art tree is no
    // longer the binding constraint, the WHOLE ZIP is, and it needs a structural answer (bundle art into a
    // sprite atlas, or host it off-zip). Tracked in docs/roadmap.md.
    // This number is therefore a trend tripwire ONLY — it is NOT proof the package will upload.
    // 900 → 960 (2026-08-18, Set 2 Dragon batch) → 985 (2026-08-20, rune-minion arts) → 1000 (2026-08-20,
    // the full rune-art wire: 291 rune arts) → 1010 (2026-08-21, the 10 Fi/Coran hero-quest arts — the two
    // variant families each ship ONE shared file, aliased in art.ts, so 14 quests cost 10 files not 14)
    // → 1017 (2026-08-22, the Rayse/Mimic/Void hero batch: 3 portraits + 3 power buttons + Ayse's Ace)
    // → 1019 (2026-08-23, the Aevor/Gorun/Cindara batch: 3 portraits + 3 power buttons + Cindara's Whelp
    // token = exactly 7 files, measured against `origin/main`'s 1011 rather than assumed)
    // → 1021 (2026-08-24, Fibbsy: 1 portrait + 1 power button = 2 files)
    // → 1031 (2026-08-26, the GIFTS batch: Great Pot + 8 of the 15 Gift arts + Kindness's portrait and power
    // button = 11 files. The remaining 7 Gifts are in `ART_PENDING` and cost nothing until their masters land.)
    // → 1040 (2026-08-27, the second Gifts master batch: 7 more Gift arts + the Happy Birthday / Merry
    // Christmas rune arts = 9 files; Aevor's new portrait replaced the old webp, net 0.)
    // → 1045 (2026-08-28, the owner's Choose One branch art: 6 second-option files — beetle2,
    // k_veinbreaker2, n2_spellsword2, crestclimb2, facetwright2, fieldmaneuvers2. Net +5, not +6: the dead
    // `n2_coppercoat.webp` master was deleted in the same pass, so measured 1038 → 1044.)
    expect(total, `art files: ${total} — the WHOLE-ZIP count (~${total + 176}) is what itch caps at 1000`).toBeLessThan(1045);
  });
});
