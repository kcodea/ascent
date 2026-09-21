import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RANK_RULES, RANK_SEASON, compareRank, rankTopDivision, resolveRank, type RankPosition } from '@game/sim';
import {
  RANK_DIVISION_POINTS, RANK_DIVISION_PROMOTION_FINISH, RANK_DIVISIONS_PER_MEDAL, RANK_MEDAL_PROMOTION_FINISH,
  RANK_PLACEMENT_AWARDS, RANK_RULES_VERSION, RANK_SEASON as SERVER_SEASON, RANK_TOP_DIVISION, resolveRankOutcome,
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
    const awards = /array\[([^\]]*)\]/.exec(sqlConst('c_awards'));
    expect(awards, 'c_awards must be an array literal').toBeTruthy();
    expect(awards![1]!.split(',').map((n) => Number(n.trim()))).toEqual([...RANK_RULES.placementAwards]);
  });

  it('schema.sql carries the SAME migration block (the cumulative paste file must not drift)', () => {
    const body = sqlSrc.slice(sqlSrc.indexOf('create or replace function public.settle_rank'));
    expect(schemaSrc.replace(/\r\n/g, '\n')).toContain(body.replace(/\r\n/g, '\n'));
  });

  it('the JSON shapes name every RankResult / RankedProfile key the client parses', () => {
    for (const key of ['runId', 'seasonId', 'rulesVersion', 'revisionBefore', 'revisionAfter', 'placement', 'before', 'after',
      'baseDelta', 'appliedDelta', 'cappedPoints', 'wasPromotionGame', 'promotionKind', 'requiredFinish',
      'promotionUnlocked', 'promoted', 'demoted', 'highestAfter', 'divisionIndex', 'points', 'revision', 'position', 'highest']) {
      expect(sqlSrc, `settle_rank JSON must emit '${key}'`).toContain(`'${key}'`);
    }
  });
});

describe('medal rank — transition parity (sim resolver ↔ Edge Function mirror)', () => {
  const starts: RankPosition[] = [];
  for (let d = 0; d <= rankTopDivision(); d++) {
    for (const p of [0, 1, 5, 6, 39, 40, 59, 60, 61, 72, 93, 94, 99, 100, 101, 140]) {
      if (d < rankTopDivision() && p > 100) continue;
      starts.push({ divisionIndex: d, points: p });
    }
  }

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
        expect(server.demoted, label).toBe(client.demoted);
        expect(compareRank(server.after, client.after), label).toBe(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1500);
  });

  it('both reject the same invalid placements', () => {
    for (const bad of [0, 9, 1.5, Number.NaN]) {
      expect(() => resolveRank({ divisionIndex: 5, points: 50 }, bad)).toThrow();
      expect(() => resolveRankOutcome({ divisionIndex: 5, points: 50 }, bad)).toThrow();
    }
  });
});
