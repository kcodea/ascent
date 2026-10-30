/**
 * THE ANNOUNCER'S DECODED LINES (R-AUDIO-MEMORY-01, audio memory pass 2026-10-29; owner: "smooth early, hitchy late,
 * worse on phones"). The announcer used to keep every line it ever decoded, for the page's life. Its no-repeat bag
 * makes almost every line a new file (1,188 of them), and each decodes to 0.4 to 1.5 MB of raw PCM, so a game piled
 * up tens of MB and the next game added more.
 *
 * Now a line is held while it is loading or sounding (a reference each), and once it ends it stays only in a small
 * recent set: at most `maxEntries` lines and `maxBytes` bytes, the least recently used dropped first. A line still
 * loading or sounding is never dropped. A file that failed to load is remembered by URL only (no bytes), so a missing
 * pack clip is not fetched again on every try.
 */

export interface LineCacheOptions {
  maxEntries: number;
  maxBytes: number;
}

/** The recent set the announcer keeps: a few lines, a few MB. */
export const ANNOUNCER_LINE_CACHE: LineCacheOptions = { maxEntries: 6, maxBytes: 6 * 1024 * 1024 };

interface Entry<B> {
  promise: Promise<B | null>;
  /** Decoded bytes once settled (0 while loading, or for a failed load). */
  bytes: number;
  settled: boolean;
  refs: number;
}

export interface LineCache<B> {
  /** Load (or reuse) `url` and hold it until `release(url)`. */
  acquire(url: string): Promise<B | null>;
  /** Drop one hold. The line then joins the recent set (or is dropped, past the caps). */
  release(url: string): void;
  /** Decoded lines held right now. */
  size(): number;
  /** Their decoded bytes. */
  bytes(): number;
  /** Tests only. */
  clear(): void;
}

export function createLineCache<B>(
  load: (url: string) => Promise<B | null>,
  sizeOf: (b: B) => number,
  opts: LineCacheOptions = ANNOUNCER_LINE_CACHE,
): LineCache<B> {
  const entries = new Map<string, Entry<B>>(); // insertion order = least recently used first
  const failed = new Set<string>();
  let total = 0;

  const trim = (): void => {
    for (const [url, e] of entries) {
      if (entries.size <= opts.maxEntries && total <= opts.maxBytes) break;
      if (e.refs > 0 || !e.settled) continue;
      entries.delete(url);
      total -= e.bytes;
    }
  };

  return {
    acquire(url) {
      if (failed.has(url)) return Promise.resolve(null);
      let e = entries.get(url);
      if (e) {
        entries.delete(url); // the young end
        entries.set(url, e);
        e.refs++;
        return e.promise;
      }
      const entry: Entry<B> = { promise: Promise.resolve(null), bytes: 0, settled: false, refs: 1 };
      entry.promise = load(url).catch(() => null).then((b) => {
        entry.settled = true;
        if (b === null) {
          failed.add(url);
          if (entries.get(url) === entry) entries.delete(url);
          return null;
        }
        if (entries.get(url) === entry) { entry.bytes = sizeOf(b); total += entry.bytes; }
        trim();
        return b;
      });
      e = entry;
      entries.set(url, e);
      return e.promise;
    },
    release(url) {
      const e = entries.get(url);
      if (!e || e.refs === 0) return;
      e.refs--;
      trim();
    },
    size: () => entries.size,
    bytes: () => total,
    clear() { entries.clear(); failed.clear(); total = 0; },
  };
}
