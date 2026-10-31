/**
 * UNIQUE HEROES PER LOBBY in a Cloudflare Versus room (owner 2026-10-31, R-VERSUS-UNIQUE-HEROES-01: "build unique
 * heroes per lobby rule"). The room deals every seat's three heroes at match creation, so no two players are ever
 * offered the same hero (1v1, Group, Duos), deterministic from the stored seeds; a pick of a hero another player holds
 * is refused; a re-roll never lands on a hero another player was dealt; a clock pick never takes a held hero.
 */
import { describe, expect, it } from 'vitest';
import { playableHeroes, runTribesForSeed } from '@game/sim';
import { engineContentRevision, versusDisjointHeroOffers, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { newRoomState, RoomCore, type CoreDeps } from '../src/core/roomCore';
import type { GSeat } from '../src/core/groupMatch';

const U = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'] as const;
const SEAT: GSeat[] = ['p1', 'p2', 'p3', 'p4'];
const ROOM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T0 = Date.UTC(2026, 9, 31, 12, 0, 0);
const JOIN = (i: number) => ({ as: 'player', display: `P${i + 1}`, profile: {}, content: engineContentRevision(), protocol: VERSUS_PROTOCOL });

function deps(seed: number): CoreDeps {
  let s = seed;
  let u = 0;
  return { random31: () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff), uuid: () => `dddddddd-dddd-4ddd-8ddd-${String(++u).padStart(12, '0')}` } as CoreDeps;
}

type Mode = 'duel' | 'group' | 'duos';

class H {
  now = T0;
  core: RoomCore;
  constructor(readonly mode: Mode, seed: number, readonly n: number) {
    const options = mode === 'duel' ? undefined : { v: 1, mode, modifiers: [] };
    this.core = new RoomCore(newRoomState({ id: ROOM, name: 'U', hostUserId: U[0], displayName: 'P1', profile: {}, setId: 'set2', contentRevision: engineContentRevision(), protocol: VERSUS_PROTOCOL, ...(options ? { options } : {}) }, this.now), deps(seed));
  }
  async op(user: string, op: string, args: Record<string, unknown> = {}): Promise<any> {
    return (await this.core.op(user, op, args, this.now)).data;
  }
  async toHeroSelect(): Promise<void> {
    for (let i = 0; i < this.n; i++) this.core.connect(U[i], this.now);
    for (let i = 1; i < this.n; i++) await this.op(U[i], 'join', JOIN(i));
    await this.op(U[0], 'start');
    for (let i = 0; i < this.n; i++) await this.op(U[i], 'gate');
  }
  get group() { return this.mode !== 'duel'; }
  get matchId(): string { return this.group ? this.core.state.group!.match.id : this.core.state.match!.id; }
  get phase(): string { return this.group ? this.core.state.group!.match.phase : this.core.state.match!.phase; }
  priv(seat: GSeat) { return this.group ? this.core.state.group!.priv[seat]! : this.core.state.priv[seat as 'p1' | 'p2']!; }
  seats(): GSeat[] { return SEAT.slice(0, this.n); }
  hero(seat: GSeat): string | null {
    if (this.group) return this.core.state.group!.match.seats.find((s) => s.seat === seat)!.hero;
    return (this.core.state.match as unknown as Record<string, string | null>)[`${seat}_hero`]!;
  }
}

const CASES: [Mode, number][] = [['duel', 2], ['group', 3], ['group', 4], ['duos', 4]];

