/** R-REFLEKTION-01 (owner 2026-11-25): "When a Ruby is cast on this, it bounces once. this cannot chain. the bounced ruby does not
 *  count as casting a ruby on another minion". */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { mintRubies, RUBY_ID } from './recruit';

const bc = (uid: string, cardId: string, golden = false): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack: 2, health: 2, keywords: [...CARD_INDEX[cardId]!.keywords], golden }) as BoardCard;
const run = (board: BoardCard[], over: Partial<RunState> = {}): RunState => ({ ...createRun(1, 'warden', 'ascent', undefined, 'set2'), phase: 'recruit', board, hand: [], ...over } as RunState);
const cast = (s: RunState, targetUid: string, rubyId: string = RUBY_ID): RunState => {
  mintRubies(s, 1, rubyId);
  return reduce(s, { type: 'play', uid: s.hand.find((c) => c.cardId === rubyId)!.uid, targetUid });
};
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const ruby = (s: RunState, uid: string): [number, number] => { const b = at(s, uid).buffs?.find((x) => x.source === 'Ruby'); return [b?.attack ?? 0, b?.health ?? 0]; };

describe('Reflektion', () => {
  it('is a Tier 3 3/5 Set 2 Kobold, in the Shop', () => {
    expect(CARD_INDEX.k_reflektion).toMatchObject({ name: 'Reflektion', tribe: 'kobold', tier: 3, attack: 3, health: 5 });
    expect(poolFor('set2').buyable.some((c) => c.id === 'k_reflektion')).toBe(true);
    for (const id of ['set1', 'set3', 'set4'] as const) expect(poolFor(id).buyable.some((c) => c.id === 'k_reflektion')).toBe(false);
  });

  it('SHOP: a Ruby on it lands whole, and bounces once (Gilded twice) to another minion', () => {
    let s = cast(run([bc('r', 'k_reflektion'), bc('x', 'sandbag')]), 'r');
    expect([ruby(s, 'r'), ruby(s, 'x')]).toEqual([[1, 1], [1, 1]]);
    expect(s.bounceFx?.length).toBe(1);
    s = cast(run([bc('r', 'k_reflektion', true), bc('x', 'sandbag')]), 'r');
    expect([ruby(s, 'r'), ruby(s, 'x')]).toEqual([[1, 1], [2, 2]]);
    // the Ward rider rides the hop, onto a Kobold only
    s = cast(run([bc('r', 'k_reflektion'), bc('k', 'k_blazer')]), 'r', 'warding-ruby');
    expect(at(s, 'k').keywords).toContain('DS');
    // alone: nothing to bounce to; a Ruby cast elsewhere: nothing
    s = cast(run([bc('r', 'k_reflektion')]), 'r');
    expect(ruby(s, 'r')).toEqual([1, 1]);
    s = cast(run([bc('r', 'k_reflektion'), bc('x', 'sandbag'), bc('y', 'sandbag')]), 'x');
    expect([ruby(s, 'r'), ruby(s, 'y')]).toEqual([[0, 0], [0, 0]]);
  });

  it('SHOP: the bounce is no cast: a second Reflektion never sends it on, and no cast-on effect or counter hears it', () => {
    let s = cast(run([bc('r', 'k_reflektion'), bc('q', 'k_reflektion')]), 'r');
    expect([ruby(s, 'r'), ruby(s, 'q')]).toEqual([[1, 1], [1, 1]]);
    expect(at(s, 'q').rubiesOnThisTurn ?? 0).toBe(0);
    expect(at(s, 'r').rubiesOnThisTurn).toBe(1);
    s = cast(run([bc('r', 'k_reflektion'), bc('f', 'k_furlboggen'), bc('x', 'sandbag')], { rngCursor: 7 }), 'r');
    // whichever got the hop, Furlboggen never cast its own Rubies
    expect(ruby(s, 'f')[0] + ruby(s, 'x')[0]).toBe(1);
  });

  const fight = (board: BoardMinion[], over = {}) => simulate(board, [{ cardId: 'sandbag', attack: 0, health: 900 }], makeRng(3), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['kobold', 'demon'], ...over }), combatSide());
  const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => ({ cardId, attack: 1, health: 90, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...over });

  it('COMBAT: a Ruby cast on it mid-fight bounces, once a Ruby, and two of them never chain', () => {
    // Blazer's Rally casts a Ruby on every friendly minion: each Reflektion bounces its own one.
    const r = fight([bm('k_blazer'), bm('k_reflektion'), bm('k_reflektion')]);
    const refl = r.initial.player.filter((m) => m.cardId === 'k_reflektion').map((m) => m.uid);
    const rubies = r.events.filter((e) => e.type === 'buff' && (e as { ruby?: boolean }).ruby) as unknown as { target: string; source: string; bounce?: { from: string } }[];
    const casts = rubies.filter((e) => !e.bounce && refl.includes(e.target)).length;
    const hops = rubies.filter((e) => e.bounce && refl.includes(e.bounce.from));
    expect(casts).toBeGreaterThan(0);
    expect(hops.length).toBe(casts);
    expect(hops.every((e) => e.target !== e.bounce!.from)).toBe(true);
  });

  it('COMBAT, either side: the enemy Reflektion bounces too', () => {
    const r = simulate([{ cardId: 'sandbag', attack: 0, health: 900 }], [bm('k_blazer'), bm('k_reflektion')], makeRng(3), CARD_INDEX, combatSide(), combatSide({ tier: 6, tribes: ['kobold'] }));
    const uid = r.initial.enemy.find((m) => m.cardId === 'k_reflektion')!.uid;
    expect(r.events.some((e) => e.type === 'buff' && (e as { bounce?: { from: string } }).bounce?.from === uid)).toBe(true);
  });
});
