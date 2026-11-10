/**
 * The room socket's client, for the connection status on screen (netcode audit F2 / F11):
 *  - R-VERSUS-CF-DEAD-01: after a fatal close (this account opened the game somewhere else) a request answers AT ONCE
 *    with why, instead of queueing behind a socket that will never reopen and timing out 15 s later; `reclaim()` opens it
 *    again.
 *  - R-VERSUS-CF-PROBE-01: a probe (the tab is visible again, the network is back) finds a socket that died unseen in
 *    2 s; a keep-alive timer that fired LATE (a frozen tab) probes a healthy socket instead of dropping it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VERSUS_CF_PROBE_MS, VersusCfClient, type WebSocketLike } from '../src/client';
import { VERSUS_CF_CLOSE, VERSUS_CF_PING, VERSUS_CF_PING_MS, VERSUS_CF_PONG, VERSUS_CF_STALE_MS } from '../src/protocol';

type Ev = { data?: unknown; code?: number; reason?: string };

/** A room that answers the hello (and pings while `alive`). `mute()` = the network died with no FIN. */
class Sock implements WebSocketLike {
  readyState = 0;
  alive = true;
  sent: string[] = [];
  private on: Record<string, ((e: Ev) => void)[]> = {};
  constructor() { setTimeout(() => { this.readyState = 1; this.emit('open', {}); }, 5); }
  addEventListener(type: string, fn: (e: Ev) => void): void { (this.on[type] ??= []).push(fn); }
  emit(type: string, e: Ev): void { for (const f of this.on[type] ?? []) f(e); }
  send(data: string): void {
    this.sent.push(data);
    if (!this.alive) return;
    if (data === VERSUS_CF_PING) { setTimeout(() => this.emit('message', { data: VERSUS_CF_PONG }), 20); return; }
    const m = JSON.parse(data) as { id: number; op: string };
    if (m.op === 'hello') setTimeout(() => this.emit('message', { data: JSON.stringify({ t: 'res', id: m.id, ok: true, data: {}, now: '' }) }), 5);
  }
  close(): void { this.readyState = 3; }
  mute(): void { this.alive = false; }
}

function make() {
  const sockets: Sock[] = [];
  const status: string[] = [];
  let wake: (() => void) | null = null;
  const c = new VersusCfClient({
    baseUrl: 'http://x', roomId: 'r', token: async () => 'dev.u.dev', versusProtocol: 1, contentRevision: 'c',
    ws: () => { const w = new Sock(); sockets.push(w); return w; },
    onStatus: (s, d) => status.push(d ? `${s}:${d}` : s),
    wake: (fn) => { wake = fn; return () => { wake = null; }; },
  });
  return { c, sockets, status, wake: () => wake?.() };
}

const settle = (p: Promise<unknown>): { state: () => string } => {
  let state = 'pending';
  p.then(() => { state = 'resolved'; }, (e: { code?: string }) => { state = `rejected:${e?.code ?? e}`; });
  return { state: () => state };
};

describe('a socket closed for good says so at once (R-VERSUS-CF-DEAD-01)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('THE BUG: replaced by a second tab, every later request waited 15 s and timed out; now it fails at once as `replaced`', async () => {
    const { c, sockets, status } = make();
    await Promise.all([c.connect(), vi.advanceTimersByTimeAsync(50)]);
    expect(c.isOpen).toBe(true);
    sockets[0]!.emit('close', { code: VERSUS_CF_CLOSE.replaced, reason: '' }); // a browser may hand over no reason
    expect(c.deadReason).toBe('replaced');
    expect(status.at(-1)).toMatch(/^dead/);
    const w = settle(c.request('heartbeat'));
    await vi.advanceTimersByTimeAsync(0);
    expect(w.state()).toBe('rejected:replaced');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets).toHaveLength(1); // and it never reconnects by itself (two tabs would trade the socket for ever)
    c.close();
  });

  it('"Play here": reclaim opens the socket again and requests flow', async () => {
    const { c, sockets, status } = make();
    await Promise.all([c.connect(), vi.advanceTimersByTimeAsync(50)]);
    sockets[0]!.emit('close', { code: VERSUS_CF_CLOSE.replaced, reason: 'replaced' });
    await Promise.all([c.reclaim(), vi.advanceTimersByTimeAsync(50)]);
    expect(sockets).toHaveLength(2);
    expect(c.isOpen).toBe(true);
    expect(c.deadReason).toBeNull();
    expect(status.at(-1)).toBe('open');
    c.close();
  });

  it('an ordinary drop is not dead: it reconnects by itself and reports down then open', async () => {
    const { c, sockets, status } = make();
    await Promise.all([c.connect(), vi.advanceTimersByTimeAsync(50)]);
    sockets[0]!.emit('close', { code: 1006 });
    expect(c.deadReason).toBeNull();
    expect(status.at(-1)).toMatch(/^down/);
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets).toHaveLength(2);
    expect(status.at(-1)).toBe('open');
    c.close();
  });
});

describe('the socket is probed when it may have died unseen (R-VERSUS-CF-PROBE-01)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('the tab is visible again on a dead socket: found in 2 s and reconnected, not on the next keep-alive tick', async () => {
    const { c, sockets, status, wake } = make();
    await Promise.all([c.connect(), vi.advanceTimersByTimeAsync(50)]);
    sockets[0]!.mute(); // the network died with no FIN while the tab was hidden
    wake();
    expect(sockets[0]!.sent.at(-1)).toBe(VERSUS_CF_PING);
    await vi.advanceTimersByTimeAsync(VERSUS_CF_PROBE_MS - 1);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(status).toContain('down:stale');
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(c.isOpen).toBe(true);
    c.close();
  });

  it('a healthy socket answers the probe and is left alone', async () => {
    const { c, sockets, status, wake } = make();
    await Promise.all([c.connect(), vi.advanceTimersByTimeAsync(50)]);
    wake();
    await vi.advanceTimersByTimeAsync(VERSUS_CF_PROBE_MS + 500);
    expect(sockets).toHaveLength(1);
    expect(status.filter((s) => s.startsWith('down'))).toHaveLength(0);
    c.close();
  });

  it('a socket waiting out its backoff reconnects at once on a wake (R-VERSUS-CF-RECONNECT-01 kept)', async () => {
    const { c, sockets, wake } = make();
    await Promise.all([c.connect(), vi.advanceTimersByTimeAsync(50)]);
    sockets[0]!.emit('close', { code: 1006 });
    wake();
    await vi.advanceTimersByTimeAsync(20);
    expect(sockets).toHaveLength(2);
    c.close();
  });

  it('a keep-alive timer that fired late (a frozen tab) probes a healthy socket instead of dropping it', async () => {
    const { c, sockets, status } = make();
    await Promise.all([c.connect(), vi.advanceTimersByTimeAsync(50)]);
    // The tab freezes: the clock jumps a minute while no timer runs, then the ping timer fires late.
    vi.setSystemTime(Date.now() + VERSUS_CF_STALE_MS + 60_000);
    await vi.advanceTimersByTimeAsync(VERSUS_CF_PING_MS + 10);
    await vi.advanceTimersByTimeAsync(VERSUS_CF_PROBE_MS + 100);
    expect(status.filter((s) => s.startsWith('down'))).toHaveLength(0); // before the fix: down:stale, a needless reconnect
    expect(sockets).toHaveLength(1);
    expect(c.isOpen).toBe(true);
    c.close();
  });
});
