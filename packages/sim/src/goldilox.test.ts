/**
 * GOLDILOX (set 3 Dwarf/Spirit, T3 2/2) — owner batch 2026-09-24.
 *
 *   "When you cast a Shop Spell, gain +3/+2. Gains 2x while in hand."
 *
 * Owner clarification: *"shop spells cast from anywhere count, not rubies, clues or generic spells. just a heads up
 * - ales ARE shop spells. they do count. also, this should work in combat, so if spells are cast in combat,
 * goldilox gains stats and those stats are permanent per our rules for hand granted stats in combat."*
 *
 * Pinned here, phase by phase (R-GOLDILOX-01 in the oracle):
 *  - SHOP: a hand-cast Shop spell (Ales included) grows it on the board (+3/+2) and in the hand (+6/+4); gilded
 *    doubles both; Rubies, Clues (Gifts) and spells outside the set's Shop-spell pool never count.
 *  - "FROM ANYWHERE": an Equipment's cast (Pourman's Keg) and an End-of-Turn cast (Soul Defiler) both count.
 *  - COMBAT: a spell cast mid-fight grows the board copy PERMANENTLY (carried back) and the hand copy through the
 *    permanent hand channel (R-HAND-02), shown live (`handBuff`); a non-pool spell does nothing; an enemy cast
 *    never feeds the player's Goldilox.
 */
import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, countRubyAsShopSpell, noteSpellCast } from './recruit';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 30, tier: 6, tribes: ['kobold', 'dwarf', 'undead', 'spirit', 'celestial'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), recruitBuffFx: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (cards: readonly BoardCard[], uid: string): BoardCard => cards.find((c) => c.uid === uid)!;
const G = CARD_INDEX['dw3_goldilox']!;

describe('Goldilox — the card', () => {
  it('is a Set 3 Dwarf/Spirit, Tier 3, 2/2, drawable from the Set 3 pool', () => {
    expect(G).toMatchObject({ name: 'Goldilox', tribe: 'dwarf', tribe2: 'spirit', tier: 3, attack: 2, health: 2 });
    expect(poolFor('set3').buyable.some((c) => c.id === 'dw3_goldilox')).toBe(true);
    expect(G.text).toBe('When you cast a **Shop spell**, gain **+3/+2**. Gains **2x** while in hand.');
    expect(G.goldenText).toBe('When you cast a **Shop spell**, gain **+6/+4**. Gains **2x** while in hand.');
  });
});

