import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type RunState } from './state';
import { castSpell } from './recruit';

describe('recruitBuffFx run-state fields', () => {
  it('initialise empty on a fresh run', () => {
    const s = createRun(12345);
    expect(s.recruitBuffFx).toEqual([]);
    expect(s.recruitFxSeq).toBe(0);
  });
});

describe('recruitBuffFx capture (source → target)', () => {
  it('a board-wide buff spell (Growth) records one descend per buffed minion (kind:spell, no source)', () => {
    const s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'a', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'b', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
    };
    castSpell(s, CARD_INDEX['growth']!); // +3/+4 to the whole board

    const spellFx = s.recruitBuffFx.filter((e) => e.kind === 'spell');
    expect(spellFx.length).toBe(2); // one per buffed minion
    const targets = spellFx.map((e) => e.targetUid).sort();
    expect(targets).toEqual(['a', 'b']);
    for (const e of spellFx) {
      expect(e.sourceUid).toBeUndefined();
      expect(e.attack).toBe(3);
      expect(e.health).toBe(4);
    }
  });

  it('Archmagus Guel records a minion tendril (kind:minion, sourceUid = Guel) when a spell is cast', () => {
    const s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'g', cardId: 'guel', tribe: 'neutral', attack: 2, health: 3, keywords: [], golden: false },
        { uid: 'a', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
    };
    castSpell(s, CARD_INDEX['growth']!); // any spell cast → Guel buffs its 'other' friend +1/+1

    const minionFx = s.recruitBuffFx.filter((e) => e.kind === 'minion');
    expect(minionFx.length).toBeGreaterThanOrEqual(1);
    for (const e of minionFx) {
      expect(e.sourceUid).toBe('g');
      expect(e.sourceCardId).toBe('guel');
      expect(e.targetUid).not.toBe('g'); // Guel never targets itself
    }
    // The other friend (stray 'a') was buffed by Guel.
    expect(minionFx.some((e) => e.targetUid === 'a')).toBe(true);
    const guelFx = minionFx.find((e) => e.targetUid === 'a')!;
    expect(guelFx.attack).toBe(1);
    expect(guelFx.health).toBe(1);
  });
});
