/** R-CONDUIT-01 (owner 2026-11-25): "add candle conduit to set 2". */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { ARCHIVED_CARDS, CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { mintRandomRubies, mintRubies } from './recruit';

const bc = (uid: string, cardId: string, golden = false): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack: 2, health: 2, keywords: [...CARD_INDEX[cardId]!.keywords], golden }) as BoardCard;
const run = (board: BoardCard[], over: Partial<RunState> = {}): RunState => ({ ...createRun(1, 'warden', 'ascent', undefined, 'set2'), phase: 'recruit', board, hand: [], ...over } as RunState);
const rubied = (s: RunState): number => s.board.reduce((n, c) => n + (c.buffs?.find((b) => b.source === 'Ruby')?.attack ?? 0), 0);
const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => ({ cardId, attack: 1, health: 90, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...over });
type Buff = { type: string; ruby?: boolean; source: string; target: string };

describe('Candle Conduit', () => {
  it('is a Tier 6 7/7 Set 2 Kobold in the Shop, out of the archive', () => {
    expect(CARD_INDEX.k_candleconduit).toMatchObject({ tribe: 'kobold', tier: 6, attack: 7, health: 7 });
    expect(poolFor('set2').buyable.some((c) => c.id === 'k_candleconduit')).toBe(true);
    expect(ARCHIVED_CARDS.some((c) => c.id === 'k_candleconduit')).toBe(false);
  });

  it('SHOP: once a Ruby, plain or Special, on another minion; alone it does nothing', () => {
    let s = run([bc('c', 'k_candleconduit'), bc('x', 'sandbag')]);
    mintRubies(s, 2);
    mintRandomRubies(s, 1);
    expect(rubied(s)).toBe(3);
    expect(s.board[0]!.attack, 'never itself').toBe(2);
    expect(s.board[1]!.rubiesOnThisTurn, 'real casts').toBe(3);
    s = run([bc('c', 'k_candleconduit')]);
    mintRubies(s, 1);
    expect(rubied(s)).toBe(0);
  });

  const fight = (golden = false, other: Partial<BoardMinion>[] = [{}, {}]) => simulate(
    [bm('k_kobe', { attack: 15, health: 400 }), bm('k_candleconduit', { golden }), ...other.map((o) => bm('sandbag', o))],
    [{ cardId: 'sandbag', attack: 0, health: 4000 }], makeRng(5), CARD_INDEX, combatSide({ tier: 6, tribes: ['kobold', 'demon'] }), combatSide());
  const casts = (r: ReturnType<typeof fight>): Buff[] => {
    const uid = r.initial.player.find((m) => m.cardId === 'k_candleconduit')!.uid;
    return r.events.filter((e) => e.type === 'buff' && (e as Buff).ruby && (e as Buff).source === uid) as unknown as Buff[];
  };

  it('COMBAT: a Ruby won mid-fight casts then and there (Gilded on two), never on itself', () => {
    const r = fight();
    expect(r.playerRubyGrantIds?.length).toBe(2); // Kobe pays twice a fight
    expect(casts(r).length).toBe(2);
    expect(casts(r).every((b) => b.target !== b.source)).toBe(true);
    const g = casts(fight(true));
    expect(g.length).toBe(4);
    expect(g[0]!.target).not.toBe(g[1]!.target);
  });

  it('COMBAT: nothing is cast again when the fight settles', () => {
    let s = run([bc('c', 'k_candleconduit'), bc('x', 'sandbag')], { phase: 'combat',
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerRubyMints: 1, playerRubyGrants: 1, playerRubyGrantIds: ['dark-ruby'] } } as unknown as Partial<RunState>);
    s = reduce(s, { type: 'settleCombat' });
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby).length).toBe(3);
    expect(rubied(s)).toBe(0);
    mintRubies(s, 1);
    expect(rubied(s), 'and it casts again in the Shop').toBe(1);
  });

  it('two Conduits and a Gem Sage end: every Ruby is heard once by each', () => {
    const s = run([bc('c', 'k_candleconduit'), bc('d', 'k_candleconduit'), bc('g', 'k_gemsage'), bc('x', 'sandbag')]);
    mintRubies(s, 1); // the Ruby, and the Sage's one: two Rubies, two Conduits
    expect(s.hand.length).toBe(2);
    expect(rubied(s)).toBe(4);
  });
});
