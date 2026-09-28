import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALPHA_TESTER_TITLE_ID, CURVE_BANDS, PROGRESSION_CURVE_VERSION, PROGRESSION_MODES, PROGRESSION_RULES_VERSION, TITLES, TUTORIAL_COURSE_ID,
  TUTORIAL_COURSE_VERSION, XP_RULES, levelOfXp, xpForSettlement,
} from './rules';
import { SQL_ERROR_STATUS } from './server';

/**
 * TS ↔ SQL PARITY for the progression writer. There is no Postgres in CI, so (like the medal-rank parity test)
 * the plpgsql constants are read out of the migration TEXT and compared with the TS rules, and the SQL's curve
 * and XP arithmetic are re-implemented here from those extracted constants and driven across every level and
 * placement against the TS functions. A re-tune in one copy fails CI here rather than writing different XP in
 * production; the Edge Function's `parity` flag is the last line for the SQL body itself.
 */
const root = join(__dirname, '../../..');
const sql = readFileSync(join(root, 'supabase/migrations/2026-09-27-account-progression.sql'), 'utf8');
const schema = readFileSync(join(root, 'schema.sql'), 'utf8');

function fnBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`no function ${name} in the migration`);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$', open + 2);
  return sql.slice(open + 2, close);
}
function constOf(body: string, name: string): string {
  const m = new RegExp(`${name}\\s+constant\\s+[a-z]+\\s*:=\\s*([^;]+);`).exec(body);
  if (!m) throw new Error(`could not find ${name}`);
  return m[1]!.trim().replace(/^'(.*)'$/, '$1');
}
const settle = fnBody('settle_progression');
const curve = fnBody('progression_level_of');
const n = (body: string, name: string): number => Number(constOf(body, name));

describe('settle_progression constants equal the TS rules', () => {
  it('XP values', () => {
    expect(n(settle, 'c_rules')).toBe(PROGRESSION_RULES_VERSION);
    expect(n(settle, 'c_curve')).toBe(PROGRESSION_CURVE_VERSION);
    expect(n(settle, 'c_complete')).toBe(XP_RULES.complete);
    expect(n(settle, 'c_top_four')).toBe(XP_RULES.topFour);
    expect(n(settle, 'c_first_place')).toBe(XP_RULES.firstPlace);
    expect(n(settle, 'c_comeback')).toBe(XP_RULES.comeback);
    expect(n(settle, 'c_comeback_streak')).toBe(XP_RULES.comebackStreak);
    expect(n(settle, 'c_practice_percent')).toBe(XP_RULES.practicePercent);
    expect(n(settle, 'c_practice_flat')).toBe(XP_RULES.practiceFlat);
    expect(n(settle, 'c_tutorial')).toBe(XP_RULES.tutorial);
    expect(constOf(settle, 'c_tutorial_course')).toBe(TUTORIAL_COURSE_ID);
    expect(n(settle, 'c_tutorial_version')).toBe(TUTORIAL_COURSE_VERSION);
  });

  it('Alpha Tester at Level 2', () => {
    expect(constOf(settle, 'c_alpha_title')).toBe(ALPHA_TESTER_TITLE_ID);
    expect(n(settle, 'c_alpha_level')).toBe(TITLES[ALPHA_TESTER_TITLE_ID]!.unlockLevel);
    expect(TITLES[ALPHA_TESTER_TITLE_ID]!.unlockLevel).toBe(2);
  });

  it('the curve bands', () => {
    expect(n(curve, 'c_band1_xp')).toBe(CURVE_BANDS[0]!.xp);
    expect(n(curve, 'c_band1_top')).toBe(CURVE_BANDS[0]!.toLevel);
    expect(n(curve, 'c_band2_xp')).toBe(CURVE_BANDS[1]!.xp);
    expect(n(curve, 'c_band2_top')).toBe(CURVE_BANDS[1]!.toLevel);
    expect(n(curve, 'c_band3_xp')).toBe(CURVE_BANDS[2]!.xp);
    expect(CURVE_BANDS).toHaveLength(3);
  });

  it('the SQL closed-form curve (re-implemented from its extracted constants) agrees with levelOfXp everywhere', () => {
    const b1 = n(curve, 'c_band1_xp'), t1 = n(curve, 'c_band1_top'), b2 = n(curve, 'c_band2_xp'), t2 = n(curve, 'c_band2_top'), b3 = n(curve, 'c_band3_xp');
    const sqlLevel = (xp: number): number => {
      if (xp < 0) return 1;
      if (xp < t1 * b1) return 1 + Math.floor(xp / b1);
      let v = xp - t1 * b1;
      if (v < (t2 - t1) * b2) return t1 + 1 + Math.floor(v / b2);
      v -= (t2 - t1) * b2;
      return t2 + 1 + Math.floor(v / b3);
    };
    for (let xp = 0; xp <= 60_000; xp += 5) expect(sqlLevel(xp), `${xp} XP`).toBe(levelOfXp(xp));
  });

  it('the SQL practice arithmetic (integer, remainder on the base) agrees with xpForSettlement', () => {
    const pct = n(settle, 'c_practice_percent');
    const scale = (x: number): number => Math.floor((x * pct + 50) / 100);
    for (let p = 1; p <= 8; p++) {
      for (const comeback of [false, true]) {
        const top = p <= 4 ? n(settle, 'c_top_four') : 0;
        const first = p === 1 ? n(settle, 'c_first_place') : 0;
        const come = comeback ? n(settle, 'c_comeback') : 0;
        const total = scale(n(settle, 'c_complete') + top + first + come);
        const sqlXp = { base: total - scale(top) - scale(first) - scale(come), topFour: scale(top), firstPlace: scale(first), comeback: scale(come), total };
        expect(sqlXp, `${p}/${comeback}`).toEqual(xpForSettlement({ mode: 'practice', placement: p, comeback }));
      }
    }
  });
});

