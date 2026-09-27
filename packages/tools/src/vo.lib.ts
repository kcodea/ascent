/**
 * Voiceover + sound-effect generator (ElevenLabs) — the pure half. `vo-generate.ts`, `vo-approve.ts` and
 * `vo-design.ts` are the CLIs; see docs/voiceover.md.
 *
 * The flow NEVER touches the shipped clips directly: `vo:generate` writes takes into the untracked `vo-drafts/`
 * folder, and `vo:approve` copies ONE chosen take into the clip's `dest` folder under the clip's id — refusing to
 * overwrite any file already there, so a recorded clip can never be replaced by accident.
 *
 * Two kinds of clip share that flow: a spoken LINE (text-to-speech in one of the `voices`) and a SOUND EFFECT
 * (`sfx`: a text prompt → a growl, grunt, clank…). `designs` are voice descriptions that `vo:design` turns into
 * new ElevenLabs voices (the per-tribe cast).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const DRAFTS_DIR = 'vo-drafts';
export const VOICE_DRAFTS_DIR = 'vo-drafts/voices';
export const STATE_FILE = 'state.json';
export const MANIFEST_PATH = 'packages/tools/vo-lines.json';
/** Where a card's clips go: the game plays `cards/<cardId>.mp3` / `.death.mp3` / `.effect.mp3` with no wiring. */
export const CARD_AUDIO_DIR = 'packages/ui/src/audio/cards';

/** A clip id is its final file name (no extension): kebab-case announcer ids, or card ids like `dw_orin.death`. */
const FILE_ID = z.string().regex(/^[a-z0-9]+([._-][a-z0-9]+)*$/, 'ids are lowercase file names, e.g. triple-3 or dw_orin.death');

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
  id: FILE_ID,
  voice: z.string().min(1),
  text: z.string().min(1),
  /** Overrides the voice's `dest` (e.g. a cast voice speaking a card line into audio/cards). */
  dest: z.string().min(1).optional(),
});

const SfxSchema = z.object({
  /** The final file name (no extension), e.g. `dw_brakka` (played) or `dw_brakka.death`. */
  id: FILE_ID,
  /** What the sound is, in words: "heavy dwarf warrior roar, single short vocal sound, no words". */
  prompt: z.string().min(1),
  /** Repo-relative folder an approved take is copied into. */
  dest: z.string().min(1),
  /** Seconds, 0.5–30; omitted → ElevenLabs picks a length from the prompt. */
  duration: z.number().min(0.5).max(30).optional(),
  /** 0–1: how literally to follow the prompt (ElevenLabs default 0.3). Higher = closer, less varied. */
  influence: z.number().min(0).max(1).optional(),
});

const DesignSchema = z.object({
  /** The voice key this becomes under `voices` once saved, e.g. `dwarf-oldguard`. */
  key: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'design keys are kebab-case, e.g. dwarf-oldguard'),
  /** Display name for the saved voice in ElevenLabs. */
  name: z.string().min(1),
  /** The Voice Design prompt (ElevenLabs allows 20–1000 characters). */
  description: z.string().min(20).max(1000),
  /** What the previews say (100–1000 characters); omitted → ElevenLabs writes a sample for the description. */
  text: z.string().min(100).max(1000).optional(),
  /** The saved voice's `dest` (defaults to the card audio folder). */
  dest: z.string().min(1).default(CARD_AUDIO_DIR),
  /** TTS model the saved voice speaks with. */
  model: z.string().min(1).default('eleven_multilingual_v2'),
});

