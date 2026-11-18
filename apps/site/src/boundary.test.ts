import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', 'public']);
// JSON is deliberately not scanned: artManifest.json lists packages/ui source paths as data.
const EXT = /\.(ts|html|css|mjs)$/;

// A quoted specifier that points at a game package or into packages/.
const GAME = String.raw`(?:@game\/|[^'"\`\s)]*packages\/)`;
const Q = `['"\`]`;

/** Every way a site file could pull game code in. */
const GAME_IMPORT_FORMS: { form: string; re: RegExp }[] = [
  { form: 'static import / re-export', re: new RegExp(String.raw`\bfrom\s*${Q}${GAME}`) },
  { form: 'side-effect import', re: new RegExp(String.raw`(?<!@)\bimport\s*${Q}${GAME}`) },
  { form: 'dynamic import', re: new RegExp(String.raw`\bimport\s*\(\s*${Q}${GAME}`) },
  { form: 'require', re: new RegExp(String.raw`\brequire\s*\(\s*${Q}${GAME}`) },
  { form: 'CSS @import', re: new RegExp(String.raw`@import\s+(?:url\(\s*)?${Q}?${GAME}`) },
  { form: 'CSS url()', re: new RegExp(String.raw`\burl\(\s*${Q}?${GAME}`) },
  { form: 'HTML src/href', re: new RegExp(String.raw`\b(?:src|href)\s*=\s*${Q}?${GAME}`) },
];

function gameImportIn(text: string): string | null {
  for (const { form, re } of GAME_IMPORT_FORMS) if (re.test(text)) return form;
  return null;
}

function siteFiles(dir: string = SITE_ROOT): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...siteFiles(full));
    else if (EXT.test(entry.name) && entry.name !== 'boundary.test.ts') out.push({ path: full, text: readFileSync(full, 'utf8') });
  }
  return out;
}

describe('site boundary', () => {
  it('imports no game runtime code', () => {
    const files = siteFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const { path, text } of files) expect(gameImportIn(text), path).toBeNull();
  });

  it.each([
    ['static import', `import { x } from '@game/ui';`, 'static import / re-export'],
    ['relative import into packages', `import { x } from '../../../packages/ui/src/stage';`, 'static import / re-export'],
    ['re-export', `export * from "@game/core";`, 'static import / re-export'],
    ['side-effect import', `import '@game/ui';`, 'side-effect import'],
    ['side-effect import into packages', `import "../../packages/ui/src/styles.css";`, 'side-effect import'],
    ['dynamic import', `const m = await import('@game/sim');`, 'dynamic import'],
    ['dynamic import into packages', 'const m = await import(`../../packages/core/src/rng`);', 'dynamic import'],
    ['require', `const c = require('@game/content');`, 'require'],
    ['CSS @import string', `@import '../../packages/ui/src/styles.css';`, 'CSS @import'],
    ['CSS @import url', `@import url("@game/ui/styles.css");`, 'CSS @import'],
    ['CSS url()', `.a { background: url(../../packages/ui/src/art/x.webp); }`, 'CSS url()'],
    ['HTML src', `<script type="module" src="/packages/ui/src/main.ts"></script>`, 'HTML src/href'],
    ['HTML href', `<link rel="stylesheet" href="@game/ui/styles.css" />`, 'HTML src/href'],
  ])('catches a %s', (_name, text, form) => {
    expect(gameImportIn(text)).toBe(form);
  });

  it.each([
    ['site-local import', `import { INSTALLER_URL } from './download';`],
    ['node import', `import { readFileSync } from 'node:fs';`],
    ['site art', `<img src="/art/ancients/war.webp" alt="" />`],
    ['site module entry', `<script type="module" src="/src/main.ts"></script>`],
    ['manifest-style data string', `const source = 'packages/ui/src/art/ancients/war.webp';`],
    ['prose mentioning packages', `// copied from packages/ui at build time, never imported`],
  ])('allows a %s', (_name, text) => {
    expect(gameImportIn(text)).toBeNull();
  });
});
