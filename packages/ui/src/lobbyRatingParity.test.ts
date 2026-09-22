import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RANK_RULES, RANK_SEASON, compareRank, rankTopDivision, resolveRank, type RankPosition } from '@game/sim';
import {
  RANK_DEMOTION_ESCAPE_FINISH, RANK_DIVISION_POINTS, RANK_DIVISION_PROMOTION_FINISH, RANK_DIVISIONS_PER_MEDAL, RANK_MEDAL_PROMOTION_FINISH,
  RANK_PLACEMENT_AWARDS, RANK_PROMOTION_LANDING, RANK_RULES_VERSION, RANK_SEASON as SERVER_SEASON, RANK_TOP_DIVISION, resolveRankOutcome,
} from '../../../supabase/functions/_shared/lobbyRating';

/**
 * MEDAL RANK — server ↔ client PARITY (2026-09-20; succeeds the C3 numeric parity test).
 *
 * The rules live in THREE places: `packages/sim/src/rank.ts` (the client), `supabase/functions/_shared/
 * lobbyRating.ts` (the Edge Function's runtime check — a plain TS module, so it is IMPORTED here and driven
 * through the same states) and the `settle_rank` plpgsql function (the actual writer — no Postgres in CI, so
 * its constants are read out of the migration TEXT and compared). If someone re-tunes the ladder in one place
 * and not the others, CI fails here rather than the copies silently disagreeing in production; the Edge
 * Function's `parity` flag is the last line for the SQL body itself.
 *
 * This is parity for TRANSITIONS, not placement literals: every division × a spread of points × every
 * placement runs through both TS resolvers and must agree field-for-field.
 */
const repoRoot = join(__dirname, '../../..');
const sqlSrc = readFileSync(join(repoRoot, 'supabase/migrations/2026-09-20-medal-rank.sql'), 'utf8');
const schemaSrc = readFileSync(join(repoRoot, 'schema.sql'), 'utf8');

function sqlConst(name: string): string {
  const m = new RegExp(`${name}\\s+constant\\s+[a-z\\[\\]]+\\s*:=\\s*([^;]+);`).exec(sqlSrc);
  if (!m) throw new Error(`could not find ${name} in the medal-rank migration`);
  return m[1]!.trim();
}

