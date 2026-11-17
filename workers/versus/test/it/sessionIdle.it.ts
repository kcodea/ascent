/**
 * THE SESSION SLEEPS (R-SESSION-ALARM-01; usage audit 2026-11-17: the hub's GameSession took ~7.5 requests a second per
 * game and never hibernated). In real workerd: a live session game is driven the way the client drives it (table, saves,
 * the listing, keyframes, the stream while watched, the end) and the object's own alarm count is read from its DEV
 * metrics. A game, watched or not, wakes its object only for the messages it is sent and the few clocks that matter (a
 * stale socket check, the listing keep-alive); an ENDED game that still owes nothing but its 30-minute memory must not
 * re-arm its alarm to "now" over and over.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VersusCfClient, type WebSocketLike } from '../../src/client';
import { LIVE_CF_PROTOCOL, type LiveHelloAnswer } from '../../src/liveProtocol';
import { SESSION_PROTOCOL, sessionPath, sessionSocketPath } from '../../src/sessionProtocol';
import { CONTENT, startHubWorker } from './driver';

const NodeWS = (globalThis as unknown as { WebSocket: new (url: string, protocols: string[]) => WebSocketLike }).WebSocket;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let hub = '';
let dispose: () => Promise<void> = async () => undefined;
beforeAll(async () => {
  const h = await startHubWorker();
  hub = h.url;
  dispose = h.dispose;
}, 120_000);
afterAll(async () => dispose());

const socket = (gameId: string, role: 'publish' | 'watch', userId: string, name: string): VersusCfClient => new VersusCfClient({
  baseUrl: hub, roomId: gameId, path: sessionSocketPath(gameId), token: async () => `dev.${userId}.${name}`,
  versusProtocol: 0, contentRevision: CONTENT, ws: (url, protocols) => new NodeWS(url, protocols),
  hello: () => ({ protocol: LIVE_CF_PROTOCOL, role, name, profile: null, contentRevision: 'it' }),
  onHello: (_d) => { void (_d as LiveHelloAnswer); },
  onPush: () => undefined,
});
const call = async (gameId: string, op: string, user: string, body: Record<string, unknown>): Promise<number> => {
  const res = await fetch(`${hub}${sessionPath(gameId, op as never)}`, {
    method: 'POST', headers: { Authorization: `Bearer dev.${user}.Claudebot1`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocol: SESSION_PROTOCOL, ...body }),
  });
  await res.text();
  return res.status;
};
const alarms = async (gameId: string): Promise<number> =>
  ((await (await fetch(`${hub}${sessionPath(gameId, 'metrics')}`)).json()) as { live?: { alarms?: number } }).live?.alarms ?? 0;

/** A session game in play: the table, a save, the listing, a keyframe (what the client sends at a shop start). */
async function startGame(game: string, me: string): Promise<VersusCfClient> {
  expect(await call(game, 'table', me, { mode: 'ranked', seatKeys: ['p1|warden|1'] })).toBe(200);
  expect(await call(game, 'save', me, { runKey: `run:${game}`, expected: 0, deviceId: 'd', save: '{"round":1}' })).toBe(200);
  const pub = socket(game, 'publish', me, 'Claudebot1');
  await pub.connect();
  await pub.request('listing', { name: 'Claudebot1', hero: 'warden', round: 1, phase: 'shop', mode: 'ranked' });
  await pub.request('key', { frame: { kind: 'key', seq: 1 } });
  return pub;
}

describe('the game session sleeps between messages (R-SESSION-ALARM-01)', () => {
  it('in play, unwatched: no alarm storm', async () => {
    const game = crypto.randomUUID();
    const me = crypto.randomUUID();
    const pub = await startGame(game, me);
    const a0 = await alarms(game);
    await sleep(6_000);
    const a1 = await alarms(game);
    console.log(`[measure] unwatched, in play: ${a1 - a0} alarms in 6 s`);
    expect(a1 - a0).toBeLessThanOrEqual(2);
    pub.close();
  }, 30_000);

  it('in play, one watcher streaming: no alarm storm', async () => {
    const game = crypto.randomUUID();
    const me = crypto.randomUUID();
    const pub = await startGame(game, me);
    const w = socket(game, 'watch', crypto.randomUUID(), 'Claudebot2');
    await w.connect();
    const a0 = await alarms(game);
    for (let i = 0; i < 24; i++) { pub.broadcast('spectate', { kind: 'delta', seq: i + 2 }); await sleep(250); }
    const a1 = await alarms(game);
    console.log(`[measure] one watcher, in play: ${a1 - a0} alarms in 6 s`);
    expect(a1 - a0).toBeLessThanOrEqual(2);
    w.close();
    pub.close();
  }, 30_000);

  it('ended, every socket gone, the session kept for its 30 minutes: the alarm is NOT re-armed to now', async () => {
    const game = crypto.randomUUID();
    const me = crypto.randomUUID();
    const pub = await startGame(game, me);
    await pub.request('end', { placement: 3 });
    pub.close();
    await sleep(1_000);
    const a0 = await alarms(game);
    await sleep(5_000);
    const a1 = await alarms(game);
    console.log(`[measure] ended, no sockets: ${a1 - a0} alarms in 5 s`);
    expect(a1 - a0).toBeLessThanOrEqual(2);
  }, 30_000);

  it('the player left mid-game (no end): after the grace no alarm storm either', async () => {
    const game = crypto.randomUUID();
    const me = crypto.randomUUID();
    const pub = await startGame(game, me);
    pub.close();
    await sleep(1_000);
    const a0 = await alarms(game);
    await sleep(5_000);
    const a1 = await alarms(game);
    console.log(`[measure] player gone, no end: ${a1 - a0} alarms in 5 s`);
    expect(a1 - a0).toBeLessThanOrEqual(2);
  }, 30_000);
});