export const ManifestSchema = z.object({
  voices: z.record(VoiceSchema),
  lines: z.array(LineSchema),
  sfx: z.array(SfxSchema).default([]),
  designs: z.array(DesignSchema).default([]),
}).superRefine((m, ctx) => {
  // Line and sfx takes share vo-drafts/, so an id is unique across both.
  const seen = new Set<string>();
  for (const c of [...m.lines, ...m.sfx]) {
    if (seen.has(c.id)) ctx.addIssue({ code: 'custom', message: `duplicate clip id "${c.id}"` });
    seen.add(c.id);
  }
  for (const l of m.lines) {
    if (!m.voices[l.voice]) ctx.addIssue({ code: 'custom', message: `line "${l.id}" uses unknown voice "${l.voice}"` });
  }
  const keys = new Set<string>();
  for (const d of m.designs) {
    if (keys.has(d.key)) ctx.addIssue({ code: 'custom', message: `duplicate design key "${d.key}"` });
    keys.add(d.key);
  }
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestInput = z.input<typeof ManifestSchema>;
export type VoLine = Manifest['lines'][number];
export type Voice = Manifest['voices'][string];
export type SfxClip = Manifest['sfx'][number];
export type VoiceDesign = Manifest['designs'][number];

/** One thing the generator can make: a spoken line or a sound effect. */
export type Clip =
  | { kind: 'line'; id: string; line: VoLine; voice: Voice }
  | { kind: 'sfx'; id: string; sfx: SfxClip };

export function clipsOf(m: Manifest): Clip[] {
  return [
    ...m.lines.map((line): Clip => ({ kind: 'line', id: line.id, line, voice: m.voices[line.voice]! })),
    ...m.sfx.map((sfx): Clip => ({ kind: 'sfx', id: sfx.id, sfx })),
  ];
}

/** Repo-relative folder the clip's approved take lands in. */
export function clipDest(c: Clip): string {
  return c.kind === 'line' ? c.line.dest ?? c.voice.dest : c.sfx.dest;
}

/** What the clip says or is, for printing. */
export function clipText(c: Clip): string {
  return c.kind === 'line' ? c.line.text : c.sfx.prompt;
}

/** What vo-drafts/state.json remembers per clip: the hash of what was generated, and how many takes exist. */
export type DraftState = Record<string, { hash: string; takes: number }>;

/** Changes whenever anything that affects the audio changes (text, voice, model, settings). */
export function lineHash(line: VoLine, voice: Voice): string {
  const key = JSON.stringify([line.text, voice.id, voice.model, voice.settings ?? null]);
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** Changes whenever anything that affects the sound changes (prompt, length, influence). */
export function sfxHash(sfx: SfxClip): string {
  const key = JSON.stringify(['sfx', sfx.prompt, sfx.duration ?? null, sfx.influence ?? null]);
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function clipHash(c: Clip): string {
  return c.kind === 'line' ? lineHash(c.line, c.voice) : sfxHash(c.sfx);
}

export function draftName(id: string, take: number): string {
  return `${id}.take${take}.mp3`;
}

export interface PlanItem {
  clip: Clip;
  /** Take numbers to generate (1-based). */
  takes: number[];
  reason: 'new' | 'changed' | 'more';
}

export interface PlanOptions {
  /** Takes to make for a new or changed clip. */
  takes: number;
  /** Add this many extra takes to clips that are already up to date. */
  more: number;
  /** Restrict to these ids (empty = all). */
  only: string[];
  /** Restrict to one kind (undefined = both). */
  kind?: Clip['kind'];
}

/**
 * Which clips need API calls. Up-to-date clips are skipped (no credits spent) unless `more` asks for extra takes;
 * a clip whose text/prompt/voice changed starts over from take 1. Clips that already shipped (their final file
 * exists in `dest`) are skipped entirely — the generator never re-bills a clip that is done.
 */
export function planGenerate(m: Manifest, state: DraftState, shipped: (c: Clip) => boolean, o: PlanOptions): PlanItem[] {
  const out: PlanItem[] = [];
  for (const clip of clipsOf(m)) {
    if (o.kind && clip.kind !== o.kind) continue;
    if (o.only.length && !o.only.includes(clip.id)) continue;
    if (shipped(clip)) continue;
    const prev = state[clip.id];
    const hash = clipHash(clip);
    if (!prev) out.push({ clip, takes: range(1, o.takes), reason: 'new' });
    else if (prev.hash !== hash) out.push({ clip, takes: range(1, o.takes), reason: 'changed' });
    else if (o.more > 0) out.push({ clip, takes: range(prev.takes + 1, o.more), reason: 'more' });
  }
  return out;
}

export interface PlanCost {
  /** Text-to-speech characters (billed per character, per take). */
  characters: number;
  /** Sound-effect generations. */
  sfxTakes: number;
  /** Seconds of sound effect requested (auto-length takes are not counted here). */
  sfxSeconds: number;
  /** Sound-effect takes with no set duration (ElevenLabs bills these at a flat per-generation rate). */
  sfxAuto: number;
}

/** What the plan will bill. Sound effects are billed by generated length, so a short `duration` keeps them cheap. */
export function planCost(plan: PlanItem[]): PlanCost {
  const cost: PlanCost = { characters: 0, sfxTakes: 0, sfxSeconds: 0, sfxAuto: 0 };
  for (const p of plan) {
    const n = p.takes.length;
    if (p.clip.kind === 'line') { cost.characters += p.clip.line.text.length * n; continue; }
    cost.sfxTakes += n;
    if (p.clip.sfx.duration == null) cost.sfxAuto += n;
    else cost.sfxSeconds += p.clip.sfx.duration * n;
  }
  return cost;
}

function range(from: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => from + i);
}

export interface ApiRequest { url: string; init: RequestInit }

const API = 'https://api.elevenlabs.io/v1';
const json = (apiKey: string, accept = 'application/json'): Record<string, string> =>
  ({ 'xi-api-key': apiKey, 'content-type': 'application/json', accept });

/** The ElevenLabs text-to-speech request for one take. */
export function ttsRequest(line: VoLine, voice: Voice, apiKey: string): ApiRequest {
  const body: Record<string, unknown> = { text: line.text, model_id: voice.model };
  if (voice.settings) body.voice_settings = voice.settings;
  return {
    url: `${API}/text-to-speech/${encodeURIComponent(voice.id)}?output_format=mp3_44100_128`,
    init: { method: 'POST', headers: json(apiKey, 'audio/mpeg'), body: JSON.stringify(body) },
  };
}

/** The ElevenLabs sound-effect request for one take. */
export function sfxRequest(sfx: SfxClip, apiKey: string): ApiRequest {
  const body: Record<string, unknown> = { text: sfx.prompt, model_id: 'eleven_text_to_sound_v2' };
  if (sfx.duration != null) body.duration_seconds = sfx.duration;
  if (sfx.influence != null) body.prompt_influence = sfx.influence;
  return {
    url: `${API}/sound-generation?output_format=mp3_44100_128`,
    init: { method: 'POST', headers: json(apiKey, 'audio/mpeg'), body: JSON.stringify(body) },
  };
}

/** The request for one take of either kind. */
export function clipRequest(c: Clip, apiKey: string): ApiRequest {
  return c.kind === 'line' ? ttsRequest(c.line, c.voice, apiKey) : sfxRequest(c.sfx, apiKey);
}

/** Voice Design: a description → a few preview voices (each a `generated_voice_id` + a base64 mp3 sample). */
export function designRequest(d: VoiceDesign, apiKey: string): ApiRequest {
  const body: Record<string, unknown> = { voice_description: d.description };
  if (d.text) body.text = d.text;
  else body.auto_generate_text = true;
  return {
    url: `${API}/text-to-voice/design?output_format=mp3_44100_128`,
    init: { method: 'POST', headers: json(apiKey), body: JSON.stringify(body) },
  };
}

/** Save one Voice Design preview as a permanent voice in the account (it then has a normal voice ID). */
export function saveVoiceRequest(d: VoiceDesign, generatedVoiceId: string, apiKey: string): ApiRequest {
  return {
    url: `${API}/text-to-voice`,
    init: {
      method: 'POST',
      headers: json(apiKey),
      body: JSON.stringify({ voice_name: d.name, voice_description: d.description, generated_voice_id: generatedVoiceId }),
    },
  };
}

/** The `voices` entry a saved design becomes. */
export function voiceFromDesign(d: VoiceDesign, voiceId: string): Voice {
  return { id: voiceId, model: d.model, dest: d.dest };
}

/** The file a design's preview N is written to, under vo-drafts/voices/. */
export function previewName(key: string, n: number): string {
  return `${key}.preview${n}.mp3`;
}
