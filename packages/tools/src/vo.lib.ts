/**
 * Voiceover generator (ElevenLabs text-to-speech) — the pure half. `vo-generate.ts` and `vo-approve.ts` are the
 * CLIs; see docs/voiceover.md.
 *
 * The flow NEVER touches the shipped clips directly: `vo:generate` writes takes into the untracked `vo-drafts/`
 * folder, and `vo:approve` copies ONE chosen take into the voice's `dest` folder under the line's id — refusing to
 * overwrite any file already there, so a recorded clip can never be replaced by accident.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const DRAFTS_DIR = 'vo-drafts';
export const STATE_FILE = 'state.json';
export const MANIFEST_PATH = 'packages/tools/vo-lines.json';

const VoiceSchema = z.object({
  /** ElevenLabs voice ID (not secret). */
  id: z.string().min(1),
  /** ElevenLabs model, e.g. eleven_multilingual_v2. */
  model: z.string().min(1),
  /** Repo-relative folder an approved take is copied into. */
  dest: z.string().min(1),
  /** Optional overrides; omitted → the voice's own saved settings in ElevenLabs. */
  settings: z.object({
    stability: z.number().min(0).max(1).optional(),
    similarity_boost: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
    use_speaker_boost: z.boolean().optional(),
    speed: z.number().optional(),
  }).optional(),
});

const LineSchema = z.object({
  /** The final file name (no extension) — also the name that goes into e.g. ANNOUNCER_LINES. */
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'ids are kebab-case, e.g. triple-3'),
  voice: z.string().min(1),
  text: z.string().min(1),
});

export const ManifestSchema = z.object({
  voices: z.record(VoiceSchema),
  lines: z.array(LineSchema),
}).superRefine((m, ctx) => {
  const seen = new Set<string>();
  for (const l of m.lines) {
    if (seen.has(l.id)) ctx.addIssue({ code: 'custom', message: `duplicate line id "${l.id}"` });
    seen.add(l.id);
    if (!m.voices[l.voice]) ctx.addIssue({ code: 'custom', message: `line "${l.id}" uses unknown voice "${l.voice}"` });
  }
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type VoLine = Manifest['lines'][number];
export type Voice = Manifest['voices'][string];

/** What vo-drafts/state.json remembers per line: the hash of what was generated, and how many takes exist. */
export type DraftState = Record<string, { hash: string; takes: number }>;

/** Changes whenever anything that affects the audio changes (text, voice, model, settings). */
export function lineHash(line: VoLine, voice: Voice): string {
  const key = JSON.stringify([line.text, voice.id, voice.model, voice.settings ?? null]);
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function draftName(id: string, take: number): string {
  return `${id}.take${take}.mp3`;
}

export interface PlanItem {
  line: VoLine;
  /** Take numbers to generate (1-based). */
  takes: number[];
  reason: 'new' | 'changed' | 'more';
}

export interface PlanOptions {
  /** Takes to make for a new or changed line. */
  takes: number;
  /** Add this many extra takes to lines that are already up to date. */
  more: number;
  /** Restrict to these ids (empty = all). */
  only: string[];
}

/**
 * Which lines need API calls. Up-to-date lines are skipped (no credits spent) unless `more` asks for extra takes;
 * a line whose text/voice changed starts over from take 1. Lines that already shipped (their final file exists in
 * `dest`) are skipped entirely — the generator never re-bills a line that is done.
 */
export function planGenerate(m: Manifest, state: DraftState, shipped: (line: VoLine) => boolean, o: PlanOptions): PlanItem[] {
  const out: PlanItem[] = [];
  for (const line of m.lines) {
    if (o.only.length && !o.only.includes(line.id)) continue;
    if (shipped(line)) continue;
    const prev = state[line.id];
    const hash = lineHash(line, m.voices[line.voice]!);
    if (!prev) out.push({ line, takes: range(1, o.takes), reason: 'new' });
    else if (prev.hash !== hash) out.push({ line, takes: range(1, o.takes), reason: 'changed' });
    else if (o.more > 0) out.push({ line, takes: range(prev.takes + 1, o.more), reason: 'more' });
  }
  return out;
}

/** Characters the plan will bill (ElevenLabs charges per character, per take). */
export function planCharacters(plan: PlanItem[]): number {
  return plan.reduce((n, p) => n + p.line.text.length * p.takes.length, 0);
}

function range(from: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => from + i);
}

/** The ElevenLabs text-to-speech request for one take. */
export function ttsRequest(line: VoLine, voice: Voice, apiKey: string): { url: string; init: RequestInit } {
  const body: Record<string, unknown> = { text: line.text, model_id: voice.model };
  if (voice.settings) body.voice_settings = voice.settings;
  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.id)}?output_format=mp3_44100_128`,
    init: {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    },
  };
}
