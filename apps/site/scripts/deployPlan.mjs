// Pure planning for the site deploy. The wrapper (scripts/site-deploy.mjs) runs what this returns.

export const PROJECT_NAME = 'ascent-site';
export const DIST_DIR = 'apps/site/dist';

export const PRODUCTION_REFUSAL =
  "Production deploys need Mike's explicit go for this deploy. Re-run with --owner-approved only after he has said so.";

/**
 * @param {string[]} argv command-line flags (without node and the script path)
 * @returns {{ branch: 'preview' | 'main', args: string[] } | { error: string }}
 */
export function deployPlan(argv) {
  const production = argv.includes('--production');
  const ownerApproved = argv.includes('--owner-approved');
  if (production && !ownerApproved) return { error: PRODUCTION_REFUSAL };
  const branch = production ? 'main' : 'preview';
  return {
    branch,
    args: ['pages', 'deploy', DIST_DIR, '--project-name', PROJECT_NAME, '--branch', branch],
  };
}
