import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CARD_AUDIO_DIR, ManifestSchema, clipDest, clipsOf, designRequest, lineHash, planCost, planGenerate, saveVoiceRequest,
  sfxHash, sfxRequest, ttsRequest, voiceFromDesign, type Clip, type Manifest, type ManifestInput,
} from './vo.lib';

const voice = { id: 'VOICE', model: 'eleven_multilingual_v2', dest: 'apps/web/public/announcer' };
const manifest = (lines: Manifest['lines'], sfx: Manifest['sfx'] = []): Manifest =>
  ManifestSchema.parse({ voices: { announcer: voice }, lines, sfx });
const raw = (lines: ManifestInput['lines'], sfx: ManifestInput['sfx'] = []): ManifestInput =>
  ({ voices: { announcer: voice }, lines, sfx });
const a = { id: 'triple-3', voice: 'announcer', text: 'Triple!' };
const b = { id: 'tier-six-3', voice: 'announcer', text: 'Tier six!' };
const growl = { id: 'dw_brakka.death', prompt: 'dwarf roar, no words', dest: CARD_AUDIO_DIR, duration: 1 };
const none = (): boolean => false;
const opts = { takes: 1, more: 0, only: [] as string[] };
const ids = (plan: { clip: Clip }[]): string[] => plan.map((p) => p.clip.id);

describe('vo planGenerate', () => {
  it('generates new lines and skips up-to-date ones (no credits re-spent)', () => {
    const m = manifest([a, b]);
    const state = { [a.id]: { hash: lineHash(a, voice), takes: 2 } };
    const plan = planGenerate(m, state, none, opts);
    expect(plan.map((p) => [p.clip.id, p.reason, p.takes])).toEqual([['tier-six-3', 'new', [1]]]);
    expect(planCost(plan).characters).toBe('Tier six!'.length);
  });

  it('regenerates from take 1 when the text changes', () => {
    const state = { [a.id]: { hash: lineHash(a, voice), takes: 3 } };
    const plan = planGenerate(manifest([{ ...a, text: 'Triple, baby!' }]), state, none, { ...opts, takes: 2 });
    expect(plan[0]).toMatchObject({ reason: 'changed', takes: [1, 2] });
  });

  it('--more numbers extra takes after the existing ones', () => {
    const state = { [a.id]: { hash: lineHash(a, voice), takes: 2 } };
    expect(planGenerate(manifest([a]), state, none, { ...opts, more: 2 })[0]).toMatchObject({ reason: 'more', takes: [3, 4] });
  });

  it('never plans a clip whose final file already ships in the game', () => {
    expect(ids(planGenerate(manifest([a, b]), {}, (c) => c.id === a.id, opts))).toEqual(['tier-six-3']);
  });

  it('--only restricts the plan', () => {
    expect(ids(planGenerate(manifest([a, b]), {}, none, { ...opts, only: ['triple-3'] }))).toEqual(['triple-3']);
  });
});

