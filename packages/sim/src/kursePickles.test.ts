import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';

/**
 * OWNER HANDOFF 2026-09-18 — two Set 3 Kobold items.
 *
 *  1. Pickles' Ruby branch pays 3 (was 2); gilded 6.
 *  2. KURSE (T4 7/4; T5 10/5 until the 2026-09-19 tune): Avenge (3) — summon a 1/1 Gemheart Golem plus this minion's Rubies. Gemheart Carver's
 *     body (`deathrattleSummonRubyStats`) on the avenge window: 1/1 + every Ruby stacked on Kurse when the
 *     count is reached; fires on EVERY multiple of three; a full board loses the Golem (summonOverflow); enemy
 *     deaths never count. Golden = Carver's convention: ONE Golem at double stats.
 */

const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack, health, sourceUid: uid, keywords: [...(d?.keywords ?? [])], ...extra } as BoardMinion;
};
const foe = (cardId: string, attack: number, health: number): BoardMinion => ({ cardId, attack, health, keywords: [] } as unknown as BoardMinion);

/** A 1/1 body with no abilities — dies to anything it touches. */
const fodder: CardDef = { id: 'kt_fodder', name: 'Fodder', tribe: 'neutral', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '' };
/** Dies and leaves an unkillable token in its slot — keeps the board full through every death. */
const seedling: CardDef = { id: 'kt_seedling', name: 'Seedling', tribe: 'neutral', tier: 1, attack: 1, health: 1, keywords: [],
  effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'kt_wall' } }], text: '' };
const wall: CardDef = { id: 'kt_wall', name: 'Wall', tribe: 'neutral', tier: 1, attack: 0, health: 400, keywords: [], effects: [], text: '', token: true };
const INDEX = { ...CARD_INDEX, kt_fodder: fodder, kt_seedling: seedling, kt_wall: wall };

const fight = (mine: BoardMinion[], foes: BoardMinion[], seed = 3) =>
  simulate(mine, foes, makeRng(seed), INDEX, combatSide({ tier: 6, poolIds: poolFor('set3').all.map((c) => c.id) } as never), combatSide({ tier: 1 }));
const golems = (r: { events: readonly CombatEvent[] }) =>
  r.events.flatMap((e) => (e.type === 'summon' && e.minion.cardId === 'gemheart-shard' ? [e.minion] : []));
const friendlyDeaths = (r: { events: readonly CombatEvent[] }) =>
  r.events.filter((e) => e.type === 'death' && (e as { side?: string }).side === 'player').length;

/** Kurse at 100 Health so the fight outlives the fodder; a 400-Health Target Dummy so every fodder dies on its own swing. */
const kurse = (extra: Partial<BoardMinion> = {}) => bm('k3_kurse', 'KU', 10, 100, extra);
const punchbag = () => foe('sandbag', 1, 400);