describe('unique heroes per lobby: the room deals disjoint offers (R-VERSUS-UNIQUE-HEROES-01)', () => {
  for (const [mode, n] of CASES) {
    it(`${mode} x${n}: no hero is offered twice, every offer is three heroes the seat's run may play, across 40 rooms`, async () => {
      for (let seed = 1; seed <= 40; seed++) {
        const h = new H(mode, seed * 7919, n);
        await h.toHeroSelect();
        expect(h.phase).toBe('hero_select');
        const all: string[] = [];
        for (const s of h.seats()) {
          const p = h.priv(s);
          expect(p.hero_offer).toHaveLength(3);
          const allowed = new Set(playableHeroes(runTribesForSeed(p.run_seed, 'set2')).map((x) => x.id));
          for (const hero of p.hero_offer!) expect(allowed.has(hero)).toBe(true);
          all.push(...p.hero_offer!);
        }
        expect(new Set(all).size).toBe(all.length);
        // Deterministic: the deal is a pure function of the stored seeds.
        expect(versusDisjointHeroOffers(h.seats().map((s) => ({ heroSeed: h.priv(s).hero_seed, runSeed: h.priv(s).run_seed })), 'set2'))
          .toEqual(h.seats().map((s) => h.priv(s).hero_offer));
      }
    });
  }

  it('the same seeds deal the same offers (a restored room sees the same three)', async () => {
    const a = new H('group', 4242, 4);
    const b = new H('group', 4242, 4);
    await a.toHeroSelect();
    await b.toHeroSelect();
    for (const s of a.seats()) expect(a.priv(s).hero_offer).toEqual(b.priv(s).hero_offer);
  });

  for (const [mode, n] of CASES) {
    it(`${mode} x${n}: every player picking slot 0, or the clock picking, ends on ${n} different heroes`, async () => {
      for (let seed = 1; seed <= 10; seed++) {
        const manual = new H(mode, seed * 104729, n);
        await manual.toHeroSelect();
        for (let i = 0; i < n; i++) await manual.op(U[i], 'pick_hero', { matchId: manual.matchId, index: 0 });
        expect(manual.phase).toBe('shop');
        expect(new Set(manual.seats().map((s) => manual.hero(s))).size).toBe(n);
        const clock = new H(mode, seed * 104729, n);
        await clock.toHeroSelect();
        clock.now += 21_000;
        await clock.core.tick(clock.now);
        expect(clock.phase).toBe('shop');
        expect(new Set(clock.seats().map((s) => clock.hero(s))).size).toBe(n);
      }
    });
  }
});

describe('unique heroes per lobby: the server refuses a held hero (an offer registered before the room dealt them)', () => {
  /** Rewrite the dealt offers into an overlapping pair, as a match created by an older build could hold. */
  const overlap = (h: H): string[] => {
    const shared = [...h.priv('p1').hero_offer!];
    for (const s of h.seats()) h.priv(s).hero_offer = [...shared];
    return shared;
  };

  for (const [mode, n] of CASES) {
    it(`${mode}: a pick of another player's hero is refused (hero_taken); the clock picks a free one`, async () => {
      const h = new H(mode, 99, n);
      await h.toHeroSelect();
      const shared = overlap(h);
      await h.op(U[0], 'pick_hero', { matchId: h.matchId, index: 1 });
      await expect(h.op(U[1], 'pick_hero', { matchId: h.matchId, index: 1 })).rejects.toThrow('hero_taken');
      await h.op(U[1], 'pick_hero', { matchId: h.matchId, index: 2 });
      // Every remaining seat is left to the clock: each takes a hero nobody holds (3 heroes cover up to 3 seats).
      h.now += 21_000;
      await h.core.tick(h.now);
      expect(h.phase).toBe('shop');
      const heroes = h.seats().map((s) => h.hero(s));
      expect(heroes[0]).toBe(shared[1]);
      expect(heroes[1]).toBe(shared[2]);
      if (n >= 3) expect(heroes[2]).toBe(shared[0]);
      expect(new Set(heroes.slice(0, 3)).size).toBe(Math.min(n, 3));
    });
  }

  for (const [mode, n] of CASES) {
    it(`${mode}: a re-roll never lands on a hero another player was dealt`, async () => {
      const h = new H(mode, 31337, n);
      await h.toHeroSelect();
      const others = h.seats().slice(1).flatMap((s) => h.priv(s).hero_offer!);
      const mine = h.priv('p1').hero_offer!;
      const free = playableHeroes(runTribesForSeed(h.priv('p1').run_seed, 'set2')).map((x) => x.id).find((x) => !mine.includes(x) && !others.includes(x))!;
      // Only one candidate is free: whatever the seeded draw, the re-roll lands on it.
      const out = await h.op(U[0], 'reroll_hero', { matchId: h.matchId, slot: 0, candidates: [...others, free] });
      expect(out.offer[0]).toBe(free);
      // Nothing free at all: refused, the offer unchanged.
      const h2 = new H(mode, 31337, n);
      await h2.toHeroSelect();
      const others2 = h2.seats().slice(1).flatMap((s) => h2.priv(s).hero_offer!);
      await expect(h2.op(U[0], 'reroll_hero', { matchId: h2.matchId, slot: 0, candidates: others2 })).rejects.toThrow('bad_candidates');
    });
  }
});
