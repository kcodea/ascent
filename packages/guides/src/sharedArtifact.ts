/**
 * The GENERATED Deno copies of the guide rules. `npm run guides:shared` (packages/tools/src/guides-shared.ts) writes
 * them into `supabase/functions/_shared/`; `sharedArtifact.test.ts` regenerates them in memory and fails when the
 * committed files differ. Pure string transforms, so the test and the writer cannot disagree.
 */

/** Source file (relative to packages/guides/src) and its generated file (relative to supabase/functions/_shared). */
export const SHARED_ARTIFACTS: ReadonlyArray<{ source: string; target: string }> = [
  { source: 'types.ts', target: 'guidesTypes.ts' },
  { source: 'validate.ts', target: 'guidesValidate.ts' },
  { source: 'wordFilter.ts', target: 'guidesWordFilter.ts' },
  { source: 'server.ts', target: 'guidesServer.ts' },
];

const HEADER = (source: string): string =>
  `// GENERATED from packages/guides/src/${source} by \`npm run guides:shared\`. DO NOT EDIT.\n`
  + '// Edit the source, re-run the script, and commit both; sharedArtifact.test.ts fails CI when they drift.\n'
  + '// Deno module (the guide-write Edge Function imports it); the repo\'s tsc/eslint skip supabase/**.\n';

/** The generated text for one source file. Relative imports gain the Deno path of their generated sibling. */
export function generateArtifact(source: string, text: string): string {
  let body = text.replace(/\r\n/g, '\n');
  for (const a of SHARED_ARTIFACTS) {
    const bare = a.source.replace(/\.ts$/, '');
    body = body.split(`from './${bare}';`).join(`from './${a.target}';`);
  }
  return HEADER(source) + body;
}
