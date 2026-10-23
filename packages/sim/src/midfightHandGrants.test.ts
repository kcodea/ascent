/**
 * R-HAND-GRANT-SUMMON-01 (owner ruling 2026-10-23): "a minion added to hand CAN be summoned that same fight."
 *
 * A MINION granted to hand mid-fight joins that side's combat hand pool at once (both sides, 1:1), under the uid
 * `handGrantUid(idx)` that its `toHand` event also carries. Summon-from-hand effects can then pick it with
 * the existing rules (a copy greys it for the fight and the card still arrives at settle). It is summonable only
 * while it would fit the real hand at settle (`handRoom` minus the fight's Rubies, then grants in order), and a
 * mid-fight hand buff on it carries back onto the card it becomes.
 */
import { describe, it, expect } from 'vitest';
import { combatSide, handGrantUid, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent, type CombatSideState } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { playerCombatSideState } from './reducer';

/** Test-only granter: a 0/60 that, at Start of Combat, gets `count` copies of `cardId` to hand (the live Shout body
 *  `battlecryGrantMinion`, re-used as a combat trigger so the grant lands deterministically before any death). */
const granter = (id: string, cardId: string, count = 1): CardDef => ({
  ...CARD_INDEX['sandbag']!, id, name: 'Test Granter', attack: 0, health: 60, keywords: [],
  effects: [{ on: 'startOfCombat', do: 'battlecryGrantMinion', params: { cardId, count } }],
} as CardDef);
const CARDS: Record<string, CardDef> = {
  ...CARD_INDEX,
  t_grant_kindled: granter('t_grant_kindled', 'sp3_kindled'),
  t_grant_two: granter('t_grant_two', 'sp3_kindled', 2),
};

