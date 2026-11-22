// Deploys apps/dash (the private dev analytics dashboard) to Cloudflare Pages (project "ascent-dash").
//   node scripts/dash-deploy.mjs                                preview deploy (branch "preview")
//   node scripts/dash-deploy.mjs --production --owner-approved  production deploy (the owner's explicit go only)
//   add --dry-run to print the wrangler command without building or deploying.
// The secrets (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ACCESS_AUD, ACCESS_TEAM_DOMAIN, ALLOWED_EMAILS) live on the
// Pages project, never here: see apps/dash/README.md.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DIR, deployPlan } from '../apps/dash/scripts/deployPlan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');

const plan = deployPlan(argv);
if ('error' in plan) {
  console.error(plan.error);
  process.exit(2);
}

const command = `npx wrangler ${plan.args.join(' ')}`;

if (dryRun) {
  console.log(`[dry run] ${plan.branch} deploy. Would run: npm run dash:build, then in ${APP_DIR}: ${command}`);
  process.exit(0);
}

for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
  if (!process.env[name]) {
    console.error(`Missing environment variable ${name}. Set it before deploying the dashboard.`);
    process.exit(2);
  }
}

function run(cmd, cwd) {
  const r = spawnSync(cmd, { cwd, stdio: 'inherit', shell: true });
  if (r.error) {
    console.error(`Could not run "${cmd}": ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run('npm run dash:build', root);
run(command, resolve(root, APP_DIR));
