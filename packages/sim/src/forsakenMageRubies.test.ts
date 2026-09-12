import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';

/**
 * FORSAKEN MAGE says "a spell", not "a Shop spell" (owner 2026-09-09): a Ruby, a Tower Shield and a Clue all
 * count — each cast grows the Undead Aura by +4 Attack, exactly like a Shop spell does.
 */
const body = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, tribes: ['undead', 'dwarf', 'kobold'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
const aura = (s: RunState): number => s.undeadBuyAtk ?? 0;

describe('Forsaken Mage counts every spell', () => {
  it('a Ruby played on a minion grows the Undead Aura by +4', () => {
    let s = run({ board: [body('m', 'forsakenweaver'), body('t', 'venom')], hand: [{ ...body('rb', 'ruby'), attack: 1, health: 1 }] });
    const before = aura(s);
    s = reduce(s, { type: 'play', uid: 'rb', targetUid: 't' } as Action);
    expect(aura(s)).toBe(before + 4);
  });

  it('a Tower Shield and a Clue count too', () => {
    let s = run({ board: [body('m', 'forsakenweaver'), body('t', 'venom')], hand: [body('ts', 'tower_shield'), body('c', 'clue')] });
    const before = aura(s);
    s = reduce(s, { type: 'play', uid: 'ts', targetUid: 't' } as Action);
    expect(aura(s)).toBe(before + 4);
    s = reduce(s, { type: 'play', uid: 'c', targetUid: 't' } as Action);
    expect(aura(s)).toBe(before + 8);
  });

  it('other spellCast watchers do NOT hear a Ruby unless they opt in', () => {
    const optedIn = Object.values(CARD_INDEX).filter((c) => c.effects.some((e) => e.on === 'spellCast' && e.params?.includeRubies === true)).map((c) => c.id);
    expect(optedIn).toEqual(['forsakenweaver', 'ce3_seer', 'ce3_zenith']); // Gravestar Seer + Zenith: "a spell" is any spell (owner 2026-09-10; the Zenith reads the same ruling, 2026-09-12)
  });
});