const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARDS[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (attack: number, health: number): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
const side = (over: Partial<CombatSideState> = {}): CombatSideState =>
  combatSide({ tier: 6, poolIds: poolFor('set3').all.map((c) => c.id), ...over });

type Summon = { side: string; minion: { cardId: string; attack: number; health: number; golden?: boolean }; fromHandUid?: string };
const handSummons = (events: CombatEvent[], who: 'player' | 'enemy'): Summon[] =>
  (events as unknown as Summon[]).filter((e) => (e as unknown as { type: string }).type === 'summon' && e.side === who && !!e.fromHandUid);
const toHands = (events: CombatEvent[], who: 'player' | 'enemy') =>
  events.filter((e): e is Extract<CombatEvent, { type: 'toHand' }> => e.type === 'toHand' && e.side === who);

/** Granter + Dreamtide Caller (Echo: summon a COPY of the highest-Health minion in hand) vs a slow wall. The hand
 *  starts EMPTY, so any hand-summon can only have picked the card granted mid-fight. */
const mine = (granterId = 't_grant_kindled'): BoardMinion[] => [bm(granterId), bm('sp3_dreamtide', { attack: 1, health: 1 } as Partial<BoardMinion>)];

describe('R-HAND-GRANT-SUMMON-01: a minion granted to hand mid-fight is summonable that same fight', () => {
  it('player: the granted card joins the hand pool (uid on its toHand) and a COPY summon picks it', () => {
    const r = simulate(mine(), [foe(5, 400)], makeRng(7), CARDS, side({ handRoom: 10 }), side());
    const grant = toHands(r.events, 'player').find((e) => e.cardId === 'sp3_kindled');
    expect(grant?.uid).toBe(handGrantUid(0));
    const s = handSummons(r.events, 'player');
    expect(s).toHaveLength(1);
    expect(s[0]!.fromHandUid).toBe(handGrantUid(0));
    expect(s[0]!.minion.cardId).toBe('sp3_kindled');
    const d = CARD_INDEX['sp3_kindled']!;
    expect([s[0]!.minion.attack, s[0]!.minion.health], 'base stats').toEqual([d.attack, d.health]);
    expect(r.playerHandGrants, 'a COPY leaves the card in hand: it still arrives at settle').toEqual(['sp3_kindled']);
  });

  it('enemy: the same fight mirrored gives the enemy the identical summon (R-SYMMETRY-01)', () => {
    const p = simulate(mine(), [foe(5, 400)], makeRng(7), CARDS, side({ handRoom: 10 }), side());
    const e = simulate([foe(5, 400)], mine(), makeRng(7), CARDS, side(), side({ handRoom: 10 }), { firstSide: 'enemy' });
    const ps = handSummons(p.events, 'player');
    const es = handSummons(e.events, 'enemy');
    expect(es).toHaveLength(1);
    expect(es[0]!.fromHandUid).toBe(handGrantUid(0));
    expect(es[0]!.minion.cardId).toBe(ps[0]!.minion.cardId);
    expect(toHands(e.events, 'enemy')[0]?.uid).toBe(handGrantUid(0));
  });

  it('both sides granting at once: each side summons its OWN grant (the uid is shared, the bookkeeping is per side)', () => {
    const r = simulate(mine(), mine(), makeRng(5), CARDS, side({ handRoom: 10 }), side({ handRoom: 10 }));
    expect(handSummons(r.events, 'player').map((x) => x.fromHandUid)).toEqual([handGrantUid(0)]);
    expect(handSummons(r.events, 'enemy').map((x) => x.fromHandUid)).toEqual([handGrantUid(0)]);
  });

  it('hand cap: a grant that would not fit the real hand is never summonable (and carries no uid)', () => {
    const full = simulate(mine(), [foe(5, 400)], makeRng(7), CARDS, side({ handRoom: 0 }), side());
    expect(handSummons(full.events, 'player')).toHaveLength(0);
    expect(toHands(full.events, 'player')[0]?.uid).toBeUndefined();
    // One free slot, two grants: only the FIRST fits (settle walks grants in order), so only it can be picked.
    const one = simulate(mine('t_grant_two'), [foe(5, 400)], makeRng(7), CARDS, side({ handRoom: 1 }), side());
    const uids = toHands(one.events, 'player').map((e) => e.uid);
    expect(uids).toEqual([handGrantUid(0), undefined]);
    const s = handSummons(one.events, 'player');
    expect(s.map((x) => x.fromHandUid)).toEqual([handGrantUid(0)]);
  });

  it('absent handRoom (older captures) falls back to 10 minus the listed hand', () => {
    const tenCards = Array.from({ length: 10 }, (_, i) => ({ uid: `h${i}`, cardId: 'sandbag', attack: 0, health: 1, keywords: [], golden: false, locked: true }));
    const r = simulate(mine(), [foe(5, 400)], makeRng(7), CARDS, side({ handMinions: tenCards }), side());
    expect(handSummons(r.events, 'player')).toHaveLength(0);
  });

  it('a granted card can be buffed in hand mid-fight; the buff carries back under its combat uid', () => {
    // Hearth Whisperer: taking damage buffs a random hand minion +1/+2 (a handBuff). The granted Kindled is the
    // only hand minion, so every buff lands on it.
    const r = simulate([bm('t_grant_kindled'), bm('sp3_hearthwhisperer', { health: 30 } as Partial<BoardMinion>), bm('sp3_dreamtide', { attack: 1, health: 1 } as Partial<BoardMinion>)],
      [foe(2, 400)], makeRng(3), CARDS, side({ handRoom: 10 }), side());
    const uid = handGrantUid(0);
    const buffs = r.events.filter((e) => e.type === 'handBuff' && e.uid === uid);
    expect(buffs.length).toBeGreaterThan(0);
    expect(r.playerHandBuffs?.some((b) => b.uid === uid)).toBe(true);
  });

  it('a CONSUMING hand summon (the Rope Wrangler Echo primitive) can take a granted card too; settle keeps it like a starting card', () => {
    const cards: Record<string, CardDef> = { ...CARDS, t_wrangler: { ...CARD_INDEX['sandbag']!, id: 't_wrangler', attack: 1, health: 1, keywords: [],
      effects: [{ on: 'onDeath', do: 'deathrattleSummonRandomHandMinion' }] } as CardDef };
    const r = simulate([bm('t_grant_kindled'), { cardId: 't_wrangler', attack: 1, health: 1, keywords: [] } as unknown as BoardMinion], [foe(5, 400)],
      makeRng(7), cards, side({ handRoom: 10 }), side());
    const uid = handGrantUid(0);
    expect(r.playerHandSummoned).toEqual([uid]);
    expect(r.events.some((e) => e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'sp3_kindled')).toBe(true);
    // Settle has kept Rope Wrangler's hand card since 2026-08-08 (it is not eaten), so the grant still arrives.
    expect(r.playerHandGrants).toEqual(['sp3_kindled']);
  });

  it('determinism: the same seed resolves the identical event log', () => {
    const a = simulate(mine(), [foe(5, 400)], makeRng(11), CARDS, side({ handRoom: 10 }), side());
    const b = simulate(mine(), [foe(5, 400)], makeRng(11), CARDS, side({ handRoom: 10 }), side());
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
});

describe('R-HAND-GRANT-SUMMON-01: the run side and settle', () => {
  const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
  };
  const run = (over: Partial<RunState> = {}): RunState =>
    ({ ...createRun(1), setId: 'set3', phase: 'recruit', tier: 6, tribes: ['spirit', 'undead', 'kobold'], ...over } as RunState);

  it('the player side carries handRoom = hand cap minus every held card (spells and Rubies too)', () => {
    const s = run({ hand: [body('a', 'sp3_kindled'), body('b', 'ruby')] });
    expect(playerCombatSideState(s).handRoom).toBe(8);
    const full = run({ hand: Array.from({ length: 10 }, (_, i) => body(`x${i}`, 'ruby')) });
    expect(playerCombatSideState(full).handRoom).toBe(0);
  });

  it('settle: the granted card arrives once, and a mid-fight hand buff on it (by its combat uid) lands on that card', () => {
    // A real fight through the reducer, then the carry-back stamped onto its result before settle (the reducer
    // shares `lastCombat` by reference, so this is exactly what a granting + hand-buffing fight leaves).
    let s = run({ embers: 10, board: [body('b', 'sp3_kindled')], hand: [body('h1', 'sp3_tidebud')] });
    s = reduce(s, { type: 'faceOmen' } as Action);
    expect(s.phase).toBe('combat');
    s.lastCombat!.playerHandGrants = ['sp3_kindled'];
    s.lastCombat!.playerHandBuffs = [{ uid: handGrantUid(0), attack: 2, health: 3 }];
    s = reduce(s, { type: 'settleCombat' } as Action);
    s = reduce(s, { type: 'resolveCombat' } as Action);
    const arrived = s.hand.filter((c) => c.cardId === 'sp3_kindled');
    expect(arrived, 'exactly one copy: no duplicate, none missing').toHaveLength(1);
    const d = CARD_INDEX['sp3_kindled']!;
    expect([arrived[0]!.attack, arrived[0]!.health]).toEqual([d.attack + 2, d.health + 3]);
    expect(s.hand.find((c) => c.uid === 'h1')!.attack, 'the starting card is untouched').toBe(CARD_INDEX['sp3_tidebud']!.attack);
  });
});
