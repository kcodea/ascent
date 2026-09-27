/**
 * `npm run vo:design` — make new ElevenLabs voices from the text descriptions under `designs` in
 * packages/tools/vo-lines.json (the per-tribe cast). See docs/voiceover.md.
 *
 *   npm run vo:design -- [--dry] [--only key1,key2] [--redo]
 *       Ask Voice Design for previews of each design (a few voices per description). The samples land in
 *       vo-drafts/voices/<key>.preview<N>.mp3. Designs that already have previews are skipped unless --redo.
 *   npm run vo:design -- save <key> <N>
 *       Keep preview N: saves it as a permanent voice in the account and adds it to `voices` in vo-lines.json
 *       under <key>, so lines can use `"voice": "<key>"` straight away.
 *
 * Needs ELEVENLABS_API_KEY in the repo-root .env (gitignored) or the shell. Previews cost credits (the sample
 * text is billed like a line); saving a preview does not.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseEnvFile } from './bug-inbox.lib';
import {
  MANIFEST_PATH, ManifestSchema, VOICE_DRAFTS_DIR, designRequest, previewName, saveVoiceRequest, voiceFromDesign,
} from './vo.lib';

const args = process.argv.slice(2);
const has = (n: string): boolean => args.includes(`--${n}`);
const flag = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--only'));

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MANIFEST = resolve(ROOT, MANIFEST_PATH);
const VOICES = resolve(ROOT, VOICE_DRAFTS_DIR);
const raw = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const manifest = ManifestSchema.parse(raw);
const idsFile = (key: string): string => resolve(VOICES, `${key}.json`);

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY ?? parseEnvFile(resolve(ROOT, '.env')).ELEVENLABS_API_KEY;
  if (!key) {
    console.error('\nMissing ELEVENLABS_API_KEY. Add a line  ELEVENLABS_API_KEY=your_key  to the .env file at the repo ' +
      'root (it is gitignored), then re-run.');
    process.exit(1);
  }
  return key;
}

if (positional[0] === 'save') {
  const [, key, nArg] = positional;
  const design = manifest.designs.find((d) => d.key === key);
  if (!design || !nArg) { console.error('Usage: npm run vo:design -- save <key> <preview-number>'); process.exit(1); }
  if (manifest.voices[design.key]) {
    console.error(`REFUSED: "${design.key}" is already a voice in ${MANIFEST_PATH}. Remove it by hand first to replace it.`);
    process.exit(1);
  }
  if (!existsSync(idsFile(design.key))) { console.error(`No previews for "${key}" — run npm run vo:design first.`); process.exit(1); }
  const ids: string[] = JSON.parse(readFileSync(idsFile(design.key), 'utf8')).generatedVoiceIds;
  const generated = ids[Number(nArg) - 1];
  if (!generated) { console.error(`"${key}" has previews 1–${ids.length}.`); process.exit(1); }
  const { url, init } = saveVoiceRequest(design, generated, apiKey());
  const res = await fetch(url, init);
  if (!res.ok) { console.error(`✗ HTTP ${res.status} ${(await res.text()).slice(0, 300)}`); process.exit(1); }
  const { voice_id: voiceId } = (await res.json()) as { voice_id: string };
  raw.voices[design.key] = voiceFromDesign(design, voiceId);
  writeFileSync(MANIFEST, JSON.stringify(raw, null, 2) + '\n');
  console.log(`Saved "${design.name}" as voice ${voiceId} → added to ${MANIFEST_PATH} as "${design.key}".`);
  console.log('Lines can now use  "voice": "' + design.key + '"  and npm run vo:generate.');
  process.exit(0);
}

const only = (flag('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
for (const k of only) {
  if (!manifest.designs.some((d) => d.key === k)) { console.error(`No design "${k}" in ${MANIFEST_PATH}.`); process.exit(1); }
}
const todo = manifest.designs.filter((d) => (!only.length || only.includes(d.key)) && !manifest.voices[d.key]
  && (has('redo') || !existsSync(idsFile(d.key))));

console.log(`\n${todo.length} design(s) to preview.`);
for (const d of todo) console.log(`  ${d.key}  "${d.description.slice(0, 90)}${d.description.length > 90 ? '…' : ''}"`);
if (!todo.length) { console.log('Nothing to do. (Saved voices and designs with previews are skipped; --redo to re-roll.)'); process.exit(0); }
if (has('dry')) { console.log('\nDRY RUN — nothing sent to ElevenLabs.'); process.exit(0); }

const key = apiKey();
mkdirSync(VOICES, { recursive: true });
let failed = 0;
for (const d of todo) {
  const { url, init } = designRequest(d, key);
  const res = await fetch(url, init);
  if (!res.ok) { console.error(`  ✗ ${d.key}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`); failed++; continue; }
  const body = (await res.json()) as { previews: { audio_base_64: string; generated_voice_id: string }[]; text: string };
  body.previews.forEach((p, i) => writeFileSync(resolve(VOICES, previewName(d.key, i + 1)), Buffer.from(p.audio_base_64, 'base64')));
  writeFileSync(idsFile(d.key), JSON.stringify({ generatedVoiceIds: body.previews.map((p) => p.generated_voice_id), text: body.text }, null, 2) + '\n');
  console.log(`  ✓ ${d.key}: ${body.previews.length} previews in ${VOICE_DRAFTS_DIR}/`);
}
console.log(`\nDone${failed ? ` with ${failed} failure(s)` : ''}. Listen, then keep one:  npm run vo:design -- save <key> <N>`);
if (failed) process.exit(1);
