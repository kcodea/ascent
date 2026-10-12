import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHARED_ARTIFACTS, generateArtifact } from './sharedArtifact';

/**
 * ONE hand-edited copy of the guide rules. The Edge Function's modules in supabase/functions/_shared/ are GENERATED
 * from this package (`npm run guides:shared`); this test regenerates them in memory and fails when the committed
 * copies differ, so the limits and the word filter can never differ between what is tested and what is deployed.
 */
const root = join(__dirname, '../../..');

describe('generated Deno copies of the guide rules', () => {
  for (const a of SHARED_ARTIFACTS) {
    it(`supabase/functions/_shared/${a.target} is up to date with packages/guides/src/${a.source}`, () => {
      const source = readFileSync(join(root, 'packages/guides/src', a.source), 'utf8');
      const committed = readFileSync(join(root, 'supabase/functions/_shared', a.target), 'utf8').replace(/\r\n/g, '\n');
      expect(committed, 'run `npm run guides:shared` and commit the result').toBe(generateArtifact(a.source, source));
    });
  }

  it('the shared sources import only each other (Deno bundles them with no import map)', () => {
    const siblings = new Set(SHARED_ARTIFACTS.map((a) => `./${a.source.replace(/\.ts$/, '')}`));
    for (const a of SHARED_ARTIFACTS) {
      const text = readFileSync(join(root, 'packages/guides/src', a.source), 'utf8');
      const froms = [...text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'([^']+)';/gms)].map((m) => m[1]!);
      for (const f of froms) expect(siblings.has(f), `${a.source} imports ${f}`).toBe(true);
    }
  });

  it('the Edge Function entry imports the generated module, never the package', () => {
    const entry = readFileSync(join(root, 'supabase/functions/guide-write/index.ts'), 'utf8');
    expect(entry).toContain("from '../_shared/guidesServer.ts'");
    expect(entry).not.toContain('@game/');
  });

  it('the entry refuses an oversized body before parsing it, using the tested byte gate', () => {
    const entry = readFileSync(join(root, 'supabase/functions/guide-write/index.ts'), 'utf8');
    expect(entry).toContain('guideBodyTooLarge(raw)');
    expect(entry).not.toContain('raw.length');
    expect(entry.toLowerCase()).toContain("headers.get('content-length')");
    expect(entry.indexOf('payload_too_large')).toBeGreaterThan(-1);
    expect(entry.indexOf('payload_too_large')).toBeLessThan(entry.indexOf('JSON.parse'));
    const refusal = entry.indexOf("json(403, { error: 'sign_in_required' })");
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(entry.indexOf('req.text()'));
  });
});
