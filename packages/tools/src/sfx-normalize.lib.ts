/**
 * Loudness normalization for card sound clips — the pure half. `sfx-normalize.ts` is the CLI; `vo-approve.ts`
 * calls `normalizeFile` on every card clip it approves. See docs/voiceover.md ("Loudness").
 *
 * Why: ElevenLabs output varies wildly in level (measured 2026-09-29: card clips spanned −42 to −6 LUFS, ~37 dB),
 * so one volume knob per slot could never make them sit together. Every clip is brought to ONE loudness first,
 * and the By-card volume box stays the per-slot / per-card trim on top.
 *
 * The chain (ffmpeg): a gentle compressor tames spikes (a roar's first hit, a shouted word), then a TWO-PASS
 * `loudnorm` (ITU BS.1770 / EBU R128 loudness) measures and applies one linear gain to the target, with a true-peak
 * ceiling. Two-pass + `linear=true` means a single gain per clip — no pumping — which keeps a whisper and a roar
 * sounding like themselves, just no longer 35× apart.
 */
import { createHash } from 'node:crypto';

/** Target integrated loudness (LUFS) every card clip is normalized to. */
export const TARGET_LUFS = -20;
/** Target for the Hero Select lines (audio/heroes/<heroId>.mp3): the average integrated loudness of the owner's 10
 *  hand-recorded hero lines (measured 2026-10-09, they spanned -29.7 to -16.7 LUFS), so the generated lines sit with
 *  them instead of at the card-clip level. */
export const HERO_SELECT_LUFS = -22.8;
/** True-peak ceiling (dBTP). */
export const TRUE_PEAK = -1;
/** Loudness range allowed through loudnorm (LU). */
export const LRA = 11;
/** The gentle compressor applied before normalization. */
export const COMPRESSOR = 'acompressor=threshold=-24dB:ratio=3:attack=5:release=80:makeup=1';
/** Where the card clips live, and the record of which ones are already normalized (by content hash). */
export const FX_AUDIO_DIR = 'packages/ui/src/audio/fx';
export const NORMALIZED_MANIFEST = 'packages/ui/src/audio/fx/normalized.json';

/** loudnorm's pass-1 measurement (its `print_format=json` report). */
export interface LoudnormMeasure {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/** The pass-1 filter: compress, then measure. */
export function measureFilter(target = TARGET_LUFS): string {
  return `${COMPRESSOR},loudnorm=I=${target}:TP=${TRUE_PEAK}:LRA=${LRA}:print_format=json`;
}

/** A plain loudness reading (no compressor): used to report a clip's loudness after normalizing. */
export function readFilter(): string {
  return `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK}:LRA=${LRA}:print_format=json`;
}

/** The pass-2 filter: compress, then one linear gain to the target from the pass-1 measurement. */
export function applyFilter(m: LoudnormMeasure, target = TARGET_LUFS): string {
  return `${COMPRESSOR},loudnorm=I=${target}:TP=${TRUE_PEAK}:LRA=${LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}`
    + `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
}

/** Pull loudnorm's JSON report out of ffmpeg's stderr (it is the last `{…}` block). */
export function parseLoudnorm(stderr: string): LoudnormMeasure {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('loudnorm printed no measurement');
  const j = JSON.parse(stderr.slice(start, end + 1)) as Partial<LoudnormMeasure>;
  for (const k of ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'] as const) {
    if (typeof j[k] !== 'string') throw new Error(`loudnorm measurement is missing ${k}`);
  }
  return j as LoudnormMeasure;
}

/** A clip that is effectively silent cannot be normalized (loudnorm reports -inf): leave it alone. */
export function isSilent(m: LoudnormMeasure): boolean {
  const i = Number(m.input_i);
  return !Number.isFinite(i) || i < -70;
}

/** Content hash of a clip, the key the manifest remembers. */
export function clipHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/** file name → hash of its normalized output. A file whose current hash matches is already done (idempotent). */
export type NormalizedManifest = Record<string, string>;

/** Which clips still need normalizing: every card clip whose current content is not the recorded normalized one. */
export function planNormalize(files: Array<{ name: string; hash: string }>, done: NormalizedManifest): string[] {
  return files.filter((f) => done[f.name] !== f.hash).map((f) => f.name);
}