describe('Goldilox — SHOP: board +3/+2, hand +6/+4 per Shop spell', () => {
  const spell = (uid: string, cardId: string) => body(uid, cardId, { tribe: 'neutral', attack: 0, health: 1 });

  it('a hand-cast Shop spell grows the board copy by +3/+2 and the hand copy by +6/+4', () => {
    let s = run({ board: [body('gb', 'dw3_goldilox')], hand: [body('gh', 'dw3_goldilox'), spell('sp', 'emberpouch')] });
    s = act(s, { type: 'play', uid: 'sp' });
    expect([at(s.board, 'gb').attack, at(s.board, 'gb').health]).toEqual([2 + 3, 2 + 2]);
    expect([at(s.hand, 'gh').attack, at(s.hand, 'gh').health], '2x while in hand').toEqual([2 + 6, 2 + 4]);
    expect(at(s.board, 'gb').buffs?.find((b) => b.source === 'Goldilox'), 'the gain names its source').toMatchObject({ attack: 3, health: 2 });
  });

  it('a Dwarven Ale IS a Shop spell and counts', () => {
    let s = run({ board: [body('gb', 'dw3_goldilox')], hand: [spell('ale', 'wo_health')] });
    s = act(s, { type: 'play', uid: 'ale' });
    const g = at(s.board, 'gb');
    // Defensive Ale buffs your board too, so read Goldilox's own ledger entry rather than the raw stats.
    expect(g.buffs?.find((b) => b.source === 'Goldilox')).toMatchObject({ attack: 3, health: 2 });
  });

  it('gilded doubles: +6/+4 on the board, +12/+8 in hand', () => {
    let s = run({ board: [body('gb', 'dw3_goldilox', { golden: true, attack: 4, health: 4 })], hand: [body('gh', 'dw3_goldilox', { golden: true, attack: 4, health: 4 }), spell('sp', 'emberpouch')] });
    s = act(s, { type: 'play', uid: 'sp' });
    expect([at(s.board, 'gb').attack, at(s.board, 'gb').health]).toEqual([4 + 6, 4 + 4]);
    expect([at(s.hand, 'gh').attack, at(s.hand, 'gh').health]).toEqual([4 + 12, 4 + 8]);
  });

  it('a Ruby, a Clue and a spell outside the Shop-spell pool never count', () => {
    const s = run({ board: [body('gb', 'dw3_goldilox')], hand: [body('gh', 'dw3_goldilox')] });
    countRubyAsShopSpell(s, CARD_INDEX['ruby']!, 1); // even a Ruby that Spellstone books as a Shop spell
    noteSpellCast(s, CARD_INDEX['clue']!); // a Gift: a spell cast, not a Shop spell
    const generic = Object.values(CARD_INDEX).find((c) => c.spell && !c.token && !c.gift && !c.ruby && !poolFor('set3').spells.some((p) => p.id === c.id))!;
    expect(generic, 'there is a non-pool spell to try').toBeTruthy();
    noteSpellCast(s, generic);
    expect([at(s.board, 'gb').attack, at(s.board, 'gb').health]).toEqual([2, 2]);
    expect([at(s.hand, 'gh').attack, at(s.hand, 'gh').health]).toEqual([2, 2]);
  });

  it('"from anywhere": an Equipment cast (Pourman\'s Keg pouring an Ale) counts', () => {
    let s = act(run({ board: [body('gb', 'dw3_goldilox')], hand: [body('p', 'dw3_pourman'), body('gh', 'dw3_goldilox')] }), { type: 'play', uid: 'p', toIndex: 1 });
    s = act(s, { type: 'activateEquipment' });
    expect(at(s.board, 'gb').buffs?.find((b) => b.source === 'Goldilox')).toMatchObject({ attack: 3, health: 2 });
    expect(at(s.hand, 'gh').buffs?.find((b) => b.source === 'Goldilox')).toMatchObject({ attack: 6, health: 4 });
  });

  it('END OF TURN: a minion casting a Shop spell at End of Turn (Soul Defiler → Staff of Guel) counts, board and hand', () => {
    const s = run({ board: [body('sd', 'dm_curator'), body('gb', 'dw3_goldilox')], hand: [body('gh', 'dw3_goldilox')] });
    applyEndOfTurn(s);
    expect(at(s.board, 'gb').buffs?.find((b) => b.source === 'Goldilox')).toMatchObject({ attack: 3, health: 2 });
    expect(at(s.hand, 'gh').buffs?.find((b) => b.source === 'Goldilox')).toMatchObject({ attack: 6, health: 4 });
  });
});

// ── COMBAT ────────────────────────────────────────────────────────────────────────────────────────────────────
// A probe Rally caster: every attack casts Growth (a Set 3 Shop-pool spell) for real through `castInCombat`.
const CASTER: CardDef = {
  id: 'gx_caster', name: 'Growth Caster', tribe: 'neutral', tier: 1, attack: 1, health: 60, keywords: ['RL'],
  effects: [{ on: 'onAttack', do: 'rallyCastNamedSpell', params: { spellId: 'growth' } }],
  text: '**Rally:** cast **Growth**.',
};
const CARDS: Record<string, CardDef> = { ...CARD_INDEX, [CASTER.id]: CASTER };
const bm = (uid: string, cardId: string, attack: number, health: number, golden = false): BoardMinion =>
  ({ uid, sourceUid: uid, cardId, attack, health, keywords: [...(CARDS[cardId]!.keywords)], golden } as unknown as BoardMinion);
const handCard = (uid: string, golden = false) => ({ uid, cardId: 'dw3_goldilox', attack: 2, health: 2, keywords: [], golden });
const ofType = <T extends CombatEvent['type']>(events: readonly CombatEvent[], type: T) =>
  events.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === type);

