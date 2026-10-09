/**
 * The ffmpeg half of sfx-normalize: normalize ONE clip in place. Shared by the `sfx:normalize` CLI and
 * `vo:approve`. ffmpeg comes from the `ffmpeg-static` dev dependency, so no system install is needed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { TARGET_LUFS, applyFilter, clipHash, isSilent, measureFilter, parseLoudnorm, readFilter } from './sfx-normalize.lib';

const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static') as string | null;

function ffmpeg(args: string[]): { stderr: string; status: number | null } {
  if (!ffmpegPath) throw new Error('ffmpeg-static has no binary for this platform.');
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-nostats', ...args], { encoding: 'utf8' });
  return { stderr: r.stderr ?? '', status: r.status };
}

export interface NormalizeResult {
  /** Hash of the normalized file (what the manifest records). */
  hash: string;
  /** Integrated loudness before / after, LUFS. */
  before: string;
  after: string;
  /** Set when the clip was left untouched (e.g. silent). */
  skipped?: string;
}

/** Compress + two-pass loudnorm `file` (an mp3) in place to `target` LUFS, 44.1 kHz / 128 kbps mp3 out. */
export function normalizeFile(file: string, target = TARGET_LUFS): NormalizeResult {
  const pass1 = ffmpeg(['-i', file, '-af', measureFilter(target), '-f', 'null', '-']);
  const m = parseLoudnorm(pass1.stderr);
  if (isSilent(m)) return { hash: clipHash(readFileSync(file)), before: m.input_i, after: m.input_i, skipped: 'silent' };
  const tmp = `${file}.norm.mp3`;
  const pass2 = ffmpeg(['-y', '-i', file, '-af', applyFilter(m, target), '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', tmp]);
  if (pass2.status !== 0) { rmSync(tmp, { force: true }); throw new Error(`ffmpeg failed on ${file}: ${pass2.stderr.slice(-300)}`); }
  renameSync(tmp, file);
  const check = parseLoudnorm(ffmpeg(['-i', file, '-af', readFilter(), '-f', 'null', '-']).stderr);
  return { hash: clipHash(readFileSync(file)), before: m.input_i, after: check.input_i };
}
