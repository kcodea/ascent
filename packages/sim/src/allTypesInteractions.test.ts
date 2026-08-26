/**
 * ALL-TYPES counts as EVERY tribe — for INTERACTIONS, not just for reading a pill (owner rule 2026-08-26:
 * "all types need to trigger all types of interactions").
 *
 * The reported case: selling an All-types minion left Voicekeeper ("get a plain copy of the first DRAGON you
 * sell each turn") silent, because the trigger did a raw `tribe`/`tribe2` comparison instead of going through
 * the shared `isTribe` predicate — which is what knows about `universalTribe`, the Anomaly Reactor's
 * `allTribes` mark, and spell-added tribes.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type Action, type RunState } from './index';
import { isTribe, defIsTribe } from './recruit';

const ALL_TYPES = Object.values(CARD_INDEX).find((c) => c.universalTribe && !c.spell)!;

const body = (uid: string, cardId: string) => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], buffs: [] };
};

describe('All-types triggers every tribe interaction', () => {
  it('the shared predicates already agree it is every tribe', () => {
    for (const t of ['dragon', 'beast', 'demon', 'dwarf', 'kobold'] as const) {
      expect(defIsTribe(ALL_TYPES, t), `${ALL_TYPES.id} counts as ${t}`).toBe(true);
      expect(isTribe(body('x', ALL_TYPES.id) as never, t)).toBe(true);
    }
  });

  it('VOICEKEEPER copies an ALL-TYPES minion sold (the reported bug)', () => {
    let s = createRun(11, 'aster');
    s = {
      ...s,
      board: [body('vk', 'd2_voicekeeper'), body('all', ALL_TYPES.id)],
      hand: [],
    } as unknown as RunState;
    const handBefore = s.hand.length;
    s = reduce(s, { type: 'sell', uid: 'all' } as Action);
    expect(s.hand.length, 'Voicekeeper conjured a copy of the sold All-types body').toBe(handBefore + 1);
    expect(s.hand[0]!.cardId, 'and it is a copy of what was sold').toBe(ALL_TYPES.id);
  });

  it('a plain NON-dragon sale still does not trigger it (no over-firing)', () => {
    const nonDragon = Object.values(CARD_INDEX).find(
      (c) => !c.spell && !c.token && !c.universalTribe && !defIsTribe(c, 'dragon'),
    )!;
    let s = createRun(11, 'aster');
    s = { ...s, board: [body('vk', 'd2_voicekeeper'), body('p', nonDragon.id)], hand: [] } as unknown as RunState;
    s = reduce(s, { type: 'sell', uid: 'p' } as Action);
    expect(s.hand.length, `${nonDragon.id} is not a Dragon — no copy`).toBe(0);
  });
});
