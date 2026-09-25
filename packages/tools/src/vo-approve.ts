/**
 * `npm run vo:approve -- <line-id> [take]` — copy one generated take from vo-drafts/ into the game under the line's
 * id (e.g. apps/web/public/announcer/triple-3.mp3). REFUSES to overwrite an existing file, so a recorded clip can
 * never be replaced by accident — delete the old file by hand first if you really mean to replace it.
 * See docs/voiceover.md.
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DRAFTS_DIR, MANIFEST_PATH, ManifestSchema, draftName } from './vo.lib';

const [id, takeArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

if (!id) { console.error('Usage: npm run vo:approve -- <line-id> [take]   (take defaults to 1)'); process.exit(1); }
const take = Number(takeArg ?? 1);

const manifest = ManifestSchema.parse(JSON.parse(readFileSync(resolve(ROOT, MANIFEST_PATH), 'utf8')));
const line = manifest.lines.find((l) => l.id === id);
if (!line) { console.error(`No line "${id}" in ${MANIFEST_PATH}.`); process.exit(1); }

const src = resolve(ROOT, DRAFTS_DIR, draftName(id, take));
const destRel = `${manifest.voices[line.voice]!.dest}/${id}.mp3`;
const dest = resolve(ROOT, destRel);
if (!existsSync(src)) { console.error(`No draft ${DRAFTS_DIR}/${draftName(id, take)} — run npm run vo:generate first.`); process.exit(1); }
if (existsSync(dest)) {
  console.error(`REFUSED: ${destRel} already exists. Existing clips are never overwritten — pick a new line id, ` +
    'or delete the old file by hand if you really mean to replace it.');
  process.exit(1);
}

copyFileSync(src, dest);
console.log(`Approved: ${DRAFTS_DIR}/${draftName(id, take)}  →  ${destRel}`);
console.log(`Next: add '${id}' to the right event in the game's line list (the announcer's is ANNOUNCER_LINES in ` +
  'packages/ui/src/announcer.ts), then commit the mp3 with that change.');