describe('the migration shape', () => {
  it('the ledger modes equal the TS modes', () => {
    const m = /mode\s+text not null check \(mode in \(([^)]+)\)\)/.exec(sql);
    expect(m, 'progression_results.mode check').toBeTruthy();
    expect(m![1]!.split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([...PROGRESSION_MODES]);
  });

  it('every SQL error the writer raises is mapped by the Edge Function', () => {
    const raised = [...settle.matchAll(/raise exception '([a-z_]+)'/g)].map((x) => x[1]!);
    expect(raised.length).toBeGreaterThan(5);
    for (const code of new Set(raised)) expect(SQL_ERROR_STATUS[code], code).toBeDefined();
  });

  it('the JSON shapes carry every key the client parses', () => {
    const resultJson = fnBody('progression_result_json');
    for (const k of ['runId', 'mode', 'rulesVersion', 'placement', 'comeback', 'xp', 'base', 'topFour', 'firstPlace', 'total', 'before', 'after', 'lifetimeXp', 'level', 'unlockedTitles', 'revisionAfter', 'settledAt']) {
      expect(resultJson, k).toContain(`'${k}'`);
    }
    const profileJson = fnBody('progression_profile_json');
    for (const k of ['accountXp', 'accountLevel', 'revision', 'equippedTitleId', 'titles']) expect(profileJson, k).toContain(`'${k}'`);
  });

  it('the writer is SECURITY DEFINER with a pinned search_path, and service-role only', () => {
    const head = sql.slice(sql.indexOf('create or replace function public.settle_progression('), sql.indexOf('as $$', sql.indexOf('create or replace function public.settle_progression(')));
    expect(head).toContain('security definer');
    expect(head).toContain('set search_path = public');
    expect(sql).toContain('revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;');
    expect(settle).toContain('pg_advisory_xact_lock');
    expect(settle).toMatch(/for update;/);
  });

  it('clients cannot write progression columns, and the switch ships OFF', () => {
    expect(sql).toContain('create trigger profiles_progression_guard before insert or update on public.profiles');
    expect(sql).toMatch(/insert into public\.progression_config \(id, epoch\) values \(1, null\)/);
    // the switch is commented out: a re-run can never move the epoch
    expect(sql).not.toMatch(/^update public\.progression_config set epoch/m);
  });

  it('schema.sql (the cumulative paste file) carries the migration verbatim', () => {
    expect(schema.replace(/\r\n/g, '\n')).toContain(sql.replace(/\r\n/g, '\n').trim());
  });
});
