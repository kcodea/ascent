/**
 * `npm run sfx:normalize` — bring every generated card clip (`packages/ui/src/audio/fx/vo-*.mp3`) to one loudness:
 * a gentle compressor, then a two-pass loudnorm to TARGET_LUFS with a true-peak ceiling. See sfx-normalize.lib.ts.
 *
 * Idempotent: `normalized.json` records each clip's normalized content hash, so re-running only touches new or
 * replaced clips. Flags: --dry (list what would change), --only a,b (just these file names, no extension).
 * `vo:approve` normalizes each card clip it approves, so this is only needed for the backlog or a re-tune.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FX_AUDIO_DIR, NORMALIZED_MANIFEST, clipHash, planNormalize, type NormalizedManifest } from './sfx-normalize.lib';
import { normalizeFile } from './sfx-normalize.run';

const args = process.argv.slice(2);
const flag = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const dry = args.includes('--dry');
const only = (flag('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = resolve(ROOT, FX_AUDIO_DIR);
const manifestPath = resolve(ROOT, NORMALIZED_MANIFEST);
const done: NormalizedManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

const files = readdirSync(dir)
  .filter((f) => f.startsWith('vo-') && f.endsWith('.mp3'))
  .map((f) => f.replace(/\.mp3$/, ''))
  .filter((n) => !only.length || only.includes(n))
  .map((name) => ({ name, hash: clipHash(readFileSync(resolve(dir, `${name}.mp3`))) }));
const todo = planNormalize(files, done);

console.log(`${todo.length} of ${files.length} card clip(s) to normalize.`);
if (dry || !todo.length) process.exit(0);

let n = 0;
for (const name of todo) {
  const r = normalizeFile(resolve(dir, `${name}.mp3`));
  if (r.skipped) { console.log(`  = ${name}: ${r.skipped}`); continue; }
  done[name] = r.hash;
  writeFileSync(manifestPath, JSON.stringify(Object.fromEntries(Object.entries(done).sort()), null, 2) + '\n');
  n++;
  console.log(`  ✓ ${name}  ${r.before} → ${r.after} LUFS`);
}
console.log(`\nNormalized ${n} clip(s). Restart \`npm run dev\` to hear them, then commit the mp3s and normalized.json.`);
