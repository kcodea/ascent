/**
 * THE ON-DEMAND SFX CACHE (R-AUDIO-MEMORY-02, desktop SFX memory pass 2026-10-29). A decoded clip is raw float PCM:
 * the whole ~520-clip bank is about 244 MB at a 48 kHz stereo context and 488 MB at 96 kHz. Desktop used to decode
 * all of it at the first click and keep it for the page's life. Now both desktop and phone keep two kinds of clip:
 *
 *  - RESIDENT: the core bank (the top-level UI / shop / combat clips and the hero-select ceremony) and the FX clips
 *    every game plays (audio/clipIndex.ts `common`). Decoded up front, never dropped, never counted here.
 *  - ON DEMAND: every card, hero and other FX clip. Decoded ahead of its first play by the prewarm (the cards on the
 *    board, in the hand, in the Shop and in the fight; the hero's lines; the hero-attack clips) or on a play that
 *    found it missing, then held in this least-recently-used set under a byte cap.
 *
 * A clip that is still SOUNDING is never dropped (a play holds it until the source ends), so the cap can be passed
 * for a moment while long clips play; the set trims back as soon as they end.
 *
 * Pure: it works on the caller's clip map, so it is unit-tested without an AudioContext.
 */

/** Desktop's on-demand cap, in bytes AT 48 kHz STEREO. A desktop keeps clips in stereo at the context's own rate (no
 *  fold to mono, no resample: the bank is genuinely stereo, and a resampled play is duller), so the cap is scaled by
 *  the context's rate (`desktopLruCapBytes`) and always holds the same SECONDS of audio. Sized from the bank: a game's
 *  working set (the hero's lines, the bound FX of every card on both boards, the hand and the Shop, the hero-attack
 *  clips) measured about 50 MB at 48 kHz stereo; 64 MB holds it with room to spare. The whole on-demand bank would be
 *  about 160 MB at 48 kHz. */
export const DESKTOP_AUDIO_LRU_BYTES_48K = 64 * 1024 * 1024;

/** The desktop cap for a context running at `rate` Hz (48 kHz when unknown). */
export function desktopLruCapBytes(rate: number): number {
  const r = Number.isFinite(rate) && rate > 0 ? rate : 48000;
  return Math.round(DESKTOP_AUDIO_LRU_BYTES_48K * (r / 48000));
}

export interface ClipLruOptions<B> {
  /** The cap on the on-demand clips' bytes. Read on every trim (the context's rate is known only once it exists). */
  capBytes: () => number;
  /** A resident clip is never counted or dropped. */
  isResident: (name: string) => boolean;
  sizeOf: (b: B) => number;
  /** Called for each clip dropped (to drop anything derived from it, e.g. its reversed copy). */
  onEvict?: (name: string) => void;
}

export interface ClipLru<B> {
  /** Hold a freshly decoded clip (sets it in the map), then trim. */
  keep(name: string, buf: B): void;
  /** A play used this clip: it becomes the most recently used. */
  touch(name: string): void;
  /** A play of this clip started: it cannot be dropped until `playEnded`. */
  playStarted(name: string): void;
  /** A play of this clip ended (or was stopped). */
  playEnded(name: string): void;
  /** Bytes of the on-demand clips held right now. */
  bytes(): number;
  /** On-demand clips held right now. */
  size(): number;
  /** Clips dropped so far. */
  evictions(): number;
}

export function createClipLru<B>(map: Map<string, B>, opts: ClipLruOptions<B>): ClipLru<B> {
  const held = new Map<string, number>(); // on-demand name -> bytes; insertion order = least recently used first
  const playing = new Map<string, number>();
  let total = 0;
  let dropped = 0;

  /** Drop the least recently used clips past the cap; never `keepName` (the clip just decoded: a play is waiting on
   *  it), never one still sounding. */
  const trim = (keepName?: string): void => {
    const cap = opts.capBytes();
    if (total <= cap) return;
    for (const [name, bytes] of held) {
      if (total <= cap) break;
      if (name === keepName) continue;
      if (opts.isResident(name)) { held.delete(name); total -= bytes; continue; } // became resident (the index loaded late)
      if ((playing.get(name) ?? 0) > 0) continue;
      held.delete(name);
      total -= bytes;
      map.delete(name);
      dropped++;
      opts.onEvict?.(name);
    }
  };

  return {
    keep(name, buf) {
      map.set(name, buf);
      if (opts.isResident(name)) return;
      const prev = held.get(name);
      if (prev !== undefined) { total -= prev; held.delete(name); }
      const b = opts.sizeOf(buf);
      held.set(name, b);
      total += b;
      trim(name);
    },
    touch(name) {
      const b = held.get(name);
      if (b === undefined) return;
      held.delete(name);
      held.set(name, b);
    },
    playStarted(name) {
      playing.set(name, (playing.get(name) ?? 0) + 1);
    },
    playEnded(name) {
      const n = (playing.get(name) ?? 0) - 1;
      if (n > 0) playing.set(name, n);
      else { playing.delete(name); trim(); }
    },
    bytes: () => total,
    size: () => held.size,
    evictions: () => dropped,
  };
}
