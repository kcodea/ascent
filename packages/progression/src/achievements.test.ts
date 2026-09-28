import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_HEROES, ACHIEVEMENT_INDEX, META_METRIC, RUN_METRICS, RUN_METRIC_KEYS, SERVER_METRICS,
  achievementCatalogHash, achievementCatalogPayload, achievementGatePasses, achievementXpOf, divisionName, evaluateAchievements, sanitizeRunMetrics,
  type AchievementDef, type AchievementSettlement,
} from './achievements';
import { factsAsV1, sanitizeProgressionFacts, type ProgressionRunFactsV2 } from './rules';

/**
 * ACHIEVEMENTS batch 1 (owner 2026-09-28: "let's just get the normal xp related achievements in for now though").
 * The registry is data: these tests pin its shape (XP only, nothing hidden, exact player text) and the evaluator's
 * semantics, which the SQL in settle_progression mirrors (achievements.db.test.ts runs both and compares).
 */

const count = (cat: string): number => ACHIEVEMENTS.filter((a) => a.category === cat).length;
const xpOf = (cat: string): number => ACHIEVEMENTS.filter((a) => a.category === cat).reduce((s, a) => s + a.rewards.xp, 0);

describe('the batch 1 registry', () => {
  it('ships 248 XP-only achievements: counts and XP per category', () => {
    expect(ACHIEVEMENTS).toHaveLength(248);
    expect(Object.fromEntries(ACHIEVEMENT_CATEGORIES.map((c) => [c, count(c)]))).toEqual({
      career: 17, ranked: 28, heroes: 132, economy: 15, mechanics: 7, runes: 5, set2: 44,
    });
    expect(Object.fromEntries(ACHIEVEMENT_CATEGORIES.map((c) => [c, xpOf(c)]))).toEqual({
      career: 1550, ranked: 4300, heroes: 14850, economy: 1925, mechanics: 1125, runes: 675, set2: 6400,
    });
  });

  it('every reward is XP only: a title slot exists (null) so a title can be attached later without a migration', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.rewards.xp, a.id).toBeGreaterThan(0);
      expect(a.rewards.titleId, a.id).toBeNull();
      expect(Object.keys(a.rewards).sort()).toEqual(['titleId', 'xp']);
    }
  });

  it('nothing hidden ships yet, nothing prestige, nothing from batch 2', () => {
    expect(ACHIEVEMENTS.filter((a) => a.hidden)).toEqual([]);
    expect(ACHIEVEMENTS.filter((a) => a.trust === 'P')).toEqual([]);
    expect(ACHIEVEMENTS.filter((a) => a.batch !== 1)).toEqual([]);
  });

  it('ids are unique and stable-shaped; every metric is known', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    const known = new Set<string>([...RUN_METRIC_KEYS, ...SERVER_METRICS]);
    for (const a of ACHIEVEMENTS) {
      expect(a.id, a.id).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);
      expect(a.id.length).toBeLessThanOrEqual(64);
      expect(known.has(a.metric), `${a.id}: ${a.metric}`).toBe(true);
      expect(a.target, a.id).toBeGreaterThan(0);
      if (a.metric in RUN_METRICS) expect(a.target, a.id).toBeLessThanOrEqual(RUN_METRICS[a.metric as keyof typeof RUN_METRICS].cap);
    }
    expect(ACHIEVEMENT_INDEX['s2.kobold.rubies_turn_8']!.name).toBe('Cut and Set');
  });

  it('player text: short plain sentences, no em dash or double hyphen, names at most 32 characters', () => {
    for (const a of ACHIEVEMENTS) {
      for (const t of [a.name, a.requirement]) {
        expect(t, a.id).not.toMatch(/—|–|--/);
        expect(t, a.id).toBe(t.trim());
      }
      expect(a.name.length, a.id).toBeLessThanOrEqual(32);
      expect(a.requirement, a.id).toMatch(/\.$/);
      expect(a.requirement.length, a.id).toBeLessThanOrEqual(120);
    }
  });

  it('Set 2 feats are scoped to Set 2 and grouped by tribe', () => {
    const set2 = ACHIEVEMENTS.filter((a) => a.category === 'set2');
    expect(set2.every((a) => a.setId === 'set2')).toBe(true);
    const groups = set2.reduce<Record<string, number>>((m, a) => ({ ...m, [a.group!]: (m[a.group!] ?? 0) + 1 }), {});
    expect(groups).toEqual({ kobold: 8, dwarf: 6, dragon: 7, beast: 6, demon: 7, cross: 5, rune: 5 });
    expect(ACHIEVEMENTS.filter((a) => a.category !== 'set2').every((a) => a.setId === null)).toBe(true);
  });

  it('hero templates: 33 heroes x 4; Debut and Top 4 count any game, Victory and Mastery are Ranked only (owner default 5)', () => {
    expect(ACHIEVEMENT_HEROES).toHaveLength(33);
    for (const h of ACHIEVEMENT_HEROES) {
      const [debut, top, win, mastery] = ['debut', 'top_four', 'victory', 'mastery'].map((t) => ACHIEVEMENT_INDEX[`hero.${h.id}.${t}`]!);
      expect([debut!.mode, top!.mode, win!.mode, mastery!.mode]).toEqual(['any', 'any', 'ranked', 'ranked']);
      expect([debut!.target, top!.target, win!.target, mastery!.target]).toEqual([3, 5, 1, 10]);
      expect([debut!.rewards.xp, top!.rewards.xp, win!.rewards.xp, mastery!.rewards.xp]).toEqual([25, 75, 100, 250]);
      expect([top!.placementMax, win!.placementMax, mastery!.placementMax]).toEqual([4, 1, 1]);
      expect(debut!.heroId).toBe(h.id);
    }
  });

  it('rank achievements use the ascending UI numerals (owner default 3) and read the Career best (owner default 2)', () => {
    const reach = ACHIEVEMENTS.filter((a) => a.family === 'ranked.reach');
    expect(reach).toHaveLength(17);
    expect(reach.map((a) => a.name).slice(0, 4)).toEqual(['Bronze 2', 'Bronze 3', 'Silver 1', 'Silver 2']);
    expect(reach.at(-1)!.name).toBe('Ascendant 3');
    expect(reach.every((a) => a.metric === 'highestDivision' && a.mode === 'account')).toBe(true);
    expect(reach.map((a) => a.target)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    expect(divisionName(0)).toBe('Bronze 1');
    expect(ACHIEVEMENT_INDEX['ranked.reach_ascendant_1']!.target).toBe(15);
  });

  it('the tutorial keeps only the graduation achievement (owner 2026-09-28: cut the step achievements)', () => {
    const tut = ACHIEVEMENTS.filter((a) => a.mode === 'tutorial');
    expect(tut.map((a) => a.id)).toEqual(['tutorial.complete_course']);
    expect(tut[0]!.rewards).toEqual({ xp: 100, titleId: null });
  });

  it('achievementXpOf sums known ids and ignores unknown ones', () => {
    expect(achievementXpOf(['career.games.1', 'ranked.first_win', 'nope.nope'])).toBe(125);
  });
});

