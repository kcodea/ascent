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

  it('the shared sources stay dependency-free: they import only each other (Deno bundles them with no import map)', () => {
    const siblings = new Set(SHARED_ARTIFACTS.map((a) => `./${a.source.replace(/\.ts$/, '')}`));
    for (const a of SHARED_ARTIFACTS) {
      const text = readFileSync(join(root, 'packages/progression/src', a.source), 'utf8');
      const froms = [...text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'([^']+)';/gms)].map((m) => m[1]!);
      for (const f of froms) expect(siblings.has(f), `${a.source} imports ${f}`).toBe(true);
    }
    // cosmetics.ts is the leaf: it imports nothing at all
    expect(readFileSync(join(root, 'packages/progression/src/cosmetics.ts'), 'utf8')).not.toMatch(/^\s*import\s/m);
  });

  it('the Edge Function entries import the generated modules, never the package', () => {
    const entry = readFileSync(join(root, 'supabase/functions/submit-progression/index.ts'), 'utf8');
    expect(entry).toContain("from '../_shared/progressionServer.ts'");
    expect(entry).not.toContain('@game/');
    const inventory = readFileSync(join(root, 'supabase/functions/progression-inventory/index.ts'), 'utf8');
    expect(inventory).toContain("from '../_shared/progressionInventory.ts'");
    expect(inventory).not.toContain('@game/');
  });
});
