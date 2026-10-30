/**
 * VERSUS CHAOS HARNESS: ONE CLIENT'S NETWORK (latency, offline, a hung socket that comes back, background-tab
 * throttling). Every request a client's Worker transport makes, and every push the room sends it, goes through its
 * `ChaosNet` (`cfChaosServer.ts` wires the fake WebSocket and fetch through it).
 */

/** Per-client network conditions (the chaos knobs). */
export interface NetState {
  /** Requests fail at once ("Failed to fetch"); responses in flight are lost. */
  offline: boolean;
  /** Round-trip latency (ms), split evenly before and after the server. */
  latencyMs: number;
  /** Requests made before this time (fake ms) hang until it (a dead socket that comes back). */
  hangUntil: number;
  /** The tab is hidden: requests (and realtime deliveries) wait for the next throttle slot. */
  hiddenSince: number | null;
  /** Realtime to this client is down (its socket died). */
  realtimeDown: boolean;
}

export const freshNet = (): NetState => ({ offline: false, latencyMs: 40, hangUntil: 0, hiddenSince: null, realtimeDown: false });

/** A background tab's timers: about once a second; past 5 minutes hidden, Chrome's intensive throttling (once a minute). */
export function throttleSlot(now: number, hiddenSince: number | null): number {
  if (hiddenSince == null) return 0;
  const period = now - hiddenSince >= 5 * 60_000 ? 60_000 : 1_000;
  const next = Math.ceil(now / period) * period;
  return next - now;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** The transport for one client. */
export class ChaosNet {
  readonly state: NetState = freshNet();
  /** Calls made, by kind (the egress view; also proves a dead client sent nothing). */
  readonly sent: Record<string, number> = {};
  constructor(readonly name: string) {}

  async send<T>(kind: string, op: () => Promise<T>): Promise<T> {
    this.sent[kind] = (this.sent[kind] ?? 0) + 1;
    const s = this.state;
    const wait = throttleSlot(Date.now(), s.hiddenSince);
    if (wait > 0) await sleep(wait);
    if (s.offline) { await sleep(5); throw new NetFailure(); }
    if (Date.now() < s.hangUntil) await sleep(s.hangUntil - Date.now());
    await sleep(s.latencyMs / 2);
    if (s.offline) throw new NetFailure();
    const out = await op();
    await sleep(s.latencyMs / 2);
    if (s.offline) throw new NetFailure(); // the answer was lost on the way back
    return out;
  }
}

export class NetFailure extends Error {
  constructor() { super('TypeError: Failed to fetch'); }
}

