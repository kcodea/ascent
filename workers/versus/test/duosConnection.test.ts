/**
 * DUOS CONNECTION FIXES (netcode audit 2026-11-09; owner go-ahead 2026-11-10), on a fake clock:
 *
 *  - R-RANKED-DUOS-AWAY-GRACE-01: a 3 s blip is not an absence. A live player with no socket only goes on auto after
 *    `RANKED_AWAY_GRACE_MS`, so the teammate's End Turn no longer closes the round on a wifi hiccup; never past the
 *    round's own clock (0:00 + the 30 s overtime).
 *  - R-VERSUS-AUTO-NEWEST-BOARD-01: a seat closed on auto fights the NEWEST board the room holds for this round (its
 *    last candidate), and last round's board only when it sent nothing this round.
 *  - R-DUOS-PASS-EXPIRE-01: a card pass waiting on a seat that went away is refused by the room (the sender's refund).
 *  - R-RANKED-DUOS-SEAT-CAP-01: a round waiting on a table that cannot be read is seated with generated teams.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PreparedCombatSide } from '@game/sim';
import { engineContentRevision, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { DISCONNECT_GRACE_MS, newRoomState, RoomCore, turnSeconds, type CoreDeps, type CoreEffects, type CoreState } from '../src/core/roomCore';
import { RANKED_AWAY_GRACE_MS, RANKED_DEAL_FALLBACK_MS, RANKED_SEAT_MAX_FAILS, type RankedService } from '../src/core/rankedMatch';
import { LocalRankedService } from '../src/rankedService';

interface Case { name: string; matchSeed: number; round: number; p1: PreparedCombatSide; p2: PreparedCombatSide }
const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/sim/src/versus/fixtures/parity.v1.json', import.meta.url)), 'utf8')) as { cases: Case[] };
const STRONG = FIXTURE.cases.find((c) => c.p1.board.length === 7)!.p1;
const MID = FIXTURE.cases[1]!.p2;

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);

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
    this.core = new RoomCore(state ?? newRoomState({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', name: 'Party', hostUserId: U1, displayName: 'One', profile: {}, setId: 'set1', contentRevision: engineContentRevision(), protocol: VERSUS_PROTOCOL, options: { v: 1, mode: 'ranked_duos', modifiers: [] } }, this.now), deps());
  }
  async op(user: string, op: string, args: Record<string, unknown> = {}): Promise<any> {
    const { data, effects } = await this.core.op(user, op, args, this.now);
    this.log.push(effects);
    return data;
  }
  async advance(ms: number): Promise<void> { this.now += ms; this.log.push(await this.core.tick(this.now)); }
  /** A socket closes / opens, with the tick the shell runs after it. */
  async drop(user: string): Promise<void> { this.log.push(this.core.disconnect(user, this.now)); this.log.push(await this.core.tick(this.now)); }
  async back(user: string): Promise<void> { this.log.push(this.core.connect(user, this.now)); this.log.push(await this.core.tick(this.now)); }
  get r() { return this.core.ranked!; }
  get g() { return this.r.m; }
  get id() { return this.g.id; }
  seat(s: 'p1' | 'p2') { return this.g.seats.find((x) => x.seat === s)!; }
  sub(s: 'p1' | 'p2') { return this.core.state.group!.subs[s]!; }
  passPushes() { return this.log.flatMap((f) => f.passes); }
}

async function toHeroSelect(h: H): Promise<void> {
  h.core.connect(U1, h.now);
  h.core.connect(U2, h.now);
  await h.op(U2, 'join', { as: 'player', display: 'Two', profile: {}, content: engineContentRevision(), protocol: VERSUS_PROTOCOL });
  await h.op(U1, 'start');
  await h.op(U1, 'gate');
  await h.op(U2, 'gate');
}

/** The pair in round 1's shop with the table seated. */
async function inShop(): Promise<H> {
  const h = new H();
  const svc = new LocalRankedService();
  await toHeroSelect(h);
  h.log.push(h.core.rankedSetTeam(await svc.ensureTeam(), h.now));
  h.log.push(await h.core.rankedSeat(svc, h.now));
  await h.op(U1, 'pick_hero', { matchId: h.id, index: 0 });
  await h.op(U2, 'pick_hero', { matchId: h.id, index: 0 });
  await h.op(U1, 'intro_done', { matchId: h.id });
  await h.op(U2, 'intro_done', { matchId: h.id });
  expect(h.g.phase).toBe('shop');
  return h;
}

