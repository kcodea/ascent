/**
 * `npm run vo:approve -- <clip-id> [take]` — copy one generated take from vo-drafts/ into the game. See
 * docs/voiceover.md.
 *
 * - An announcer (or other folder) clip lands in its `dest` folder under its id, e.g.
 *   apps/web/public/announcer/triple-3.mp3.
 * - A CARD clip (`dest: "card"`) is bound to that card's slot in the FX workbench's "By card" view, exactly as the
 *   workbench's own import does: the mp3 lands in audio/fx/vo-<card>[-death].mp3, a one-layer Sound def in
 *   fx/defs/sfx-vo-<card>[-death].json, and the binding in choreo/bindings.json (`<cardId>` = On Play,
 *   `<cardId>.death` = On Death). It then shows, plays and can be re-tuned (volume, swap) in that view.
 *
 * REFUSES to overwrite an existing file, or a slot the workbench already bound to another sound, so nothing chosen
 * by hand is ever replaced by accident.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CARD_INDEX } from '@game/content';
import {
  BINDINGS_PATH, CARD_DEST, DRAFTS_DIR, FX_DEFS_DIR, MANIFEST_PATH, ManifestSchema, bindCardSlot, cardSlot, clipDest,
  clipFile, clipsOf, draftName, soundDef, type Bindings,
} from './vo.lib';

const [id, takeArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fail = (msg: string): never => { console.error(msg); process.exit(1); };

if (!id) fail('Usage: npm run vo:approve -- <clip-id> [take]   (take defaults to 1)');
const take = Number(takeArg ?? 1);

const manifest = ManifestSchema.parse(JSON.parse(readFileSync(resolve(ROOT, MANIFEST_PATH), 'utf8')));
const clip = clipsOf(manifest).find((c) => c.id === id) ?? fail(`No line or sfx "${id}" in ${MANIFEST_PATH}.`);

const src = resolve(ROOT, DRAFTS_DIR, draftName(id!, take));
if (!existsSync(src)) fail(`No draft ${DRAFTS_DIR}/${draftName(id!, take)} — run npm run vo:generate first.`);
const destRel = clipFile(clip);
const dest = resolve(ROOT, destRel);
if (existsSync(dest)) {
  fail(`REFUSED: ${destRel} already exists. Existing clips are never overwritten — pick a new id, ` +
    'or delete the old file by hand if you really mean to replace it.');
}

if (clipDest(clip) !== CARD_DEST) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`Approved: ${DRAFTS_DIR}/${draftName(id!, take)}  →  ${destRel}`);
  console.log(`Next: add '${id}' to the right event in the game's line list (the announcer's is ANNOUNCER_LINES in ` +
    'packages/ui/src/announcer.ts), then commit the mp3 with that change.');
  process.exit(0);
}

// ── A card clip: file + Sound def + By-card binding. ──
const slotOf = cardSlot(id!);
const card = CARD_INDEX[slotOf.cardId] ?? fail(`No card "${slotOf.cardId}" (clip "${id}").`);
const slot = cardSlot(id!, card.spell === true);
if (slot.kind === 'death' && card.spell) fail(`"${card.name}" is a spell: spells have no On Death slot.`);
const defRel = `${FX_DEFS_DIR}/${slot.defId}.json`;
if (existsSync(resolve(ROOT, defRel))) fail(`REFUSED: ${defRel} already exists.`);
const bindingsFile = resolve(ROOT, BINDINGS_PATH);
const bound = bindCardSlot(JSON.parse(readFileSync(bindingsFile, 'utf8')) as Bindings, slot);
if (bound.status === 'taken') {
  fail(`REFUSED: ${card.name}'s ${slot.kind === 'death' ? 'On Death' : 'On Play'} slot is already bound to ` +
    `"${bound.existing}" in the workbench. Clear it there first if this clip should replace it.`);
}

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
writeFileSync(resolve(ROOT, defRel), JSON.stringify(soundDef(slot), null, 2) + '\n');
if (bound.status === 'added') writeFileSync(bindingsFile, JSON.stringify(bound.bindings, null, 2) + '\n');
console.log(`Approved: ${DRAFTS_DIR}/${draftName(id!, take)}  →  ${destRel}`);
console.log(`  bound to ${card.name} → ${slot.kind === 'death' ? 'On Death' : 'On Play'} (${defRel}) — see it in the ` +
  'FX workbench\'s "By card" view. Restart `npm run dev` to hear it, then commit the mp3, the def and bindings.json.');
