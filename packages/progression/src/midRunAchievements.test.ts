import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, RUN_METRICS, achievementOf } from './achievements';
import { END_STATE_RUN_METRICS, achievementKnowableMidRun, midRunUnlockedAchievements, type MidRunAchievementContext } from './midRunAchievements';

const RANKED: MidRunAchievementContext = { mode: 'ranked', eligibleRun: true, setId: 'set2', heroId: 'warden' };
const NONE = { completed: [], progress: {} };

describe('midRunUnlockedAchievements (R-ACH-TOAST-01)', () => {
  it('reports a one-game feat the moment its metric reaches the target', () => {
    expect(midRunUnlockedAchievements({ goldSpentTurnMax: 19 }, RANKED, NONE)).not.toContain('economy.spend_turn_20');
    expect(midRunUnlockedAchievements({ goldSpentTurnMax: 20 }, RANKED, NONE)).toContain('economy.spend_turn_20');
  });

  it('never reports an achievement the account already completed', () => {
    expect(midRunUnlockedAchievements({ goldSpentTurnMax: 40 }, RANKED, { completed: ['economy.spend_turn_20'], progress: {} })).not.toContain('economy.spend_turn_20');
  });

  it('never reports one already shown this game, so each is announced once', () => {
    const first = midRunUnlockedAchievements({ gildsMade: 1 }, RANKED, NONE);
    expect(first).toContain('first.gild');
    expect(midRunUnlockedAchievements({ gildsMade: 2 }, RANKED, NONE, first)).not.toContain('first.gild');
  });

  it('applies the settlement gates: an ineligible game, the wrong set, a retired id', () => {
    const tutorial: MidRunAchievementContext = { mode: 'tutorial', eligibleRun: false, setId: 'set2', heroId: null };
    expect(midRunUnlockedAchievements({ goldSpentTurnMax: 40 }, tutorial, NONE)).toEqual([]);
    // A Practice without Normal Health or a turn timer counts for nothing (the `any` gate).
    const casual: MidRunAchievementContext = { mode: 'practice', eligibleRun: false, setId: 'set2', heroId: null };
    expect(midRunUnlockedAchievements({ goldSpentTurnMax: 40 }, casual, NONE)).toEqual([]);
    // A Set 2 feat needs a Set 2 game.
    expect(midRunUnlockedAchievements({ rubyPlaysTurnMax: 8 }, RANKED, NONE)).toContain('s2.kobold.rubies_turn_8');
    expect(midRunUnlockedAchievements({ rubyPlaysTurnMax: 8 }, { ...RANKED, setId: 'set3' }, NONE)).not.toContain('s2.kobold.rubies_turn_8');
    expect(midRunUnlockedAchievements({ goldSpentTurnMax: 40 }, RANKED, { ...NONE, retired: ['economy.spend_turn_20'] })).not.toContain('economy.spend_turn_20');
  });

  it('a lifetime achievement adds this game to the stored progress, and is skipped while that progress is unknown', () => {
    const id = 'economy.spend_lifetime_1000';
    expect(midRunUnlockedAchievements({ goldSpent: 60 }, RANKED, { completed: [], progress: { [id]: 939 } })).not.toContain(id);
    expect(midRunUnlockedAchievements({ goldSpent: 61 }, RANKED, { completed: [], progress: { [id]: 939 } })).toContain(id);
    expect(midRunUnlockedAchievements({ goldSpent: 5000 }, RANKED, { completed: [], progress: null })).not.toContain(id);
  });

  it('leaves out what only the finished game knows: placements, server metrics, the final board', () => {
    const endOnly = ACHIEVEMENTS.filter((d) => !achievementKnowableMidRun(d));
    expect(endOnly.some((d) => d.placementMax !== null)).toBe(true);
    for (const d of endOnly) {
      const why = d.placementMax !== null || d.mode === 'account' || d.mode === 'tutorial' || END_STATE_RUN_METRICS.has(d.metric as never) || !(d.metric in RUN_METRICS);
      expect(why, d.id).toBe(true);
    }
    // A final-board feat never shows mid-game, however high its metric reads.
    const finalIds = ACHIEVEMENTS.filter((d) => END_STATE_RUN_METRICS.has(d.metric as never)).map((d) => d.id);
    expect(finalIds.length).toBeGreaterThan(0);
    const metrics = Object.fromEntries([...END_STATE_RUN_METRICS].map((k) => [k, 7]));
    const got = midRunUnlockedAchievements(metrics, RANKED, NONE);
    for (const id of finalIds) expect(got).not.toContain(id);
    // A server metric (the game itself) never shows mid-game.
    expect(midRunUnlockedAchievements({ game: 1 } as never, RANKED, NONE)).not.toContain('ranked.first_game');
  });

  it('only a Ranked game counts toward a hero, as the settlement reads it', () => {
    const heroDef = ACHIEVEMENTS.find((d) => d.heroId !== null && achievementKnowableMidRun(d));
    if (!heroDef) return; // none today: the rule is ready for one
    const m = { [heroDef.metric]: heroDef.target };
    expect(midRunUnlockedAchievements(m, { ...RANKED, heroId: heroDef.heroId }, { completed: [], progress: {} })).toContain(heroDef.id);
    expect(midRunUnlockedAchievements(m, { mode: 'practice', eligibleRun: true, setId: 'set2', heroId: heroDef.heroId }, { completed: [], progress: {} })).not.toContain(heroDef.id);
  });

  it('drops values over the sanity cap, like the server', () => {
    expect(midRunUnlockedAchievements({ goldSpentTurnMax: 10_000_000 }, RANKED, NONE)).not.toContain('economy.spend_turn_20');
  });

  it('every id it can return is a real achievement', () => {
    const all = midRunUnlockedAchievements(Object.fromEntries(Object.keys({ goldSpentTurnMax: 0, gildsMade: 0, heroPowerUses: 0 }).map((k) => [k, 100])), RANKED, NONE);
    for (const id of all) expect(achievementOf(id)).not.toBeNull();
  });
});