describe('sanitizing run metrics (a bad counter must never cost XP)', () => {
  it('keeps known non-negative integers within the cap, drops everything else', () => {
    expect(sanitizeRunMetrics({ rubyPlays: 12, goldSpent: -1, spellsCast: 1.5, alesCast: '3', futureMetric: 9, tierSixByRound9: 2, finalKobolds: 5 }))
      .toEqual({ rubyPlays: 12, finalKobolds: 5 });
    expect(sanitizeRunMetrics(null)).toEqual({});
    expect(sanitizeRunMetrics([1, 2])).toEqual({});
  });

  it('sanitizeProgressionFacts keeps V1 as V1 and cleans V2 metrics; factsAsV1 drops them', () => {
    const v2: ProgressionRunFactsV2 = {
      version: 2, runId: 'r', mode: 'ranked', setId: 'set2', patch: 'p', heroId: 'warden', placement: 2, waveReached: 12, terminal: true,
      comebackAfterFourLosses: false, combats: { wins: 5, losses: 6, draws: 0 }, metrics: { rubyPlays: 9 },
    };
    const dirty = { ...v2, metrics: { rubyPlays: 9, bogus: 4 }, extra: 'x' };
    expect(sanitizeProgressionFacts(dirty)).toEqual(v2);
    const v1 = factsAsV1(v2);
    expect(v1.version).toBe(1);
    expect('metrics' in v1).toBe(false);
    expect(sanitizeProgressionFacts(v1)).toEqual(v1);
    expect(sanitizeProgressionFacts({ ...v2, version: 3 })).toBeNull();
    expect(sanitizeProgressionFacts({ ...v2, metrics: null })).toBeNull();
  });
});

