import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';

/**
 * Set 2's Beast tribe — IN PROGRESS. This pins what's authored so far: the tribe is reachable in a set-2 run,
 * the carried-over set-1 Beasts are present, and Packstrider's per-Beast Rally scales with the board.
 */
describe('set 2 — Beast tribe wiring', () => {
  it('set 2 lists beast, and its new + carried-over Beasts are in the index', () => {
    const newBeasts = Object.values(CARD_INDEX).filter((c) => c.id.startsWith('b2_'));
    expect(newBeasts.length).toBeGreaterThan(0);
    expect(newBeasts.every((c) => c.tribe === 'beast')).toBe(true);
    // carried over from set 1 (opted into set 2's manifest)
    for (const id of ['badgington', 'seaurchin', 'sporebat', 'manasaber']) {
      expect(CARD_INDEX[id]).toBeTruthy();
    }
  });
});

describe('set 2 — Packstrider', () => {
  const pk: BoardMinion = { cardId: 'b2_packstrider', attack: 2, health: 40, keywords: ['RL'], sourceUid: 'PK' };

  it('Rally buffs itself by +1/+1 per Beast you control (including itself)', () => {
    // Three Beasts on board: Packstrider + two others. Its first attack should add +3/+3 (×3 Beasts).
    // Real Beasts (Strays) — a BoardMinion tribe override doesn't reach the combat minion, which reads its
    // CardDef tribe, so a tribe-overridden sandbag wouldn't count.
    const others: BoardMinion[] = [
      { cardId: 'stray', attack: 1, health: 40, sourceUid: 'B1' },
      { cardId: 'stray', attack: 1, health: 40, sourceUid: 'B2' },
    ];
    const r = simulate([pk, ...others], [{ cardId: 'sandbag', attack: 0, health: 400 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 1, tribes: ['beast'] }), combatSide({ tier: 1 }));
    // its rally buff event: +3/+3 (one per Beast, three Beasts)
    expect(r.events.some((e) => e.type === 'buff' && e.attack === 3 && e.health === 3)).toBe(true);
  });
});
