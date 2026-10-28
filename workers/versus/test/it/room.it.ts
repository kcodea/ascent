/**
 * VERSUS ON CLOUDFLARE — the Room Durable Object in real workerd (`npm run versus:cf:test`, local only). The rules are
 * covered on a fake clock by `test/roomCore.test.ts`; this file proves the parts only the runtime can: the WebSocket
 * upgrade and auth, the hello version check, pushes reaching every client, the ALARM closing a round at 0:00, socket
 * close detection and the reconnect, and the directory's one-room-per-account rule.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveVersusFight, versusStartingVitals, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { versusFightDigest } from '@game/sim';
import { VersusCfClient, versusCfHttp } from '../../src/client';
import { CONTENT, FIXTURE, HERO_IDS, Player, sideOf, startLocalWorker, toGroupShop, toRoundOne } from './driver';

let base = '';
let dispose: () => Promise<void> = async () => undefined;

beforeAll(async () => {
  const w = await startLocalWorker();
  base = w.url;
  dispose = w.dispose;
});
afterAll(async () => dispose());

describe('Versus room in workerd', () => {
  it('health names the engine; a socket without a valid token is refused', async () => {
    const h = await (await fetch(`${base}/health`)).json() as Record<string, unknown>;
    expect(h).toMatchObject({ protocol: VERSUS_PROTOCOL, contentRevision: CONTENT });
    const ws = new (globalThis as any).WebSocket(`${base.replace(/^http/, 'ws')}/rooms/${crypto.randomUUID()}/ws`, ['ascent-versus.v1']);
    const opened = await new Promise<boolean>((r) => { ws.addEventListener('open', () => r(true)); ws.addEventListener('error', () => r(false)); });
    expect(opened).toBe(false);
    await expect(versusCfHttp(base, '/rooms', 'dev.not-a-uuid.x', { method: 'POST', body: {} })).rejects.toThrow('not_signed_in');
  });

  it('a client on another content revision is refused at hello (4409) and never plays', async () => {
    const p = new Player(base, crypto.randomUUID(), 'Claudebot1');
    const roomId = await p.createRoom();
    let status = '';
    const c = new VersusCfClient({
      baseUrl: base, roomId, token: async () => p.token, versusProtocol: VERSUS_PROTOCOL, contentRevision: 'deadbeef',
      ws: (url, protocols) => new (globalThis as any).WebSocket(url, protocols), onStatus: (s, d) => { status = `${s}:${d}`; },
    });
    void c.connect().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1000));
    expect(status).toBe('dead:version_mismatch');
    c.close();
  });

  it('one room per account (the directory)', async () => {
    const p = new Player(base, crypto.randomUUID(), 'Claudebot1');
    await p.createRoom();
    await expect(p.createRoom()).rejects.toThrow('already_in_room');
  });

  it('both ready: every client gets the fight in one push, identical to the reference resolver', async () => {
    const { a, b } = await toRoundOne(base);
    const mid = a.matchId;
    await a.req('submit', { matchId: mid, round: 1, seq: 1, side: sideOf(1, 'p1'), final: true, checkpoint: null });
    const got = Promise.all([a, b].map((p) => p.next((m) => m.t === 'round' && m.row.round === 1)));
    const answer = await b.req('submit', { matchId: mid, round: 1, seq: 1, side: sideOf(1, 'p2'), final: true, checkpoint: null });
    expect(answer.phase).toBe('combat');
    const [ra, rb] = await got;
    expect(ra.msg).toEqual(rb.msg);
    const row = (ra.msg as { row: Record<string, any> }).row;
    const c = FIXTURE.cases[0]!;
    const before = { p1: versusStartingVitals(a.match!.p1_hero, a.match!.options), p2: versusStartingVitals(a.match!.p2_hero, a.match!.options) };
    const ref = resolveVersusFight({ matchSeed: Number(a.match!.seed), round: 1, p1: structuredClone(c.p1), p2: structuredClone(c.p2), vitals: before });
    expect(row.digest).toBe(versusFightDigest(ref));
    for (const p of [a, b]) p.client!.close();
  });

  it('0:00: the alarm closes the round (newest candidate promoted) and pushes the fight', async () => {
    const { a, b } = await toRoundOne(base);
    const mid = a.matchId;
    await a.req('submit', { matchId: mid, round: 1, seq: 1, side: sideOf(1, 'p1'), final: true, checkpoint: null });
    await b.req('submit', { matchId: mid, round: 1, seq: 1, side: sideOf(1, 'p2'), final: false, checkpoint: null });
    const deadline = Date.parse(String(a.match!.shop_deadline));
    const [ra] = await Promise.all([a, b].map((p) => p.next((m) => m.t === 'round' && m.row.round === 1, 60_000)));
    expect(ra.wall - deadline).toBeGreaterThanOrEqual(250);
    expect(ra.wall - deadline).toBeLessThan(2_000);
    for (const p of [a, b]) p.client!.close();
  });

  it('a dropped player: blip reconnects without a pause; gone pauses after the grace; back resumes', async () => {
    const { a, b, roomId } = await toRoundOne(base);
    (b.client as unknown as { ws: { close(): void } }).ws.close();
    await b.next((m) => m.t === 'match');
    await new Promise((r) => setTimeout(r, 3_500));
    expect(a.match!.paused_at).toBeNull();
    const paused = a.next((m) => m.t === 'match' && m.match.paused_at != null);
    b.client!.close();
    expect((await paused).msg).toMatchObject({ match: { paused_seat: 'p2' } });
    const b2 = new Player(base, b.userId, 'Claudebot2');
    await b2.connect(roomId);
    const resumed = a.next((m) => m.t === 'match' && m.match.paused_at == null);
    await b2.req('request_resume', { matchId: a.matchId });
    await resumed;
    for (const p of [a, b2]) p.client!.close();
  });
});

describe('Group room in workerd', () => {
  it('4 players: the last lock resolves both fights and every client gets the round in one push; a drop pauses', async () => {
    const { players, matchId } = await toGroupShop(base, 4);
    for (const p of players.slice(0, 3)) await p.req('submit', { matchId, round: 1, seq: 1, side: sideOf(1, 'p1'), final: true, checkpoint: null });
    const got = Promise.all(players.map((p) => p.next((m) => m.t === 'round' && m.row.round === 1 && Array.isArray(m.row.fights))));
    const answer = await players[3]!.req('submit', { matchId, round: 1, seq: 1, side: sideOf(1, 'p2'), final: true, checkpoint: null });
    expect(answer.phase).toBe('combat');
    const rows = (await got).map((a) => (a.msg as unknown as { row: { fights: unknown[]; digest: string } }).row);
    expect(rows[0]!.fights).toHaveLength(2);
    expect(new Set(rows.map((r) => r.digest)).size).toBe(1);
    const paused = players[0]!.next((m) => m.t === 'match' && m.match.paused_at != null);
    players[3]!.client!.close();
    expect((await paused).msg).toMatchObject({ match: { paused_seat: 'p4' } });
    for (const p of players.slice(0, 3)) p.client!.close();
  });
});

describe('Duos room in workerd', () => {
  it('one tag-team fight reaches all four; a pass reaches the teammate only', async () => {
    const { players, matchId } = await toGroupShop(base, 4, 'duos');
    const [p1, p2, p3, p4] = players as [Player, Player, Player, Player];
    const mateSaw = p2.next((m) => m.t === 'pass');
    let foeSaw = false;
    const foeWatch = p3.next((m) => m.t === 'pass', 1500).then(() => { foeSaw = true; }, () => undefined);
    const row = await p1.req('duos_pass', { matchId, round: 1, seq: 1, card: { cardId: 'x', passFrom: 'hand' } });
    expect(row.to_seat).toBe('p2');
    expect(((await mateSaw).msg as unknown as { row: { seq: number } }).row.seq).toBe(1);
    await foeWatch;
    expect(foeSaw).toBe(false);
    for (const p of [p1, p2, p3]) await p.req('submit', { matchId, round: 1, seq: 1, side: sideOf(1, 'p1'), final: true, checkpoint: null });
    const got = Promise.all(players.map((p) => p.next((m) => m.t === 'round' && m.row.round === 1)));
    await p4.req('submit', { matchId, round: 1, seq: 1, side: sideOf(1, 'p2'), final: true, checkpoint: null });
    const rows = (await got).map((a) => (a.msg as unknown as { row: { fights: unknown[] } }).row);
    expect(rows.every((r) => r.fights.length === 1)).toBe(true);
    for (const p of players) p.client!.close();
  });
});

describe('Ranked Duos party in workerd', () => {
  it('the pair plays a round against three seated teams (local: generated, unrated); every client gets the ranked round', async () => {
    const a = new Player(base, crypto.randomUUID(), 'Claudebot1');
    const b = new Player(base, crypto.randomUUID(), 'Claudebot2');
    const roomId = await (async () => {
      const room = await versusCfHttp<Record<string, any>>(base, '/rooms', a.token, {
        method: 'POST', body: { name: 'Party', display: 'A', profile: {}, setId: 'set1', contentRevision: CONTENT, protocol: VERSUS_PROTOCOL, options: { v: 1, mode: 'ranked_duos', modifiers: [] } },
      });
      return room.id as string;
    })();
    await a.connect(roomId);
    await b.connect(roomId);
    await b.req('join', { as: 'player', display: 'B', profile: {}, content: CONTENT, protocol: VERSUS_PROTOCOL });
    await a.req('start');
    await a.req('gate');
    await b.req('gate');
    const matchId = (await a.req('sync')).match.id as string;
    await a.req('register_offer', { matchId, offer: HERO_IDS.slice(0, 3) });
    await b.req('register_offer', { matchId, offer: HERO_IDS.slice(3, 6) });
    await a.req('pick_hero', { matchId, index: 0 });
    await b.req('pick_hero', { matchId, index: 0 });
    await a.next((m) => m.t === 'match' && (m.match as { seated?: boolean }).seated === true, 10_000);
    await a.req('intro_done', { matchId });
    await b.req('intro_done', { matchId });
    await a.req('submit', { matchId, round: 1, seq: 1, side: sideOf(1, 'p1'), final: true, checkpoint: null });
    const got = Promise.all([a, b].map((p) => p.next((m) => m.t === 'round' && (m.row as { kind?: string }).kind === 'ranked')));
    await b.req('submit', { matchId, round: 1, seq: 1, side: sideOf(1, 'p2'), final: true, checkpoint: null });
    const rows = (await got).map((x) => (x.msg as unknown as { row: { vitals: Record<string, unknown> } }).row);
    expect(Object.keys(rows[0]!.vitals).sort()).toEqual(['a', 'b', 'c', 'd']);
    const table = await a.req('ranked_table', { matchId });
    expect(table.served).toHaveLength(6);
    for (const p of [a, b]) p.client!.close();
  });
});
