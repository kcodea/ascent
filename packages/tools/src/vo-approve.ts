/**
 * `npm run vo:approve -- <clip-id> [take]` — copy one generated take from vo-drafts/ into the game under the clip's
 * id (e.g. apps/web/public/announcer/triple-3.mp3, or packages/ui/src/audio/cards/dw_orin.death.mp3). REFUSES to
 * overwrite an existing file, so a recorded clip can never be replaced by accident — delete the old file by hand
 * first if you really mean to replace it. See docs/voiceover.md.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CARD_AUDIO_DIR, DRAFTS_DIR, MANIFEST_PATH, ManifestSchema, clipDest, clipsOf, draftName } from './vo.lib';

const [id, takeArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

if (!id) { console.error('Usage: npm run vo:approve -- <clip-id> [take]   (take defaults to 1)'); process.exit(1); }
const take = Number(takeArg ?? 1);

const manifest = ManifestSchema.parse(JSON.parse(readFileSync(resolve(ROOT, MANIFEST_PATH), 'utf8')));
const clip = clipsOf(manifest).find((c) => c.id === id);
if (!clip) { console.error(`No line or sfx "${id}" in ${MANIFEST_PATH}.`); process.exit(1); }

const src = resolve(ROOT, DRAFTS_DIR, draftName(id, take));
const destDir = clipDest(clip);
const destRel = `${destDir}/${id}.mp3`;
const dest = resolve(ROOT, destRel);
if (!existsSync(src)) { console.error(`No draft ${DRAFTS_DIR}/${draftName(id, take)} — run npm run vo:generate first.`); process.exit(1); }
if (existsSync(dest)) {
  console.error(`REFUSED: ${destRel} already exists. Existing clips are never overwritten — pick a new id, ` +
    'or delete the old file by hand if you really mean to replace it.');
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`Approved: ${DRAFTS_DIR}/${draftName(id, take)}  →  ${destRel}`);
if (destDir === CARD_AUDIO_DIR) {
  console.log('No wiring needed: the game plays audio/cards/<cardId>.mp3 when the card is played, .death.mp3 when it ' +
    'dies and .effect.mp3 when its effect fires. Restart `npm run dev` to hear it, run `npm run sfx:manifest`, and ' +
    'commit the mp3.');
} else {
  console.log(`Next: add '${id}' to the right event in the game's line list (the announcer's is ANNOUNCER_LINES in ` +
    'packages/ui/src/announcer.ts), then commit the mp3 with that change.');
}