let seq = 0;
const submit = (h: H, u: string, side: PreparedCombatSide, final: boolean) =>
  h.op(u, 'submit', { matchId: h.id, round: h.g.round, seq: ++seq, side: structuredClone(side), final, checkpoint: null });
const lock = (h: H, u: string, side: PreparedCombatSide) => submit(h, u, side, true);
const candidate = (h: H, u: string, side: PreparedCombatSide) => submit(h, u, side, false);

/** Both fight round `n` and come back to the next shop. */
async function playRound(h: H, a: PreparedCombatSide, b: PreparedCombatSide): Promise<void> {
  const round = h.g.round;
  await lock(h, U1, a);
  await lock(h, U2, b);
  expect(h.g.phase).toBe('combat');
  await h.op(U1, 'combat_ready', { matchId: h.id, round });
  await h.op(U2, 'combat_ready', { matchId: h.id, round });
  expect(h.g.phase).toBe('shop');
  expect(h.g.round).toBe(round + 1);
}

describe('Ranked Duos: a short drop is not an absence (R-RANKED-DUOS-AWAY-GRACE-01)', () => {
  it('the grace is the client\'s worst ordinary reconnect: 8 s handshake + 3 s backoff cap + 1 s', () => {
    expect(RANKED_AWAY_GRACE_MS).toBe(12_000);
    expect(RANKED_AWAY_GRACE_MS).toBeGreaterThan(DISCONNECT_GRACE_MS);
  });

  it('THE BUG: a 3 s blip while my teammate ends the turn no longer closes the round on last round\'s board', async () => {
    const h = await inShop();
    await playRound(h, STRONG, MID); // round 1: p2 locked MID (its "last round's board")
    await candidate(h, U2, STRONG); // round 2: p2 has shopped; the room holds this board as its candidate
    await h.drop(U2);
    await h.advance(DISCONNECT_GRACE_MS + 500); // the old grace: p2 went auto here
    expect(h.seat('p2').auto).toBe(false);
    await lock(h, U1, STRONG); // the present teammate ends the turn
    expect(h.g.phase).toBe('shop'); // before the fix: resolving, with p2 on MID
    // p2 is back inside the grace, keeps playing, and ends the turn: the round closes on what p2 locked.
    await h.advance(2_000);
    await h.back(U2);
    expect(h.seat('p2').auto).toBe(false);
    await lock(h, U2, STRONG);
    expect(h.g.phase).toBe('combat');
    expect(h.sub('p2').source).toBe('lock');
    expect((h.sub('p2').prepared_side as PreparedCombatSide).board).toHaveLength(STRONG.board.length);
  });

  it('gone past the grace: away (auto) exactly at 12 s, woken by the room\'s own alarm; back = off auto', async () => {
    const h = await inShop();
    const at = h.now;
    await h.drop(U2);
    expect(h.core.nextAlarm(h.now)).toBe(at + DISCONNECT_GRACE_MS); // the room's socket grace still ticks first
    await h.advance(DISCONNECT_GRACE_MS);
    expect(h.seat('p2').auto).toBe(false);
    expect(h.core.nextAlarm(h.now)).toBe(at + RANKED_AWAY_GRACE_MS);
    await h.advance(RANKED_AWAY_GRACE_MS - DISCONNECT_GRACE_MS - 1);
    expect(h.seat('p2').auto).toBe(false);
    await h.advance(1);
    expect(h.seat('p2').auto).toBe(true);
    expect(h.g.paused_at).toBeNull(); // still no pause in Ranked Duos
    await h.back(U2);
    expect(h.seat('p2').auto).toBe(false);
  });

  it('a SILENT drop (a stale socket, already 15 s quiet) is away 3 s after the room notices, as before: no second full grace', async () => {
    const h = await inShop();
    expect(h.core.staleSilenceCredit()).toBe(RANKED_AWAY_GRACE_MS - DISCONNECT_GRACE_MS);
    h.log.push(h.core.disconnect(U2, h.now, h.core.staleSilenceCredit()));
    h.log.push(await h.core.tick(h.now));
    expect(h.seat('p2').auto).toBe(false);
    await h.advance(DISCONNECT_GRACE_MS - 1);
    expect(h.seat('p2').auto).toBe(false);
    await h.advance(1);
    expect(h.seat('p2').auto).toBe(true);
  });

  it('never past the round\'s own clock: a seat inside the grace is "not ready yet", and the overtime still closes the round', async () => {
    const h = await inShop();
    await lock(h, U1, STRONG);
    await candidate(h, U2, MID);
    await h.advance(turnSeconds(1, 'ranked_duos') * 1000 + 30_000 - 2_000); // 2 s before 0:00 + overtime
    expect(h.g.phase).toBe('shop');
    await h.drop(U2);
    await h.advance(2_000); // the overtime ends 10 s before the grace would
    expect(h.g.phase).toBe('combat');
  });
});

