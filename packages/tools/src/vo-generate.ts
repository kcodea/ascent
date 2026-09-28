/**
 * `npm run vo:generate` — turn the lines AND sound effects in packages/tools/vo-lines.json into mp3 takes via
 * ElevenLabs, written to the untracked vo-drafts/ folder (never into the game). Clips already generated with the
 * same text/prompt/voice are skipped, so re-running costs nothing. See docs/voiceover.md.
 *
 * Flags: --dry (print the plan + cost, call nothing), --takes N (takes per new/changed clip, default 1),
 * --more N (N extra takes for clips already generated), --only id1,id2 (just these clips),
 * --lines / --sfx (just one kind).
 * Needs ELEVENLABS_API_KEY in the repo-root .env (gitignored) or the shell.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseEnvFile } from './bug-inbox.lib';
import {
  DRAFTS_DIR, MANIFEST_PATH, ManifestSchema, STATE_FILE, clipFile, clipHash, clipRequest, clipText, clipsOf, draftName,
  planCost, planGenerate, type Clip, type DraftState,
} from './vo.lib';

const args = process.argv.slice(2);
const has = (n: string): boolean => args.includes(`--${n}`);
const flag = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const dry = has('dry');
const takes = Number(flag('takes') ?? 1);
const more = Number(flag('more') ?? 0);
const only = (flag('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const kind: Clip['kind'] | undefined = has('lines') ? 'line' : has('sfx') ? 'sfx' : undefined;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DRAFTS = resolve(ROOT, DRAFTS_DIR);
const STATE = resolve(DRAFTS, STATE_FILE);

const manifest = ManifestSchema.parse(JSON.parse(readFileSync(resolve(ROOT, MANIFEST_PATH), 'utf8')));
const state: DraftState = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const shipped = (c: Clip): boolean => existsSync(resolve(ROOT, clipFile(c)));
const all = clipsOf(manifest);

for (const id of only) {
  if (!all.some((c) => c.id === id)) { console.error(`No line or sfx "${id}" in ${MANIFEST_PATH}.`); process.exit(1); }
}

const plan = planGenerate(manifest, state, shipped, { takes, more, only, kind });
const cost = planCost(plan);
const skippedShipped = all.filter((c) => (!kind || c.kind === kind) && (!only.length || only.includes(c.id)) && shipped(c)).length;

console.log(`\n${plan.length} clip(s) to generate, ${plan.reduce((n, p) => n + p.takes.length, 0)} take(s).` +
  (skippedShipped ? `  ${skippedShipped} already in the game, skipped.` : ''));
if (cost.characters) console.log(`  Voice lines: ${cost.characters} characters (≈ credits).`);
if (cost.sfxTakes) {
  console.log(`  Sound effects: ${cost.sfxTakes} generation(s), ${cost.sfxSeconds.toFixed(1)} s of audio` +
    (cost.sfxAuto ? ` + ${cost.sfxAuto} with no set length (billed at a flat rate each)` : '') +
    '. Sound effects are billed per second generated; check the ElevenLabs usage page for the current rate.');
}
for (const p of plan) {
  console.log(`  ${p.clip.kind === 'sfx' ? '♪' : '“'} ${p.clip.id}  [${p.reason}] take ${p.takes.join(', ')}  "${clipText(p.clip)}"`);
}
if (!plan.length) { console.log('Nothing to do — every clip is up to date. (Use --more N for extra takes.)'); process.exit(0); }
if (dry) { console.log('\nDRY RUN — nothing sent to ElevenLabs.'); process.exit(0); }

const apiKey = process.env.ELEVENLABS_API_KEY ?? parseEnvFile(resolve(ROOT, '.env')).ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('\nMissing ELEVENLABS_API_KEY. Add a line  ELEVENLABS_API_KEY=your_key  to the .env file at the repo root ' +
    '(it is gitignored), then re-run.');
  process.exit(1);
}

mkdirSync(DRAFTS, { recursive: true });
let failed = 0;
for (const p of plan) {
  const hash = clipHash(p.clip);
  if (p.reason !== 'more') state[p.clip.id] = { hash, takes: 0 };
  for (const take of p.takes) {
    const { url, init } = clipRequest(p.clip, apiKey);
    const res = await fetch(url, init);
    if (!res.ok) {
      console.error(`  ✗ ${p.clip.id} take ${take}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
      failed++;
      break;
    }
    writeFileSync(resolve(DRAFTS, draftName(p.clip.id, take)), Buffer.from(await res.arrayBuffer()));
    state[p.clip.id] = { hash, takes: take };
    writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n'); // save after every take: a crash never re-bills
    console.log(`  ✓ ${DRAFTS_DIR}/${draftName(p.clip.id, take)}`);
  }
}

console.log(`\nDone${failed ? ` with ${failed} failure(s)` : ''}. Listen in ${DRAFTS_DIR}/, then approve a take:` +
  `\n  npm run vo:approve -- <clip-id> <take>`);
if (failed) process.exit(1);
