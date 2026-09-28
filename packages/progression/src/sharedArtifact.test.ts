import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHARED_ARTIFACTS, generateArtifact } from './sharedArtifact';

/**
 * ONE hand-edited copy of the progression rules. The Edge Function's modules in supabase/functions/_shared/ are
 * GENERATED from this package (`npm run progression:shared`); this test regenerates them in memory and fails
 * when the committed copies differ, so a rules edit can never ship to the client without the server (or back).
 */
const root = join(__dirname, '../../..');

describe('generated Deno copies of the progression rules', () => {
  for (const a of SHARED_ARTIFACTS) {
    it(`supabase/functions/_shared/${a.target} is up to date with packages/progression/src/${a.source}`, () => {
      const source = readFileSync(join(root, 'packages/progression/src', a.source), 'utf8');
      const committed = readFileSync(join(root, 'supabase/functions/_shared', a.target), 'utf8').replace(/\r\n/g, '\n');
      expect(committed, 'run `npm run progression:shared` and commit the result').toBe(generateArtifact(a.source, source));
    });
  }

  it('the rules file stays dependency-free (Deno bundles it with no import map)', () => {
    const rules = readFileSync(join(root, 'packages/progression/src/rules.ts'), 'utf8');
    expect(rules).not.toMatch(/^\s*import\s/m);
  });

  it('the Edge Function entry imports the generated modules, never the package', () => {
    const entry = readFileSync(join(root, 'supabase/functions/submit-progression/index.ts'), 'utf8');
    expect(entry).toContain("from '../_shared/progressionServer.ts'");
    expect(entry).not.toContain('@game/');
  });
});
