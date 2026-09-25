import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ManifestSchema, lineHash, planCharacters, planGenerate, ttsRequest, type Manifest } from './vo.lib';

const voice = { id: 'VOICE', model: 'eleven_multilingual_v2', dest: 'apps/web/public/announcer' };
const manifest = (lines: Manifest['lines']): Manifest => ({ voices: { announcer: voice }, lines });
const a = { id: 'triple-3', voice: 'announcer', text: 'Triple!' };
const b = { id: 'tier-six-3', voice: 'announcer', text: 'Tier six!' };
const none = (): boolean => false;
const opts = { takes: 1, more: 0, only: [] as string[] };

describe('vo planGenerate', () => {
  it('generates new lines and skips up-to-date ones (no credits re-spent)', () => {
    const m = manifest([a, b]);
    const state = { [a.id]: { hash: lineHash(a, voice), takes: 2 } };
    const plan = planGenerate(m, state, none, opts);
    expect(plan.map((p) => [p.line.id, p.reason, p.takes])).toEqual([['tier-six-3', 'new', [1]]]);
    expect(planCharacters(plan)).toBe('Tier six!'.length);
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

  it('never plans a line whose final file already ships in the game', () => {
    expect(planGenerate(manifest([a, b]), {}, (l) => l.id === a.id, opts).map((p) => p.line.id)).toEqual(['tier-six-3']);
  });

  it('--only restricts the plan', () => {
    expect(planGenerate(manifest([a, b]), {}, none, { ...opts, only: ['triple-3'] }).map((p) => p.line.id)).toEqual(['triple-3']);
  });
});

describe('vo manifest', () => {
  it('rejects duplicate ids, unknown voices and non-kebab ids', () => {
    expect(() => ManifestSchema.parse(manifest([a, a]))).toThrow(/duplicate/);
    expect(() => ManifestSchema.parse(manifest([{ ...a, voice: 'nope' }]))).toThrow(/unknown voice/);
    expect(() => ManifestSchema.parse(manifest([{ ...a, id: 'Triple 3' }]))).toThrow(/kebab/);
  });

  it('the committed vo-lines.json is valid', () => {
    const raw = JSON.parse(readFileSync(resolve(__dirname, '../vo-lines.json'), 'utf8'));
    expect(() => ManifestSchema.parse(raw)).not.toThrow();
  });

  it('builds the ElevenLabs request without leaking the key into the URL', () => {
    const { url, init } = ttsRequest(a, voice, 'SECRET');
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/VOICE?output_format=mp3_44100_128');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('SECRET');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Triple!', model_id: 'eleven_multilingual_v2' });
  });
});
