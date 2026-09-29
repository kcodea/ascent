import { describe, expect, it } from 'vitest';
import { collectionCategories, HIDDEN_WHEN_OFF } from './collectionModel';

// Owner 2026-09-29: "hide music and boards from collections for now".
describe('Collection rail hides Boards and Music while they are switched off', () => {
  it('lists neither board nor music', () => {
    const cats = collectionCategories();
    expect(cats).not.toContain('board');
    expect(cats).not.toContain('music');
  });
  it('keeps the live categories and the other coming-soon ones', () => {
    const cats = collectionCategories();
    for (const live of ['title', 'hero_skin', 'minion_skin', 'hero_attack'] as const) expect(cats).toContain(live);
    expect(cats).toContain('announcer');
  });
  it('hides exactly board and music', () => {
    expect([...HIDDEN_WHEN_OFF].sort()).toEqual(['board', 'music']);
  });
});
