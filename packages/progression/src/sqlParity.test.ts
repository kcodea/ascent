import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CURVE_BANDS, PROGRESSION_CURVE_VERSION, PROGRESSION_MODES, PROGRESSION_RULES_VERSION, TITLES, TUTORIAL_COURSE_ID,
  TUTORIAL_COURSE_VERSION, XP_RULES, levelOfXp, xpForSettlement,
} from './rules';
import {
  ALPHA_TESTER_TITLE_ID, COSMETICS, COSMETIC_CATEGORIES, COSMETIC_CATEGORY_DEFS, COSMETIC_RARITIES, CRATE_RARITY_ODDS, CRATE_ROLL_VERSION,
  EQUIP_SLOTS, HERO_TITLE_COSMETICS, catalogSyncPayload, crateRarityFallback, eligibleCrateCosmetics, heroMasterTitleId, heroTitleId, pickCrateReward,
} from './cosmetics';
import { SQL_ERROR_STATUS } from './server';
import {
  ACHIEVEMENTS, ACHIEVEMENT_AGGS, ACHIEVEMENT_MODES, ACHIEVEMENT_TRUSTS, ASCENDANT_DIVISION, BRUTAL_LOBBY_STRENGTH, META_METRIC, SERVER_METRICS, achievementCatalogPayload,
} from './achievements';
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
/** The skins migration adds the code-owned catalog sync and REPLACES `progression_crate_pool` + `progression_profile_json`. */
const skins = readFileSync(join(root, 'supabase/migrations/2026-09-28-progression-skins.sql'), 'utf8');
/** The achievements migration (2026-09-28) REPLACES `settle_progression` + `progression_result_json` and adds the catalog sync. */
const ach = readFileSync(join(root, 'supabase/migrations/2026-09-28-achievements.sql'), 'utf8');
/** The hero attack migration (2026-09-28) REPLACES `equip_cosmetic` to accept the account-wide `hero_attack` slot. */
const heroAttack = readFileSync(join(root, 'supabase/migrations/2026-09-28-progression-hero-attack.sql'), 'utf8');
/** The fixed-odds migration (2026-09-29) REPLACES `progression_crate_pool` + `open_crate` and adds `progression_crate_pick`. */
const odds = readFileSync(join(root, 'supabase/migrations/2026-09-29-crate-fixed-rarity-odds.sql'), 'utf8');
/** The equal-chance migration (2026-09-29, "yeah equal chance") REPLACES `progression_crate_pick` + `open_crate`. */
const uniform = readFileSync(join(root, 'supabase/migrations/2026-09-29-crate-uniform-within-rarity.sql'), 'utf8');
/** The hero titles migration (2026-09-29) REPLACES `settle_progression` (it grants achievement titles) and seeds the 66 hero titles. */
const heroTitles = readFileSync(join(root, 'supabase/migrations/2026-09-29-hero-titles.sql'), 'utf8');
/** The Gauntlet migration (2026-09-29) REPLACES `progression_crate_json` (adds `source`) + the crate transition guard. */
const gauntlet = readFileSync(join(root, 'supabase/migrations/2026-09-29-gauntlet-progress.sql'), 'utf8');
const schema = readFileSync(join(root, 'schema.sql'), 'utf8');

