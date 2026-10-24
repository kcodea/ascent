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
 *  2. keeps each clip MONO (`phoneMono`; a phone speaker is close to mono anyway): half the bytes;
 *  3. no longer fetches the ~430 per-card, per-hero and FX clips at the first touch.
 *
 * PHONE AUDIO QUALITY (R-TOUCH-AUDIO-QUALITY-01, owner report 2026-10-23 on a real iPhone: "the sound effects were all
 * terrible/not loaded"). The memory pass above went too far in three ways, fixed here:
 *
 *  a. It decoded at 32 kHz. The context runs at 44.1 or 48 kHz, so every play was resampled again by the buffer
 *     source, which interpolates linearly: a dull top end with imaging above it. A phone now decodes at the
 *     context's own rate (`phoneDecodeRate`, capped at 48 kHz), so a clip plays with no second resample.
 *  b. The card, hero and FX clips loaded on their FIRST play, so that play was silent (or the synth blip). A phone
 *     now decodes the clips the game will need next ahead of time (audio/clipIndex.ts, audio/phonePrewarm.ts), one
 *     at a time, in an LRU sized for a game's working set (`PHONE_AUDIO_LRU_BYTES`).
 *  c. The core bank rode the asset queue's `audio` lane, BEHIND the whole phone art stream (about 1,300 images),
 *     so on a real connection the shop's own sounds arrived late. A phone's sounds now ride the `chrome` lane:
 *     after the title's art, ahead of the art stream, still behind anything on screen (`now`).
 *
 * Desktop is unchanged: it never reads anything here.
 */

/** The highest rate a phone stores decoded clips at. */
export const PHONE_AUDIO_MAX_RATE = 48000;

/** The rate a phone decodes at: the live context's own rate, so a play needs no resample, capped at 48 kHz (a
 *  96 kHz context would double the bytes for nothing a phone speaker plays). 48 kHz when the rate is unknown. */
export function phoneDecodeRate(contextRate: number): number {
  return Number.isFinite(contextRate) && contextRate > 0 ? Math.min(contextRate, PHONE_AUDIO_MAX_RATE) : PHONE_AUDIO_MAX_RATE;
}

/**
 * The cap on a phone's on-demand clips (card, hero and FX `sound` clips; the core bank is held outside it). Sized
 * from the bank itself (48 kHz mono): a run's working set is the hero's two lines (~1 MB), the bound FX of every card
 * on both boards, the hand and the Shop (~0.43 MB a card, ~13 MB for 31 cards) and the hero-attack clips (~12 MB),
 * about 26 MB. 40 MB holds all of it with room to spare, so nothing a game is using is evicted and re-decoded.
 * The whole on-demand bank would be ~120 MB.
 */
export const PHONE_AUDIO_LRU_BYTES = 40 * 1024 * 1024;

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

/**
 * Fold a clip to mono for a phone. The average of the channels, unless the channels cancel (a wide stereo effect
 * whose sides are out of phase): when the average keeps less than a quarter of the louder channel's energy, the
 * louder channel is kept instead, so a clip never comes out hollow or near silent.
 */
export function phoneMono(channels: readonly Float32Array[]): Float32Array {
  const avg = downmixToMono(channels);
  if (channels.length < 2) return avg;
  const energy = (a: Float32Array): number => { let e = 0; for (let i = 0; i < a.length; i++) e += a[i]! * a[i]!; return e; };
  let loud = channels[0]!; let loudE = energy(loud);
  for (let c = 1; c < channels.length; c++) { const e = energy(channels[c]!); if (e > loudE) { loud = channels[c]!; loudE = e; } }
  return loudE > 0 && energy(avg) < 0.25 * loudE ? loud.slice() : avg;
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

/**
 * PLAY STATS (phone audio quality pass, owner 2026-10-23). How many clip plays found their clip decoded, how many
 * MISSED (the clip was not decoded yet, so that play was a synth blip or silence), and how long a missed clip took to
 * arrive. A clip is counted as missed once per wait, however often it is asked for while it loads (the FX `sound`
 * layer retries every tick). Read by `npm run perf:phone-run` through `window.__ascentSfx` on a phone.
 */
export interface PlayStats {
  plays: number;
  misses: number;
  /** Misses of a clip that was not decoded up front on this device (loaded on demand). */
  demandMisses: number;
  missed: string[];
  /** Miss to decoded, in ms, per missed clip that has since arrived. */
  lagMs: number[];
}
export function createPlayStats(now: () => number = () => Date.now()) {
  const st: PlayStats = { plays: 0, misses: 0, demandMisses: 0, missed: [], lagMs: [] };
  const waiting = new Map<string, number>();
  return {
    stats: st,
    hit(): void { st.plays++; },
    miss(name: string, onDemand: boolean): void {
      if (waiting.has(name)) return;
      waiting.set(name, now());
      st.misses++;
      if (onDemand) st.demandMisses++;
      if (st.missed.length < 200) st.missed.push(name);
    },
    ready(name: string): void {
      const t = waiting.get(name);
      if (t === undefined) return;
      waiting.delete(name);
      st.lagMs.push(now() - t);
    },
  };
}
