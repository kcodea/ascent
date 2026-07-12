/**
 * `npm run sfx:import` — move recorded clips from audio-inbox/ into packages/ui/src/audio/ at their exact
 * target names. Confident matches move; ambiguous ones stay put and are reported. Flags: --dry (preview),
 * --keep (copy not move), --force (overwrite existing), --no-manifest (skip the status refresh),
 * --inbox <dir> (override the drop folder).
 */
import { readdirSync, existsSync, mkdirSync, writeFileSync, renameSync, copyFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { NEUTRAL, BEASTS, DRAGONS, UNDEAD, MECHS, DEMONS, TOKENS, SPELLS } from '@game/content';
import { HEROES } from '@game/sim';
import { buildIndex, matchFile, type MatchCard, type MatchHero } from './sfx-import.lib';

const args = process.argv.slice(2);
const has = (n: string): boolean => args.includes(`--${n}`);
const flag = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const dry = has('dry'), keep = has('keep'), force = has('force'), noManifest = has('no-manifest');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const INBOX = resolve(ROOT, flag('inbox') ?? 'audio-inbox');
const AUDIO = resolve(ROOT, 'packages/ui/src/audio');

if (!existsSync(INBOX)) {
  mkdirSync(INBOX, { recursive: true });
  writeFileSync(resolve(INBOX, 'README.txt'),
    'Drop recorded .mp3 clips here, named by card/hero name (or id) + a variant word:\n' +
    '  Pennycat death.mp3   warden power.mp3   alley effect.mp3   Yirin.mp3\n' +
    'Then run:  npm run sfx:import\n');
  console.log(`Created ${INBOX} — drop your .mp3 clips there, then re-run \`npm run sfx:import\`.`);
  process.exit(0);
}

const cards = [...NEUTRAL, ...BEASTS, ...DRAGONS, ...UNDEAD, ...MECHS, ...DEMONS, ...TOKENS, ...SPELLS] as unknown as MatchCard[];
const index = buildIndex(cards, HEROES as unknown as MatchHero[]);

const entries = readdirSync(INBOX).filter((f) => !f.startsWith('.') && f !== 'README.txt');
const moved: string[] = [], skipped: string[] = [], unmatched: string[] = [];

for (const f of entries) {
  if (!f.toLowerCase().endsWith('.mp3')) { skipped.push(`${f}  — not an .mp3 (export as mp3)`); continue; }
  const r = matchFile(f, index);
  if (!r.ok) { unmatched.push(`${f}  — ${r.reason}${r.suggestions.length ? `  (did you mean: ${r.suggestions.join(', ')}?)` : ''}`); continue; }
  const dest = resolve(AUDIO, r.target);
  if (existsSync(dest) && !force) { skipped.push(`${f}  — ${r.target} already exists (use --force to overwrite)`); continue; }
  if (!dry) {
    mkdirSync(dirname(dest), { recursive: true });
    const src = resolve(INBOX, f);
    if (keep) copyFileSync(src, dest);
    else { try { renameSync(src, dest); } catch { copyFileSync(src, dest); rmSync(src); } } // cross-device fallback
  }
  moved.push(`${f}  →  ${r.target}${r.confidence === 'fuzzy' ? '  (fuzzy)' : ''}`);
}

const head = dry ? 'DRY RUN — nothing moved' : keep ? 'Imported (copied)' : 'Imported';
console.log(`\n${head}: ${moved.length} · skipped: ${skipped.length} · unmatched: ${unmatched.length}\n`);
if (moved.length) console.log(`  ${dry ? 'would move' : 'moved'}:\n` + moved.map((s) => '    ' + s).join('\n'));
if (skipped.length) console.log(`\n  skipped:\n` + skipped.map((s) => '    ' + s).join('\n'));
if (unmatched.length) console.log(`\n  left in inbox (rename & re-run):\n` + unmatched.map((s) => '    ' + s).join('\n'));

if (moved.length && !dry && !noManifest) {
  // cast to string so tsc doesn't statically resolve the specifier — the generator only exists on another branch
  try { await import('./sfx-manifest.ts' as string); } // regenerate statuses if the generator is present on this branch
  catch { console.log('\nNext: run `npm run sfx:manifest` to refresh the manifest statuses.'); }
} else if (!dry && moved.length) {
  console.log('\nNext: run `npm run sfx:manifest` to refresh the manifest statuses.');
}
