import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS, ACHIEVEMENTS_150, ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_HEROES, ACHIEVEMENT_INDEX, META_METRIC, RUN_METRICS, RUN_METRIC_KEYS, SERVER_METRICS,
  achievementCatalogHash, achievementCatalogPayload, achievementGatePasses, achievementXpOf, divisionName, evaluateAchievements, sanitizeRunMetrics,
  type AchievementDef, type AchievementSettlement,
} from './achievements';
import { factsAsV1, sanitizeProgressionFacts, type ProgressionRunFactsV2 } from './rules';
import { COSMETICS, cosmeticOf, heroMasterTitleId, heroTitleId } from './cosmetics';

/**
 * ACHIEVEMENTS batch 1 (owner 2026-09-28: "let's just get the normal xp related achievements in for now though").
 * The registry is data: these tests pin its shape (XP only, nothing hidden, exact player text) and the evaluator's
 * semantics, which the SQL in settle_progression mirrors (achievements.db.test.ts runs both and compares).
 */

const count = (cat: string): number => ACHIEVEMENTS.filter((a) => a.category === cat).length;
const xpOf = (cat: string): number => ACHIEVEMENTS.filter((a) => a.category === cat).reduce((s, a) => s + a.rewards.xp, 0);

describe('the batch 1 registry', () => {
  it('ships 446 achievements: counts and XP per category (hero titles 2026-09-29 added 33 Titled tiers, 4,950 XP; Runesmith + Guardian back 2026-10-01: +10; the 2026-10-03 150: +61,375 XP)', () => {
    expect(ACHIEVEMENTS).toHaveLength(446);
    expect(Object.fromEntries(ACHIEVEMENT_CATEGORIES.map((c) => [c, count(c)]))).toEqual({
      career: 17, ranked: 28, heroes: 222, economy: 15, mechanics: 7, runes: 5, set2: 82, combat: 36, milestones: 34,
    });
    expect(Object.fromEntries(ACHIEVEMENT_CATEGORIES.map((c) => [c, xpOf(c)]))).toEqual({
      career: 1550, ranked: 4300, heroes: 31750, economy: 1925, mechanics: 1125, runes: 675, set2: 22350, combat: 13175, milestones: 22100,
    });
    expect(ACHIEVEMENTS.reduce((s, a) => s + a.rewards.xp, 0)).toBe(98_950);
  });

  it('every reward pays XP; ONLY the hero Titled and Mastery tiers carry a title (owner 2026-09-29), each a real catalog title', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.rewards.xp, a.id).toBeGreaterThan(0);
      expect(Object.keys(a.rewards).sort()).toEqual(['titleId', 'xp']);
      if (a.family === 'hero.titled') expect(a.rewards.titleId, a.id).toBe(heroTitleId(a.heroId!));
      else if (a.family === 'hero.mastery') expect(a.rewards.titleId, a.id).toBe(heroMasterTitleId(a.heroId!));
      else expect(a.rewards.titleId, a.id).toBeNull();
      if (a.rewards.titleId) {
        const t = cosmeticOf(a.rewards.titleId)!;
        expect(t.category, a.id).toBe('title');
        expect(t.acquisition, a.id).toEqual({ type: 'achievement', id: a.id });
      }
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
      // The cap bounds ONE game's value: a one-game (max) target must fit under it; a lifetime (sum) total may not.
      if (a.metric in RUN_METRICS && a.agg === 'max') expect(a.target, a.id).toBeLessThanOrEqual(RUN_METRICS[a.metric as keyof typeof RUN_METRICS].cap);
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
    expect(groups).toEqual({ kobold: 16, dwarf: 13, dragon: 14, beast: 13, demon: 16, cross: 5, rune: 5 });
    expect(ACHIEVEMENTS.filter((a) => a.category !== 'set2').every((a) => a.setId === null)).toBe(true);
  });

  it('hero templates: 36 heroes x 5; Debut and Top 4 count any game, the win tiers are Ranked only (owner default 5)', () => {
    expect(ACHIEVEMENT_HEROES).toHaveLength(36);
    for (const h of ACHIEVEMENT_HEROES) {
      const [debut, top, win, titled, mastery] = ['debut', 'top_four', 'victory', 'titled', 'mastery'].map((t) => ACHIEVEMENT_INDEX[`hero.${h.id}.${t}`]!);
      expect([debut!.mode, top!.mode, win!.mode, titled!.mode, mastery!.mode]).toEqual(['any', 'any', 'ranked', 'ranked', 'ranked']);
      // owner 2026-09-29: "the hero's title is granted at 3 wins with a hero, then the mastery of that title is after 10 wins"
      expect([debut!.target, top!.target, win!.target, titled!.target, mastery!.target]).toEqual([3, 5, 1, 3, 10]);
      expect([debut!.rewards.xp, top!.rewards.xp, win!.rewards.xp, titled!.rewards.xp, mastery!.rewards.xp]).toEqual([25, 75, 100, 150, 250]);
      expect([top!.placementMax, win!.placementMax, titled!.placementMax, mastery!.placementMax]).toEqual([4, 1, 1, 1]);
      expect(debut!.heroId).toBe(h.id);
      // the 2026-10-03 sixth tier: 25 games of any eligible kind
      const devoted = ACHIEVEMENT_INDEX[`hero.${h.id}.devoted`]!;
      expect([devoted.mode, devoted.target, devoted.rewards.xp, devoted.placementMax, devoted.heroId]).toEqual(['any', 25, 200, null, h.id]);
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

describe('the 2026-10-03 150 (owner: "add 150 more achievements"; themes Tribes & cards, Heroes deeper, Combat feats, Long-term grind)', () => {
  const theme = (a: AchievementDef): string => (a.category === 'set2' ? 'tribes' : a.category === 'heroes' ? 'heroes' : a.category);
  it('150 new, by theme: 38 / 42 / 36 / 34, 61,375 XP, XP only, never hidden', () => {
    expect(ACHIEVEMENTS_150).toHaveLength(150);
    const by = ACHIEVEMENTS_150.reduce<Record<string, number>>((m, a) => ({ ...m, [theme(a)]: (m[theme(a)] ?? 0) + 1 }), {});
    expect(by).toEqual({ tribes: 38, heroes: 42, combat: 36, milestones: 34 });
    expect(ACHIEVEMENTS_150.reduce((s, a) => s + a.rewards.xp, 0)).toBe(61_375);
    for (const a of ACHIEVEMENTS_150) {
      expect(a.rewards.titleId, a.id).toBeNull();
      expect(a.hidden, a.id).toBe(false);
      expect(ACHIEVEMENTS, a.id).toContain(a);
    }
  });

  it('XP scales steeply with difficulty (owner: "some of the larger longer term ones should easily be 500+ xp")', () => {
    const band = (lo: number, hi: number): number => ACHIEVEMENTS_150.filter((a) => a.rewards.xp >= lo && a.rewards.xp <= hi).length;
    expect([band(25, 100), band(101, 300), band(301, 499), band(500, 749), band(750, 1500)]).toEqual([10, 77, 13, 24, 26]);
    expect(Math.max(...ACHIEVEMENTS_150.map((a) => a.rewards.xp))).toBe(1500);
    // the biggest milestones sit clearly above 500
    for (const id of ['career.games.1000', 'ranked.games.1000', 'career.firsts.250', 'career.top_four.500', 'combat.kills_life_5000']) {
      expect(ACHIEVEMENT_INDEX[id]!.rewards.xp, id).toBeGreaterThanOrEqual(1000);
    }
  });

  it('names are unique across achievements and the cosmetic catalog (titles included)', () => {
    const lower = (s: string): string => s.toLowerCase();
    expect(new Set(ACHIEVEMENTS.map((a) => lower(a.name))).size).toBe(ACHIEVEMENTS.length);
    const cosmetics = new Set(COSMETICS.map((c) => lower(c.name)));
    expect(ACHIEVEMENTS_150.filter((a) => cosmetics.has(lower(a.name))).map((a) => a.name)).toEqual([]);
  });

  it('a lifetime tier of a batch 1 family keeps that family and its metric (so the family reads as one ladder)', () => {
    for (const [id, family] of [['career.games.1000', 'career.games'], ['career.firsts.250', 'career.firsts'], ['career.top_four.500', 'career.top_four'], ['ranked.promotions_25', 'ranked.promotions'], ['career.achievements.200', 'career.achievements'], ['career.comebacks.25', 'career.comebacks']] as const) {
      const a = ACHIEVEMENT_INDEX[id]!;
      const first = ACHIEVEMENTS.find((x) => x.family === family)!;
      expect([a.family, a.metric, a.mode, a.placementMax], id).toEqual([first.family, first.metric, first.mode, first.placementMax]);
    }
  });

  it('the new run metrics are the 11 the observer counts (trust O, like every run metric)', () => {
    const fresh = ['heroPowerUses', 'flawlessWins', 'lastStandWins', 'combatWinStreakMax', 'undefeated', 'knockouts', 'heroDamageCombatMax', 'heroDamageDealt', 'enemyKillsCombatMax', 'enemyKills', 'brink'];
    for (const k of fresh) expect(RUN_METRIC_KEYS, k).toContain(k);
    for (const a of ACHIEVEMENTS.filter((x) => fresh.includes(x.metric))) expect(a.trust, a.id).toBe('O');
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
