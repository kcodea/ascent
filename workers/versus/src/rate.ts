/**
 * PER-SOCKET RATE LIMIT, shared by the Versus room and the live game objects (a token bucket per socket, in memory: a
 * wake resets it, which only ever errs generous). Requests: 20/s sustained, bursts of 40 (a shop turn sends one
 * candidate per board change). Relays (spectator frames, cursors, emotes): 60/s, bursts of 120. Over the limit a frame
 * is dropped (a request answers `rate_limited`); a socket that keeps flooding (over the limit 200 times) is closed with
 * 1008. Frames over 1.5 MB are refused outright (a full submit with its checkpoint is ~1.3 MB at most).
 */
export const RATE = { req: { per: 20, burst: 40 }, bc: { per: 60, burst: 120 } } as const;
export const MAX_FRAME_CHARS = 1_500_000;
export const FLOOD_CLOSE_AFTER = 200;
export interface Bucket { req: number; bc: number; at: number; over: number }

/**
 * Take one token of `kind` from `b` (a fresh bucket when undefined) at `now`. Answers the bucket to keep, whether the
 * frame may pass, and whether the socket has flooded past `FLOOD_CLOSE_AFTER`. Pure.
 */
export function takeToken(b: Bucket | undefined, kind: 'req' | 'bc', now: number): { bucket: Bucket; ok: boolean; flood: boolean } {
  const bucket = b ?? { req: RATE.req.burst, bc: RATE.bc.burst, at: now, over: 0 };
  const dt = (now - bucket.at) / 1000;
  bucket.req = Math.min(RATE.req.burst, bucket.req + dt * RATE.req.per);
  bucket.bc = Math.min(RATE.bc.burst, bucket.bc + dt * RATE.bc.per);
  bucket.at = now;
  if (bucket[kind] >= 1) { bucket[kind] -= 1; return { bucket, ok: true, flood: false }; }
  bucket.over += 1;
  return { bucket, ok: false, flood: bucket.over >= FLOOD_CLOSE_AFTER };
}
