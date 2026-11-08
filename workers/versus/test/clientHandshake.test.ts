/**
 * R-VERSUS-CF-HANDSHAKE-01 (2026-11-08, fix/versus-reliability-nov): a RECONNECT whose handshake never finishes is
 * dropped and retried, never left hanging.
 *
 * The keep-alive (a ping every 5 s, stale after 15 s) only starts once the room answers the hello. A socket that dies
 * between the reconnect and the hello's answer (a phone changing networks while it comes back: the upgrade or the hello
 * is lost, no close ever arrives) had NO watchdog: `ready` stayed false, every request queued behind it and timed out one
 * by one, and the socket was never replaced. The returning player sat on a frozen screen while the match went on
 * without them. Connect's own deadline (`connectTimeoutMs`) only covers the FIRST connect, not a reconnect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VersusCfClient, VERSUS_CF_HANDSHAKE_MS, type WebSocketLike } from '../src/client';

type Ev = { data?: unknown; code?: number; reason?: string };

/** `open`: the upgrade completes; `hello`: the room answers the hello. A socket missing either just sits there. */
class FakeWs implements WebSocketLike {
  readyState = 0;
  closed = false;
  private on: Record<string, ((e: Ev) => void)[]> = {};
  constructor(readonly open: boolean, readonly hello: boolean) {
    if (open) setTimeout(() => { this.readyState = 1; this.emit('open', {}); }, 10);
  }
  addEventListener(type: string, fn: (e: Ev) => void): void { (this.on[type] ??= []).push(fn); }
  emit(type: string, e: Ev): void { for (const f of this.on[type] ?? []) f(e); }
  send(data: string): void {
    if (data === 'ping') { setTimeout(() => this.emit('message', { data: 'pong' }), 10); return; }
    const m = JSON.parse(data) as { id: number; op: string };
    if (m.op === 'hello' && !this.hello) return;
    setTimeout(() => this.emit('message', { data: JSON.stringify({ t: 'res', id: m.id, ok: true, data: { op: m.op }, now: '' }) }), 10);
  }
  close(): void { this.readyState = 3; this.closed = true; }
}

function setup(): { client: VersusCfClient; sockets: FakeWs[]; net: { open: boolean; hello: boolean } } {
  const net = { open: true, hello: true };
  const sockets: FakeWs[] = [];
  const client = new VersusCfClient({
    baseUrl: 'http://x', roomId: 'r', token: async () => 'dev.u.dev', versusProtocol: 1, contentRevision: 'c',
    ws: () => { const w = new FakeWs(net.open, net.hello); sockets.push(w); return w; },
  });
  return { client, sockets, net };
}

describe('VersusCfClient: a reconnect that never finishes its handshake', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('the hello is lost after the upgrade: the socket is replaced, and a request queued meanwhile lands', async () => {
    const { client, sockets, net } = setup();
    const c = client.connect();
    await vi.advanceTimersByTimeAsync(50);
    await c;
    // The network blips: the socket closes; the reconnect's upgrade gets through but its hello is lost.
    net.hello = false;
    sockets.at(-1)!.emit('close', { code: 1006 });
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets).toHaveLength(2);
    const lock = client.request('submit', { final: true });
    net.hello = true;
    await vi.advanceTimersByTimeAsync(VERSUS_CF_HANDSHAKE_MS + 3_500);
    expect(sockets[1]!.closed).toBe(true);
    expect(sockets.length).toBeGreaterThanOrEqual(3);
    expect(client.isOpen).toBe(true);
    await expect(lock).resolves.toEqual({ op: 'submit' });
    client.close();
  });

  it('the upgrade itself never completes (no open, no close): the socket is replaced', async () => {
    const { client, sockets, net } = setup();
    const c = client.connect();
    await vi.advanceTimersByTimeAsync(50);
    await c;
    net.open = false;
    sockets.at(-1)!.emit('close', { code: 1006 });
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets).toHaveLength(2);
    net.open = true;
    await vi.advanceTimersByTimeAsync(VERSUS_CF_HANDSHAKE_MS + 3_500);
    expect(sockets[1]!.closed).toBe(true);
    expect(client.isOpen).toBe(true);
    client.close();
  });

  it('a healthy handshake is never cut', async () => {
    const { client, sockets } = setup();
    const c = client.connect();
    await vi.advanceTimersByTimeAsync(50);
    await c;
    await vi.advanceTimersByTimeAsync(VERSUS_CF_HANDSHAKE_MS * 3);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.closed).toBe(false);
    client.close();
  });
});