/** The body of a function's LATEST definition (gauntlet, else hero titles, else equal chance, else fixed odds, else hero attack, else achievements, else skins, else crates, else the MVP's). */
function fnBody(name: string, from?: string): string {
  const defines = (t: string): boolean => t.includes(`create or replace function public.${name}(`);
  const text = from ?? (defines(gauntlet) ? gauntlet : defines(heroTitles) ? heroTitles : defines(uniform) ? uniform : defines(odds) ? odds : defines(heroAttack) ? heroAttack : defines(ach) ? ach : defines(skins) ? skins : defines(crates) ? crates : sql);
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
    for (const k of ['runId', 'mode', 'rulesVersion', 'placement', 'comeback', 'xp', 'base', 'topFour', 'firstPlace', 'total', 'before', 'after', 'lifetimeXp', 'level', 'unlockedTitles', 'cratesAwarded', 'crateIds', 'achievements', 'achievementXp', 'revisionAfter', 'settledAt']) {
      expect(resultJson, k).toContain(`'${k}'`);
    }
    const profileJson = fnBody('progression_profile_json');
    for (const k of ['accountXp', 'accountLevel', 'revision', 'equippedTitleId', 'titles', 'cosmetics', 'loadout', 'slot', 'targetId', 'cosmeticId']) expect(profileJson, k).toContain(`'${k}'`);
  });

  it('every writer is SECURITY DEFINER with a pinned search_path, and service-role only', () => {
    for (const [text, fn, sig] of [
      [sql, 'settle_progression', 'uuid, text, text, bigint, boolean, int, jsonb'],
      [crates, 'settle_progression', 'uuid, text, text, bigint, boolean, int, jsonb'],
      [crates, 'open_crate', 'uuid, uuid'],
      [crates, 'equip_title', 'uuid, text'],
      [skins, 'equip_cosmetic', 'uuid, text, text, text'],
      [skins, 'sync_cosmetic_catalog', 'jsonb, text'],
      [ach, 'settle_progression', 'uuid, text, text, bigint, boolean, int, jsonb'],
      [ach, 'sync_achievement_catalog', 'jsonb, text'],
      [heroTitles, 'settle_progression', 'uuid, text, text, bigint, boolean, int, jsonb'],
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

  it('schema.sql (the cumulative paste file) carries every progression migration verbatim, in order', () => {
    const flat = schema.replace(/\r\n/g, '\n');
    const at = [sql, crates, skins, ach, heroAttack, odds, uniform, heroTitles, gauntlet].map((t) => flat.indexOf(t.replace(/\r\n/g, '\n').trim()));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('equip_cosmetic accepts exactly the TS equip slots, and the hero attack slot only with the global target', () => {
    const body = fnBody('equip_cosmetic');
    const slots = /p_slot not in \(([^)]*)\)/.exec(body)![1]!.split(',').map((x) => x.trim().replace(/^'(.*)'$/, '$1'));
    expect(slots).toEqual([...EQUIP_SLOTS]);
    expect(body).toContain("if p_target_id is distinct from '' then raise exception 'bad_target'");
  });
});

describe('the crates migration (2026-09-28)', () => {
  it('replaces settle_progression WITHOUT changing a single XP / curve / title constant (every later writer keeps the MVP ones)', () => {
    const consts = (body: string): string[] => [...body.matchAll(/^\s*(c_[a-z_]+)\s+constant\s+[a-z]+\s*:=\s*([^;]+);/gm)].map((m) => `${m[1]}=${m[2]!.trim()}`);
    const mvp = consts(settleMvp);
    expect(consts(fnBody('settle_progression', crates))).toEqual(mvp);
    expect(consts(settle).slice(0, mvp.length)).toEqual(mvp);
    expect(mvp.length).toBeGreaterThan(10);
  });

  it('every SQL error open_crate / equip_title raise is mapped by the inventory Edge Function', () => {
    for (const fn of ['open_crate', 'equip_title', 'equip_cosmetic']) {
      const raised = [...fnBody(fn).matchAll(/raise exception '([a-z_]+)'/g)].map((x) => x[1]!);
      expect(raised.length, fn).toBeGreaterThan(0);
      for (const code of new Set(raised)) expect(INVENTORY_ERROR_STATUS[code], `${fn}: ${code}`).toBeDefined();
    }
  });

  it('the result JSON carries the crates; the crate JSON carries every CrateRow key', () => {
    const resultJson = fnBody('progression_result_json');
    for (const k of ['cratesAwarded', 'crateIds']) expect(resultJson, k).toContain(`'${k}'`);
    const crateJson = fnBody('progression_crate_json');
    for (const k of ['crateId', 'earnedLevel', 'state', 'rewardId', 'earnedAt', 'openedAt', 'source']) expect(crateJson, k).toContain(`'${k}'`);
  });

  it('the published rarity odds and the roll version equal the TS rules (owner 2026-09-29: "make it 50/30/15/5 though")', () => {
    const pick = fnBody('progression_crate_pick');
    expect(COSMETIC_RARITIES.map((r) => n(pick, `c_odds_${r}`))).toEqual(COSMETIC_RARITIES.map((r) => CRATE_RARITY_ODDS[r]));
    expect(CRATE_RARITY_ODDS).toEqual({ common: 50, rare: 30, epic: 15, legendary: 5 });
    expect(Object.values(CRATE_RARITY_ODDS).reduce((a, b) => a + b, 0)).toBe(100);
    // the SQL walks the rarities in the TS order
    expect(/v_rarities text\[\] := array\[([^\]]*)\]/.exec(pick)![1]!.split(',').map((x) => x.trim().replace(/^'(.*)'$/, '$1'))).toEqual([...COSMETIC_RARITIES]);
    expect(n(fnBody('open_crate'), 'c_roll_version')).toBe(CRATE_ROLL_VERSION);
    expect(CRATE_ROLL_VERSION).toBe(3);
    // the pool (still the fixed-odds file's) carries the category weight only; the odds are not in it, and the
    // equal-chance pick never reads the weight (owner 2026-09-29: "yeah equal chance")
    expect(pick).not.toMatch(/pool_weight/);
    expect(pick).toMatch(/order by p\.pool_cosmetic_id collate "C"\s+offset v_idx limit 1;/);
    expect(fnBody('progression_crate_pool')).not.toMatch(/c_w_|c_odds_/);
    expect(fnBody('progression_crate_pool')).toMatch(/select c\.cosmetic_id, k\.weight/);
    // one draw per opening, through the pick
    expect(fnBody('open_crate')).toContain('public.progression_crate_pick(p_user, random())');
    expect(fnBody('open_crate').match(/random\(\)/g)).toHaveLength(1);
  });

  /** The rows of one `insert into public.<table> (...) values (...), ... on conflict` seed in the CRATES file (the
   *  first seed; since the skins file the sync writes both tables from code). */
  function seedRows(table: string, from: string = crates): string[][] {
    const at = from.indexOf(`insert into public.${table} (`);
    const block = from.slice(from.indexOf('values', at) + 6, from.indexOf('on conflict', at));
    return [...block.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]!.split(',').map((x) => x.trim().replace(/^'(.*)'$/, '$1')));
  }

  it('the crates file first seed: every category with the code weight and target (titles on), never re-writing a flag', () => {
    const rows = seedRows('cosmetic_categories');
    expect(rows.map((r) => r[0])).toEqual([...COSMETIC_CATEGORIES]);
    for (const [id, weight, , target] of rows) {
      const def = COSMETIC_CATEGORY_DEFS[id as keyof typeof COSMETIC_CATEGORY_DEFS];
      expect({ weight: Number(weight), target }, id).toEqual({ weight: def.weight, target: def.target });
    }
    expect(rows.filter((r) => r[2] === 'true').map((r) => r[0])).toEqual(['title']);
    // a re-run can never flip a flag the sync (or the owner) set
    for (const table of ['cosmetic_categories', 'cosmetic_catalog']) {
      const at = crates.indexOf(`insert into public.${table} (`);
      expect(crates.slice(crates.indexOf('on conflict', at), crates.indexOf(';', crates.indexOf('on conflict', at))), table).toMatch(/do nothing$/);
    }
  });

  it('the crates file first seed of items equals the code catalog\'s titles row for row', () => {
    const nul = (v: string | undefined): string | null => (v === undefined || v === 'null' ? null : v);
    const sqlRows = seedRows('cosmetic_catalog').map(([id, category, rarity, source, level, targetType, targetId, achievementId, active]) => ({
      cosmeticId: id!, category: category!, rarity: rarity!, acquisitionSource: source!, milestoneLevel: nul(level) === null ? null : Number(level),
      targetType: nul(targetType), targetId: nul(targetId), achievementId: nul(achievementId), active: active === 'true',
    }));
    // the hero titles (2026-09-29) came later, in their own file's seed (below)
    const titles = catalogSyncPayload().items.filter((i) => i.category === 'title' && i.acquisitionSource !== 'achievement');
    expect([...sqlRows].sort((a, b) => (a.cosmeticId < b.cosmeticId ? -1 : 1))).toEqual(titles);
    // the settlement's Alpha Tester constants agree with the catalog's level milestone
    expect(constOf(settle, 'c_alpha_title')).toBe(ALPHA_TESTER_TITLE_ID);
    expect(n(settle, 'c_alpha_level')).toBe(TITLES[ALPHA_TESTER_TITLE_ID]!.unlockLevel);
  });

  it('the SQL pick (rarity band, nearest-rarity fallback, equal-chance index in id order) picks exactly what pickCrateReward picks', () => {
    const pick = fnBody('progression_crate_pick');
    const oddsOf = COSMETIC_RARITIES.map((r) => n(pick, `c_odds_${r}`));
    // the SQL fallback: order by abs(g - rolled), g
    expect(pick).toMatch(/order by abs\(g - v_rolled\), g/);
    expect(pick).toContain('v_idx := least(v_n - 1, greatest(0, floor(v_frac * v_n)::bigint));');
    const sqlOrder = (rolled: number): number[] => [0, 1, 2, 3].sort((a, b) => Math.abs(a - rolled) - Math.abs(b - rolled) || a - b);
    for (let i = 0; i < 4; i++) expect(sqlOrder(i).map((j) => COSMETIC_RARITIES[j])).toEqual(crateRarityFallback(COSMETIC_RARITIES[i]!));
    const sqlPick = (eligible: ReturnType<typeof eligibleCrateCosmetics>, draw: number): string | null => {
      const x = Math.min(Math.max(draw, 0), 1) * 100;
      let lo = 0; let rolled = 3; let frac = 1;
      for (let i = 0; i < 4; i++) {
        if (x < lo + oddsOf[i]!) { rolled = i; frac = (x - lo) / oddsOf[i]!; break; }
        lo += oddsOf[i]!;
      }
      for (const j of sqlOrder(rolled)) {
        const pool = eligible.filter((c) => c.rarity === COSMETIC_RARITIES[j]).sort((a, b) => (Buffer.from(a.id) < Buffer.from(b.id) ? -1 : 1));
        if (pool.length === 0) continue;
        return pool[Math.min(pool.length - 1, Math.max(0, Math.floor(frac * pool.length)))]!.id;
      }
      return null;
    };
    const all = eligibleCrateCosmetics([]);
    const noCommon = all.filter((c) => c.rarity === 'common').map((c) => c.id);
    const onlyEpicLeft = all.filter((c) => c.rarity !== 'epic').map((c) => c.id);
    for (const owned of [[], ['title_wanderer', 'title_the_unbroken'], noCommon, onlyEpicLeft, all.slice(1).map((c) => c.id), all.map((c) => c.id)]) {
      const eligible = eligibleCrateCosmetics(owned);
      for (let k = 0; k <= 4000; k++) {
        const draw = k / 4000;
        expect(sqlPick(eligible, draw), `draw ${draw}`).toBe(pickCrateReward(eligible, draw)?.id ?? null);
      }
    }
  });
});

/** The rows of one `insert into public.<table> (...) values (...), ... on conflict` seed. */
function seedRowsOf(table: string, from: string): string[][] {
  const at = from.indexOf(`insert into public.${table} (`);
  const block = from.slice(from.indexOf('values', at) + 6, from.indexOf('on conflict', at));
  return [...block.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]!.split(',').map((x) => x.trim().replace(/^'(.*)'$/, '$1')));
}

