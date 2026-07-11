/**
 * `npm run sfx:manifest` — regenerate the Filename/Trigger rows of docs/audio/sfx-manifest.md from the real
 * card/hero/spell data, preserving the human-authored Creative brief + Status columns. Only the zone below
 * GEN_MARKER is rewritten; the hand-authored prose above it is left byte-for-byte untouched.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { NEUTRAL, BEASTS, DRAGONS, UNDEAD, MECHS, DEMONS, TOKENS, SPELLS } from '@game/content';
import { HEROES } from '@game/sim';
import {
  deriveRows, mergeRows, parseExistingTables, renderGeneratedZone, GEN_MARKER,
  type ManifestCard, type ManifestHero, type SfxRow,
} from './sfx-manifest.lib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DOC = resolve(ROOT, 'docs/audio/sfx-manifest.md');
const AUDIO = resolve(ROOT, 'packages/ui/src/audio');

// Cards: every tribe + tokens + all spells. Excludes ENEMY filler (not in these arrays).
const cards = [...NEUTRAL, ...BEASTS, ...DRAGONS, ...UNDEAD, ...MECHS, ...DEMONS, ...TOKENS, ...SPELLS] as unknown as ManifestCard[];

// System/UI clips = top-level audio/*.mp3 (the per-card clips live in audio/cards/, a subdir readdir skips).
// Exclude the spellcast bed — deriveRows emits its own row for it under Spells.
const systemFiles = readdirSync(AUDIO).filter((f) => f.endsWith('.mp3') && f !== 'spellcast.mp3').sort();

const fresh = deriveRows(cards, HEROES as unknown as ManifestHero[], systemFiles);
const existingDoc = existsSync(DOC) ? readFileSync(DOC, 'utf8') : '';
const merged: SfxRow[] = mergeRows(fresh, parseExistingTables(existingDoc));

// Disk status flip: a still-to-record row whose mp3 now exists in the tree → mark recorded (🎙️).
for (const r of merged) {
  if (r.status === '⬜' && existsSync(resolve(AUDIO, r.filename))) r.status = '🎙️';
}

const marker = existingDoc.indexOf(GEN_MARKER);
if (marker === -1) {
  throw new Error(`sfx-manifest: marker not found in ${DOC}. The prose zone (Task 1) must exist first.`);
}
const prose = existingDoc.slice(0, marker + GEN_MARKER.length);
writeFileSync(DOC, `${prose}\n\n${renderGeneratedZone(merged)}\n`);

const sections = new Set(merged.map((r) => r.section)).size;
const todo = merged.filter((r) => r.status === '⬜').length;
console.log(`sfx-manifest: ${merged.length} rows across ${sections} sections (${todo} still to record) → ${DOC}`);
