import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const { latestYml, sha512Of } = createRequire(import.meta.url)('./latestYml.cjs');

describe('latest.yml (the update feed file CI writes)', () => {
  it('names the version, the unversioned installer, its hash and size', () => {
    const text = latestYml({ version: '0.2.0', fileName: 'ASCENT-Setup.exe', sha512: 'abc==', size: 42, releaseDate: '2026-11-04T00:00:00.000Z' });
    expect(text).toBe(
      "version: 0.2.0\nfiles:\n  - url: ASCENT-Setup.exe\n    sha512: abc==\n    size: 42\npath: ASCENT-Setup.exe\nsha512: abc==\nreleaseDate: '2026-11-04T00:00:00.000Z'\n",
    );
  });
  it('hashes the file as base64 SHA-512', async () => {
    const f = path.join(mkdtempSync(path.join(os.tmpdir(), 'lyml-')), 'x.exe');
    writeFileSync(f, 'hello');
    expect(await sha512Of(f)).toBe(createHash('sha512').update('hello').digest('base64'));
  });
});
