/**
 * `npm run progression:shared`: write the GENERATED Deno copies of the progression rules into
 * supabase/functions/_shared/ (see packages/progression/src/sharedArtifact.ts). Run it after editing
 * packages/progression/src/rules.ts or server.ts, then commit the generated files with the source.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARED_ARTIFACTS, generateArtifact } from '../../progression/src/sharedArtifact';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
for (const a of SHARED_ARTIFACTS) {
  const text = readFileSync(join(root, 'packages/progression/src', a.source), 'utf8');
  const out = join(root, 'supabase/functions/_shared', a.target);
  writeFileSync(out, generateArtifact(a.source, text), 'utf8');
  console.log(`wrote ${out}`);
}
