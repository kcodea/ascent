/**
 * RANKED DUOS, the pure rules (owner design 2026-10-26; R-RANKED-DUOS-GATE-01, R-RANKED-DUOS-RATING-01,
 * R-RANKED-DUOS-NAME-01, R-RANKED-DUOS-SEATING-01): the end-turn gate, the Duos rating table, team names and the table
 * seating (duo runs first, then two DIFFERENT solo players per team, band steps, unique heroes, the per-player cap).
 */
import { describe, expect, it } from 'vitest';
import { DUOS_RANK_RULES, resolveRank } from '../rank';
import { STRENGTH_BANDS } from '../lobby/strengthBands';
import { runOwnerOf } from '../lobby/snapshotSeats';
import {
  cleanTeamName, defaultTeamName, rankedDuosCloseAt, rankedDuosShoppingOpen, RANKED_DUOS_END_GRACE_MS,
  RANKED_DUOS_OVERTIME_BACKSTOP_MS, teamNameProblem, teamPairOf,
} from './rankedDuos';
import { RANKED_DUOS_MAX_SEATS_PER_PLAYER, selectRankedDuosTable, servedOwnerOf, type DuoRunCandidate, type SoloRunCandidate } from './rankedDuosSeating';

const D = 100_000;

describe('the end-turn gate (owner 2026-10-26, R-RANKED-DUOS-GATE-01)', () => {
  it('both ended: the round goes at once (at the later end), whatever the clock says', () => {
    expect(rankedDuosCloseAt({ deadline: D, ended: [10_000, 20_000] })).toBe(20_000);
    expect(rankedDuosCloseAt({ deadline: null, ended: [1, 2] })).toBe(2);
  });
  it('one ended with time left: wait for the other until 0:00, then 5 s', () => {
    expect(rankedDuosCloseAt({ deadline: D, ended: [40_000, null] })).toBe(D + RANKED_DUOS_END_GRACE_MS);
  });
  it('nobody ended at 0:00: the first End Turn opens the 5 s window', () => {
    expect(rankedDuosCloseAt({ deadline: D, ended: [null, D + 12_000] })).toBe(D + 12_000 + RANKED_DUOS_END_GRACE_MS);
  });
  it('nobody ended at all: the 30 s AFK backstop past 0:00', () => {
    expect(rankedDuosCloseAt({ deadline: D, ended: [null, null] })).toBe(D + RANKED_DUOS_OVERTIME_BACKSTOP_MS);
  });
  it('round 1 before its clock starts: nothing closes it unless both ended', () => {
    expect(rankedDuosCloseAt({ deadline: null, ended: [null, 5] })).toBeNull();
  });
  it('shopping stops at 0:00 (re-order / freeze stay open until the close)', () => {
    expect(rankedDuosShoppingOpen(D, D - 1)).toBe(true);
    expect(rankedDuosShoppingOpen(D, D)).toBe(false);
    expect(rankedDuosShoppingOpen(null, D)).toBe(true);
  });
});

describe('the Duos rating (owner 2026-10-26, R-RANKED-DUOS-RATING-01)', () => {
  const at = (divisionIndex: number, points: number, demotionReady = false) => ({ divisionIndex, points, demotionReady });
  it('places 1-4 award +34 / +11 / -11 / -34', () => {
    expect([1, 2, 3, 4].map((p) => resolveRank(at(1, 50), p, DUOS_RANK_RULES).appliedDelta)).toEqual([34, 11, -11, -34]);
    expect(() => resolveRank(at(1, 50), 5, DUOS_RANK_RULES)).toThrow();
  });
  it('a division promotion game needs a top-2 finish; a medal one needs 1st (2nd holds at 100)', () => {
    expect(resolveRank(at(0, 100), 2, DUOS_RANK_RULES)).toMatchObject({ promoted: true, after: { divisionIndex: 1, points: 10 } });
    expect(resolveRank(at(0, 100), 3, DUOS_RANK_RULES)).toMatchObject({ promoted: false, after: { divisionIndex: 0, points: 89 } });
    expect(resolveRank(at(2, 100), 2, DUOS_RANK_RULES)).toMatchObject({ promoted: false, after: { divisionIndex: 2, points: 100 } });
    expect(resolveRank(at(2, 100), 1, DUOS_RANK_RULES)).toMatchObject({ promoted: true, promotionKind: 'medal' });
  });
  it('a demotion game demotes on 3rd / 4th and is escaped by a top 2', () => {
    expect(resolveRank(at(4, 0, true), 3, DUOS_RANK_RULES)).toMatchObject({ demoted: true, after: { divisionIndex: 3, points: 89 } });
    expect(resolveRank(at(4, 0, true), 4, DUOS_RANK_RULES)).toMatchObject({ demoted: true, after: { divisionIndex: 3, points: 66 } });
    expect(resolveRank(at(4, 0, true), 2, DUOS_RANK_RULES)).toMatchObject({ demoted: false, after: { divisionIndex: 4, points: 11 } });
  });
  it('a loss to 0 arms the demotion gate (no instant demotion); Bronze I floors', () => {
    expect(resolveRank(at(4, 20), 4, DUOS_RANK_RULES).after).toEqual({ divisionIndex: 4, points: 0, demotionReady: true });
    expect(resolveRank(at(0, 20), 4, DUOS_RANK_RULES).after).toEqual({ divisionIndex: 0, points: 0, demotionReady: false });
  });
});

