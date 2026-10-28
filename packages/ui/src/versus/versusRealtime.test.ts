/**
 * R-VERSUS-RELIABLE-01 (audit 2026-10-27; owner: "it would simply pause when someone returned"). REALTIME AT THE MATCH
 * START, AND REALTIME THAT HEALS. Run against the REAL realtime-js the game ships (2.108.2 over @supabase/phoenix 0.4.4)
 * through a fake WebSocket that answers like the Realtime server:
 *  - the match start's channel swap sends a join for the MATCH's own topic at once, even while the server has not yet
 *    answered the room channel's leave, and a late leave answer or close for the old join never touches it;
 *  - a join the server refuses, or a live channel the server closes, is re-opened with a backoff (before: nothing
 *    watched the join's status, so a dead channel stayed dead and the client ran on the 4 s heartbeat and 12 s polls);
 *  - a re-join reports the rows as changed, since anything that happened while it was down never arrived.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { makeVersusRemote, versusTopic } from './versusRemote';

type Msg = [string | null, string | null, string, string, Record<string, unknown>];

/** A fake Realtime server behind a fake WebSocket: joins are answered ok (echoing the postgres bindings), leaves only
 *  when released (`holdLeaves`), and a join can be refused once (`refuseNextJoin`). */
class FakeSocket {
  static all: FakeSocket[] = [];
  static holdLeaves = false;
  static refuseNextJoin = false;
  static held: (() => void)[] = [];
  static sent: Msg[] = [];
  readyState = 0;
  binaryType = 'arraybuffer';
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
    setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
  }
  reply(m: Msg, status: 'ok' | 'error', response: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify([m[0], m[1], m[2], 'phx_reply', { status, response }]) });
  }
  push(joinRef: string | null, topic: string, event: string): void {
    this.onmessage?.({ data: JSON.stringify([joinRef, null, topic, event, {}]) });
  }
  send(data: string): void {
    const m = JSON.parse(data) as Msg;
    FakeSocket.sent.push(m);
    const [, , , event, payload] = m;
    if (event === 'phx_join') {
      if (FakeSocket.refuseNextJoin) { FakeSocket.refuseNextJoin = false; setTimeout(() => this.reply(m, 'error', { reason: 'refused' }), 0); return; }
      const cfg = (payload.config ?? {}) as { postgres_changes?: Record<string, unknown>[] };
      const pg = (cfg.postgres_changes ?? []).map((f, i) => ({ ...f, id: i + 1 }));
      setTimeout(() => this.reply(m, 'ok', { postgres_changes: pg }), 0);
    } else if (event === 'phx_leave') {
      // The server answers the leave, then closes the topic for that join (as Phoenix does).
      const answer = (): void => { this.reply(m, 'ok', {}); this.push(m[0], m[2], 'phx_close'); };
      if (FakeSocket.holdLeaves) FakeSocket.held.push(answer);
      else setTimeout(answer, 0);
    } else if (event === 'heartbeat') {
      setTimeout(() => this.reply(m, 'ok', {}), 0);
    }
  }
  close(): void { this.readyState = 3; this.onclose?.({ code: 1000 }); }
}

const joins = (topic: string): Msg[] => FakeSocket.sent.filter((m) => m[3] === 'phx_join' && m[2] === `realtime:${topic}`);
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Let the fake server and realtime-js trade a few messages. */
async function settle(): Promise<void> { for (let i = 0; i < 6; i++) await tick(); }

let client: SupabaseClient;
beforeEach(() => {
  FakeSocket.all = [];
  FakeSocket.sent = [];
  FakeSocket.held = [];
  FakeSocket.holdLeaves = false;
  FakeSocket.refuseNextJoin = false;
  client = createClient('http://localhost:54321', 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: FakeSocket as never, heartbeatIntervalMs: 600_000 },
  });
});
afterEach(async () => {
  await client.removeAllChannels().catch(() => undefined);
});

