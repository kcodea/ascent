/**
 * VERSUS ON CLOUDFLARE — RANKED DUOS on a fake clock: the party, the team identity, the table seated by the Edge
 * Function's own seating handler (from a fake Supabase), the both-ready close and its 30 s overtime, no pause (absence =
 * auto), leaving, and the end: ONE `ranked_finish` job carrying the placement, the rating's inputs and the duo run.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HEROES, type PreparedCombatSide } from '@game/sim';
import { engineContentRevision, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { parseDuosHistory } from '@game/sim/versus/duosHistory';
import { DISCONNECT_GRACE_MS, newRoomState, RoomCore, turnSeconds, type CoreDeps, type CoreEffects, type CoreState } from '../src/core/roomCore';
import { memberBoard, type RankedService } from '../src/core/rankedMatch';
import { LocalRankedService } from '../src/rankedService';
import { stateFromEntries, valueOfKey } from '../src/core/storage';

interface Case { name: string; matchSeed: number; round: number; p1: PreparedCombatSide; p2: PreparedCombatSide }
const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/sim/src/versus/fixtures/parity.v1.json', import.meta.url)), 'utf8')) as { cases: Case[] };
const STRONG = FIXTURE.cases.find((c) => c.p1.board.length === 7)!.p1;
const MID = FIXTURE.cases[1]!.p2;

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const TEAM = '99999999-9999-4999-8999-999999999999';
const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);
const HERO_IDS = HEROES.slice(0, 6).map((h) => h.id);

function deps(): CoreDeps {
  let s = 99;
  let u = 0;
  return { random31: () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff), uuid: () => `eeeeeeee-eeee-4eee-8eee-${String(++u).padStart(12, '0')}` };
}

class H {
  now = T0;
  core: RoomCore;
  log: CoreEffects[] = [];
  constructor(state?: CoreState) {
    this.core = new RoomCore(state ?? newRoomState({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac', name: 'Party', hostUserId: U1, displayName: 'One', profile: {}, setId: 'set1', contentRevision: engineContentRevision(), protocol: VERSUS_PROTOCOL, options: { v: 1, mode: 'ranked_duos', modifiers: [] } }, this.now), deps());
  }
  async op(user: string, op: string, args: Record<string, unknown> = {}): Promise<any> {
    const { data, effects } = await this.core.op(user, op, args, this.now);
    this.log.push(effects);
    return data;
  }
  async advance(ms: number): Promise<void> { this.now += ms; this.log.push(await this.core.tick(this.now)); }
  get r() { return this.core.ranked!; }
  get g() { return this.r.m; }
  get id() { return this.g.id; }
  persisted() { return this.log.flatMap((f) => f.persist); }
}

/** The pair in round 1's shop with the table seated (`svc`: the fake Supabase). */
async function inShop(svc: RankedService = new LocalRankedService()): Promise<H> {
  const h = new H();
  h.core.connect(U1, h.now);
  h.core.connect(U2, h.now);
  await h.op(U2, 'join', { as: 'player', display: 'Two', profile: {}, content: engineContentRevision(), protocol: VERSUS_PROTOCOL });
  await h.op(U1, 'start');
  await h.op(U1, 'gate');
  await h.op(U2, 'gate');
  expect(h.log.at(-1)!.ranked.team).toBe(true);
  h.log.push(h.core.rankedSetTeam(await svc.ensureTeam(U1, U2), h.now));
  await h.op(U1, 'register_offer', { matchId: h.id, offer: HERO_IDS.slice(0, 3) });
  await h.op(U2, 'register_offer', { matchId: h.id, offer: HERO_IDS.slice(3, 6) });
  await h.op(U1, 'pick_hero', { matchId: h.id, index: 0 });
  await h.op(U2, 'pick_hero', { matchId: h.id, index: 0 });
  expect(h.g.phase).toBe('shop');
  expect(h.log.at(-1)!.ranked.seat).toBe(true);
  h.log.push(await h.core.rankedSeat(svc, h.now));
  expect(h.r.r.seated_at).not.toBeNull();
  await h.op(U1, 'intro_done', { matchId: h.id });
  await h.op(U2, 'intro_done', { matchId: h.id });
  expect(h.g.shop_deadline).toBe(h.now + turnSeconds(1, 'ranked_duos') * 1000);
  return h;
}

const lock = (h: H, u: string, side: PreparedCombatSide) => h.op(u, 'submit', { matchId: h.id, round: h.g.round, seq: 1, side: structuredClone(side), final: true, checkpoint: null });