describe('team names (owner 2026-10-26, R-RANKED-DUOS-NAME-01)', () => {
  it('2-16 letters, digits and single spaces; trimmed and collapsed', () => {
    expect(cleanTeamName('  CITRUS   Kings ')).toBe('CITRUS Kings');
    expect(teamNameProblem('CITRUS')).toBeNull();
    expect(teamNameProblem('Goats 2')).toBeNull();
    expect(teamNameProblem('a')).toBe('name_length');
    expect(teamNameProblem('x'.repeat(17))).toBe('name_length');
    expect(teamNameProblem('Goats!')).toBe('name_chars');
    expect(teamNameProblem('Gö ats')).toBe('name_chars');
  });
  it('the default reads "Name1 & Name2"; a team is the unordered pair', () => {
    expect(defaultTeamName('Kevin', 'Lemon')).toBe('Kevin & Lemon');
    expect(teamPairOf('b', 'a')).toEqual(['a', 'b']);
    expect(teamPairOf('a', 'b')).toEqual(['a', 'b']);
    expect(() => teamPairOf('a', 'a')).toThrow();
  });
});

// ── Seating ───────────────────────────────────────────────────────────────────────────────────────────────────────
const HEROES = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10', 'h11', 'h12'];
const solo = (key: string, owner: string, hero: string, strength?: number): SoloRunCandidate =>
  ({ key, ownerId: owner, author: owner, heroId: hero, ...(strength != null ? { strength } : {}) });
const duo = (id: string, a: [string, string], b: [string, string], strength?: number): DuoRunCandidate => ({
  id, ...(strength != null ? { strength } : {}),
  members: [{ runKey: `${id}:p1`, ownerId: a[0], name: a[0], heroId: a[1] }, { runKey: `${id}:p2`, ownerId: b[0], name: b[0], heroId: b[1] }],
});
const base = { seed: 7, liveHeroes: ['h1', 'h2'], band: null, generatedHeroes: HEROES };