describe('The newest board the room holds fights (R-VERSUS-AUTO-NEWEST-BOARD-01)', () => {
  it('an away seat with a board from THIS round fights that board, not last round\'s', async () => {
    const h = await inShop();
    await playRound(h, STRONG, MID);
    await candidate(h, U2, STRONG); // this round's board
    await h.drop(U2);
    await h.advance(RANKED_AWAY_GRACE_MS);
    expect(h.seat('p2').auto).toBe(true);
    await lock(h, U1, STRONG);
    expect(h.g.phase).toBe('combat');
    const sub = h.sub('p2');
    expect(sub.final).toBe(true);
    expect(sub.source).toBe('deadline'); // a current board: its reported vitals count (`versusFreshSide`)
    expect((sub.prepared_side as PreparedCombatSide).board).toHaveLength(STRONG.board.length);
    expect((sub.prepared_side as PreparedCombatSide).board).not.toHaveLength(MID.board.length);
  });

  it('an away seat that sent nothing this round still fights its last locked board (the design intent)', async () => {
    const h = await inShop();
    await playRound(h, STRONG, MID);
    await h.drop(U2);
    await h.advance(RANKED_AWAY_GRACE_MS);
    await lock(h, U1, STRONG);
    expect(h.g.phase).toBe('combat');
    expect(h.sub('p2').source).toBe('auto');
    expect((h.sub('p2').prepared_side as PreparedCombatSide).board).toHaveLength(MID.board.length);
  });

  it('a seat that never locked anything and sent nothing fights empty, as before', async () => {
    const h = await inShop();
    await h.drop(U2);
    await h.advance(RANKED_AWAY_GRACE_MS);
    await lock(h, U1, STRONG);
    expect(h.g.phase).toBe('combat');
    expect(h.sub('p2').source).toBe('empty');
    expect(h.sub('p2').prepared_side).toBeNull();
  });
});

describe('An unanswered pass expires with a refund (R-DUOS-PASS-EXPIRE-01)', () => {
  const card = (uid: string) => ({ uid, cardId: 'lanternlight', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false, passFrom: 'hand' });
  const teamFx = { uid: 'team1', cardId: '__team', passFrom: 'team', team: { kind: 'maxGold', amount: 1 } };

  it('THE BUG: a pass sent in the teammate\'s first seconds offline was `sent` for ever; now it is refused when they count as away', async () => {
    const h = await inShop();
    await h.op(U2, 'duos_hand_room', { matchId: h.id, room: 5 });
    await h.drop(U2);
    await h.advance(1_000);
    // Inside the grace the room still takes the pass (the teammate may be back in a moment).
    const row = await h.op(U1, 'duos_pass', { matchId: h.id, round: 1, seq: 0, card: card('L1') });
    expect(row.status).toBe('sent');
    await h.op(U1, 'duos_pass', { matchId: h.id, round: 1, seq: 1, card: teamFx });
    const before = h.passPushes().length;
    await h.advance(RANKED_AWAY_GRACE_MS); // the teammate never came back
    expect(h.seat('p2').auto).toBe(true);
    const rows = await h.op(U1, 'duos_passes', { matchId: h.id, from: 1 });
    const cardRow = rows.find((r: { seq: number }) => r.seq === 0);
    expect(cardRow).toMatchObject({ status: 'refused', reason: 'teammate_away' });
    expect(cardRow.answered_at).not.toBeNull();
    // Pushed once, to the team only (the sender's run refunds on it), exactly as a full hand's refusal is.
    const pushed = h.passPushes().slice(before).filter((p) => p.seq === 0);
    expect(pushed).toHaveLength(1);
    expect(h.core.passAudience(pushed[0]!).sort()).toEqual([U1, U2].sort());
    // A TEAM EFFECT took nothing from the sender: it waits for the teammate, as designed.
    expect(rows.find((r: { seq: number }) => r.seq === 1).status).toBe('sent');
    // Storage: the round's pass list is written again.
    expect(h.log.some((f) => f.dirty.has('gpass:1'))).toBe(true);
    // A new pass is refused up front from here on (the existing rule).
    await expect(h.op(U1, 'duos_pass', { matchId: h.id, round: 1, seq: 2, card: card('L2') })).rejects.toThrow('teammate_away');
  });

  it('the teammate comes back later: the expired pass reads refused (their run never lands it) and their answer changes nothing', async () => {
    const h = await inShop();
    await h.drop(U2);
    await h.op(U1, 'duos_pass', { matchId: h.id, round: 1, seq: 0, card: card('L1') });
    await h.advance(RANKED_AWAY_GRACE_MS);
    await h.back(U2);
    const rows = await h.op(U2, 'duos_passes', { matchId: h.id, from: 1 });
    expect(rows.map((r: { status: string }) => r.status)).toEqual(['refused']);
    expect((await h.op(U2, 'duos_answer_pass', { matchId: h.id, fromSeat: 'p1', seq: 0, landed: true })).status).toBe('refused');
  });

  it('a teammate who is back inside the grace answers it as always: nothing expires', async () => {
    const h = await inShop();
    await h.drop(U2);
    await h.op(U1, 'duos_pass', { matchId: h.id, round: 1, seq: 0, card: card('L1') });
    await h.advance(5_000);
    await h.back(U2);
    expect((await h.op(U2, 'duos_passes', { matchId: h.id, from: 1 }))[0].status).toBe('sent');
    expect((await h.op(U2, 'duos_answer_pass', { matchId: h.id, fromSeat: 'p1', seq: 0, landed: true })).status).toBe('landed');
    await h.advance(RANKED_AWAY_GRACE_MS);
    expect((await h.op(U1, 'duos_passes', { matchId: h.id, from: 1 }))[0].status).toBe('landed');
  });

  it('a teammate who concedes: the pass waiting on them goes back at once', async () => {
    const h = await inShop();
    await h.op(U1, 'duos_pass', { matchId: h.id, round: 1, seq: 0, card: card('L1') });
    await h.op(U2, 'forfeit', { matchId: h.id });
    expect((await h.op(U1, 'duos_passes', { matchId: h.id, from: 1 }))[0]).toMatchObject({ status: 'refused', reason: 'teammate_away' });
  });
});

