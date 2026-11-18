// Deploys apps/site to Cloudflare Pages (project "ascent-site").
//   node scripts/site-deploy.mjs                              preview deploy
//   node scripts/site-deploy.mjs --production --owner-approved  production deploy (Mike's explicit go only)
//   add --dry-run to print the wrangler command without building or deploying.
// Separate from Ship Ascent (npm run ship), which ships the desktop app.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployPlan } from '../apps/site/scripts/deployPlan.mjs';

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
  console.log(`[dry run] ${plan.branch} deploy. Would run: npm run build:site, then: ${command}`);
  process.exit(0);
}

for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
  if (!process.env[name]) {
    console.error(`Missing environment variable ${name}. Set it before deploying the site.`);
    process.exit(2);
  }
}

function run(cmd) {
  const r = spawnSync(cmd, { cwd: root, stdio: 'inherit', shell: true });
  if (r.error) {
    // The spawn itself failed (no shell, bad cwd), so nothing printed a reason.
    console.error(`Could not run "${cmd}": ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run('npm run build:site');
run(command);