describe('the evaluator (the TS mirror of settle_progression)', () => {
  const ranked = (over: Partial<AchievementSettlement> = {}): AchievementSettlement => ({
    mode: 'ranked', eligibleRun: true, setId: 'set2', heroId: 'warden', placement: 1, metrics: { game: 1 }, ...over,
  });
  const d = (over: Partial<AchievementDef>): AchievementDef => ({
    id: 'x.test', version: 1, name: 'T', requirement: 'T.', category: 'career', group: null, family: null, mode: 'any', setId: null, heroId: null,
    placementMax: null, metric: 'game', agg: 'max', target: 1, rewards: { xp: 10, titleId: null }, hidden: false, trust: 'O', batch: 1, showProgress: false, ...over,
  });

  it('gates: mode, set, hero, placement', () => {
    const s = ranked();
    expect(achievementGatePasses(d({ mode: 'ranked' }), { ...s, mode: 'practice' })).toBe(false);
    expect(achievementGatePasses(d({ mode: 'any' }), { ...s, mode: 'practice', eligibleRun: false })).toBe(false);
    expect(achievementGatePasses(d({ mode: 'any' }), { ...s, mode: 'practice', eligibleRun: true })).toBe(true);
    expect(achievementGatePasses(d({ mode: 'any' }), { ...s, mode: 'tutorial', eligibleRun: false })).toBe(false);
    expect(achievementGatePasses(d({ mode: 'tutorial' }), { ...s, mode: 'tutorial', eligibleRun: false })).toBe(true);
    expect(achievementGatePasses(d({ mode: 'account' }), { ...s, mode: 'tutorial', eligibleRun: false })).toBe(true);
    expect(achievementGatePasses(d({ setId: 'set2' }), { ...s, setId: 'set3' })).toBe(false);
    expect(achievementGatePasses(d({ heroId: 'indy' }), s)).toBe(false);
    expect(achievementGatePasses(d({ placementMax: 4 }), { ...s, placement: 5 })).toBe(false);
    expect(achievementGatePasses(d({ placementMax: 4 }), { ...s, placement: null })).toBe(false);
    expect(achievementGatePasses(d({ placementMax: 4 }), { ...s, placement: 4 })).toBe(true);
  });

  it('sum accumulates, max keeps the best; completion at the target pays once', () => {
    const sum = d({ id: 'a.sum', agg: 'sum', target: 3 });
    const max = d({ id: 'a.max', metric: 'rubyPlaysTurnMax', target: 8 });
    let prior: Record<string, { progress: number; completed: boolean }> = {};
    const run = (m: Record<string, number>): ReturnType<typeof evaluateAchievements> => {
      const r = evaluateAchievements([sum, max], ranked({ metrics: m }), prior);
      for (const [id, p] of Object.entries(r.progress)) prior = { ...prior, [id]: { progress: p, completed: r.completed.includes(id) || !!prior[id]?.completed } };
      return r;
    };
    expect(run({ game: 1, rubyPlaysTurnMax: 5 })).toEqual({ progress: { 'a.max': 5, 'a.sum': 1 }, completed: [], xp: 0 });
    expect(run({ game: 1, rubyPlaysTurnMax: 3 })).toEqual({ progress: { 'a.sum': 2 }, completed: [], xp: 0 });
    expect(run({ game: 1, rubyPlaysTurnMax: 9 })).toEqual({ progress: { 'a.max': 9, 'a.sum': 3 }, completed: ['a.max', 'a.sum'], xp: 20 });
    // completed: never again
    expect(run({ game: 1, rubyPlaysTurnMax: 12 })).toEqual({ progress: {}, completed: [], xp: 0 });
  });

  it('the meta family counts completions so far, this settlement included, evaluated last by target', () => {
    const defs = [d({ id: 'b.one' }), d({ id: 'b.two' }), d({ id: 'meta.2', metric: META_METRIC, target: 2 }), d({ id: 'meta.3', metric: META_METRIC, target: 3 })];
    const r = evaluateAchievements(defs, ranked(), {});
    expect(r.completed).toEqual(['b.one', 'b.two', 'meta.2', 'meta.3']);
    expect(r.xp).toBe(40);
  });

  it('a Set 2 feat does not move in a Set 1 run; a Ranked-only feat does not move in Practice', () => {
    const s2 = ACHIEVEMENT_INDEX['s2.kobold.rubies_turn_8']!;
    const win = ACHIEVEMENT_INDEX['s2.kobold.win_banner']!;
    expect(evaluateAchievements([s2], ranked({ setId: 'set1', metrics: { rubyPlaysTurnMax: 9 } }), {}).completed).toEqual([]);
    expect(evaluateAchievements([s2], ranked({ metrics: { rubyPlaysTurnMax: 9 } }), {}).completed).toEqual([s2.id]);
    expect(evaluateAchievements([win], ranked({ mode: 'practice', metrics: { finalKobolds: 5 } }), {}).completed).toEqual([]);
    expect(evaluateAchievements([win], ranked({ placement: 2, metrics: { finalKobolds: 5 } }), {}).completed).toEqual([]);
    expect(evaluateAchievements([win], ranked({ metrics: { finalKobolds: 5 } }), {}).completed).toEqual([win.id]);
  });

  it('a hidden def evaluates exactly like a visible one (the framework supports hidden: true)', () => {
    const h = d({ id: 'hidden.test', hidden: true });
    expect(evaluateAchievements([h], ranked(), {}).completed).toEqual(['hidden.test']);
  });

  it('the whole catalog: a first Ranked win as Warden at Silver 1 completes exactly the expected set', () => {
    const r = evaluateAchievements(ACHIEVEMENTS, ranked({ metrics: { game: 1, highestDivision: 3, heroesPlayed: 1, heroesWon: 1, goldSpentTurnMax: 21 } }), {});
    expect(r.completed.sort()).toEqual([
      'career.games.1', 'economy.spend_turn_20', 'ranked.first_game', 'ranked.first_top_four', 'ranked.first_win',
      'ranked.reach_bronze_2', 'ranked.reach_bronze_3', 'ranked.reach_silver_1', 'hero.warden.victory',
    ].sort());
    expect(r.xp).toBe(25 + 50 + 25 + 50 + 100 + 50 + 50 + 75 + 100);
    expect(r.progress['hero.warden.debut']).toBe(1);
    expect(r.progress['hero.warden.mastery']).toBe(1);
  });
});

describe('the catalog payload', () => {
  it('one row per def, sorted, with the evaluation columns; the hash is stable and moves with any change', () => {
    const p = achievementCatalogPayload();
    expect(p.items).toHaveLength(ACHIEVEMENTS.length);
    expect(p.items.map((i) => i.achievementId)).toEqual([...p.items.map((i) => i.achievementId)].sort());
    expect(p.items.every((i) => i.active)).toBe(true);
    expect(achievementCatalogHash(p)).toBe(achievementCatalogHash(achievementCatalogPayload()));
    const changed = achievementCatalogPayload(ACHIEVEMENTS.map((a) => (a.id === 'career.games.1' ? { ...a, rewards: { xp: 26, titleId: null } } : a)));
    expect(achievementCatalogHash(changed)).not.toBe(achievementCatalogHash(p));
    expect(achievementCatalogHash(p)).toMatch(/^a1-[0-9a-f]{16}$/);
  });
});
