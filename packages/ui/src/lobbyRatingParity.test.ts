import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RANK_RULES, RANK_SEASON, STRENGTH_BONUS_FLOOR, STRENGTH_BONUS_MAX, STRENGTH_BONUS_SPAN, STRENGTH_BOT_RATE, STRENGTH_PLACEMENT_WEIGHTS,
  STRENGTH_PRIOR_FIGHTS, STRENGTH_PRIOR_WINS, STRENGTH_TIERS,
  compareRank, lobbyStrengthOf, rankTopDivision, resolveRank, strengthBonusOf, strengthTierOf, type RankPosition, type StrengthInput,
} from '@game/sim';
import {
  RANK_DEMOTION_ESCAPE_FINISH, RANK_DIVISION_POINTS, RANK_DIVISION_PROMOTION_FINISH, RANK_DIVISIONS_PER_MEDAL, RANK_MEDAL_PROMOTION_FINISH,
  RANK_PLACEMENT_AWARDS, RANK_PROMOTION_LANDING, RANK_RULES_VERSION, RANK_SEASON as SERVER_SEASON, RANK_TOP_DIVISION, resolveRankOutcome,
  STRENGTH_BONUS_FLOOR as SERVER_BONUS_FLOOR, STRENGTH_BONUS_MAX as SERVER_BONUS_MAX, STRENGTH_BONUS_SPAN as SERVER_BONUS_SPAN,
  STRENGTH_BOT_RATE as SERVER_BOT_RATE, STRENGTH_PLACEMENT_WEIGHTS as SERVER_PLACEMENT_WEIGHTS,
  STRENGTH_PRIOR_FIGHTS as SERVER_PRIOR_FIGHTS, STRENGTH_PRIOR_WINS as SERVER_PRIOR_WINS, STRENGTH_TIER_BRUTAL, STRENGTH_TIER_EVEN, STRENGTH_TIER_HARD,
  lobbyStrengthValue, strengthBonusOf as serverStrengthBonusOf, strengthTierOf as serverStrengthTierOf,
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
/** The medal-rank migration (2026-09-20) still owns the profile constraints; the FIGHT-LEDGER migration
 *  (2026-09-22) redefines `settle_rank` with the lobby-strength bonus, so the function body and its constants
 *  are read from THAT file. Historical migrations are never edited. */
const medalSrc = readFileSync(join(repoRoot, 'supabase/migrations/2026-09-20-medal-rank.sql'), 'utf8');
const sqlSrc = readFileSync(join(repoRoot, 'supabase/migrations/2026-09-22-fight-ledger.sql'), 'utf8');
const schemaSrc = readFileSync(join(repoRoot, 'schema.sql'), 'utf8');
const goingInSrc = readFileSync(join(repoRoot, 'supabase/migrations/2026-09-22-lobby-strength-going-in.sql'), 'utf8');

function sqlConst(name: string): string {
  const m = new RegExp(`${name}\\s+constant\\s+[a-z0-9\\[\\]]+\\s*:=\\s*([^;]+);`).exec(sqlSrc);
  if (!m) throw new Error(`could not find ${name} in the fight-ledger migration`);
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

  it('the lobby-strength constants agree (sim, Edge Function module, settle_rank SQL) — owner 2026-09-22', () => {
    expect(SERVER_PRIOR_WINS).toBe(STRENGTH_PRIOR_WINS);
    expect(SERVER_PRIOR_FIGHTS).toBe(STRENGTH_PRIOR_FIGHTS);
    expect(SERVER_BOT_RATE).toBe(STRENGTH_BOT_RATE);
    expect(SERVER_BONUS_MAX).toBe(STRENGTH_BONUS_MAX);
    expect(SERVER_BONUS_FLOOR).toBe(STRENGTH_BONUS_FLOOR);
    expect(SERVER_BONUS_SPAN).toBe(STRENGTH_BONUS_SPAN);
    expect([...SERVER_PLACEMENT_WEIGHTS]).toEqual([...STRENGTH_PLACEMENT_WEIGHTS]);
    expect(STRENGTH_TIER_EVEN).toBe(STRENGTH_TIERS.even);
    expect(STRENGTH_TIER_HARD).toBe(STRENGTH_TIERS.hard);
    expect(STRENGTH_TIER_BRUTAL).toBe(STRENGTH_TIERS.brutal);
    // The owner's numbers (2026-09-22, the revised top-4 rule): the 30 / 70 line and the four weights.
    expect([STRENGTH_PRIOR_WINS, STRENGTH_PRIOR_FIGHTS, STRENGTH_BOT_RATE, STRENGTH_BONUS_MAX, STRENGTH_BONUS_FLOOR, STRENGTH_BONUS_SPAN]).toEqual([10, 20, 0.25, 15, 30, 70]);
    expect([...STRENGTH_PLACEMENT_WEIGHTS]).toEqual([1.0, 0.8, 0.62, 0.47]);
    expect(sqlConst('c_prior_wins')).toBe(String(STRENGTH_PRIOR_WINS));
    expect(sqlConst('c_prior_fights')).toBe(String(STRENGTH_PRIOR_FIGHTS));
    expect(Number(sqlConst('c_bot_rate'))).toBe(STRENGTH_BOT_RATE);
    expect(sqlConst('c_bonus_max')).toBe(String(STRENGTH_BONUS_MAX));
    expect(sqlConst('c_bonus_floor')).toBe(String(STRENGTH_BONUS_FLOOR));
    expect(sqlConst('c_bonus_span')).toBe(String(STRENGTH_BONUS_SPAN));
    const sqlWeights = /^array\[(.*)\]$/.exec(sqlConst('c_bonus_weights'));
    expect(sqlWeights, 'c_bonus_weights is a float8 array literal').not.toBeNull();
    expect(sqlWeights![1]!.split(',').map((w) => Number(w.trim()))).toEqual([...STRENGTH_PLACEMENT_WEIGHTS]);
    expect(sqlConst('c_tier_even')).toBe(String(STRENGTH_TIERS.even));
    expect(sqlConst('c_tier_hard')).toBe(String(STRENGTH_TIERS.hard));
    expect(sqlConst('c_tier_brutal')).toBe(String(STRENGTH_TIERS.brutal));
    // The SQL folds the bonus into the award BEFORE every branch, top-4 only, in the SAME multiplication order
    // as the TS copies (max × weight × factor), and the old overload is gone.
    expect(sqlSrc).toContain('v_base := c_awards[p_placement] + v_bonus;');
    expect(sqlSrc).toContain('if p_placement <= cardinality(c_bonus_weights) then');
    expect(sqlSrc).toContain('round((c_bonus_max * c_bonus_weights[p_placement] * least(1.0::float8, greatest(0.0::float8, (v_strength - c_bonus_floor)::float8 / c_bonus_span)))::numeric)::int');
    expect(sqlSrc).toContain('drop function if exists public.settle_rank(uuid, text, int, int, int, bigint);');
    expect(sqlSrc).toContain('p_seat_keys text[] default null');
    expect(sqlSrc).toContain('revoke all on function public.settle_rank(uuid, text, int, int, int, bigint, text[])');
  });

  it('the strength formula and the bonus agree (sim vs the Edge Function module) on fixtures', () => {
    const tables: StrengthInput[][] = [
      [], // no opponents known: 50
      Array.from({ length: 7 }, (_, i) => ({ key: `bot:hybrid:h${i}`, fights: 0, wins: 0 })), // all bots: 25
      Array.from({ length: 7 }, (_, i) => ({ key: `a|h${i}|1`, fights: 0, wins: 0 })), // unserved: 50
      Array.from({ length: 7 }, (_, i) => ({ key: `a|h${i}|1`, fights: 200, wins: 140 })), // proven 70%: ~68
      Array.from({ length: 7 }, (_, i) => ({ key: `a|h${i}|1`, fights: 40, wins: 36 })), // a strong field
      [{ key: 'a|h|1', fights: 12, wins: 10 }, { key: 'b|h|2', fights: 3, wins: 0 }, { key: 'bot:hybrid:x', fights: 0, wins: 0 }, { key: 'c|h|3', fights: 0, wins: 0 }, { key: 'd|h|4', fights: 30, wins: 22 }, { key: 'e|h|5', fights: 9, wins: 9 }, { key: 'f|h|6', fights: 100, wins: 20 }],
    ];
    for (const inputs of tables) {
      const client = lobbyStrengthOf(inputs);
      expect(lobbyStrengthValue(inputs), JSON.stringify(inputs)).toBe(client.value);
      expect(serverStrengthTierOf(client.value)).toBe(client.tier);
      expect(strengthTierOf(client.value)).toBe(client.tier);
      for (let placement = 1; placement <= 8; placement++) expect(serverStrengthBonusOf(client.value, placement)).toBe(strengthBonusOf(client.value, placement));
    }
    for (let s = 0; s <= 100; s++) {
      for (let placement = 1; placement <= 8; placement++) expect(serverStrengthBonusOf(s, placement), `${placement} at ${s}`).toBe(strengthBonusOf(s, placement));
      for (let placement = 5; placement <= 8; placement++) expect(serverStrengthBonusOf(s, placement)).toBe(0);
    }
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
    // The check constraint (still owned by the medal-rank migration): the medal-floor `% 3` term is gone.
    expect(medalSrc).toContain('check (not rank_demotion_ready or (rank_points = 0 and rank_division > 0));');
    expect(medalSrc).not.toContain('rank_division % 3 = 0');
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

  it('the going-in block (2026-09-22): the same settle_rank, the strength from lobby_fights minus this seed, the constants untouched, schema.sql carries it', () => {
    const body = goingInSrc.slice(goingInSrc.indexOf('create or replace function public.settle_rank'));
    expect(body).toContain('p_seed bigint default null,\n  p_seat_keys text[] default null');
    expect(body, 'no overload is dropped or added by the going-in swap').not.toContain('drop function');
    expect(body).toContain('x.lobby_seed <> p_seed');
    expect(body, 'the view cannot exclude by seed, so the function must not read it').not.toContain('run_fight_records');
    for (const c of ['c_prior_wins      constant int := 10', 'c_prior_fights    constant int := 20', 'c_bot_rate        constant float8 := 0.25',
      'c_bonus_max       constant int := 15', 'c_bonus_floor     constant int := 30', 'c_bonus_span      constant int := 70', 'c_bonus_weights   constant float8[] := array[1.0, 0.8, 0.62, 0.47]']) {
      expect(body, `the going-in body keeps ${c}`).toContain(c);
      expect(sqlSrc, `the fight-ledger body has ${c}`).toContain(c);
    }
    expect(schemaSrc.replace(/\r\n/g, '\n')).toContain(body.replace(/\r\n/g, '\n'));
  });

  it('the JSON shapes name every RankResult / RankedProfile key the client parses', () => {
    for (const key of ['runId', 'seasonId', 'rulesVersion', 'revisionBefore', 'revisionAfter', 'placement', 'before', 'after',
      'baseDelta', 'appliedDelta', 'cappedPoints', 'wasPromotionGame', 'promotionKind', 'requiredFinish',
      'promotionUnlocked', 'promoted', 'wasDemotionGame', 'demotionUnlocked', 'demoted', 'highestAfter', 'divisionIndex', 'points', 'demotionReady',
      'strengthBonus', 'lobbyStrength']) {
      expect(sqlSrc, `settle_rank JSON must emit '${key}'`).toContain(`'${key}'`);
    }
    for (const key of ['revision', 'position', 'highest']) expect(medalSrc, `rank_profile_json must emit '${key}'`).toContain(`'${key}'`);
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

  it('the lobby-strength bonus agrees on both (owner 2026-09-22, the top-4 rule): the anchor table, 5th to 8th = +0, the cap, the gates and the landing', () => {
    // The owner's anchors, pinned on BOTH TS copies: [placement, strength, bonus].
    const anchors: [number, number, number][] = [[1, 100, 15], [1, 75, 10], [4, 100, 7], [2, 100, 12], [3, 100, 9], [1, 50, 4], [4, 50, 2]];
    for (const [placement, strength, b] of anchors) {
      expect(strengthBonusOf(strength, placement), `sim: ${placement} at ${strength}`).toBe(b);
      expect(serverStrengthBonusOf(strength, placement), `server: ${placement} at ${strength}`).toBe(b);
    }
    for (let placement = 5; placement <= 8; placement++) expect(strengthBonusOf(100, placement)).toBe(0);
    const bonus = (s: number, placement: number) => strengthBonusOf(s, placement);
    const cases: [RankPosition, number, number][] = [
      [{ divisionIndex: 7, points: 20 }, 1, bonus(74, 1)],       // a mid-division 1st at Brutal 74: +40 +9
      [{ divisionIndex: 7, points: 20 }, 4, bonus(74, 4)],       // a 4th at Brutal 74: +6 +4
      [{ divisionIndex: 7, points: 20 }, 1, bonus(100, 1)],      // +55
      [{ divisionIndex: 7, points: 20 }, 1, bonus(50, 1)],       // Even 50: +40 +4
      [{ divisionIndex: 7, points: 20 }, 1, bonus(30, 1)],       // strength 30: the plain +40
      [{ divisionIndex: 7, points: 20 }, 5, bonus(100, 1)],      // 5th: −6, a bonus handed in is ignored
      [{ divisionIndex: 7, points: 20 }, 8, bonus(100, 1)],      // 8th: −40, never scaled
      [{ divisionIndex: 7, points: 90 }, 1, bonus(100, 1)],      // the cap: 90 + 55 lands on 100, overflow discarded
      [{ divisionIndex: 7, points: 100 }, 1, bonus(100, 1)],     // the gate: promoted, landing 10, bonus converted
      [{ divisionIndex: 7, points: 100 }, 4, bonus(100, 4)],     // a 4th at a division gate: promoted, landing 10
      [{ divisionIndex: 8, points: 100 }, 1, bonus(100, 1)],     // the medal gate
      [{ divisionIndex: 8, points: 100 }, 4, bonus(100, 4)],     // a 4th at a medal gate: holds at 100
      [{ divisionIndex: 17, points: 130 }, 1, bonus(100, 1)],    // Ascendant III takes the full +55
      [{ divisionIndex: 17, points: 130 }, 4, bonus(100, 4)],    // and a 4th's full +13
      [{ divisionIndex: 7, points: 0, demotionReady: true }, 1, bonus(100, 1)], // a demotion game escaped with the bonus
      [{ divisionIndex: 7, points: 0, demotionReady: true }, 4, bonus(100, 4)], // escaped by a 4th, with its bonus
    ];
    for (const [start, placement, b] of cases) {
      const c = resolveRank(start, placement, RANK_RULES, { bonus: b, lobbyStrength: 100 });
      const s = resolveRankOutcome(start, placement, b);
      const label = `division ${start.divisionIndex} @ ${start.points}, placement ${placement}, bonus ${b}`;
      expect(s.after, label).toEqual(c.after);
      expect(s.baseDelta, label).toBe(c.baseDelta);
      expect(s.strengthBonus, label).toBe(c.strengthBonus);
      expect(s.appliedDelta, label).toBe(c.appliedDelta);
      expect(s.cappedPoints, label).toBe(c.cappedPoints);
      expect(s.promoted, label).toBe(c.promoted);
      expect(s.promotionUnlocked, label).toBe(c.promotionUnlocked);
    }
    // The numbers themselves, on the sim copy (the server copy just agreed with it).
    expect(resolveRank({ divisionIndex: 7, points: 20 }, 1, RANK_RULES, { bonus: 9 })).toMatchObject({ baseDelta: 49, strengthBonus: 9, appliedDelta: 49, after: { divisionIndex: 7, points: 69 } });
    expect(resolveRank({ divisionIndex: 7, points: 20 }, 4, RANK_RULES, { bonus: 4 })).toMatchObject({ baseDelta: 10, strengthBonus: 4, appliedDelta: 10, after: { divisionIndex: 7, points: 30 } });
    expect(resolveRank({ divisionIndex: 7, points: 20 }, 1, RANK_RULES, { bonus: 0 })).toMatchObject({ baseDelta: 40, strengthBonus: 0, appliedDelta: 40 });
    expect(resolveRank({ divisionIndex: 7, points: 20 }, 5, RANK_RULES, { bonus: 15 })).toMatchObject({ baseDelta: -6, strengthBonus: 0, appliedDelta: -6 });
    expect(resolveRank({ divisionIndex: 7, points: 90 }, 1, RANK_RULES, { bonus: 15 })).toMatchObject({ baseDelta: 55, strengthBonus: 15, appliedDelta: 10, cappedPoints: 45, promotionUnlocked: true, after: { divisionIndex: 7, points: 100 } });
    expect(resolveRank({ divisionIndex: 7, points: 100 }, 1, RANK_RULES, { bonus: 15 })).toMatchObject({ baseDelta: 55, strengthBonus: 15, appliedDelta: 10, cappedPoints: 0, promoted: true, after: { divisionIndex: 8, points: 10 } });
    expect(resolveRank({ divisionIndex: 7, points: 100 }, 4, RANK_RULES, { bonus: 7 })).toMatchObject({ baseDelta: 13, strengthBonus: 7, appliedDelta: 10, cappedPoints: 0, promoted: true, after: { divisionIndex: 8, points: 10 } });
  });

  it('both reject the same invalid placements', () => {
    for (const bad of [0, 9, 1.5, Number.NaN]) {
      expect(() => resolveRank({ divisionIndex: 5, points: 50 }, bad)).toThrow();
      expect(() => resolveRankOutcome({ divisionIndex: 5, points: 50 }, bad)).toThrow();
    }
  });
});
