import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', 'public']);
const EXT = /\.(ts|html|css|mjs)$/;

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
    for (const { path, text } of files) expect(text, path).not.toMatch(/from\s+['"](@game\/|.*packages\/)/);
  });
});
