import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PUBLIC ASSETS MUST CARRY THE BASE URL.
 *
 * itch.io serves the game from a CDN sub-path, so a root-absolute `src="/frames/x.webp"` resolves against the
 * CDN root and 404s — the button renders as a broken image. It works perfectly on localhost, which is why it
 * keeps shipping: `npm run dev` and `vite preview` both serve from `/`.
 *
 * Vite rewrites `url(/…)` inside CSS at build time, but it CANNOT rewrite a string literal in JS. So each one
 * has to prefix `import.meta.env.BASE_URL` itself.
 *
 * This has now escaped twice — the mobile itch test (documented in Card.tsx) and the browser build on
 * 2026-07-27, which broke the end-turn, refresh, hero-power and tavern-upgrade buttons. A comment in one file
 * plainly wasn't enough, so it's a test.
 */
const SRC = join(__dirname);

/** Every public/ top-level folder that ships assets referenced from code. */
const PUBLIC_DIRS = ['frames', 'cursors', 'fx', 'sfx', 'audio', 'art'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'art') continue; // bundled via import.meta.glob, not public/
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

describe('public asset paths are BASE_URL-relative', () => {
  const files = sourceFiles(SRC);

  it('the sweep sees the source tree (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('no source file hard-codes a root-absolute public asset path', () => {
    const pattern = new RegExp(`["'\`]/(${PUBLIC_DIRS.join('|')})/`);
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        // Comments are prose — the notes about this very trap quote the bad form deliberately, and so do
        // JSDoc blocks. Strip the CR FIRST: these files are CRLF, and `.` never matches \r, so every `//`
        // line survived the strip and reported itself as an offender.
        const code = line
          .replace(/\r$/, '')
          .replace(/\/\/.*$/, '')   // line comment
          .replace(/^\s*\*.*$/, ''); // JSDoc continuation line
        if (pattern.test(code)) offenders.push(`${f.split(/[\\/]/).pop()}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
    expect(
      offenders,
      'root-absolute public paths 404 on itch — prefix `import.meta.env.BASE_URL` (see Card.tsx)',
    ).toEqual([]);
  });

  it('no source file puts a RELATIVE BASE_URL path inside a CSS url() string', () => {
    // The second trap (shipped 2026-08-27, caught 2026-09-02): `url('${BASE_URL}fx/x.png')` is correct on
    // itch's sub-path AND still broken there, because a production BASE_URL is `./` and Chromium resolves a
    // relative url() inside a CSS custom property against the STYLESHEET that reads it (assets/), not the
    // page. Resolve to an absolute URL first — see `publicAssetCssUrl` in floatConfig.ts.
    const pattern = /url\(\s*['"`]?\$\{import\.meta\.env\.BASE_URL\}/;
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/\r$/, '').replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        if (pattern.test(code)) offenders.push(`${f.split(/[\\/]/).pop()}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
    expect(
      offenders,
      'a relative url() in a CSS variable resolves against assets/ in prod — use publicAssetCssUrl (floatConfig.ts)',
    ).toEqual([]);
  });
});
