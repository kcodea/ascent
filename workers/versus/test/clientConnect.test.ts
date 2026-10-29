/**
 * R-VERSUS-CF-CONNECT-01 (live 2026-10-29: with Ranked Duos on the Cloudflare host, Duo + Play sat on "Opening your
 * party..." for good). Opening a room socket must ALWAYS settle:
 *  - a socket that never completes its hello (a room that is gone answers its upgrade with 404, which a browser only
 *    sees as a dropped socket, so the client retried for ever) fails `connect()` with `timeout` at the deadline;
 *  - `close()` (a newer room took the transport's one socket) fails a `connect()` still waiting;
 *  - a fatal close before the hello (version mismatch, replaced, room closed) fails it with that reason.
 * Before the fix every one of these left `connect()` pending for ever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VersusCfClient, type WebSocketLike } from '../src/client';
import { VERSUS_CF_CLOSE } from '../src/protocol';

type Ev = { data?: unknown; code?: number; reason?: string };

/** `refused`: every upgrade fails (error + 1006, as a browser reports a 404). `silent`: opens, never answers the hello.
 *  `fatal`: opens, then the room closes it with `code` before answering. */
class FakeWs implements WebSocketLike {
  readyState = 0;
  private on: Record<string, ((e: Ev) => void)[]> = {};
  constructor(readonly kind: 'refused' | 'silent' | 'fatal', readonly code = 0) {
    setTimeout(() => {
      if (kind === 'refused') { this.emit('error', {}); this.emit('close', { code: 1006 }); return; }
      this.readyState = 1;
      this.emit('open', {});
      if (kind === 'fatal') setTimeout(() => this.emit('close', { code: this.code, reason: 'version_mismatch' }), 5);
    }, 10);
  }
  addEventListener(type: string, fn: (e: Ev) => void): void { (this.on[type] ??= []).push(fn); }
  emit(type: string, e: Ev): void { for (const f of this.on[type] ?? []) f(e); }
  send(): void { /* never answers */ }
  close(): void { this.readyState = 3; }
}

function client(kind: 'refused' | 'silent' | 'fatal', connectTimeoutMs?: number, code = 0) {
  const sockets: FakeWs[] = [];
  const c = new VersusCfClient({
    baseUrl: 'http://x', roomId: 'r', token: async () => 'dev.u.dev', versusProtocol: 1, contentRevision: 'c', connectTimeoutMs,
    ws: () => { const w = new FakeWs(kind, code); sockets.push(w); return w; },
  });
  return { c, sockets };
}

/** Settles `p` into a tag (never throws), so a test can see "still pending". */
function watch(p: Promise<unknown>): { state: () => string } {
  let state = 'pending';
  p.then(() => { state = 'resolved'; }, (e: { code?: string }) => { state = `rejected:${e?.code ?? e}`; });
  return { state: () => state };
}

describe('VersusCfClient.connect never hangs (R-VERSUS-CF-CONNECT-01)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a refused upgrade (a gone room) fails connect() with timeout at the deadline, not never', async () => {
    const { c, sockets } = client('refused', 10_000);
    const w = watch(c.connect());
    await vi.advanceTimersByTimeAsync(9_000);
    expect(w.state()).toBe('pending');
    expect(sockets.length).toBeGreaterThan(1); // it is retrying meanwhile
    await vi.advanceTimersByTimeAsync(1_500);
    expect(w.state()).toBe('rejected:timeout');
    c.close();
  });

  it('a socket that opens but never answers the hello fails at the deadline too', async () => {
    const { c } = client('silent', 10_000);
    const w = watch(c.connect());
    await vi.advanceTimersByTimeAsync(10_500);
    expect(w.state()).toBe('rejected:timeout');
    c.close();
  });

  it('close() fails a connect() that is still waiting (a newer room took the socket)', async () => {
    const { c } = client('refused');
    const w = watch(c.connect());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(w.state()).toBe('pending');
    c.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.state()).toBe('rejected:closed');
  });

  it('a fatal close before the hello fails connect() with its reason', async () => {
    const { c } = client('fatal', undefined, VERSUS_CF_CLOSE.versionMismatch);
    const w = watch(c.connect());
    await vi.advanceTimersByTimeAsync(100);
    expect(w.state()).toBe('rejected:version_mismatch');
    c.close();
  });

  it('a connect that succeeds clears its deadline (no late timeout)', async () => {
    const sockets: { emit: (t: string, e: Ev) => void }[] = [];
    const c = new VersusCfClient({
      baseUrl: 'http://x', roomId: 'r', token: async () => 'dev.u.dev', versusProtocol: 1, contentRevision: 'c', connectTimeoutMs: 1_000,
      ws: () => {
        const on: Record<string, ((e: Ev) => void)[]> = {};
        const w = {
          readyState: 0,
          addEventListener: (t: string, fn: (e: Ev) => void) => { (on[t] ??= []).push(fn); },
          emit: (t: string, e: Ev) => { for (const f of on[t] ?? []) f(e); },
          send: (data: string) => {
            const m = JSON.parse(data) as { id: number; op: string };
            if (m.op === 'hello') setTimeout(() => w.emit('message', { data: JSON.stringify({ t: 'res', id: m.id, ok: true, data: {}, now: '' }) }), 5);
          },
          close: () => undefined,
        };
        setTimeout(() => { w.readyState = 1; w.emit('open', {}); }, 5);
        sockets.push(w);
        return w;
      },
    });
    const w = watch(c.connect());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(w.state()).toBe('resolved');
    expect(c.isOpen).toBe(true);
    c.close();
  });
});
