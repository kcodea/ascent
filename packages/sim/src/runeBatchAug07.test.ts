import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/** The 2026-08-07 owner batch: 16 Basic runes. Data-only ones are covered by validateRunes + the count
 *  tripwire; this file pins the ones with new machinery. */
const rune = (id: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.id === id)!;
const bm = (uid: string, cardId: string, a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });

/** Arm a rune through the REAL buyRune path — the same helper shape runes.test.ts uses. */
function withRune(id: string, extra: Partial<RunState> = {}): RunState {
  const s: RunState = { ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 20, runeforgeOffer: [id], ...extra };
  return reduce(s, { type: 'buyRune', index: 0 }) as RunState;
}

describe('the 16 defs exist at sheet costs', () => {
  const want: [string, number][] = [
    ['rune_tip_jar', 6], ['rune_coffers', 5], ['rune_vault', 2], ['rune_altar', 1], ['rune_lorekeeping', 4],
    ['rune_thrift', 3], ['rune_engraving', 3], ['rune_wheel', 4], ['rune_flagship', 3], ['rune_brew', 4],
    ['rune_underdog', 4], ['rune_top_hat', 3], ['rune_evolution', 3], ['rune_transcription', 4],
    ['rune_treasure_map', 2], ['rune_golden_splinter', 3],
  ];
  it('all present, all Basic, at the sheet costs', () => {
    for (const [id, cost] of want) {
      const r = rune(id);
      expect(r, `${id} missing`).toBeDefined();
      expect(r.cost, id).toBe(cost);
      expect(!!r.epic, `${id} should be Basic`).toBe(false);
    }
  });
  it('the set-2 three are scoped; the rest are shared', () => {
    for (const id of ['rune_engraving', 'rune_flagship', 'rune_brew']) expect(rune(id).sets).toEqual(['set2']);
    for (const [id] of want) {
      if (['rune_engraving', 'rune_flagship', 'rune_brew'].includes(id)) continue;
      expect(rune(id).sets, `${id} should be shared`).toBeUndefined();
    }
  });
});

describe('the shop-side machinery', () => {
  it('Altar sells the whole board at +3 each, through the real sell rituals', () => {
    // embers: exactly the rune's cost, so the final Gold is purely what the Altar paid out.
    const s = withRune('rune_altar', { board: [bm('a', 'pack', 3, 2), bm('b', 'stray', 1, 1)], embers: 1 });
    expect(s.board.length, 'the board was not emptied').toBe(0);
    expect(s.embers).toBe(8); // 2 sells × (sell value 1 + premium 3)
    expect(s.soldThisTurn?.length).toBe(2); // the minion-sold ritual ran per body
  });

  it('Vault pays 10 Gold on the upgrade that reaches Tier 5, once', () => {
    let s = withRune('rune_vault', { tier: 4, embers: 20 });
    const before = s.embers;
    const cost = s.upgradeCost;
    s = reduce(s, { type: 'upgrade' }) as RunState;
    expect(s.tier).toBe(5);
    expect(s.embers).toBe(before - cost + 10);
    expect(s.runeVault).toBeUndefined(); // spent
  });

  it('Transcription copies the next 2 buys, then retires', () => {
    let s = withRune('rune_transcription', { embers: 20, shop: [] });
    expect(s.runeTranscription).toBe(2);
    // Drive three buys of DISTINCT minions (three copies of one id would triple into a golden and eat the count).
    const ids = ['stray', 'pack', 'alley'];
    for (let i = 0; i < 3; i++) {
      const uid = `o${i}`;
      s = { ...s, shop: [{ uid, cardId: ids[i]!, cost: 3 } as RunState['shop'][number]], embers: 20 };
      s = reduce(s, { type: 'buy', uid }) as RunState;
    }
    // The first two buys each brought a free copy; the third did not: 3 bought + 2 copies = 5.
    expect(s.hand.length).toBe(5);
    expect(s.hand.filter((c) => c.cardId === 'stray').length).toBe(2);
    expect(s.hand.filter((c) => c.cardId === 'pack').length).toBe(2);
    expect(s.hand.filter((c) => c.cardId === 'alley').length).toBe(1);
    expect(s.runeTranscription).toBeUndefined();
  });

  it('Treasure Map pays 10 Gold after 2 turn ticks, then retires', () => {
    // The countdown ticks in resolveCombat (the new-turn transition), the same case Rune of Slaying's test uses.
    const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };
    let s = withRune('rune_treasure_map', { embers: 5 });
    expect(s.runeTreasureMap).toEqual({ turns: 2, gold: 10 });
    s = reduce({ ...s, phase: 'combat', lastCombat: win } as RunState, { type: 'resolveCombat' }) as RunState;
    const g1 = s.embers;
    expect(s.runeTreasureMap?.turns).toBe(1);
    s = reduce({ ...s, phase: 'combat', lastCombat: win } as RunState, { type: 'resolveCombat' }) as RunState;
    expect(s.embers - g1, 'the payout landed on the second tick (with the new turn Gold on top)').toBeGreaterThanOrEqual(10);
    expect(s.runeTreasureMap).toBeUndefined();
  });

  it('Evolution transforms the board into random Tier-4 minions (buffs and golden do not carry)', () => {
    const s = withRune('rune_evolution', { board: [bm('a', 'stray', 9, 9), bm('b', 'pack', 1, 1)] });
    expect(s.board.length).toBe(2);
    for (const c of s.board) {
      expect(CARD_INDEX[c.cardId]?.tier, c.cardId).toBe(4);
      expect(c.golden).toBe(false);
      expect(c.attack).toBe(CARD_INDEX[c.cardId]!.attack); // fresh base stats
    }
  });
});

describe('the combat flags', () => {
  it('Underdog doubles the two lowest-Attack minions at Start of Combat', () => {
    const r = simulate(
      [{ cardId: 'stray', attack: 1, health: 4 }, { cardId: 'pack', attack: 3, health: 2 }, { cardId: 'sandbag', attack: 9, health: 9 }],
      [{ cardId: 'sandbag', attack: 0, health: 9999 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 6, questMods: { runeUnderdog: true } as never }), combatSide({ tier: 1 }));
    const doubles = r.events.filter((e) => e.type === 'buff' && e.source === 'Rune of the Underdog');
    expect(doubles.length).toBe(2);
    // Each grant equals the body's own stats — a doubling, not a flat buff.
    expect(doubles.some((e) => e.type === 'buff' && e.attack === 1 && e.health === 4)).toBe(true);
    expect(doubles.some((e) => e.type === 'buff' && e.attack === 3 && e.health === 2)).toBe(true);
  });

  it('Engraving: Avenge (3) permanently raises Ruby Health via the Ruby-Power channel', () => {
    const r = simulate(
      [{ cardId: 'sandbag', attack: 5, health: 4000 },
       { cardId: 'stray', attack: 1, health: 1 }, { cardId: 'stray', attack: 1, health: 1 }, { cardId: 'stray', attack: 1, health: 1 }],
      [{ cardId: 'omen', attack: 60, health: 40000 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 6, questMods: { runeEngraving: true } as never }), combatSide({ tier: 1 }));
    expect(r.playerRubyBonusGain, '3 deaths → one +0/+1 proc').toEqual({ attack: 0, health: 1 });
  });
});
