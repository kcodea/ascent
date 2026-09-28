import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CURVE_BANDS, PROGRESSION_CURVE_VERSION, PROGRESSION_MODES, PROGRESSION_RULES_VERSION, TITLES, TUTORIAL_COURSE_ID,
  TUTORIAL_COURSE_VERSION, XP_RULES, levelOfXp, xpForSettlement,
} from './rules';
import {
  ALPHA_TESTER_TITLE_ID, COSMETICS, COSMETIC_CATEGORIES, COSMETIC_CATEGORY_DEFS, COSMETIC_RARITIES, CRATE_ROLL_VERSION, RARITY_WEIGHTS,
  crateWeightOf, eligibleCrateCosmetics, pickCrateReward,
} from './cosmetics';
import { SQL_ERROR_STATUS } from './server';
import { INVENTORY_ERROR_STATUS } from './inventory';

/**
 * TS ↔ SQL PARITY for the progression writer. There is no Postgres in CI, so (like the medal-rank parity test)
 * the plpgsql constants are read out of the migration TEXT and compared with the TS rules, and the SQL's curve
 * and XP arithmetic are re-implemented here from those extracted constants and driven across every level and
 * placement against the TS functions. A re-tune in one copy fails CI here rather than writing different XP in
 * production; the Edge Function's `parity` flag is the last line for the SQL body itself.
 */
const root = join(__dirname, '../../..');
const sql = readFileSync(join(root, 'supabase/migrations/2026-09-27-account-progression.sql'), 'utf8');
/** The crates migration REPLACES `settle_progression` and the JSON shapes: the live definitions are read from it. */
const crates = readFileSync(join(root, 'supabase/migrations/2026-09-28-progression-crates.sql'), 'utf8');
const schema = readFileSync(join(root, 'schema.sql'), 'utf8');

/** The body of a function's LATEST definition (the crates migration when it defines it, else the MVP's). */
function fnBody(name: string, from?: string): string {
  const text = from ?? (crates.includes(`create or replace function public.${name}(`) ? crates : sql);
  const start = text.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`no function ${name} in the migration`);
  const open = text.indexOf('$$', start);
  const close = text.indexOf('$$', open + 2);
  return text.slice(open + 2, close);
}
function constOf(body: string, name: string): string {
  const m = new RegExp(`${name}\\s+constant\\s+[a-z]+\\s*:=\\s*([^;]+);`).exec(body);
  if (!m) throw new Error(`could not find ${name}`);
  return m[1]!.trim().replace(/^'(.*)'$/, '$1');
}
const settle = fnBody('settle_progression');
const settleMvp = fnBody('settle_progression', sql);
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

  it('every writer is SECURITY DEFINER with a pinned search_path, and service-role only', () => {
    for (const [text, fn, sig] of [
      [sql, 'settle_progression', 'uuid, text, text, bigint, boolean, int, jsonb'],
      [crates, 'settle_progression', 'uuid, text, text, bigint, boolean, int, jsonb'],
      [crates, 'open_crate', 'uuid, uuid'],
      [crates, 'equip_title', 'uuid, text'],
    ] as const) {
      const at = text.indexOf(`create or replace function public.${fn}(`);
      const head = text.slice(at, text.indexOf('as $$', at));
      expect(head, fn).toContain('security definer');
      expect(head, fn).toContain('set search_path = public');
      expect(text).toContain(`revoke all on function public.${fn}(${sig}) from public, anon, authenticated;`);
      expect(text).toContain(`grant execute on function public.${fn}(${sig}) to service_role;`);
      expect(fnBody(fn, text), fn).toContain('pg_advisory_xact_lock');
    }
    expect(settle).toMatch(/for update;/);
  });

  it('clients cannot write progression columns, and the switch ships OFF', () => {
    expect(sql).toContain('create trigger profiles_progression_guard before insert or update on public.profiles');
    expect(sql).toMatch(/insert into public\.progression_config \(id, epoch\) values \(1, null\)/);
    // the switch is commented out: a re-run can never move the epoch
    expect(sql).not.toMatch(/^update public\.progression_config set epoch/m);
  });

  it('schema.sql (the cumulative paste file) carries both migrations verbatim, the crates one AFTER the MVP', () => {
    const flat = schema.replace(/\r\n/g, '\n');
    const mvp = sql.replace(/\r\n/g, '\n').trim();
    const crt = crates.replace(/\r\n/g, '\n').trim();
    expect(flat).toContain(mvp);
    expect(flat).toContain(crt);
    expect(flat.indexOf(crt)).toBeGreaterThan(flat.indexOf(mvp));
  });
});