describe('Ranked Duos room (Cloudflare) — the party and the table', () => {
  it('two seats, both gates: a ranked match; the table seats three recorded teams with the Edge Function\'s handler', async () => {
    const svc: RankedService = { ensureTeam: async () => ({ teamId: TEAM, name: 'The Pair', division: 2 }), soloSample: async () => [], duoSample: async () => ({ rows: [], names: {} }) };
    const h = await inShop(svc);
    expect(h.r.r.ranked_team).toBe(TEAM);
    const json = h.r.json();
    expect(json.teams).toHaveLength(4);
    expect(json.teamName).toBe('The Pair');
    expect(json.seated).toBe(true);
    const table = await h.op(U1, 'ranked_table', { matchId: h.id });
    expect((table.served as unknown[]).length).toBe(6);
    // No samples at all: generated teams, so the match is unrated (the SQL's 'generated').
    expect(h.r.r.unrated).toBe('generated');
  });

  it('a Versus room never turns into a party, and a party never into a Versus room', async () => {
    const h = new H();
    h.core.connect(U1, h.now);
    await expect(h.op(U1, 'set_options', { options: { v: 1, mode: 'duel', modifiers: [] } })).rejects.toThrow('bad_mode');
  });
});

describe('Ranked Duos room (Cloudflare) — the close (R-RANKED-DUOS-GATE-01)', () => {
  it('both ended: the round closes and resolves at once; one fight of the four teams carries the live result', async () => {
    const h = await inShop();
    await lock(h, U1, STRONG);
    expect(h.g.phase).toBe('shop');
    await lock(h, U2, MID);
    expect(h.g.phase).toBe('combat');
    const rows = await h.op(U1, 'ranked_rounds', { matchId: h.id, from: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].fights.some((f: { a_team: string; b_team: string; live_result: unknown }) => (f.a_team === 'a' || f.b_team === 'a') && f.live_result != null)).toBe(true);
    expect(Object.keys(rows[0].vitals).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('one never ends: the round waits past 0:00 for the 30 s overtime, then closes on their candidate', async () => {
    const h = await inShop();
    await lock(h, U1, STRONG);
    await h.op(U2, 'submit', { matchId: h.id, round: 1, seq: 1, side: structuredClone(MID), final: false, checkpoint: null });
    await h.advance(turnSeconds(1, 'ranked_duos') * 1000 + 1000);
    expect(h.g.phase).toBe('shop'); // past 0:00, still open for the teammate
    await h.advance(30_000);
    expect(h.g.phase).toBe('combat');
  });

  it('identical rooms produce identical rounds (deterministic)', async () => {
    const a = await inShop();
    const b = await inShop();
    for (const h of [a, b]) { await lock(h, U1, STRONG); await lock(h, U2, MID); }
    const da = (await a.op(U1, 'ranked_rounds', { matchId: a.id }))[0].digest;
    const db = (await b.op(U1, 'ranked_rounds', { matchId: b.id }))[0].digest;
    expect(da).toBe(db);
  });
});

describe('Ranked Duos room (Cloudflare) — absence, leaving, the end', () => {
  it('no pause: an absent player is on auto after the grace (their last board plays); back = off auto', async () => {
    const h = await inShop();
    h.core.disconnect(U2, h.now);
    await h.advance(DISCONNECT_GRACE_MS);
    expect(h.g.paused_at).toBeNull();
    expect(h.g.seats.find((s) => s.seat === 'p2')!.auto).toBe(true);
    await lock(h, U1, STRONG);
    expect(h.g.phase).toBe('combat'); // an auto seat counts as ended
    h.core.connect(U2, h.now);
    expect(h.g.seats.find((s) => s.seat === 'p2')!.auto).toBe(false);
  });

  it('both leave: the pair is placed, the match ends, and ONE ranked_finish job carries everything', async () => {
    const h = await inShop({ ensureTeam: async () => ({ teamId: TEAM, name: null, division: 0 }), soloSample: async () => [], duoSample: async () => ({ rows: [], names: {} }) });
    await lock(h, U1, STRONG);
    await lock(h, U2, MID);
    await h.op(U1, 'combat_ready', { matchId: h.id, round: 1 });
    await h.op(U2, 'combat_ready', { matchId: h.id, round: 1 });
    await h.op(U1, 'leave');
    expect(h.g.phase).toBe('shop');
    await h.op(U2, 'leave');
    expect(h.g.phase).toBe('complete');
    const jobs = h.persisted().filter((j) => j.kind === 'ranked_finish');
    expect(jobs).toHaveLength(1);
    const row = jobs[0]!.row as { placement: number; rounds: unknown[]; submissions: unknown[]; match: { ranked_team: string } };
    expect(row.placement).toBeGreaterThanOrEqual(2);
    expect(row.rounds).toHaveLength(1);
    expect(row.submissions).toHaveLength(2); // both live boards of round 1, for the duo run
    expect(row.match.ranked_team).toBe(TEAM);
  });

  it('played to the end: a placement, and the room is a party again', async () => {
    const h = await inShop();
    let guard = 0;
    while (h.g.phase !== 'complete' && guard++ < 60) {
      await lock(h, U1, STRONG);
      await lock(h, U2, STRONG);
      if (h.g.phase === 'combat') { await h.op(U1, 'combat_ready', { matchId: h.id, round: h.g.round }); await h.op(U2, 'combat_ready', { matchId: h.id, round: h.g.round }); }
    }
    expect(h.g.phase).toBe('complete');
    expect(h.r.r.teams.find((t) => t.team === 'a')!.placement).not.toBeNull();
    expect(h.core.state.room.status).toBe('open');
    // DUOS MATCH HISTORY (R-DUOS-HISTORY-01): the finish job carries the whole table, the live pair's boards included.
    const fin = h.persisted().find((j) => j.kind === 'ranked_finish')!.row as { history: unknown; placement: number };
    const hist = parseDuosHistory(fin.history)!;
    expect(hist.mode).toBe('ranked_duos');
    expect(hist.teams).toHaveLength(4);
    const live = hist.teams.find((t) => t.team === 'a')!;
    expect(live.kind).toBe('live');
    expect(live.placement).toBe(fin.placement);
    expect(live.members.map((m) => m.userId)).toEqual([U1, U2]);
    expect(live.members.every((m) => m.board && m.board.minions.length === STRONG.board.length && m.board.round === h.g.round)).toBe(true);
    for (const t of hist.teams.filter((x) => x.team !== 'a')) {
      expect(t.kind).not.toBe('live');
      expect(t.members).toHaveLength(2);
      expect(t.members.every((m) => m.userId === undefined && m.heroId !== '')).toBe(true);
    }
    // Table order: by placement, a team still standing ahead of the placed ones below it.
    const places = hist.teams.map((t) => t.placement ?? 1.5);
    expect(places).toEqual([...places].sort((a, b) => a - b));
  });

  it('the table could not be seated yet: the round waits in resolving and resolves once it is', async () => {
    const h = new H();
    h.core.connect(U1, h.now);
    h.core.connect(U2, h.now);
    await h.op(U2, 'join', { as: 'player', display: 'Two', profile: {}, content: engineContentRevision(), protocol: VERSUS_PROTOCOL });
    await h.op(U1, 'start');
    await h.op(U1, 'gate');
    await h.op(U2, 'gate');
    for (const [u, i] of [[U1, 0], [U2, 3]] as const) await h.op(u, 'register_offer', { matchId: h.id, offer: HERO_IDS.slice(i, i + 3) });
    for (const u of [U1, U2]) await h.op(u, 'pick_hero', { matchId: h.id, index: 0 });
    for (const u of [U1, U2]) await h.op(u, 'intro_done', { matchId: h.id });
    await lock(h, U1, MID);
    await lock(h, U2, MID);
    expect(h.g.phase).toBe('resolving');
    expect(h.r.r.seat_retry_at).not.toBeNull();
    h.log.push(await h.core.rankedSeat(new LocalRankedService(), h.now));
    expect(h.g.phase).toBe('combat');
  });

  it('a party rebuilt from its storage keys mid-match carries on identically', async () => {
    const h = await inShop();
    await lock(h, U1, STRONG);
    const store = new Map<string, unknown>();
    for (const fx of h.log) for (const k of fx.dirty) {
      const v = valueOfKey(h.core.state, k);
      if (v === undefined) store.delete(k); else store.set(k, structuredClone(v));
    }
    const revived = new H(stateFromEntries(store)!);
    revived.now = h.now;
    revived.core.restoreSockets([U1, U2], h.now);
    await lock(revived, U2, MID);
    await lock(h, U2, MID);
    const d1 = (await h.op(U1, 'ranked_rounds', { matchId: h.id }))[0].digest;
    const d2 = (await revived.op(U1, 'ranked_rounds', { matchId: h.id }))[0].digest;
    expect(d2).toBe(d1);
  });
});

describe('memberBoard (versus_ranked_duos__member_board)', () => {
  it('serves the round\'s own board, the last one past the end, an empty one in a gap, nothing before the start', () => {
    const solo = { kind: 'solo', boards: [{ wave: 2, minions: [1] }, { wave: 4, minions: [2] }] };
    expect(memberBoard(solo, 1).form).toBe('none');
    expect(memberBoard(solo, 2)).toEqual({ form: 'snapshot', board: { wave: 2, minions: [1] } });
    expect(memberBoard(solo, 9)).toEqual({ form: 'snapshot', board: { wave: 4, minions: [2] } });
    expect((memberBoard(solo, 3).board as { minions: unknown[] }).minions).toEqual([]);
    const duo = { kind: 'duo', rounds: [{ round: 1, side: { board: [1], state: {} } }, { round: 3, side: { board: [3], state: {} } }] };
    expect(memberBoard(duo, 2)).toEqual({ form: 'side', board: { board: [], state: {} } });
    expect(memberBoard({ kind: 'generated' }, 2).form).toBe('none');
  });
});