describe('vo sound effects', () => {
  it('plans sfx beside lines, and --sfx / --lines pick one kind', () => {
    const m = manifest([a], [growl]);
    expect(ids(planGenerate(m, {}, none, opts))).toEqual(['triple-3', 'dw_brakka.death']);
    expect(ids(planGenerate(m, {}, none, { ...opts, kind: 'sfx' }))).toEqual(['dw_brakka.death']);
    expect(ids(planGenerate(m, {}, none, { ...opts, kind: 'line' }))).toEqual(['triple-3']);
  });

  it('skips an up-to-date sfx and regenerates when its prompt or length changes', () => {
    const state = { [growl.id]: { hash: sfxHash(growl), takes: 1 } };
    expect(planGenerate(manifest([], [growl]), state, none, opts)).toEqual([]);
    expect(planGenerate(manifest([], [{ ...growl, prompt: 'bigger roar' }]), state, none, opts)[0]?.reason).toBe('changed');
    expect(planGenerate(manifest([], [{ ...growl, duration: 2 }]), state, none, opts)[0]?.reason).toBe('changed');
  });

  it('costs sfx by seconds generated and counts auto-length takes apart', () => {
    const m = manifest([a], [growl, { id: 'dw_orin.death', prompt: 'grunt', dest: CARD_AUDIO_DIR }]);
    expect(planCost(planGenerate(m, {}, none, { ...opts, takes: 2 }))).toEqual({
      characters: 'Triple!'.length * 2, sfxTakes: 4, sfxSeconds: 2, sfxAuto: 2,
    });
  });

  it('a card clip lands where the game plays it; a line may override its voice folder', () => {
    const m = manifest([{ id: 'dw_orin', voice: 'announcer', text: 'Shield up.', dest: CARD_AUDIO_DIR }, a], [growl]);
    expect(clipsOf(m).map(clipDest)).toEqual([CARD_AUDIO_DIR, 'apps/web/public/announcer', CARD_AUDIO_DIR]);
  });

  it('builds the sound-generation request', () => {
    const { url, init } = sfxRequest({ ...growl, influence: 0.6 }, 'SECRET');
    expect(url).toBe('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('SECRET');
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'dwarf roar, no words', model_id: 'eleven_text_to_sound_v2', duration_seconds: 1, prompt_influence: 0.6,
    });
  });
});

describe('vo voice design', () => {
  const d = ManifestSchema.parse({
    voices: {}, lines: [],
    designs: [{ key: 'dwarf-oldguard', name: 'Dwarf Old Guard', description: 'A grizzled veteran dwarf soldier, deep and gravelly.' }],
  }).designs[0]!;

  it('defaults a design to the card folder and the v2 model', () => {
    expect(d).toMatchObject({ dest: CARD_AUDIO_DIR, model: 'eleven_multilingual_v2' });
    expect(voiceFromDesign(d, 'NEWID')).toEqual({ id: 'NEWID', model: 'eleven_multilingual_v2', dest: CARD_AUDIO_DIR });
  });

  it('asks for previews (auto sample text when none is given), then saves the chosen one', () => {
    const design = designRequest(d, 'SECRET');
    expect(design.url).toBe('https://api.elevenlabs.io/v1/text-to-voice/design?output_format=mp3_44100_128');
    expect(JSON.parse(design.init.body as string)).toEqual({ voice_description: d.description, auto_generate_text: true });
    const save = saveVoiceRequest(d, 'GEN1', 'SECRET');
    expect(save.url).toBe('https://api.elevenlabs.io/v1/text-to-voice');
    expect(JSON.parse(save.init.body as string)).toEqual({
      voice_name: 'Dwarf Old Guard', voice_description: d.description, generated_voice_id: 'GEN1',
    });
  });

  it('rejects a description ElevenLabs would refuse (under 20 characters)', () => {
    expect(() => ManifestSchema.parse({ voices: {}, lines: [], designs: [{ key: 'x', name: 'X', description: 'too short' }] })).toThrow();
  });
});

describe('vo manifest', () => {
  it('rejects duplicate ids (across lines and sfx), unknown voices and bad ids', () => {
    expect(() => ManifestSchema.parse(raw([a, a]))).toThrow(/duplicate/);
    expect(() => ManifestSchema.parse(raw([{ ...a, id: 'dw_brakka.death' }], [growl]))).toThrow(/duplicate/);
    expect(() => ManifestSchema.parse(raw([{ ...a, voice: 'nope' }]))).toThrow(/unknown voice/);
    expect(() => ManifestSchema.parse(raw([{ ...a, id: 'Triple 3' }]))).toThrow(/lowercase file names/);
  });

  it('the committed vo-lines.json is valid', () => {
    const file = JSON.parse(readFileSync(resolve(__dirname, '../vo-lines.json'), 'utf8'));
    expect(() => ManifestSchema.parse(file)).not.toThrow();
  });

  it('builds the ElevenLabs request without leaking the key into the URL', () => {
    const { url, init } = ttsRequest(a, voice, 'SECRET');
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/VOICE?output_format=mp3_44100_128');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('SECRET');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Triple!', model_id: 'eleven_multilingual_v2' });
  });
});
