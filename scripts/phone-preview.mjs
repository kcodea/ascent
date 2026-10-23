#!/usr/bin/env node
/**
 * PHONE PREVIEW (R-TOUCH-CRASH-REPORT-01, owner 2026-10-22: test a branch on the iPhone without a deploy).
 *
 * Builds the PRODUCTION web bundle of the current checkout (what players run, phone art copies included) and serves it
 * on the LAN with `vite preview --host`, then prints the PC's LAN URL(s) to open on the phone (same Wi-Fi).
 *
 * Usage: npm run phone:preview [-- --port 4174] [-- --no-build]
 *   --no-build  serve the existing apps/web/dist as is.
 *
 * Port 4174 by default: 5173 is the dev server's (task:serve / dev:active) and 4173 is the local `web-prod` preview in
 * .claude/launch.json; neither is touched. The first run on Windows may ask to allow Node through the firewall
 * (Private networks).
 *
 * The bundle talks to the LIVE Supabase project, like the shipped game: the tracked apps/web/.env carries the project URL
 * and the publishable key (a `.env.local` / `.env.production` overrides it the usual Vite way). With no URL at all the
 * game runs offline and crash reports are not sent; the script warns.
 *
 * It is plain http, so the page is NOT a secure context on the phone. What that changes is in
 * docs/devlog/2026-10-22-phone-crash-telemetry.md (in short: play, audio, WebGL and crash reports work; the magic-link
 * sign-in does not come back to this address, and the phone gets its own guest account for this origin).
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PORT = String(Number(arg('port', '4174')));

const hasBackend = ['.env', '.env.local', '.env.production', '.env.production.local']
  .map((f) => path.join(root, 'apps/web', f))
  .some((f) => fs.existsSync(f) && /^VITE_SUPABASE_URL\s*=\s*\S/m.test(fs.readFileSync(f, 'utf8')));
if (!hasBackend) console.warn('[phone:preview] no VITE_SUPABASE_URL in apps/web/.env*: the build runs OFFLINE (no crash reports, no accounts).');

if (!args.includes('--no-build')) {
  console.log('[phone:preview] building the production bundle (npm run build:web)...');
  execSync('npm run build:web', { cwd: root, stdio: 'inherit' });
}

const lan = Object.entries(os.networkInterfaces())
  .flatMap(([name, list]) => (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ name, address: a.address })))
  // Private ranges first (home Wi-Fi), virtual adapters (WSL, Hyper-V, VPN) after.
  .sort((a, b) => Number(!/^(192\.168|10\.)/.test(a.address)) - Number(!/^(192\.168|10\.)/.test(b.address)));

// One command string (PORT is a sanitized number): npm is a .cmd on Windows, so it needs a shell there.
const child = spawn(`npm run preview -w apps/web -- --host 0.0.0.0 --port ${PORT} --strictPort`, { cwd: root, stdio: 'inherit', shell: true });
setTimeout(() => {
  console.log('\n[phone:preview] open on the phone (same Wi-Fi):');
  if (lan.length === 0) console.log('  (no LAN IPv4 address found: is the PC on Wi-Fi / Ethernet?)');
  for (const a of lan) console.log(`  http://${a.address}:${PORT}/   (${a.name})`);
  console.log('  Add ?crashlog=1 once to see the on-phone crash readout. Ctrl+C stops the server.\n');
}, 1500);
child.on('exit', (code) => process.exit(code ?? 0));