describe('medal rank — constants agree across the three copies', () => {
  it('the shared Edge Function module equals RANK_RULES', () => {
    expect([...RANK_PLACEMENT_AWARDS]).toEqual([...RANK_RULES.placementAwards]);
    expect(RANK_DIVISION_POINTS).toBe(RANK_RULES.divisionPoints);
    expect(RANK_DIVISIONS_PER_MEDAL).toBe(RANK_RULES.divisionsPerMedal);
    expect(RANK_TOP_DIVISION).toBe(rankTopDivision());
    expect(RANK_DIVISION_PROMOTION_FINISH).toBe(RANK_RULES.divisionPromotionFinish);
    expect(RANK_MEDAL_PROMOTION_FINISH).toBe(RANK_RULES.medalPromotionFinish);
    expect(RANK_DEMOTION_ESCAPE_FINISH).toBe(RANK_RULES.demotionEscapeFinish);
    expect(RANK_PROMOTION_LANDING, 'a won promotion lands at 10 (owner 2026-09-21)').toBe(RANK_RULES.promotionLanding);
    expect(RANK_RULES.promotionLanding).toBe(10);
    expect(RANK_RULES_VERSION).toBe(RANK_RULES.rulesVersion);
    expect(SERVER_SEASON).toBe(RANK_SEASON);
  });

  it('the settle_rank SQL carries the same numbers', () => {
    expect(sqlConst('c_season')).toBe(String(RANK_SEASON));
    expect(sqlConst('c_rules')).toBe(String(RANK_RULES.rulesVersion));
    expect(sqlConst('c_cap')).toBe(String(RANK_RULES.divisionPoints));
    expect(sqlConst('c_top')).toBe(String(rankTopDivision()));
    expect(sqlConst('c_per_medal')).toBe(String(RANK_RULES.divisionsPerMedal));
    expect(sqlConst('c_division_finish')).toBe(String(RANK_RULES.divisionPromotionFinish));
    expect(sqlConst('c_medal_finish')).toBe(String(RANK_RULES.medalPromotionFinish));
    expect(sqlConst('c_demotion_finish')).toBe(String(RANK_RULES.demotionEscapeFinish));
    expect(sqlConst('c_promo_landing')).toBe(String(RANK_RULES.promotionLanding));
    expect(sqlSrc, 'the won gate must land on the constant, not a literal').toContain('p1 := c_promo_landing;');
    const awards = /array\[([^\]]*)\]/.exec(sqlConst('c_awards'));
    expect(awards, 'c_awards must be an array literal').toBeTruthy();
    expect(awards![1]!.split(',').map((n) => Number(n.trim()))).toEqual([...RANK_RULES.placementAwards]);
  });

  it('the SQL carries the widened demotion gate (owner 2026-09-21): the flag is valid at 0 in ANY division above Bronze I, and no branch demotes outside a demotion game', () => {
    // The check constraint: the medal-floor `% 3` term is gone.
    expect(sqlSrc).toContain('check (not rank_demotion_ready or (rank_points = 0 and rank_division > 0));');
    expect(sqlSrc).not.toContain('rank_division % 3 = 0');
    // settle_rank: the medal-floor test `(d0 % c_per_medal) = 0` no longer exists anywhere in the body — the only
    // `% c_per_medal` left is the promotion-gate KIND test. The instant `d0 - 1` demotion exists ONLY in the
    // demotion-game branch (one occurrence).
    const body = sqlSrc.slice(sqlSrc.indexOf('create or replace function public.settle_rank'));
    expect(body).not.toContain('(d0 % c_per_medal) = 0');
    expect(body.match(/d1 := d0 - 1/g) ?? [], 'exactly one place drops a division: the demotion game').toHaveLength(1);
    expect(body).not.toContain('d1 := c_top - 1');
    expect(body, 'the arming branch reads: a loss to 0 in any division above Bronze I').toContain('if v_base < 0 and v_pts <= 0 and d0 > 0 then');
  });

  it('schema.sql carries the SAME migration block (the cumulative paste file must not drift)', () => {
    const body = sqlSrc.slice(sqlSrc.indexOf('create or replace function public.settle_rank'));
    expect(schemaSrc.replace(/\r\n/g, '\n')).toContain(body.replace(/\r\n/g, '\n'));
  });

  it('the JSON shapes name every RankResult / RankedProfile key the client parses', () => {
    for (const key of ['runId', 'seasonId', 'rulesVersion', 'revisionBefore', 'revisionAfter', 'placement', 'before', 'after',
      'baseDelta', 'appliedDelta', 'cappedPoints', 'wasPromotionGame', 'promotionKind', 'requiredFinish',
      'promotionUnlocked', 'promoted', 'wasDemotionGame', 'demotionUnlocked', 'demoted', 'highestAfter', 'divisionIndex', 'points', 'demotionReady', 'revision', 'position', 'highest']) {
      expect(sqlSrc, `settle_rank JSON must emit '${key}'`).toContain(`'${key}'`);
    }
  });
});

