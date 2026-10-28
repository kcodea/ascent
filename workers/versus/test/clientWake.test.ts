/**
 * R-VERSUS-CF-RECONNECT-01: a room socket that is down reconnects AT ONCE when the device's network comes back (the
 * browser's `online` event, the client's `wake` hook), instead of waiting out its backoff (up to 3 s). Found by the
 * Cloudflare chaos matrix (dropFin: the returning player's pause lifted 4.1 s after they were back, over the 4 s bar).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VersusCfClient, type WebSocketLike } from '../src/client';

type Ev = { data?: unknown; code?: number; reason?: string };

/** A socket that the test opens / closes; answers the hello. */
class FakeWs implements WebSocketLike {
  readyState = 0;
  private on: Record<string, ((e: Ev) => void)[]> = {};
  constructor(readonly fail: boolean) {
    setTimeout(() => {
      if (this.fail) { this.emit('error', {}); this.emit('close', { code: 1006 }); return; }
      this.readyState = 1;
      this.emit('open', {});
    }, 10);
  }
  addEventListener(type: string, fn: (e: Ev) => void): void { (this.on[type] ??= []).push(fn); }
  emit(type: string, e: Ev): void { for (const f of this.on[type] ?? []) f(e); }
  send(data: string): void {
    const m = JSON.parse(data) as { id: number; op: string };
    if (m.op === 'hello') setTimeout(() => this.emit('message', { data: JSON.stringify({ t: 'res', id: m.id, ok: true, data: {}, now: '' }) }), 10);
  }
  close(): void { this.readyState = 3; }
}

describe('VersusCfClient: reconnect on wake', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a socket waiting out its backoff reconnects at once when the network comes back', async () => {
    let offline = false;
    const sockets: FakeWs[] = [];
    let wake: (() => void) | null = null;
    const client = new VersusCfClient({
      baseUrl: 'http://x', roomId: 'r', token: async () => 'dev.u.dev', versusProtocol: 1, contentRevision: 'c',
      ws: () => { const w = new FakeWs(offline); sockets.push(w); return w; },
      wake: (fn) => { wake = fn; return () => { wake = null; }; },
    });
    const connected = client.connect();
    await vi.advanceTimersByTimeAsync(50);
    await connected;
    expect(client.isOpen).toBe(true);

    // The network goes: the socket closes, and every reconnect fails while it is gone (the backoff grows to 3 s).
    offline = true;
    sockets.at(-1)!.emit('close', { code: 1006 });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(client.isOpen).toBe(false);
    const tried = sockets.length;

    // Back: the wake reconnects now, well inside the backoff that was pending.
    offline = false;
    wake!();
    await vi.advanceTimersByTimeAsync(50);
    expect(sockets.length).toBe(tried + 1);
    expect(client.isOpen).toBe(true);

    client.close();
    expect(wake).toBeNull();
  });

  it('a wake while the socket is up does nothing', async () => {
    const sockets: FakeWs[] = [];
    let wake: (() => void) | null = null;
    const client = new VersusCfClient({
      baseUrl: 'http://x', roomId: 'r', token: async () => 'dev.u.dev', versusProtocol: 1, contentRevision: 'c',
      ws: () => { const w = new FakeWs(false); sockets.push(w); return w; },
      wake: (fn) => { wake = fn; return () => { wake = null; }; },
    });
    const connected = client.connect();
    await vi.advanceTimersByTimeAsync(50);
    await connected;
    wake!();
    await vi.advanceTimersByTimeAsync(50);
    expect(sockets.length).toBe(1);
    client.close();
  });
});
