/**
 * PHONE AUDIO MEMORY (R-TOUCH-PLAY-MEMORY-01, owner report 2026-10-18: on a recent iPhone, from the Home Screen icon,
 * pressing PLAY crashed the page twice in a row, "A problem repeatedly occurred").
 *
 * The first touch on a phone is usually the title's Play, and that touch creates the AudioContext (audioUnlock.ts),
 * which used to start decoding the whole core SFX bank at once: 87 clips, all in flight together on the shared asset
 * pipe, every one turned into raw float PCM (length x channels x 4 bytes). Measured on the prod build as an iPhone:
 * 120.5 MB of AudioBuffers within one second of the press at a 96 kHz context, about 60 MB at an iPhone's 48 kHz,
 * the biggest single allocation Play causes, landing in the same second as the mode home's layers and art. A phone now:
 *
 *  1. decodes ONE clip at a time (`serialQueue`), starting a moment after the press, so no burst lands with Play;
 *  2. decodes at 32 kHz (`PHONE_AUDIO_RATE`) instead of the context's 48 kHz, and keeps each clip MONO
 *     (`downmixToMono`; a phone speaker is close to mono anyway): together a third of the bytes;
 *  3. no longer fetches the ~430 per-card, per-hero and FX clips at the first touch (they load on their first play).
 *
 * Desktop is unchanged: it never reads anything here.
 */

/** The rate a phone stores decoded clips at. 32 kHz keeps everything up to 16 kHz, past what a phone speaker plays,
 *  at two thirds of an iPhone's 48 kHz. */
export const PHONE_AUDIO_RATE = 32000;

/** Delay between the press that creates the context and the first core decode on a phone. */
export const PHONE_AUDIO_PREFETCH_DELAY_MS = 2500;

/** Average every channel into one. Same length as the input channels; an empty list gives an empty array. */
export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  const n = channels.length;
  if (n === 0) return new Float32Array(0);
  const len = channels[0]!.length;
  if (n === 1) return channels[0]!.slice();
  const out = new Float32Array(len);
  const k = 1 / n;
  for (const ch of channels) for (let i = 0; i < len; i++) out[i]! += ch[i]! * k;
  return out;
}

/** Decoded size of a buffer in bytes (float32 PCM). */
export const audioBufferBytes = (b: { length: number; numberOfChannels: number }): number => b.length * b.numberOfChannels * 4;

/** A queue that runs one async job at a time, in order. A failed job never stops the ones behind it. */
export function serialQueue(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}
