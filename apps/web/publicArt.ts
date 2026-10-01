import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The PUBLIC images the game actually references — baked into the bundle as `__PUBLIC_ART__` so the art preload
 * (`packages/ui/src/preloadPlan.ts`) can warm them in order (art pop-in fix, 2026-09-29).
 *
 * `apps/web/public/` is served verbatim and is invisible to `import.meta.glob`, and it also holds files nothing
 * uses any more (old boards, icons, FX preview pages). Preloading every image there would spend a remote
 * player's bandwidth on dead files, and a hand-kept list would go stale the first time art is added. So the list
 * is DERIVED: a public image is in when the UI source mentions it — literally (`cardplate-beast.webp`), or through
 * a template the source builds it from (`tier-stars-${tier}.webp`, `medallions/${id}.webp`).
 */
const IMG = /\.(webp|png|jpe?g|svg)$/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function sourceText(dirs: string[]): string {
  const parts: string[] = [];
  for (const d of dirs) {
    for (const f of walk(d)) {
      if (/\.test\.tsx?$/.test(f) || !/\.(tsx?|css|html)$/.test(f)) continue;
      parts.push(readFileSync(f, 'utf8'));
    }
  }
  return parts.join('\n');
}

/** Is `rel` (a public path like `frames/tier-stars-3.webp`) referenced by `src`? Exported for its test. */
export function isReferenced(rel: string, src: string): boolean {
  const slash = rel.lastIndexOf('/');
  const dir = slash >= 0 ? rel.slice(0, slash + 1) : '';
  const base = rel.slice(slash + 1);
  if (src.includes(base)) return true; // literal filename
  if (dir && src.includes(`${dir}\${`)) return true; // a whole-folder template: `medallions/${id}.webp`
  // A templated NAME: the longest-meaningful prefix of the stem, cut at a separator or digit, followed by `${`.
  const stem = base.replace(IMG, '');
  for (let i = stem.length - 1; i >= 4; i--) {
    const ch = stem[i]!;
    if (ch === '-' || ch === '_' || /\d/.test(ch)) {
      const cut = /\d/.test(ch) ? stem.slice(0, i) : stem.slice(0, i + 1);
      if (cut.length >= 5 && src.includes(`${cut}\${`)) return true;
    }
  }
  return false;
}

/** Every referenced public image, as a BASE_URL-relative path (`frames/oval-beast.webp`), sorted. */
export function publicArtList(publicDir: string, uiSrcDirs: string[]): string[] {
  const src = sourceText(uiSrcDirs);
  return walk(publicDir)
    .map((f) => relative(publicDir, f).split('\\').join('/'))
    .filter((rel) => IMG.test(rel) && isReferenced(rel, src))
    .sort();
}
