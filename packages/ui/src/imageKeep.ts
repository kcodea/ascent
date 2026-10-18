/**
 * IMAGE KEEP — where the art preloader holds the decoded images it made (`artPreload.ts`).
 *
 * Desktop holds every one for the session (`budgetBytes = Infinity`, the "no pop-in" contract, owner 2026-09-30). A
 * phone gets a BOUNDED LRU instead (owner 2026-10-18, "the iPhone crashes a lot"): holding all ~1,300 decoded images
 * cost about 1.1 GB, and iOS kills a tab long before that. Once a URL falls out, nothing references its Image, so the
 * browser may drop the decoded pixels; the bytes stay in the HTTP cache and the next <img> decodes them again.
 *
 * Bytes are estimated as width x height x 4 (RGBA), which is what a decoded bitmap costs. Pure: no DOM needed.
 */
export interface ImageKeep<T> {
  /** Hold `item` for `key` (re-holding moves it to the newest end), then evict the oldest until under budget. */
  set(key: string, item: T, bytes: number): void;
  /** The held item, refreshed to newest. */
  get(key: string): T | undefined;
  has(key: string): boolean;
  stats(): { count: number; bytes: number; evicted: number; budgetBytes: number };
}

export function createImageKeep<T>(budgetBytes: number): ImageKeep<T> {
  // A Map iterates in insertion order, so delete + set makes it an LRU with O(1) touch and evict.
  const held = new Map<string, { item: T; bytes: number }>();
  let total = 0;
  let evicted = 0;
  const evict = (): void => {
    for (const [k, v] of held) {
      if (total <= budgetBytes || held.size <= 1) return; // always keep the newest, however big
      held.delete(k);
      total -= v.bytes;
      evicted++;
    }
  };
  return {
    set(key, item, bytes) {
      const old = held.get(key);
      if (old) { held.delete(key); total -= old.bytes; }
      const b = Math.max(0, bytes || 0);
      held.set(key, { item, bytes: b });
      total += b;
      evict();
    },
    get(key) {
      const v = held.get(key);
      if (!v) return undefined;
      held.delete(key);
      held.set(key, v);
      return v.item;
    },
    has: (key) => held.has(key),
    stats: () => ({ count: held.size, bytes: total, evicted, budgetBytes }),
  };
}

/** Decoded size of an image, in bytes (RGBA). 0 when unknown. */
export const decodedBytes = (w: number, h: number): number => (w > 0 && h > 0 ? w * h * 4 : 0);