describe('Kurse — Avenge (3): a Gemheart Golem plus its Rubies', () => {
  it('is a T4 7/4 Kobold (owner tune 2026-09-19) whose Avenge names the Carver Golem', () => {
    const c = CARD_INDEX['k3_kurse']!;
    expect([c.tribe, c.tier, c.attack, c.health]).toEqual(['kobold', 4, 7, 4]);
    // Owner 2026-09-24: the Golem attacks immediately (`charge`), Kurse only; text + behaviour in koboldCelestialDwarf0924.test.ts.
    expect(c.effects).toEqual([{ on: 'avenge', do: 'avengeSummonRubyStats', params: { count: 3, tokenId: 'gemheart-shard', charge: true } }]);
    // The same printed Golem contract as Gemheart Carver, plus Kurse's own "It attacks immediately."
    expect(c.text).toBe(CARD_INDEX['k_gemheart']!.text.replace('**Echo:**', '**Avenge (3):**') + ' It attacks immediately.');
    expect(c.goldenText).toBe(CARD_INDEX['k_gemheart']!.goldenText!.replace('**Echo:**', '**Avenge (3):**') + ' It attacks immediately.');
    expect(poolFor('set3').buyable.some((x) => x.id === 'k3_kurse')).toBe(true);
  });

  it('after three friendly deaths a 1/1 Golem appears (no Rubies on Kurse)', () => {
    const r = fight([kurse(), bm('kt_fodder', 'f1', 1, 1), bm('kt_fodder', 'f2', 1, 1), bm('kt_fodder', 'f3', 1, 1)], [punchbag()]);
    expect(friendlyDeaths(r)).toBeGreaterThanOrEqual(3);
    const g = golems(r);
    expect(g.length).toBe(1);
    expect([g[0]!.attack, g[0]!.health]).toEqual([1, 1]);
  });

  it('with +2/+2 of Rubies on Kurse the Golem is a 3/3', () => {
    const r = fight([kurse({ buffs: [{ source: 'Ruby', attack: 2, health: 2, count: 2 }] }),
      bm('kt_fodder', 'f1', 1, 1), bm('kt_fodder', 'f2', 1, 1), bm('kt_fodder', 'f3', 1, 1)], [punchbag()]);
    const g = golems(r);
    expect(g.length).toBe(1);
    expect([g[0]!.attack, g[0]!.health]).toEqual([3, 3]);
  });

  it('golden: ONE Golem at double stats (Carver convention) — 2/2 bare, 6/6 with +2/+2 of Rubies', () => {
    const bare = fight([kurse({ golden: true }), bm('kt_fodder', 'f1', 1, 1), bm('kt_fodder', 'f2', 1, 1), bm('kt_fodder', 'f3', 1, 1)], [punchbag()]);
    expect(golems(bare).length).toBe(1);
    expect([golems(bare)[0]!.attack, golems(bare)[0]!.health]).toEqual([2, 2]);
    const gem = fight([kurse({ golden: true, buffs: [{ source: 'Ruby', attack: 2, health: 2, count: 2 }] }),
      bm('kt_fodder', 'f1', 1, 1), bm('kt_fodder', 'f2', 1, 1), bm('kt_fodder', 'f3', 1, 1)], [punchbag()]);
    expect(golems(gem).length).toBe(1);
    expect([golems(gem)[0]!.attack, golems(gem)[0]!.health]).toEqual([6, 6]);
  });

  it('six friendly deaths → two Golems (fires on every multiple of three)', () => {
    const r = fight([kurse(), ...[1, 2, 3, 4, 5, 6].map((i) => bm('kt_fodder', `f${i}`, 1, 1))], [punchbag()]);
    expect(friendlyDeaths(r)).toBeGreaterThanOrEqual(6);
    expect(golems(r).length).toBeGreaterThanOrEqual(2);
  });

  it('a full board loses the Golem (summonOverflow) — the count still ticks, nothing lands', () => {
    // Every fodder here Echoes an unkillable Wall into its slot, so the board stays at seven through all three deaths.
    const r = fight([kurse(), ...[1, 2, 3, 4, 5, 6].map((i) => bm('kt_seedling', `s${i}`, 1, 1))], [punchbag()]);
    expect(friendlyDeaths(r)).toBeGreaterThanOrEqual(3);
    expect(r.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'kt_wall').length).toBeGreaterThanOrEqual(3);
    expect(golems(r).length).toBe(0);
  });

  it('enemy deaths do not count', () => {
    const r = fight([kurse()], [foe('kt_fodder', 1, 1), foe('kt_fodder', 1, 1), foe('kt_fodder', 1, 1), foe('kt_fodder', 1, 1)]);
    expect(r.events.filter((e) => e.type === 'death' && (e as { side?: string }).side === 'enemy').length).toBeGreaterThanOrEqual(3);
    expect(golems(r).length).toBe(0);
  });
});

describe('Pickles — the Ruby branch pays 3 (gilded 6)', () => {
  const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
  };
  const run = (over: Partial<RunState> = {}): RunState =>
    ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, tribes: ['kobold', 'undead', 'dwarf'],
      pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
  const act = (s: RunState, a: Action): RunState => reduce(s, a);

  it('prints 3 / 6 and declares count 3', () => {
    const c = CARD_INDEX['k3_splitpick']!;
    // Owner 2026-09-24: "Choose One: Get 3 Rubies or a Facetwright." The Ruby branch is now FIRST (index 0).
    expect(c.chooseOne![0]!.text).toBe('Get **3 Rubies**.');
    expect(c.chooseOne![0]!.goldenText).toBe('Get **6 Rubies**.');
    expect(c.chooseOne![0]!.effects).toEqual([{ on: 'onPlay', do: 'battlecryGetRubies', params: { count: 3 } }]);
  });

  it('choosing the Ruby branch hands three Rubies (six gilded)', () => {
    const rubies = (s: RunState) => s.hand.filter((h) => CARD_INDEX[h.cardId]?.ruby).length;
    let s = run({ hand: [body('p', 'k3_splitpick')] });
    s = act(act(s, { type: 'play', uid: 'p' }), { type: 'chooseOne', index: 0 });
    expect(rubies(s)).toBe(3);
    let g = run({ hand: [body('p', 'k3_splitpick', { golden: true })] });
    g = act(act(g, { type: 'play', uid: 'p' }), { type: 'chooseOne', index: 0 });
    expect(rubies(g)).toBe(6);
  });
});