describe('the hero titles migration (2026-09-29): a title at 3 Ranked 1sts with a hero, its golden master at 10', () => {
  const body = fnBody('settle_progression');
  it('the seed equals the code catalog\'s hero titles row for row, achievement-sourced, and never overwrites a synced row', () => {
    const nul = (v: string | undefined): string | null => (v === undefined || v === 'null' ? null : v);
    const sqlRows = seedRowsOf('cosmetic_catalog', heroTitles).map(([id, category, rarity, source, level, targetType, targetId, achievementId, active]) => ({
      cosmeticId: id!, category: category!, rarity: rarity!, acquisitionSource: source!, milestoneLevel: nul(level) === null ? null : Number(level),
      targetType: nul(targetType), targetId: nul(targetId), achievementId: nul(achievementId), active: active === 'true',
    }));
    const hero = new Set(HERO_TITLE_COSMETICS.map((c) => c.id));
    expect([...sqlRows].sort((a, b) => (a.cosmeticId < b.cosmeticId ? -1 : 1))).toEqual(catalogSyncPayload().items.filter((i) => hero.has(i.cosmeticId)));
    expect(sqlRows).toHaveLength(66);
    expect(sqlRows.every((r) => r.acquisitionSource === 'achievement')).toBe(true);
    const at = heroTitles.indexOf('insert into public.cosmetic_catalog (');
    expect(heroTitles.slice(heroTitles.indexOf('on conflict', at), heroTitles.indexOf(';', heroTitles.indexOf('on conflict', at)))).toMatch(/do nothing$/);
    // every achievement that names a title names one of these rows
    for (const a of ACHIEVEMENTS.filter((x) => x.rewards.titleId)) expect(hero.has(a.rewards.titleId!), a.id).toBe(true);
  });

  it('the id convention constants equal heroTitleId / heroMasterTitleId', () => {
    const prefix = constOf(body, 'c_hero_title_prefix');
    const suffix = constOf(body, 'c_master_suffix');
    expect(heroTitleId('warden')).toBe(`${prefix}warden`);
    expect(heroMasterTitleId('warden')).toBe(`${prefix}warden${suffix}`);
  });

  it('a completion grants its catalog title in the same transaction, keyed; the master upgrades a worn base title', () => {
    expect(body).toMatch(/if d\.title_id is not null and exists \(select 1 from public\.cosmetic_catalog c where c\.cosmetic_id = d\.title_id and c\.category = 'title'\) then/);
    expect(body).toMatch(/values \(p_user, d\.title_id, 'achievement', d\.achievement_id\)\s+on conflict \(user_id, cosmetic_id\) do nothing;/);
    expect(body).toContain('v_unlocked := array_append(v_unlocked, d.title_id);');
    expect(body).toContain('(v_equipped || c_master_suffix) = any(v_unlocked)');
    // the achievements writer's evaluation is otherwise untouched
    const ach8 = fnBody('settle_progression', ach);
    const strip = (t: string): string => t.replace(/\s+/g, ' ');
    for (const line of ['continue when v_new = v_old and v_new < d.target;', "where c.active and not c.admin_off and c.trust <> 'P'"]) {
      expect(strip(ach8)).toContain(line);
      expect(strip(body)).toContain(line);
    }
    // the backfill never pays XP and never deletes
    expect(heroTitles).toMatch(/select ap\.user_id, ap\.achievement_id, 'backfill', 'ranked', 0,/);
    expect(heroTitles).not.toMatch(/\bdelete from\b/);
  });
});

