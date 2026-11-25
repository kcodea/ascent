/** R-ALEUS-01 (owner 2026-11-25): "Aleus - 1/7 - When you cast an Ale, give minions in the shop +2/+2." */
import { describe, expect, it } from 'vitest';
import { ALE_IDS, combatSide, makeRng, simulate, type BoardMinion, type CardDef } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

const bc = (uid: string, cardId: string, golden = false): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, ...(CARD_INDEX[cardId]!.tribe2 ? { tribe2: CARD_INDEX[cardId]!.tribe2 } : {}), attack: 2, health: 2, keywords: [], golden }) as BoardCard;
const run = (board: BoardCard[], hand: string[]): RunState => ({ ...createRun(1, 'warden', 'ascent', undefined, 'set2'), phase: 'recruit', embers: 30, board, hand: hand.map((id, i) => bc(`h${i}`, id)) } as RunState);
const buff = (s: RunState): [number, number] => [s.tavernBuyBonus.atk, s.tavernBuyBonus.hp];
const play = (s: RunState, i: number): RunState => {
  let n = reduce(s, { type: 'play', uid: `h${i}`, targetUid: 'x' });
  for (let k = 0; n.chooseOne && k < 3; k++) n = reduce(n, { type: 'chooseOne', index: 0, targetUid: 'x' } as never);
  return n;
};

describe('Aleus', () => {
  it('is a Tier 4 1/7 Dwarf and Demon of Set 2, in the Shop', () => {
    expect(CARD_INDEX.dw_aleus).toMatchObject({ name: 'Aleus', tribe: 'dwarf', tribe2: 'demon', tier: 4, attack: 1, health: 7 });
    expect(poolFor('set2').buyable.some((c) => c.id === 'dw_aleus')).toBe(true);
  });

  it('SHOP: every Ale, +2/+2 to the Shop for good (Gilded +4/+4), and no other spell', () => {
    for (const id of ALE_IDS) {
      const s = play(run([bc('a', 'dw_aleus'), bc('x', 'dw_aleus', true)], [id]), 0);
      expect(buff(s), id).toEqual([6, 6]); // plain 2 + Gilded 4
    }
    expect(buff(play(run([bc('a', 'dw_aleus'), bc('x', 'sandbag')], ['growth']), 0))).toEqual([0, 0]);
    expect(buff(play(run([bc('x', 'sandbag')], [ALE_IDS[0]!]), 0))).toEqual([0, 0]);
  });

  it('SHOP: the minions there and the ones after carry it', () => {
    let s = play(run([bc('a', 'dw_aleus'), bc('x', 'sandbag')], [ALE_IDS.find((i) => i !== 'lastcall')!]), 0);
    s = reduce(s, { type: 'roll' });
    expect(buff(s)).toEqual([2, 2]);
    const off = s.shop.find((c) => c && !CARD_INDEX[c.cardId]!.spell)!;
    s = reduce(s, { type: 'buy', uid: off.uid });
    expect(s.hand.find((c) => c.cardId === off.cardId)!.attack).toBe(CARD_INDEX[off.cardId]!.attack + 2);
  });

  // COMBAT: a probe Rally caster casts the spell for real through `castInCombat` (Champion Inu's probe).
  const fight = (spellId: string, golden = false, aleus = true) => {
    const c: CardDef = {
      id: 'aleus_caster', name: 'Caster', tribe: 'neutral', tier: 1, attack: 1, health: 80, keywords: ['RL'],
      effects: [{ on: 'onAttack', do: 'rallyCastNamedSpell', params: { spellId } }], text: '**Rally:** cast a spell.',
    };
    const cards: Record<string, CardDef> = { ...CARD_INDEX, [c.id]: c };
    const bm = (uid: string, cardId: string, attack: number, health: number, g = false): BoardMinion =>
      ({ uid, sourceUid: uid, cardId, attack, health, keywords: [...cards[cardId]!.keywords], golden: g } as unknown as BoardMinion);
    const r = simulate([bm('cx', c.id, 1, 80), ...(aleus ? [bm('al', 'dw_aleus', 1, 500, golden)] : [])], [bm('sb', 'sandbag', 0, 200)], makeRng(3), cards, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    return { gain: [r.playerTavernBuyGain?.attack ?? 0, r.playerTavernBuyGain?.health ?? 0], casts: r.events.filter((e) => e.type === 'spellcast' && e.side === 'player').length };
  };

  it('COMBAT: each Ale cast in a fight pays the Shop +2/+2 (Gilded +4/+4); another spell, or no Aleus, pays nothing', () => {
    const plain = fight('wo_mine');
    expect(plain.casts).toBeGreaterThan(0);
    expect(plain.gain).toEqual([2 * plain.casts, 2 * plain.casts]);
    const g = fight('wo_mine', true);
    expect(g.gain).toEqual([4 * g.casts, 4 * g.casts]);
    const other = fight('growth');
    expect(other.casts).toBeGreaterThan(0);
    expect(other.gain).toEqual([0, 0]);
    expect(fight('wo_mine', false, false).gain).toEqual([0, 0]);
  });
});

describe('the owner batch of 2026-11-25', () => {
  it('stats: Demon Horse, Contract Butcher, Gasket, Raven (R-BALANCE-1125-01); Kennelmaster (R-KENNEL-01); Drunk Daniel (R-DRUNKDANIEL-01)', () => {
    const line = (id: string) => [CARD_INDEX[id]!.name, CARD_INDEX[id]!.tier, CARD_INDEX[id]!.attack, CARD_INDEX[id]!.health];
    expect(['dm_hungerling', 'dm_butcher', 'dm_gasket', 'b2_raven', 'kennel', 'dw_drunkdaniel'].map(line)).toEqual([
      ['Demon Horse', 3, 4, 5], ['Contract Butcher', 3, 3, 2], ['Gasket', 4, 6, 3], ['Raven', 4, 3, 4], ['Kennelmaster', 2, 1, 5], ['Drunk Daniel', 5, 6, 6],
    ]);
  });

  it('Pickles is in Set 2 and Set 3 (R-PICKLES-SET2-01)', () => {
    for (const set of ['set2', 'set3'] as const) expect(poolFor(set).buyable.some((c) => c.id === 'k3_splitpick'), set).toBe(true);
  });

  it('Frank, Defender and Indy are in Set 2 and Set 3, and work in a Set 2 run (R-SET2-NEUTRALS-1125-01)', () => {
    for (const set of ['set2', 'set3'] as const) for (const id of ['e3_frank', 'n3_defender', 'n3_indy']) expect(poolFor(set).buyable.some((c) => c.id === id), `${set} ${id}`).toBe(true);
    let s = reduce(run([bc('x', 'sandbag')], ['e3_frank', 'n3_defender', 'n3_indy']), { type: 'play', uid: 'h0' });
    s = reduce(s, { type: 'activateEquipment', targetUid: 'x' });
    expect(s.board.find((c) => c.uid === 'x')!.attack, 'the Bloodpot').toBe(5);
    s = reduce(s, { type: 'play', uid: 'h1' });
    expect(s.hand.filter((c) => c.cardId === 'tower_shield')).toHaveLength(2);
    s = reduce(s, { type: 'play', uid: 'h2' });
    for (let i = 0; i < 5; i++) s = reduce(s, { type: 'roll' });
    expect(s.shop.some((c) => c?.cardId === 'n3_goldenmonkey')).toBe(true);
  });
});
