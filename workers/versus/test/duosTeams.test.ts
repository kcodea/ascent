/**
 * VERSUS DUOS, THREE AND FOUR TEAMS (owner 2026-11-06, R-VERSUS-EIGHT-01) on a fake clock: every committed round equals the
 * resolver's digest, a Copy never hurts the copied team, teams out together share a place, and only full teams start.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HEROES, resolveVersusDuosTable, versusDuosStartingVitals, versusDuosTeamPairings, duosTableDigest, type PreparedCombatSide, type VersusDuosTeamId } from '@game/sim';
import { engineContentRevision, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { newRoomState, RoomCore, type CoreDeps } from '../src/core/roomCore';
import type { GSeat } from '../src/core/groupMatch';

interface Case { p1: PreparedCombatSide; p2: PreparedCombatSide }
const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/sim/src/versus/fixtures/parity.v1.json', import.meta.url)), 'utf8')) as { cases: Case[] };
const STRONG = FIXTURE.cases.find((c) => c.p1.board.length === 7)!.p1;
const EMPTY: PreparedCombatSide = { board: [], state: structuredClone(FIXTURE.cases[0]!.p1.state), config: {} };

const U = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`);
const SEAT: GSeat[] = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
const ROOM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HERO_IDS = HEROES.slice(0, 24).map((h) => h.id);
const DUOS = { v: 1, mode: 'duos', modifiers: [] };
const JOIN = (i: number) => ({ as: 'player', display: `P${i + 1}`, profile: {}, content: engineContentRevision(), protocol: VERSUS_PROTOCOL });

function deps(): CoreDeps {
  let s = 777;
  let u = 0;
  return { random31: () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff), uuid: () => `cccccccc-cccc-4ccc-8ccc-${String(++u).padStart(12, '0')}` } as unknown as CoreDeps;
}

class H {
  now = Date.UTC(2026, 10, 6, 12, 0, 0);
  core = new RoomCore(newRoomState({ id: ROOM, name: 'D', hostUserId: U[0]!, displayName: 'P1', profile: {}, setId: 'set1', contentRevision: engineContentRevision(), protocol: VERSUS_PROTOCOL, options: DUOS } as never, this.now), deps());
  async op(user: string, op: string, args: Record<string, unknown> = {}): Promise<unknown> { return (await this.core.op(user, op, args, this.now)).data; }
  get g() { return this.core.state.group!.match; }
  seat(s: GSeat) { return this.g.seats.find((x) => x.seat === s)!; }
  team(t: string) { return this.g.teams!.find((x) => x.team === t)!; }
}

async function seated(n: number): Promise<H> {
  const h = new H();
  for (let i = 0; i < n; i++) h.core.connect(U[i]!, h.now);
  for (let i = 1; i < n; i++) await h.op(U[i]!, 'join', JOIN(i));
  return h;
}

async function inShop(n: number): Promise<H> {
  const h = await seated(n);
  await h.op(U[0]!, 'start');
  for (let i = 0; i < n; i++) await h.op(U[i]!, 'gate');
  for (let i = 0; i < n; i++) await h.op(U[i]!, 'register_offer', { matchId: h.g.id, offer: HERO_IDS.slice(i * 3, i * 3 + 3) });
  for (let i = 0; i < n; i++) await h.op(U[i]!, 'pick_hero', { matchId: h.g.id, index: 0 });
  for (let i = 0; i < n; i++) await h.op(U[i]!, 'intro_done', { matchId: h.g.id });
  return h;
}

const lock = async (h: H, n: number, side: (i: number) => PreparedCombatSide): Promise<void> => {
  const round = h.g.round;
  for (let i = 0; i < n; i++) if (h.seat(SEAT[i]!).eliminated_round == null) await h.op(U[i]!, 'submit', { matchId: h.g.id, round, seq: 1, side: structuredClone(side(i)), final: true, checkpoint: null });
};
const ready = async (h: H, n: number): Promise<void> => {
  const round = h.g.round;
  for (let i = 0; i < n; i++) if (h.seat(SEAT[i]!).eliminated_round == null) await h.op(U[i]!, 'combat_ready', { matchId: h.g.id, round });
};

describe('Versus Duos with three and four teams (R-VERSUS-EIGHT-01)', () => {
  it('the schedule: 4 teams = two fights and everyone meets once in 3 rounds; 3 teams = one fight and one Copy', () => {
    const four: VersusDuosTeamId[] = ['a', 'b', 'c', 'd'];
    const met = new Set<string>();
    for (let r = 1; r <= 3; r++) {
      const ps = versusDuosTeamPairings(four, {}, r);
      expect(ps).toHaveLength(2);
      for (const p of ps) met.add(`${p.a}${p.b}`);
    }
    expect(met.size).toBe(6);
    const three = versusDuosTeamPairings(['a', 'b', 'c'], {}, 1);
    expect(three.map((p) => p.copy)).toEqual([false, true]);
    expect(versusDuosTeamPairings(four, { d: 1 }, 2).filter((p) => p.copy)).toHaveLength(1); // one team out: three left
  });

  it('four teams: two tag-team fights a round, equal to the resolver, each team charged once', async () => {
    const h = await inShop(8);
    expect(h.g.teams!.map((t) => t.team)).toEqual(['a', 'b', 'c', 'd']);
    const pick = (i: number): PreparedCombatSide => (i < 2 || (i >= 4 && i < 6) ? STRONG : EMPTY); // teams a and c are strong
    await lock(h, 8, pick);
    expect(h.g.phase).toBe('combat');
    const r1 = h.core.state.group!.rounds[1]!;
    expect(r1.fights).toHaveLength(2);
    const teams: VersusDuosTeamId[] = ['a', 'b', 'c', 'd'];
    const sides = Object.fromEntries(SEAT.map((s, i) => [s, pick(i)]));
    const vitals = Object.fromEntries(teams.map((t, k) => [t, versusDuosStartingVitals(h.seat(SEAT[2 * k]!).hero, h.seat(SEAT[2 * k + 1]!).hero, h.g.options)]));
    expect(r1.digest).toBe(duosTableDigest(resolveVersusDuosTable({ matchSeed: h.g.seed, round: 1, teams, eliminated: {}, sides, vitals })));
    await ready(h, 8);
    expect(h.g.round).toBe(2);
  });

  it('three teams: the odd team faces a Copy, which never costs the copied team anything', async () => {
    const h = await inShop(6);
    const before = h.team('b').health;
    await lock(h, 6, (i) => (i >= 4 ? STRONG : i < 2 ? STRONG : EMPTY));
    const r1 = h.core.state.group!.rounds[1]!;
    expect(r1.fights).toHaveLength(2);
    const copy = r1.fights.find((f) => f.b_copy)!;
    expect(copy).toBeTruthy();
    expect(copy.heart_lost_by === copy.b_seat).toBe(false);
    expect(before).toBeNull(); // pools fill on the first commit
  });

  it('a team at zero is out, placed by how many teams were still in; the match plays on until one team stands', async () => {
    const h = await inShop(6);
    const pick = (i: number): PreparedCombatSide => (i < 2 ? STRONG : EMPTY);
    const done = (): boolean => (h.g.phase as string) === 'complete';
    for (let guard = 0; guard < 80 && !done(); guard++) {
      await lock(h, 6, pick);
      if (done()) break;
      await ready(h, 6);
    }
    expect(done()).toBe(true);
    expect(h.team('a').eliminated_round).toBeNull();
    const places = h.g.teams!.filter((t) => t.team !== 'a').map((t) => t.placement);
    for (const p of places) expect([2, 3]).toContain(p);
  });

  it('only full teams start; a gap between teams closes up at the start', async () => {
    const half = await seated(5);
    await expect(half.op(U[0]!, 'start')).rejects.toThrow('need_full_teams');
    const gap = await seated(4); // p1 p2 p3 p4
    await gap.op(U[2]!, 'take_seat', { role: 'p5' });
    await gap.op(U[3]!, 'take_seat', { role: 'p6' });
    await gap.op(U[0]!, 'start');
    for (let i = 0; i < 4; i++) await gap.op(U[i]!, 'gate');
    expect(gap.g.seats.map((s) => [s.seat, s.team])).toEqual([['p1', 'a'], ['p2', 'a'], ['p3', 'b'], ['p4', 'b']]);
    expect(gap.g.seats[2]!.user_id).toBe(U[2]);
  });

  it('a 2v2 stays one fight on the original resolver', async () => {
    const h = await inShop(4);
    await lock(h, 4, (i) => (i < 2 ? STRONG : EMPTY));
    expect(h.core.state.group!.rounds[1]!.fights).toHaveLength(1);
  });
});
