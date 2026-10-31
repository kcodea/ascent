/**
 * RANKED DUOS, OPPONENTS FIRST (owner 2026-10-31, R-RANKED-OPPONENTS-FIRST-01), verbatim: "we want full unique heroes,
 * and i want the players in ranked modes to get their options technically after the opponents are chosen, so it forces
 * more variety in hero selection".
 *
 * The room seats the three recorded teams at match creation (team, then table), and only then deals the party's two
 * offers, around the table's six heroes (and each other, `versusDisjointHeroOffers`). No offer before the table; a
 * table that is late past `RANKED_DEAL_FALLBACK_MS` deals the old way, and a table chosen before that deal (it may hold a
 * dealt hero) is dropped and seated after Hero Select, around the picks, as before.
 */
import { describe, expect, it } from 'vitest';
import { engineContentRevision, VERSUS_HERO_SELECT_SECONDS, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { newRoomState, RoomCore, type CoreDeps } from '../src/core/roomCore';
import { RANKED_DEAL_FALLBACK_MS, type RankedService } from '../src/core/rankedMatch';
import { LocalRankedService } from '../src/rankedService';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const ROOM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad';
const T0 = Date.UTC(2026, 9, 31, 12, 0, 0);
const JOIN = { as: 'player', display: 'Two', profile: {}, content: engineContentRevision(), protocol: VERSUS_PROTOCOL };

function deps(seed: number): CoreDeps {
  let s = seed;
  let u = 0;
  return { random31: () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff), uuid: () => `cccccccc-cccc-4ccc-8ccc-${String(++u).padStart(12, '0')}` } as CoreDeps;
}

class H {
  now = T0;
  core: RoomCore;
  constructor(seed: number) {
    this.core = new RoomCore(newRoomState({ id: ROOM, name: 'Party', hostUserId: U1, displayName: 'One', profile: {}, setId: 'set2', contentRevision: engineContentRevision(), protocol: VERSUS_PROTOCOL, options: { v: 1, mode: 'ranked_duos', modifiers: [] } }, this.now), deps(seed));
  }
  async op(user: string, op: string, args: Record<string, unknown> = {}): Promise<any> {
    return (await this.core.op(user, op, args, this.now)).data;
  }
  async gates(): Promise<void> {
    this.core.connect(U1, this.now);
    this.core.connect(U2, this.now);
    await this.op(U2, 'join', JOIN);
    await this.op(U1, 'start');
    await this.op(U1, 'gate');
    await this.op(U2, 'gate');
  }
  get r() { return this.core.ranked!; }
  get id() { return this.r.m.id; }
  offers(): string[][] { return (['p1', 'p2'] as const).map((s) => this.r.g.priv[s]!.hero_offer ?? []); }
  served(): string[] { return (this.r.g.served ?? []).map((x) => x.hero); }
}

describe('Ranked Duos deals the party\'s heroes after its table (R-RANKED-OPPONENTS-FIRST-01)', () => {
  it('no offer, no clock and no pick before the table; then two disjoint offers that hold none of its six heroes, across 30 rooms', async () => {
    for (let seed = 1; seed <= 30; seed++) {
      const h = new H(seed * 104729);
      await h.gates();
      expect(h.offers()).toEqual([[], []]);
      expect(h.r.m.hero_deadline).toBeNull();
      await expect(h.op(U1, 'pick_hero', { matchId: h.id, index: 0 })).rejects.toThrow('not_dealt');
      await h.core.rankedSeat(new LocalRankedService(), h.now);
      expect(h.r.r.dealt).toBe('table');
      const served = h.served();
      expect(served).toHaveLength(6);
      expect(new Set(served).size).toBe(6);
      const all = h.offers().flat();
      expect(all).toHaveLength(6);
      expect(new Set(all).size).toBe(6);
      for (const hero of all) expect(served.includes(hero), hero).toBe(false);
      expect(h.r.m.hero_deadline).toBe(h.now + VERSUS_HERO_SELECT_SECONDS * 1000);
      await h.op(U1, 'pick_hero', { matchId: h.id, index: 1 });
      await h.op(U2, 'pick_hero', { matchId: h.id, index: 2 });
      expect(h.r.m.phase).toBe('shop');
      const heroes = [...h.r.m.seats.map((s) => s.hero!), ...served];
      expect(new Set(heroes).size).toBe(8); // full uniqueness across the 8 heroes in the game
    }
  });

  it('a table that lands after the fallback deal is dropped, then seated after Hero Select around the picks', async () => {
    const h = new H(77);
    await h.gates();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const slow: RankedService = { ...new LocalRankedService(), ensureTeam: async () => ({ teamId: null, name: null, division: 0 }), soloSample: async () => { await held; return []; }, duoSample: async () => ({ rows: [], names: {} }) };
    const inFlight = h.core.rankedSeat(slow, h.now);
    h.now += RANKED_DEAL_FALLBACK_MS;
    await h.core.tick(h.now);
    expect(h.r.r.dealt).toBe('fallback');
    expect(h.offers().flat()).toHaveLength(6);
    release();
    await inFlight;
    expect(h.r.r.seated_at).toBeNull();
    await h.op(U1, 'pick_hero', { matchId: h.id, index: 0 });
    await h.op(U2, 'pick_hero', { matchId: h.id, index: 0 });
    await h.core.rankedSeat(new LocalRankedService(), h.now);
    expect(h.r.r.seated_at).not.toBeNull();
    const heroes = [...h.r.m.seats.map((s) => s.hero!), ...h.served()];
    expect(new Set(heroes).size).toBe(8);
  });
});