describe('the table seating (owner 2026-10-26, R-RANKED-DUOS-SEATING-01)', () => {
  it('recorded duo runs come first; solo pairs fill the rest', () => {
    const t = selectRankedDuosTable({ ...base,
      duoRuns: [duo('d1', ['u1', 'h3'], ['u2', 'h4'])],
      soloRuns: [solo('s1', 'u3', 'h5'), solo('s2', 'u4', 'h6'), solo('s3', 'u5', 'h7'), solo('s4', 'u6', 'h8')] });
    expect(t.teams.map((x) => x.kind)).toEqual(['duo', 'pair', 'pair']);
    expect(t.teams[0]).toMatchObject({ team: 'b', order: 'recorded', duoRunId: 'd1' });
    expect(t.teams.slice(1).every((x) => x.order === 'random')).toBe(true);
    expect(t.unrated).toBe(false);
  });

  it('a fallback team is two DIFFERENT players', () => {
    const t = selectRankedDuosTable({ ...base, duoRuns: [],
      soloRuns: [solo('s1', 'u1', 'h3'), solo('s2', 'u1', 'h4'), solo('s3', 'u2', 'h5'), solo('s4', 'u3', 'h6'), solo('s5', 'u4', 'h7'), solo('s6', 'u5', 'h8')] });
    for (const team of t.teams.filter((x) => x.kind === 'pair')) {
      const [a, b] = team.members;
      expect(servedOwnerOf(a.ownerId, a.name)).not.toBe(servedOwnerOf(b.ownerId, b.name));
    }
  });

  it('all eight heroes are unique, the live pair included; a run never sits twice', () => {
    for (let seed = 1; seed < 40; seed++) {
      const t = selectRankedDuosTable({ ...base, seed,
        duoRuns: [duo('d1', ['u1', 'h1'], ['u2', 'h4']), duo('d2', ['u3', 'h5'], ['u4', 'h6'])],
        soloRuns: [solo('s1', 'u5', 'h5'), solo('s2', 'u6', 'h7'), solo('s3', 'u7', 'h8'), solo('s4', 'u8', 'h2'), solo('s5', 'u9', 'h9')] });
      const heroes = ['h1', 'h2', ...t.teams.flatMap((x) => x.members.map((m) => m.heroId))];
      expect(new Set(heroes).size).toBe(8);
      const keys = t.teams.flatMap((x) => x.members.map((m) => m.key));
      expect(new Set(keys).size).toBe(6);
      expect(t.teams.some((x) => x.duoRunId === 'd1')).toBe(false); // d1 plays the live pair's hero
    }
  });

  it(`at most ${RANKED_DUOS_MAX_SEATS_PER_PLAYER} of the six served seats per player`, () => {
    const runs = ['h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10'].map((h, i) => solo(`s${i}`, i < 5 ? 'whale' : `u${i}`, h));
    const t = selectRankedDuosTable({ ...base, duoRuns: [], soloRuns: runs });
    const whale = t.teams.flatMap((x) => x.members).filter((m) => m.ownerId === 'whale').length;
    expect(whale).toBeLessThanOrEqual(RANKED_DUOS_MAX_SEATS_PER_PLAYER);
  });

  it('the band: in-band runs first, widening only when the step is exhausted, the overall cap never relaxed', () => {
    const bronze = STRENGTH_BANDS.Bronze!;
    const soloRuns = [
      solo('in1', 'u1', 'h3', 10), solo('in2', 'u2', 'h4', 15),
      solo('near1', 'u3', 'h5', 28), solo('near2', 'u4', 'h6', 29), solo('near3', 'u5', 'h7', 30), solo('near4', 'u6', 'h8', 30),
      solo('over', 'u7', 'h9', 90),
    ];
    const t = selectRankedDuosTable({ ...base, band: bronze, duoRuns: [], soloRuns });
    const keys = t.teams.flatMap((x) => x.members.map((m) => m.key));
    expect(keys.slice(0, 2)).toEqual(expect.arrayContaining(['in1', 'in2']));
    expect(keys).not.toContain('over'); // above Bronze's overall cap (40) at every step
    expect(t.usedStep).toBeGreaterThan(0);
  });

  it('too few runs: generated seats fill the table (a half pair gets a generated partner); any generated member = unrated', () => {
    const half = selectRankedDuosTable({ ...base, duoRuns: [], soloRuns: [solo('s1', 'u1', 'h3')] });
    expect(half.teams).toHaveLength(3);
    expect(half.teams[0]!.members.map((m) => m.kind)).toEqual(['solo', 'generated']);
    expect(half.unrated).toBe(true); // a generated member fields no board yet: never rated
    const none = selectRankedDuosTable({ ...base, duoRuns: [], soloRuns: [] });
    expect(none.teams.map((x) => x.kind)).toEqual(['generated', 'generated', 'generated']);
    expect(none.unrated).toBe(true);
  });

  it('deterministic: same seed and pool = same table, whatever order the rows arrived in', () => {
    const runs = ['h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10'].map((h, i) => solo(`s${i}`, `u${i}`, h));
    const a = selectRankedDuosTable({ ...base, duoRuns: [], soloRuns: runs });
    const b = selectRankedDuosTable({ ...base, duoRuns: [], soloRuns: [...runs].reverse() });
    expect(b).toEqual(a);
    expect(selectRankedDuosTable({ ...base, seed: 8, duoRuns: [], soloRuns: runs })).not.toEqual(a);
  });

  it('one player = the lobby rule (account, else display name)', () => {
    for (const r of [{ ownerId: 'x', author: 'A' }, { ownerId: undefined, author: 'Bob' }, { ownerId: undefined, author: 'anon' }]) {
      expect(servedOwnerOf(r.ownerId ?? null, r.author)).toBe(runOwnerOf(r));
    }
  });
});