describe('the skins migration (2026-09-28): the code-owned catalog sync + the emergency switch', () => {
  it('seeds NO catalog or category rows and writes no flag (the sync owns them), and forces a resync', () => {
    expect(skins).not.toMatch(/insert into public\.cosmetic_categories \([^)]*\) values/);
    expect(skins).not.toMatch(/insert into public\.cosmetic_catalog \([^)]*\) values/);
    expect(skins).not.toMatch(/^update public\.cosmetic_(catalog|categories) set/m);
    expect(skins).toMatch(/^update public\.progression_config set catalog_hash = null where id = 1;/m);
  });

  it('sync_cosmetic_catalog reads every payload key, checks the hash first, and never writes admin_off or deletes', () => {
    const body = fnBody('sync_cosmetic_catalog');
    const payload = catalogSyncPayload();
    for (const k of Object.keys(payload.categories[0]!)) expect(body, k).toContain(`'${k}'`);
    for (const k of Object.keys(payload.items[0]!)) expect(body, k).toContain(`'${k}'`);
    expect(body.indexOf('catalog_hash')).toBeLessThan(body.indexOf('insert into'));
    expect(body).not.toMatch(/admin_off/);
    expect(body).not.toMatch(/\bdelete\b/);
    expect(body).toContain("'unchanged'");
  });

  it('the effective state (active AND NOT admin_off; enabled AND NOT admin_off) gates the pool, equip and the loadout', () => {
    expect(fnBody('progression_crate_pool')).toMatch(/c\.active and not c\.admin_off and k\.enabled and not k\.admin_off/);
    expect(fnBody('progression_profile_json')).toMatch(/c\.active and not c\.admin_off and k\.enabled and not k\.admin_off/);
    const equip = fnBody('equip_cosmetic');
    expect(equip).toMatch(/k\.enabled and not k\.admin_off/);
    expect(equip).toMatch(/not v_cat\.active or v_cat\.admin_off/);
  });

  it('documents the one-line emergency switch (admin_off) for an item, a category, and both restores', () => {
    for (const line of [
      "update public.cosmetic_catalog set admin_off = true where cosmetic_id = 'skin_blackbelt_2';",
      "update public.cosmetic_categories set admin_off = true, updated_at = now() where category = 'minion_skin';",
      "update public.cosmetic_catalog set admin_off = false where cosmetic_id = 'skin_blackbelt_2';",
      "update public.cosmetic_categories set admin_off = false, updated_at = now() where category = 'minion_skin';",
    ]) expect(skins).toContain(line);
  });

  it('equip_cosmetic checks slot, target, liveness and ownership, and never deletes ownership', () => {
    const body = fnBody('equip_cosmetic');
    for (const code of ['bad_slot', 'bad_target', 'bad_cosmetic_id', 'wrong_target', 'not_equippable', 'not_owned']) expect(body, code).toContain(`'${code}'`);
    expect(body).not.toMatch(/delete from public\.player_cosmetics/);
    expect(skins).not.toMatch(/delete from public\.(player_cosmetics|cosmetic_catalog|cosmetic_categories)/);
  });
});

