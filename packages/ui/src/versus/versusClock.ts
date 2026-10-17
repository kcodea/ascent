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

  /**
   * How far off `offset()` can be, in ms: half the best sample's round trip (the reply's server time was stamped
   * somewhere inside that trip), capped at 500. 0 before any sample. The shop clock adds this to the time left, so
   * the client's 0:00 (and its lock) can only land AT or AFTER the server's deadline, never before it
   * (R-VERSUS-CLOCK-LOCK-01).
   */
  uncertaintyMs(): number {
    if (this.samples.length === 0) return 0;
    let best = this.samples[0]!;
    for (const s of this.samples) if (s.rttMs < best.rttMs) best = s;
    return Math.min(500, best.rttMs / 2);
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

/**
 * THE ONE CLOCK RULE (owner 2026-10-16: "make sure that everything locks actually like after 0, make sure it doesnt
 * lock early"; R-VERSUS-CLOCK-LOCK-01). The number shown and the lock come from the SAME time-left value: the clock
 * shows `ceil(ms / 1000)`, and the shop locks only once `ms <= 0`. So while there is any time left (even 1 ms) the
 * clock reads at least 0:01 and actions go through; the lock lands exactly as it reads 0:00. A null clock (not
 * started) is neither shown as 0 nor locked.
 */
export function shopClockAt(remainingMs: number | null): { display: number; locked: boolean } {
  if (remainingMs == null) return { display: 0, locked: false };
  return { display: displaySeconds(remainingMs), locked: remainingMs <= 0 };
}