describe('the crates migration (2026-09-28)', () => {
  it('replaces settle_progression WITHOUT changing a single XP / curve / title constant', () => {
    const consts = (body: string): string[] => [...body.matchAll(/^\s*(c_[a-z_]+)\s+constant\s+[a-z]+\s*:=\s*([^;]+);/gm)].map((m) => `${m[1]}=${m[2]!.trim()}`);
    expect(consts(settle)).toEqual(consts(settleMvp));
    expect(consts(settle).length).toBeGreaterThan(10);
  });

  it('every SQL error open_crate / equip_title raise is mapped by the inventory Edge Function', () => {
    for (const fn of ['open_crate', 'equip_title']) {
      const raised = [...fnBody(fn).matchAll(/raise exception '([a-z_]+)'/g)].map((x) => x[1]!);
      expect(raised.length, fn).toBeGreaterThan(0);
      for (const code of new Set(raised)) expect(INVENTORY_ERROR_STATUS[code], `${fn}: ${code}`).toBeDefined();
    }
  });

  it('the result JSON carries the crates; the crate JSON carries every CrateRow key', () => {
    const resultJson = fnBody('progression_result_json');
    for (const k of ['cratesAwarded', 'crateIds']) expect(resultJson, k).toContain(`'${k}'`);
    const crateJson = fnBody('progression_crate_json');
    for (const k of ['crateId', 'earnedLevel', 'state', 'rewardId', 'earnedAt', 'openedAt']) expect(crateJson, k).toContain(`'${k}'`);
  });

  it('the rarity weights and roll version equal the TS rules', () => {
    const pool = fnBody('progression_crate_pool');
    expect(COSMETIC_RARITIES.map((r) => n(pool, `c_w_${r}`))).toEqual(COSMETIC_RARITIES.map((r) => RARITY_WEIGHTS[r]));
    expect(RARITY_WEIGHTS).toEqual({ common: 55, rare: 30, epic: 12, legendary: 3 });
    expect(n(fnBody('open_crate'), 'c_roll_version')).toBe(CRATE_ROLL_VERSION);
  });

  /** The rows of one `insert into public.<table> (...) values (...), ... on conflict` seed. */
  function seedRows(table: string): string[][] {
    const at = crates.indexOf(`insert into public.${table} (`);
    const block = crates.slice(crates.indexOf('values', at) + 6, crates.indexOf('on conflict', at));
    return [...block.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]!.split(',').map((x) => x.trim().replace(/^'(.*)'$/, '$1')));
  }

  it('the category seed equals COSMETIC_CATEGORY_DEFS (weights + the feature flags: only title on)', () => {
    const rows = seedRows('cosmetic_categories');
    expect(rows.map((r) => r[0])).toEqual([...COSMETIC_CATEGORIES]);
    for (const [id, weight, enabled, target] of rows) {
      const def = COSMETIC_CATEGORY_DEFS[id as keyof typeof COSMETIC_CATEGORY_DEFS];
      expect({ weight: Number(weight), enabled: enabled === 'true', target }, id).toEqual({ weight: def.weight, enabled: def.enabled, target: def.target });
    }
    expect(COSMETIC_CATEGORIES.filter((c) => COSMETIC_CATEGORY_DEFS[c].enabled)).toEqual(['title']);
  });

  it('the catalog seed equals COSMETICS row for row (ids, category, rarity, acquisition, active)', () => {
    const rows = seedRows('cosmetic_catalog');
    const nul = (v: string | undefined): string | null => (v === undefined || v === 'null' ? null : v);
    const sqlRows = rows.map(([id, category, rarity, source, level, targetType, targetId, achievementId, active]) => ({
      id, category, rarity, source, level: nul(level) === null ? null : Number(level),
      targetType: nul(targetType), targetId: nul(targetId), achievementId: nul(achievementId), active: active === 'true',
    }));
    const tsRows = COSMETICS.map((c) => ({
      id: c.id, category: c.category, rarity: c.rarity, source: c.acquisition.type,
      level: c.acquisition.type === 'level_milestone' ? c.acquisition.level : null,
      targetType: c.target?.type ?? null, targetId: c.target?.id ?? null,
      achievementId: c.acquisition.type === 'achievement' ? c.acquisition.id : null, active: c.active,
    }));
    expect(sqlRows).toEqual(tsRows);
    // the settlement's Alpha Tester constants agree with the catalog's level milestone
    expect(constOf(settle, 'c_alpha_title')).toBe(ALPHA_TESTER_TITLE_ID);
    expect(n(settle, 'c_alpha_level')).toBe(TITLES[ALPHA_TESTER_TITLE_ID]!.unlockLevel);
  });

  it('the SQL walk (cumulative weight in id order, first bucket above the roll) picks exactly what pickCrateReward picks, for every roll', () => {
    const pool = fnBody('progression_crate_pool');
    const w = (r: string): number => n(pool, `c_w_${r}`);
    const catWeight = Object.fromEntries(seedRows('cosmetic_categories').map((r) => [r[0], Number(r[1])]));
    for (const owned of [[], ['title_wanderer', 'title_the_unbroken'], eligibleCrateCosmetics([]).slice(1).map((c) => c.id)]) {
      const eligible = eligibleCrateCosmetics(owned);
      // SQL: order by id collate "C" (byte order), weight = rarity x category
      const sqlPool = [...eligible].sort((a, b) => (Buffer.from(a.id) < Buffer.from(b.id) ? -1 : 1)).map((c) => ({ id: c.id, weight: w(c.rarity) * catWeight[c.category]! }));
      expect(sqlPool.map((p) => p.weight)).toEqual(eligible.map(crateWeightOf));
      const total = sqlPool.reduce((s, p) => s + p.weight, 0);
      for (let roll = 0; roll < total; roll++) {
        let acc = 0;
        const sqlPick = sqlPool.find((p) => (acc += p.weight) > roll)!.id;
        expect(sqlPick, `roll ${roll}`).toBe(pickCrateReward(eligible, roll)!.id);
      }
    }
  });
});