describe('R-VERSUS-RELIABLE-01: Realtime at the match start, and Realtime that heals', () => {
  it('the topic names the match', () => {
    expect(versusTopic('r1', null)).toBe('versus:r1:room');
    expect(versusTopic('r1', 'm1')).toBe('versus:r1:m1');
  });

  it('the match start: a join for the MATCH goes out at once, while the room channel\'s leave is still unanswered', async () => {
    const remote = makeVersusRemote(() => client);
    const room = remote.subscribeRoom('r1', null, () => undefined);
    await settle();
    expect(joins(versusTopic('r1', null))).toHaveLength(1);
    FakeSocket.holdLeaves = true; // the server is slow to answer the room channel's leave
    void room.close();
    const match = remote.subscribeRoom('r1', 'm1', () => undefined);
    await settle();
    expect(joins(versusTopic('r1', 'm1')), 'the match channel joined').toHaveLength(1);
    // Its join carries the match's own row bindings (the match row and the round inserts).
    const tables = ((joins(versusTopic('r1', 'm1'))[0]![4].config as { postgres_changes: { table: string }[] }).postgres_changes).map((x) => x.table);
    expect(tables).toEqual(expect.arrayContaining(['versus_rooms', 'versus_matches', 'versus_rounds', 'versus_group_matches', 'versus_group_rounds']));
    // The late leave answer and the server's close of the OLD join land now: the match channel stays joined.
    FakeSocket.held.forEach((f) => f());
    await settle();
    expect(client.getChannels().map((c) => `${c.topic}|${c.state}`)).toEqual([`realtime:${versusTopic('r1', 'm1')}|joined`]);
    void match.close();
  });

  it('the same match again (a reconnect): the late close of the old join never closes the new one', async () => {
    const remote = makeVersusRemote(() => client);
    const a = remote.subscribeRoom('r1', 'm1', () => undefined);
    await settle();
    FakeSocket.holdLeaves = true;
    void a.close();
    const b = remote.subscribeRoom('r1', 'm1', () => undefined);
    await settle();
    expect(joins(versusTopic('r1', 'm1'))).toHaveLength(2);
    FakeSocket.held.forEach((f) => f());
    await settle();
    await tick(1200);
    await settle();
    expect(client.getChannels().map((c) => `${c.topic}|${c.state}`)).toEqual([`realtime:${versusTopic('r1', 'm1')}|joined`]);
    expect(joins(versusTopic('r1', 'm1')), 'no churn').toHaveLength(2);
    void b.close();
  });

  it('a refused join is re-opened after the backoff', async () => {
    const remote = makeVersusRemote(() => client);
    const woke: string[] = [];
    FakeSocket.refuseNextJoin = true;
    const ch = remote.subscribeRoom('r1', 'm1', (what) => woke.push(what));
    await settle();
    expect(joins(versusTopic('r1', 'm1'))).toHaveLength(1);
    await tick(1100); // the first backoff step (1 s)
    await settle();
    expect(joins(versusTopic('r1', 'm1')).length, 'joined again after the backoff').toBeGreaterThanOrEqual(2);
    expect(client.getChannels().map((c) => c.state)).toEqual(['joined']);
    // The very first join of a channel reports nothing (its caller has just read the rows).
    expect(woke).toEqual([]);
    void ch.close();
  });

  it('the server closes a live channel: re-opened, and the rows are read again (nothing that changed meanwhile is lost)', async () => {
    const remote = makeVersusRemote(() => client);
    const woke: string[] = [];
    const ch = remote.subscribeRoom('r1', 'm3', (what) => woke.push(what));
    await settle();
    const topic = `realtime:${versusTopic('r1', 'm3')}`;
    FakeSocket.all[0]!.push(joins(versusTopic('r1', 'm3'))[0]![0], topic, 'phx_close');
    await settle();
    await tick(1100);
    await settle();
    expect(joins(versusTopic('r1', 'm3'))).toHaveLength(2);
    expect(woke).toEqual(expect.arrayContaining(['room', 'match', 'rounds']));
    void ch.close();
  });

  it('a close of ours never re-opens', async () => {
    const remote = makeVersusRemote(() => client);
    const ch = remote.subscribeRoom('r1', 'm2', () => undefined);
    await settle();
    await ch.close();
    await tick(1200);
    await settle();
    expect(joins(versusTopic('r1', 'm2'))).toHaveLength(1);
  });
});