describe('the achievements migration (2026-09-28)', () => {
  const body = fnBody('settle_progression');
  it('the achievement constants equal the TS registry', () => {
    expect(constOf(body, 'c_meta_metric')).toBe(META_METRIC);
    expect(n(body, 'c_brutal_strength')).toBe(BRUTAL_LOBBY_STRENGTH);
    expect(n(body, 'c_ascendant_div')).toBe(ASCENDANT_DIVISION);
  });

  it('the settlement computes EVERY server metric (and only those), so a client can never supply one', () => {
    const built = body.slice(body.indexOf('v_metrics := v_metrics || jsonb_build_object('), body.indexOf('-- Pass 1'));
    const keys = [...built.matchAll(/'([A-Za-z]+)',/g)].map((m) => m[1]!);
    expect(new Set([...keys, META_METRIC])).toEqual(new Set(SERVER_METRICS));
    expect(built).toContain('c_meta_metric, 0');
  });

  it('the catalog check constraints equal the TS unions', () => {
    const list = (col: string): string[] => {
      const m = new RegExp(`${col}\\s+text not null(?: default '[A-Z]')? check \\(${col} in \\(([^)]+)\\)\\)`).exec(ach);
      expect(m, col).toBeTruthy();
      return m![1]!.split(',').map((x) => x.trim().replace(/'/g, ''));
    };
    expect(list('mode')).toEqual([...ACHIEVEMENT_MODES]);
    expect(list('agg')).toEqual([...ACHIEVEMENT_AGGS]);
    expect(list('trust')).toEqual([...ACHIEVEMENT_TRUSTS]);
  });

  it('sync_achievement_catalog reads every payload key, checks the hash first, never writes admin_off or deletes', () => {
    const sync = fnBody('sync_achievement_catalog');
    for (const k of Object.keys(achievementCatalogPayload().items[0]!)) expect(sync, k).toContain(`'${k}'`);
    expect(sync.indexOf('achievements_hash')).toBeLessThan(sync.indexOf('insert into'));
    expect(sync).not.toMatch(/admin_off/);
    expect(sync).not.toMatch(/\bdelete\b/);
  });

  it('evaluation skips retired, emergency-off and prestige rows; completions are keyed once per account; progress is private', () => {
    expect(body).toMatch(/c\.active and not c\.admin_off and c\.trust <> 'P'/);
    expect(ach).toMatch(/primary key \(user_id, achievement_id\)/);
    expect(ach).toContain('create policy "read achievement_completions" on public.achievement_completions for select using (true);');
    expect(ach).toContain('create policy "read own achievement_progress" on public.achievement_progress for select to authenticated using (auth.uid() = user_id);');
    expect(ach).not.toMatch(/delete from public\.achievement_(completions|progress|catalog)/);
  });

  it('the switch ships OFF and is commented out (a re-run can never move the epoch)', () => {
    expect(ach).toMatch(/^-- update public\.progression_config set achievements_epoch = now\(\)/m);
    expect(ach).not.toMatch(/^update public\.progression_config set achievements_epoch/m);
    expect(ach).toMatch(/^update public\.progression_config set achievements_hash = null where id = 1;/m);
  });
});
