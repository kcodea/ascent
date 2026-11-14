import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { PRESENTATION_POLICIES } from '@game/core';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';

/**
 * VAULTKEEPER, owner revert 2026-11-14 (R-VAULT-02): back EXACTLY to the 2026-08-15..2026-10-10 card, through the real
 * reducer. "Gain +2/+2 whenever you play a Dragon. Improves +2/+2 for every 4 spells cast this game." The grant is
 * 2 x (1 + floor((Shop Spells + Rubies) / 4)), read live off the run; Gilded doubles it.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 50, tier: 7, hand: [], board: [], shop: [], ...over } as RunState);
const play = (s: RunState, uid: string): RunState => reduce(s, { type: 'play', uid } as Action);
const gained = (s: RunState, uid: string): [number, number] => {
  const c = s.board.find((b) => b.uid === uid)!;
  return [c.attack - CARD_INDEX[c.cardId]!.attack * (c.golden ? 2 : 1), c.health - CARD_INDEX[c.cardId]!.health * (c.golden ? 2 : 1)];
};
const DRAGON = 'd2_transcendence', DWARF = 'dw_brakka';
const VAULT = CARD_INDEX['d2_herzog']!;

describe('Vaultkeeper (reverted 2026-11-14): +2/+2 per Dragon played, improving every 4 spells', () => {
  it('is the 2026-08-15 card: a Dragon, Tier 6, 6/10, with the old texts and effect', () => {
    expect([VAULT.tribe, VAULT.tribe2, VAULT.tier, VAULT.attack, VAULT.health]).toEqual(['dragon', undefined, 6, 6, 10]);
    expect(VAULT.effects).toEqual([{ on: 'onSummon', do: 'onTribePlayedBuffSelfPerSpell', params: { tribe: 'dragon', base: 2, per: 4 } }]);
    expect([VAULT.text, VAULT.goldenText]).toEqual([
      'Gain **+2/+2** whenever you play a **Dragon**. Improves **+2/+2** for every **4 spells** cast this game.',
      'Gain **+4/+4** whenever you play a **Dragon**. Improves **+4/+4** for every **4 spells** cast this game.',
    ]);
  });

  it('has its presentation policy back, and the 10-20 factory has none', () => {
    expect(PRESENTATION_POLICIES['factory:onTribePlayedBuffSelfPerSpell:onSummon']).toBeDefined();
    expect(PRESENTATION_POLICIES['factory:tribePlayedGainSelfImproving:onTribePlayed']).toBeUndefined();
  });

  it('a Dragon played pays +2/+2; a Dwarf pays nothing', () => {
    let s = run({ board: [body('v', 'd2_herzog')], hand: [body('d', DRAGON), body('w', DWARF)] });
    s = play(s, 'd');
    expect(gained(s, 'v')).toEqual([2, 2]);
    s = play(s, 'w');
    expect(gained(s, 'v'), 'a Dwarf is not a Dragon').toEqual([2, 2]);
  });

  it('every 4 spells (Shop Spells + Rubies) add +2/+2 to the grant, retroactively', () => {
    for (const [spellsCast, rubyCasts, want] of [[3, 0, 2], [4, 0, 4], [2, 2, 4], [8, 1, 6]] as const) {
      const s = play(run({ spellsCast, rubyCasts, board: [body('v', 'd2_herzog')], hand: [body('d', DRAGON)] }), 'd');
      expect(gained(s, 'v'), `${spellsCast} spells + ${rubyCasts} Rubies`).toEqual([want, want]);
    }
  });

  it('Gilded doubles the grant, steps included', () => {
    const s = play(run({ spellsCast: 4, board: [body('v', 'd2_herzog', { golden: true, attack: 12, health: 20 })], hand: [body('d', DRAGON)] }), 'd');
    expect(gained(s, 'v')).toEqual([8, 8]);
  });

  it('never pays itself for its own arrival', () => {
    const s = play(run({ hand: [body('v', 'd2_herzog')] }), 'v');
    expect(gained(s, 'v')).toEqual([0, 0]);
  });

  it('Rune of the Vaultkeeper also gives the grant to an adjacent Dragon', () => {
    const s = play(run({ runeVaultkeeper: true, board: [body('n', 'd2_cinderchef'), body('v', 'd2_herzog')], hand: [body('d', DRAGON)] } as Partial<RunState>), 'd');
    expect(gained(s, 'v')).toEqual([2, 2]);
    expect((s.board.find((c) => c.uid === 'n')!.buffs ?? []).filter((b) => b.source === 'Vaultkeeper').reduce((t, b) => t + b.attack, 0)).toBe(2);
  });
});
