/**
 * The GENERATED Deno copies of the progression rules (see `rules.ts` / `server.ts` headers).
 *
 * `npm run progression:shared` (packages/tools/src/progression-shared.ts) writes these into
 * `supabase/functions/_shared/`; `sharedArtifact.test.ts` regenerates them in memory and fails when the committed
 * files differ. Pure string transforms, so the test and the writer cannot disagree about what "generated" means.
 */

/** Source file (relative to packages/progression/src) → generated file (relative to supabase/functions/_shared). */
export const SHARED_ARTIFACTS: ReadonlyArray<{ source: string; target: string }> = [
  { source: 'rules.ts', target: 'progressionRules.ts' },
  { source: 'server.ts', target: 'progressionServer.ts' },
];

const HEADER = (source: string): string =>
  `// GENERATED from packages/progression/src/${source} by \`npm run progression:shared\`. DO NOT EDIT.\n`
  + '// Edit the source, re-run the script, and commit both; sharedArtifact.test.ts fails CI when they drift.\n'
  + '// Deno module (the submit-progression Edge Function imports it); the repo\'s tsc/eslint skip supabase/**.\n';

/** The generated text for one source file. Relative imports gain the Deno path of their generated sibling. */
export function generateArtifact(source: string, text: string): string {
  let body = text.replace(/\r\n/g, '\n');
  for (const a of SHARED_ARTIFACTS) {
    const bare = a.source.replace(/\.ts$/, '');
    body = body.split(`from './${bare}';`).join(`from './${a.target}';`);
  }
  return HEADER(source) + body;
}