describe('The table never holds a fight for good (R-RANKED-DUOS-SEAT-CAP-01)', () => {
  const down: RankedService = {
    ensureTeam: async () => ({ teamId: null, name: null, division: 0 }),
    soloSample: async () => { throw new Error('supabase down'); },
    duoSample: async () => { throw new Error('supabase down'); },
  };

  it('Supabase down all game: the round waiting on the table is seated with generated teams (unrated) and resolves', async () => {
    const h = new H();
    await toHeroSelect(h);
    await expect(h.core.rankedSeat(down, h.now)).rejects.toThrow();
    expect(h.r.r.seat_fails).toBe(1);
    await h.advance(RANKED_DEAL_FALLBACK_MS); // the heroes are dealt the old way
    await h.op(U1, 'pick_hero', { matchId: h.id, index: 0 });
    await h.op(U2, 'pick_hero', { matchId: h.id, index: 0 });
    await h.op(U1, 'intro_done', { matchId: h.id });
    await h.op(U2, 'intro_done', { matchId: h.id });
    // While nothing waits on the table the reads just keep being retried: no generated table yet.
    for (let i = 1; i < RANKED_SEAT_MAX_FAILS; i++) await expect(h.core.rankedSeat(down, h.now)).rejects.toThrow();
    expect(h.r.r.seat_fails).toBe(RANKED_SEAT_MAX_FAILS);
    expect(h.r.r.seated_at).toBeNull();
    await lock(h, U1, STRONG);
    await lock(h, U2, MID);
    expect(h.g.phase).toBe('resolving'); // the round is closed and waits on the table
    expect(h.log.at(-1)!.ranked.seat).toBe(true);
    // The shell's next seating call: the reads are skipped, generated teams are seated, the round resolves.
    h.log.push(await h.core.rankedSeat(down, h.now));
    expect(h.r.r.seated_at).not.toBeNull();
    expect(h.r.r.unrated).toBe('generated');
    expect(h.r.r.seat_fails).toBe(0);
    expect(h.g.phase).toBe('combat');
  });

  it('a table that reads fine after a failure is the real table: the count starts over', async () => {
    const h = new H();
    await toHeroSelect(h);
    await expect(h.core.rankedSeat(down, h.now)).rejects.toThrow();
    h.log.push(await h.core.rankedSeat(new LocalRankedService(), h.now));
    expect(h.r.r.seated_at).not.toBeNull();
    expect(h.r.r.seat_fails).toBe(0);
  });
});
