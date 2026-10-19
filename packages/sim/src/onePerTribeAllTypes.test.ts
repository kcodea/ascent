import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { ALE_IDS, noteSpellCast, onePerTribeTargets } from './recruit';

/**
 * R-ONE-PER-TRIBE-ALL-01 (owner 2026-10-18: "i used great pot here and it didnt buff my all type - that's a bug").
 *
 * Great Pot and Rune of the Shared Table read a minion's printed `tribe`/`tribe2` only. An All-types body prints
 * `tribe: 'neutral'` with `universalTribe`, so it looked typeless and was skipped. It now takes its OWN slot, the
 * Fatecarver / Paragon convention, and the Anomaly Reactor's `allTribes` mark and spell-added tribes count too.
 */
const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const body = (cardId: string, uid: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
const gain = (s: RunState, uid: string): number => {
  const c = s.board.find((x) => x.uid === uid)!;
  return c.attack - CARD_INDEX[c.cardId]!.attack;
};
const pot = (): RunState['hand'][number] => ({ uid: 'gp', cardId: 'greatpot', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
const ALE_ID = ALE_IDS[0]!;

describe('R-ONE-PER-TRIBE-ALL-01: an All-types minion takes its own one-per-type slot', () => {
  it('the fixture is an All-types card printed as neutral', () => {
    expect(CARD_INDEX['n2_paragon']!.universalTribe).toBe(true);
    expect(CARD_INDEX['n2_paragon']!.tribe).toBe('neutral');
  });

  it('Great Pot buffs an All-types minion on a board that already covers other types', () => {
    let s: RunState = { ...set2(), phase: 'recruit', embers: 40, board: [body('pack', 'B'), body('n2_paragon', 'P')], hand: [pot()] };
    s = reduce(s, { type: 'play', uid: 'gp' });
    expect(gain(s, 'B'), 'the Beast').toBe(4);
    expect(gain(s, 'P'), 'the All-types minion was skipped').toBe(4);
  });

  it('Great Pot buffs an All-types minion standing alone', () => {
    let s: RunState = { ...set2(), phase: 'recruit', embers: 40, board: [body('n2_paragon', 'P')], hand: [pot()] };
    s = reduce(s, { type: 'play', uid: 'gp' });
    expect(gain(s, 'P')).toBe(4);
  });

  it('the Anomaly Reactor mark counts as All types', () => {
    const marked = { ...body('pack', 'M'), allTribes: true } as BoardCard;
    const targets = onePerTribeTargets([body('pack', 'B'), marked]).map((c) => c.uid);
    expect(targets).toEqual(['B', 'M']);
  });

  it('still one per type for ordinary minions, and neutrals stay skipped', () => {
    const targets = onePerTribeTargets([body('pack', 'B1'), body('stray', 'B2'), body('n2_paragon', 'P')]).map((c) => c.uid);
    expect(targets).toContain('B1');
    expect(targets).toContain('P');
    const beasts = targets.filter((u) => u.startsWith('B'));
    expect(beasts.length, 'two Beasts both claimed the Beast slot').toBe(CARD_INDEX['stray']!.tribe === CARD_INDEX['pack']!.tribe ? 1 : 2);
  });

  it('Rune of the Shared Table buffs an All-types minion too', () => {
    const s: RunState = { ...set2(), runeSharedTable: { attack: 2, health: 2 }, board: [body('pack', 'B'), body('n2_paragon', 'P')] };
    noteSpellCast(s, CARD_INDEX[ALE_ID]!);
    expect(gain(s, 'P'), 'the All-types minion was skipped').toBe(2);
  });
});
