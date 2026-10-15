/**
 * VERSUS — the shared clock (blueprint 1.4: deadlines are absolute server timestamps; clients display an
 * offset-adjusted countdown and never own it). Pure.
 *
 * The offset is estimated from RPC replies that carry `serverNow`: offset = serverNow - (sent + received) / 2.
 * The sample with the smallest round trip wins (the least uncertainty), and old samples age out so a laptop that
 * slept or a clock that was corrected re-converges.
 */

export interface OffsetSample {
  offsetMs: number;
  rttMs: number;
  at: number;
}

export class ServerClock {
  private samples: OffsetSample[] = [];
  constructor(private readonly keep = 8) {}

  /** Record one reply: `sent`/`received` are local ms (performance-free Date.now), `serverNow` the server's ISO. */
  sample(sent: number, received: number, serverNow: string | undefined | null): void {
    if (!serverNow) return;
    const server = Date.parse(serverNow);
    if (!Number.isFinite(server) || received < sent) return;
    this.samples.push({ offsetMs: server - (sent + received) / 2, rttMs: received - sent, at: received });
    if (this.samples.length > this.keep) this.samples.shift();
  }

  /** Server minus local, in ms (0 before any sample). */
  offset(): number {
    if (this.samples.length === 0) return 0;
    let best = this.samples[0]!;
    for (const s of this.samples) if (s.rttMs < best.rttMs) best = s;
    return best.offsetMs;
  }

  /** The server's "now" in local epoch ms. */
  now(local = Date.now()): number {
    return local + this.offset();
  }

  /** Ms until an ISO deadline (negative once past); `null` deadline = null. */
  remainingMs(deadline: string | null | undefined, local = Date.now()): number | null {
    if (!deadline) return null;
    return Date.parse(deadline) - this.now(local);
  }
}

/** Whole seconds to show for a remaining duration (ceil, never negative). */
export function displaySeconds(remainingMs: number | null): number {
  if (remainingMs == null) return 0;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}
