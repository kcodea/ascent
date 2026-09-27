import { describe, expect, it } from 'vitest';
import { BEGINNER_HERO_IDS, DEFAULT_PRACTICE_CONFIG, practiceHeroChoiceIds, practiceHeroes } from './index';

/** Practice "Heroes: Beginner / All" (owner 2026-09-27): Beginner offers exactly Indy, Warden and Keshi as the usual
 *  three-choice pick; All offers every Practice hero. */
describe('Practice hero offer', () => {
  it('Beginner offers exactly Indy, Warden, Keshi', () => {
    expect([...BEGINNER_HERO_IDS]).toEqual(['indy', 'warden', 'keshi']);
    expect(practiceHeroChoiceIds('beginner')).toEqual(['indy', 'warden', 'keshi']);
  });
  it('a draft without the field (saved before it existed) reads as Beginner, the default', () => {
    expect(practiceHeroChoiceIds(undefined)).toEqual(['indy', 'warden', 'keshi']);
    expect(DEFAULT_PRACTICE_CONFIG.heroes).toBe('beginner');
  });
  it('All offers every Practice hero (tribe-gated like before)', () => {
    expect(practiceHeroChoiceIds('all')).toEqual(practiceHeroes().map((h) => h.id));
    expect(practiceHeroChoiceIds('all').length).toBeGreaterThan(3);
  });
});
