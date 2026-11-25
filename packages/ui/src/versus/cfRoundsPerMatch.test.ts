// @vitest-environment jsdom
/**
 * R-VERSUS-ROUNDS-MATCH-01 (live 2026-11-25): one room plays match after match, and the rounds its socket caches are keyed by
 * round NUMBER. A second Ranked Duos game of a party replayed the first one's fights (its rounds were never dropped), never
 * came back to the shop, and the server closed the rounds without the players. Drives the REAL transport over a fake socket.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VersusError } from './versusRemote';
import { makeCfVersusRemote } from './versusCfRemote';

const ROOM = { id: 'room', members: [], status: 'in_game' };
/** What the room answers a request with, by op. */
let answers: Record<string, (args: Record<string, unknown>) => unknown> = {};
let asked: string[] = [];
let live: FakeSocket | null = null;

class FakeSocket {
  readyState = 0;
  private on: Record<string, ((e: unknown) => void)[]> = {};
  constructor() {
    live = this; // eslint-disable-line @typescript-eslint/no-this-alias
    setTimeout(() => { this.readyState = 1; for (const f of this.on.open ?? []) f({}); }, 0);
  }
  addEventListener(t: string, f: (e: unknown) => void): void { (this.on[t] ??= []).push(f); }
  deliver(msg: unknown): void { for (const f of this.on.message ?? []) f({ data: JSON.stringify(msg) }); }
  send(text: string): void {
    const m = JSON.parse(text.startsWith('{') ? text : '{}') as { t?: string; id?: number; op?: string; args?: Record<string, unknown> };
    if (m.t !== 'req') return;
    if (m.op !== 'hello') asked.push(m.op!);
    const data = m.op === 'hello' ? { room: ROOM, match: null, priv: null } : answers[m.op!]?.(m.args ?? {}) ?? null;
    setTimeout(() => this.deliver({ t: 'res', id: m.id, ok: true, data }), 0);
  }
  close(): void { this.readyState = 3; }
}

const push = (msg: Record<string, unknown>): void => live!.deliver({ ...msg, now: '' });
const ranked = (id: string, phase: string, round: number): void => push({ t: 'match', match: { id, phase, round, seats: [], revision: 1 } });
const rankedRound = (round: number, digest: string): void => push({ t: 'round', row: { kind: 'ranked', round, digest, fights: [{}] } });
const groupRound = (match_id: string, round: number): void => push({ t: 'round', row: { match_id, round, digest: match_id, fights: [{}] } });
const duel = (id: string, phase: string, round: number): void => push({ t: 'match', match: { id, phase, round, revision: 1 } });
const duelRound = (match_id: string, round: number): void => push({ t: 'round', row: { match_id, round } });

async function open(): Promise<ReturnType<typeof makeCfVersusRemote>> {
  vi.stubGlobal('WebSocket', FakeSocket);
  answers = { room: () => ROOM, heartbeat: () => ({ serverNow: '' }) };
  asked = [];
  const cf = makeCfVersusRemote({ baseUrl: 'http://worker', getClient: () => null, currentUserId: () => 'kev', makeError: (c, m) => new VersusError(c, m) });
  await cf.heartbeat('room'); // opens the room's socket
  asked = [];
  return cf;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('one room, many matches: rounds belong to their match (R-VERSUS-ROUNDS-MATCH-01)', () => {
  it('a second Ranked Duos game never reads a fight of the first', async () => {
    const cf = await open();
    ranked('m1', 'shop', 1);
    for (let r = 1; r <= 13; r++) rankedRound(r, 'first');
    ranked('m1', 'complete', 13);
    expect((await cf.rankedRounds('m1', 1)).length).toBe(13);
    ranked('m2', 'shop', 1);
    expect(await cf.rankedRounds('m2', 1)).toEqual([]);
    rankedRound(1, 'second'); // the round goes out just before the match row that moves to combat
    expect((await cf.rankedRounds('m2', 1)).map((r) => [r.round, (r as unknown as { digest: string }).digest])).toEqual([[1, 'second']]);
    ranked('m2', 'combat', 1);
    expect((await cf.rankedRounds('m2', 1)).map((r) => r.round)).toEqual([1]);
    expect(asked).toEqual([]); // all from the pushes
  });

  it('a read for the match before is not answered with the rounds of this one', async () => {
    const cf = await open();
    ranked('m1', 'combat', 1);
    rankedRound(1, 'first');
    ranked('m2', 'combat', 1);
    rankedRound(1, 'second');
    expect(await cf.rankedRounds('m1', 1)).toEqual([]);
    expect(await cf.groupRounds('m1', 1)).toEqual([]);
  });

  it('a read in flight when the room moves on brings nothing of the old match', async () => {
    const cf = await open();
    ranked('m1', 'combat', 2); // a reload: the rounds were committed before this socket
    answers.ranked_rounds = () => [{ round: 1, digest: 'first', fights: [{}] }, { round: 2, digest: 'first', fights: [{}] }];
    const reading = cf.rankedRounds('m1', 1);
    ranked('m2', 'shop', 1);
    expect(await reading).toEqual([]);
    answers.ranked_rounds = () => [];
    expect(await cf.rankedRounds('m2', 1)).toEqual([]);
  });

  it('holds for Group and 1v1 too, with a match of another mode in between', async () => {
    const cf = await open();
    ranked('g1', 'combat', 1);
    groupRound('g1', 1);
    expect((await cf.groupRounds('g1', 1)).length).toBe(1);
    duel('d1', 'combat', 1);
    duelRound('d1', 1);
    expect((await cf.rounds('d1', 1)).length).toBe(1);
    ranked('g2', 'shop', 1);
    expect(await cf.groupRounds('g2', 1)).toEqual([]);
    duel('d2', 'shop', 1);
    expect(await cf.rounds('d2', 1)).toEqual([]);
  });
});