describe('medal rank — transition parity (sim resolver ↔ Edge Function mirror)', () => {
  const starts: RankPosition[] = [];
  for (let d = 0; d <= rankTopDivision(); d++) {
    for (const p of [0, 1, 5, 6, RANK_RULES.promotionLanding, 39, 40, 59, 60, 61, 72, 93, 94, 99, 100, 101, 140]) {
      if (d < rankTopDivision() && p > 100) continue;
      starts.push({ divisionIndex: d, points: p, demotionReady: false });
      if (p === 0 && d > 0) starts.push({ divisionIndex: d, points: p, demotionReady: true }); // an ARMED gate — every division above Bronze I (owner 2026-09-21)
    }
  }

  it('the walk visits an ARMED start in every division above Bronze I (not just the medal floors)', () => {
    expect(starts.filter((s) => s.demotionReady).map((s) => s.divisionIndex)).toEqual([...Array(rankTopDivision()).keys()].map((i) => i + 1));
  });

  it('every division × points × placement agrees field-for-field', () => {
    let checked = 0;
    for (const start of starts) {
      for (let placement = 1; placement <= 8; placement++) {
        const client = resolveRank(start, placement);
        const server = resolveRankOutcome(start, placement);
        const label = `division ${start.divisionIndex} @ ${start.points}, placement ${placement}`;
        expect(server.after, label).toEqual(client.after);
        expect(server.baseDelta, label).toBe(client.baseDelta);
        expect(server.appliedDelta, label).toBe(client.appliedDelta);
        expect(server.cappedPoints, label).toBe(client.cappedPoints);
        expect(server.wasPromotionGame, label).toBe(client.wasPromotionGame);
        expect(server.promotionKind, label).toBe(client.promotionKind);
        expect(server.requiredFinish, label).toBe(client.requiredFinish);
        expect(server.promotionUnlocked, label).toBe(client.promotionUnlocked);
        expect(server.promoted, label).toBe(client.promoted);
        expect(server.wasDemotionGame, label).toBe(client.wasDemotionGame);
        expect(server.demotionUnlocked, label).toBe(client.demotionUnlocked);
        expect(server.demoted, label).toBe(client.demoted);
        expect(compareRank(server.after, client.after), label).toBe(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1500);
  });

  it('the owner\'s sequence agrees on both: medal promotion lands at 10 → loss ARMS → loss DEMOTES', () => {
    const seq = [[{ divisionIndex: 5, points: 100 }, 1], 8, 8] as const;
    let c = resolveRank(seq[0][0], seq[0][1]);
    let s = resolveRankOutcome(seq[0][0], seq[0][1]);
    expect(s.after).toEqual(c.after);
    expect(c.after).toEqual({ divisionIndex: 6, points: 10, demotionReady: false });
    expect(s.appliedDelta, 'the landing cushion is the applied delta').toBe(10);
    expect(s.cappedPoints).toBe(0);
    c = resolveRank(c.after, 8); s = resolveRankOutcome(s.after, 8);
    expect(s.after).toEqual(c.after);
    expect(c.after).toEqual({ divisionIndex: 6, points: 0, demotionReady: true });
    expect(s.demotionUnlocked).toBe(true);
    c = resolveRank(c.after, 8); s = resolveRankOutcome(s.after, 8);
    expect(s.after).toEqual(c.after);
    expect(c.after).toEqual({ divisionIndex: 5, points: 60, demotionReady: false });
    expect(s.wasDemotionGame && s.demoted).toBe(true);
  });

  it('the owner\'s 2026-09-21 sequence agrees on both: inside a medal a loss HALTS at 0 (armed) → bottom-4 in the demotion game drops one division', () => {
    let c = resolveRank({ divisionIndex: 7, points: 10 }, 8);
    let s = resolveRankOutcome({ divisionIndex: 7, points: 10 }, 8);
    expect(s.after).toEqual(c.after);
    expect(c.after, 'Gold II 10, 8th: no instant drop to Gold I 70').toEqual({ divisionIndex: 7, points: 0, demotionReady: true });
    expect(s.demoted).toBe(false);
    expect(s.demotionUnlocked).toBe(true);
    expect(s.appliedDelta).toBe(-10);
    expect(s.cappedPoints).toBe(30);
    c = resolveRank(c.after, 6); s = resolveRankOutcome(s.after, 6);
    expect(s.after).toEqual(c.after);
    expect(c.after, 'the demotion game, 6th → Gold I 84').toEqual({ divisionIndex: 6, points: 84, demotionReady: false });
    expect(s.wasDemotionGame && s.demoted).toBe(true);
    // …and a top-4 in the demotion game keeps the division, applying its award from 0
    const kc = resolveRank({ divisionIndex: 7, points: 0, demotionReady: true }, 2);
    const ks = resolveRankOutcome({ divisionIndex: 7, points: 0, demotionReady: true }, 2);
    expect(ks.after).toEqual(kc.after);
    expect(kc.after).toEqual({ divisionIndex: 7, points: 28, demotionReady: false });
    expect(ks.wasDemotionGame && !ks.demoted).toBe(true);
    // the top division too: Ascendant III below 0 arms instead of dropping
    const tc = resolveRank({ divisionIndex: 17, points: 10 }, 8);
    const ts = resolveRankOutcome({ divisionIndex: 17, points: 10 }, 8);
    expect(ts.after).toEqual(tc.after);
    expect(tc.after).toEqual({ divisionIndex: 17, points: 0, demotionReady: true });
  });

  it('both reject the same invalid placements', () => {
    for (const bad of [0, 9, 1.5, Number.NaN]) {
      expect(() => resolveRank({ divisionIndex: 5, points: 50 }, bad)).toThrow();
      expect(() => resolveRankOutcome({ divisionIndex: 5, points: 50 }, bad)).toThrow();
    }
  });
});
