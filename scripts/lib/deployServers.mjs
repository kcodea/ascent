/**
 * Deploy the friends hub and the Versus Worker for the commit checked out in `wt` (a clean release worktree), shared by
 * `scripts/release-web.mjs` (Netlify pack) and `scripts/ship.mjs` (desktop ship). Lifted verbatim from release-web.mjs
 * steps 3b-3c: same commands, same console output, same failure messages (a failure prints and exits 1).
 *
 * Returns the hub URL + note, the Versus Worker URL + content revision, and `newSecrets`: the SQL lines
 * `workers/versus/scripts/writer-secret.mjs` printed for any writer secret it newly set (empty when both already existed).
 * Each must be run once in Supabase before the build goes out, or results / messages are refused.
 */
import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const die = (msg) => { console.error(`
✗ ${msg}
`); process.exit(1); };
const step = (msg) => console.log(`
• ${msg}`);
const run = (cmd, cwd, env = process.env) => { console.log(`  $ ${cmd}`); execSync(cmd, { cwd, stdio: 'inherit', env }); };
const WORKER_URL = /https:\/\/ascent-versus-v(\d+)-([0-9a-z]+)\.team-ascent\.workers\.dev/;

/** Run writer-secret.mjs as release-web always did (its output reaches the console) and return the SQL lines it printed. */
function runWriterSecret(name, workerDir) {
  const cmd = `node scripts/writer-secret.mjs ${name}`;
  console.log(`  $ ${cmd}`);
  const r = spawnSync(cmd, { cwd: workerDir, encoding: 'utf8', shell: true, stdio: ['inherit', 'pipe', 'inherit'] });
  process.stdout.write(r.stdout ?? '');
  if (r.status !== 0) process.exit(r.status ?? 1);
  return String(r.stdout ?? '').split(/\r?\n/).filter((l) => l.startsWith('insert into'));
}

export async function deployServers({ wt, persist }) {
  const sha = execSync('git rev-parse HEAD', { cwd: wt, encoding: 'utf8' }).trim();
  const newSecrets = [];
  // ── 3b. THE FRIENDS HUB FIRST: one stable Worker for every build, deployed only when its own code changed. It goes
  //    before the Versus Worker because that Worker's LIVE_DIR service binding names the hub's LiveDirectoryWriter
  //    entrypoint (R-LIVE-DIR-01): a Versus Worker deployed before the hub has it would not deploy. ─────────────────────
  let hubUrl = null;
  let hubNote = '';
  {
    step('the friends hub (deployed only when its code changed)');
    const cmd = `npm run hub:deploy -- ${persist ? '--persist' : ''}`.trim();
    console.log(`  $ ${cmd}`);
    let out;
    try {
      out = execSync(cmd, { cwd: wt, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      console.log(String(e.stdout ?? ''));
      die('the friends hub deploy failed (nothing was built; the live site is untouched)');
    }
    for (const line of out.split(/\r?\n/)) if (line.trim() && !line.startsWith('>')) console.log(`  ${line.trim()}`);
    const m = /hub: (deployed|unchanged) (https:\/\/ascent-hub\.team-ascent\.workers\.dev) ([0-9a-f]+)/.exec(out);
    if (!m) die('the hub deploy printed no "hub: deployed|unchanged <url> <hash>" line');
    let health = null;
    for (let i = 0; i < 10 && !health; i++) {
      try {
        const res = await fetch(`${m[2]}/health`);
        if (res.ok) health = await res.json();
      } catch { /* not routable yet */ }
      if (!health) await new Promise((r) => setTimeout(r, 3000));
    }
    if (!health || health.code !== m[3]) die(`${m[2]}/health does not answer code ${m[3]}`);
    hubUrl = m[2];
    hubNote = `${m[1]} (code ${m[3]}, hub protocol ${health.hub}, oldest client ${health.min})`;
    console.log(`  ✓ friends hub live: ${hubUrl} ${hubNote}`);
    if (persist) {
      const workerDir = path.join(wt, 'workers', 'versus');
      let secrets = '';
      try { secrets = execSync('npx wrangler secret list --name ascent-hub', { cwd: workerDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { /* treated as missing */ }
      if (secrets.includes('HUB_WRITER_SECRET')) console.log('  ✓ hub writer secret already set');
      else {
        console.log('  the hub has no writer secret yet: setting one (run the SQL line it prints, or messages are refused)');
        newSecrets.push(...runWriterSecret('ascent-hub', workerDir));
      }
    }
  }

  // ── 3c. the Versus Worker for this commit, BEFORE the site: a new site must never meet a missing Worker ───────────────
  let workerUrl = null;
  let workerRev = null;
  {
    step(`deploying the Versus Worker for ${sha.slice(0, 9)}${persist ? '' : ' (result writer OFF)'}`);
    // deploy.ts echoes only its own summary and wrangler's URL / version lines, never a key.
    const cmd = `npm run versus:cf:deploy -- ${persist ? '--persist' : ''}`.trim();
    console.log(`  $ ${cmd}`);
    let out;
    try {
      out = execSync(cmd, { cwd: wt, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      console.log(String(e.stdout ?? ''));
      die('the Versus Worker deploy failed (nothing was built; the live site is untouched)');
    }
    for (const line of out.split(/\r?\n/)) if (line.trim() && !line.startsWith('>')) console.log(`  ${line.trim()}`);
    const m = WORKER_URL.exec(out);
    if (!m) die('the Worker deploy printed no ascent-versus-*.team-ascent.workers.dev URL');
    workerUrl = m[0];
    // The Worker must answer with THIS build's engine, or every hello would be refused with version_mismatch.
    let health = null;
    for (let i = 0; i < 10 && !health; i++) {
      try {
        const res = await fetch(`${workerUrl}/health`);
        if (res.ok) health = await res.json();
      } catch { /* not routable yet */ }
      if (!health) await new Promise((r) => setTimeout(r, 3000));
    }
    if (!health) die(`${workerUrl}/health did not answer`);
    if (`v${health.cfProtocol}-${health.contentRevision}` !== `v${m[1]}-${m[2]}`) die(`the Worker at ${workerUrl} carries v${health.cfProtocol}-${health.contentRevision}, not its own name`);
    workerRev = health.contentRevision;
    console.log(`  ✓ Worker live: ${workerUrl} (content ${workerRev}, protocol ${health.protocol})`);
    // Each content revision is its own Worker, so a NEW one has no result-writer secret yet. Give it one (the secret is
    // generated and piped straight to wrangler; only its sha256 is printed, as the SQL line to run once).
    if (persist) {
      const name = `ascent-versus-v${m[1]}-${m[2]}`;
      const workerDir = path.join(wt, 'workers', 'versus');
      let secrets = '';
      try { secrets = execSync(`npx wrangler secret list --name ${name}`, { cwd: workerDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { /* treated as missing */ }
      if (secrets.includes('VERSUS_WRITER_SECRET')) console.log('  ✓ result writer secret already set on this Worker');
      else {
        console.log('  this Worker has no result writer secret yet: setting one (run the SQL line it prints BEFORE uploading the zip)');
        newSecrets.push(...runWriterSecret(name, workerDir));
      }
    }
  }

  return { hubUrl, hubNote, workerUrl, workerRev, newSecrets };
}
