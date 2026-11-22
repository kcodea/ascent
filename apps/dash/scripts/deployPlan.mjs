// Pure planning for the dashboard deploy. The wrapper (scripts/dash-deploy.mjs) runs what this returns, from
// apps/dash (so wrangler finds functions/ and wrangler.toml next to dist/).

export const PROJECT_NAME = 'ascent-dash';
export const DIST_DIR = 'dist';
export const APP_DIR = 'apps/dash';

export const PRODUCTION_REFUSAL =
  "Production deploys of the dashboard need the owner's explicit go for this deploy. Re-run with --owner-approved only after he has said so.";

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
