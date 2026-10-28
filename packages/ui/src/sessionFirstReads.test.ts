import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SESSION-FIRST READS (R-SEC-READS-01, 2026-11-07). The large shared tables answer only a session once
 * `2026-11-09-security-reads-need-session.sql` is applied, so a boot-time read waits for the boot's anonymous sign-in
 * instead of going out as the bare public key; bounded, so an offline boot is never held; and once only per load.
 */
const h = vi.hoisted(() => ({ userId: null as string | null, settled: null as Promise<unknown> | null }));
vi.mock('./identity', () => ({
  currentUserId: () => h.userId,
  currentIdentity: () => null,
  setIdentity: () => {},
  identitySettled: () => h.settled,
}));

/** A fresh module (its once-per-load latch reset), imported on real timers; the clock is faked after. */
async function load(): Promise<typeof import('./remoteBoards')> {
  vi.useRealTimers();
  vi.resetModules();
  const m = await import('./remoteBoards');
  vi.useFakeTimers();
  return m;
}
beforeEach(() => { h.userId = null; h.settled = null; });
afterEach(() => { vi.useRealTimers(); });

const flag = (p: Promise<unknown>): { done: boolean } => { const s = { done: false }; void p.then(() => { s.done = true; }); return s; };

describe('sessionReady', { timeout: 60_000 }, () => {
  it('waits for the boot sign-in, then answers at once', async () => {
    let land!: () => void;
    h.settled = new Promise<void>((r) => { land = r; });
    const { sessionReady } = await load();
    const first = flag(sessionReady());
    await vi.advanceTimersByTimeAsync(1000);
    expect(first.done).toBe(false);
    h.userId = 'u1';
    land();
    await vi.advanceTimersByTimeAsync(0);
    expect(first.done).toBe(true);
    const again = flag(sessionReady());
    await vi.advanceTimersByTimeAsync(0);
    expect(again.done).toBe(true);
  });

  it('never holds a read longer than the cap (offline boot), and waits only once per load', async () => {
    h.settled = new Promise(() => {}); // the sign-in never lands
    const { sessionReady } = await load();
    const first = flag(sessionReady());
    await vi.advanceTimersByTimeAsync(5999);
    expect(first.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(first.done).toBe(true);
    const later = flag(sessionReady());
    await vi.advanceTimersByTimeAsync(0);
    expect(later.done).toBe(true);
  });

  it('does not wait when there is a session already, or no boot sign-in at all (tools, tests)', async () => {
    const { sessionReady } = await load();
    const noBoot = flag(sessionReady());
    await vi.advanceTimersByTimeAsync(0);
    expect(noBoot.done).toBe(true);
    h.settled = new Promise(() => {});
    h.userId = 'u1';
    const signedIn = flag(sessionReady());
    await vi.advanceTimersByTimeAsync(0);
    expect(signedIn.done).toBe(true);
  });
});