describe('Goldilox — COMBAT: a mid-fight Shop spell grows it permanently, board and hand', () => {
  const fight = (opts: { golden?: boolean; poolIds?: string[]; casterSide?: 'player' | 'enemy' } = {}) => {
    const golden = !!opts.golden;
    const mine = [bm('gb', 'dw3_goldilox', golden ? 4 : 2, 30, golden), ...(opts.casterSide === 'enemy' ? [] : [bm('cx', 'gx_caster', 1, 60)])];
    const theirs = opts.casterSide === 'enemy' ? [bm('ecx', 'gx_caster', 1, 60), bm('sb', 'sandbag', 1, 40)] : [bm('sb', 'sandbag', 1, 40)];
    return simulate(mine, theirs, makeRng(7), CARDS,
      combatSide({ tier: 6, handMinions: [handCard('gh', golden)], ...(opts.poolIds ? { poolIds: opts.poolIds } : {}) }),
      combatSide({ tier: 6 }));
  };

  it('each Growth cast grows the board Goldilox +3/+2 (permanent, carried back) and the hand Goldilox +6/+4 (live handBuff)', () => {
    const r = fight();
    const casts = ofType(r.events, 'spellcast').filter((e) => e.side === 'player').length;
    expect(casts, 'the probe cast at least once').toBeGreaterThan(0);
    const hb = ofType(r.events, 'handBuff').filter((e) => e.uid === 'gh');
    expect(hb.length, 'one hand growth per cast').toBe(casts);
    for (const e of hb) expect(e).toMatchObject({ side: 'player', attack: 6, health: 4 });
    const handTotal = (r.playerHandBuffs ?? []).filter((b) => b.uid === 'gh').reduce((a, b) => ({ attack: a.attack + b.attack, health: a.health + b.health }), { attack: 0, health: 0 });
    expect(handTotal, 'carried back to the run hand (R-HAND-02)').toEqual({ attack: 6 * casts, health: 4 * casts });
    const perma = (r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'gb' && !p.ruby);
    expect(perma.reduce((n, p) => n + p.attack, 0), 'board growth is permanent').toBe(3 * casts);
    expect(perma.reduce((n, p) => n + p.health, 0)).toBe(2 * casts);
  });

  it('gilded doubles both halves in combat', () => {
    const r = fight({ golden: true });
    const casts = ofType(r.events, 'spellcast').filter((e) => e.side === 'player').length;
    expect(casts).toBeGreaterThan(0);
    for (const e of ofType(r.events, 'handBuff').filter((x) => x.uid === 'gh')) expect(e).toMatchObject({ attack: 12, health: 8 });
    expect((r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'gb' && !p.ruby).reduce((n, p) => n + p.attack, 0)).toBe(6 * casts);
  });

  it('a spell outside the side\'s Shop-spell pool does nothing (a "generic" spell)', () => {
    const pool = poolFor('set3').all.map((c) => c.id).filter((id) => id !== 'growth');
    const r = fight({ poolIds: pool });
    expect(ofType(r.events, 'spellcast').filter((e) => e.side === 'player').length, 'the cast still happened').toBeGreaterThan(0);
    expect(ofType(r.events, 'handBuff').filter((e) => e.uid === 'gh')).toEqual([]);
    expect((r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'gb')).toEqual([]);
  });

  it('an ENEMY cast never feeds the player\'s Goldilox', () => {
    const r = fight({ casterSide: 'enemy' });
    expect(ofType(r.events, 'spellcast').filter((e) => e.side === 'enemy').length).toBeGreaterThan(0);
    expect(ofType(r.events, 'handBuff').filter((e) => e.uid === 'gh')).toEqual([]);
    expect((r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'gb')).toEqual([]);
  });

  it('is deterministic: the same seed produces the same log', () => {
    expect(JSON.stringify(fight().events)).toBe(JSON.stringify(fight().events));
  });
});

describe('Goldilox — COMBAT → SHOP: the carry-back lands permanently in the run', () => {
  it('settle applies the hand growth to the run hand, attributed to Goldilox', () => {
    let s = run({ board: [body('cx0', 'dw3_goldilox')], hand: [body('gh', 'dw3_goldilox')] });
    s = act(s, { type: 'faceOmen' });
    expect(s.phase).toBe('combat');
    // Stamp a Goldilox hand growth onto the combat result before settle, exactly as `spellResolved` emits it
    // (source = the hand card's own uid). The reducer shares `lastCombat` by reference.
    s.lastCombat!.playerHandBuffs = [{ uid: 'gh', attack: 6, health: 4, source: 'gh' }];
    s = act(s, { type: 'settleCombat' });
    s = act(s, { type: 'resolveCombat' });
    const gh = s.hand.find((c) => c.uid === 'gh');
    expect(gh, 'still in hand').toBeTruthy();
    expect(gh!.buffs?.find((b) => b.source === 'Goldilox'), 'named after itself, not "Combat" (R-PROV-01)').toMatchObject({ attack: 6, health: 4 });
  });
});
