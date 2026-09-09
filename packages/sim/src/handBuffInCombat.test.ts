/**
 * R-HAND-02 — "CARDS BUFFED IN HAND ARE ALWAYS PERMANENT" (owner ruling 2026-09-09).
 *
 * *"cards buffed in hand are always permanent. so if something buffs a card in hand during combat, that
 * card in hand retains the buff. the buff also needs to show in real time like all of our other effects do."*
 *
 * Three claims, each pinned here against the real engine:
 *  1. A combat effect that buffs a hand card LOGS it (`handBuff`) — the replay grows the card on its beat
 *     (the UI half is pinned in `useCombatReplay.test.ts`, `handBuffsShownThrough`).
 *  2. The buff CARRIES BACK (`playerHandBuffs`) and settle applies it to the run hand — permanently, as a
 *     recruit buff would be (`addBuff`, attributed).
 *  3. The same effect fired IN THE SHOP (an Echo triggered outside combat) lands directly — permanent by
 *     construction — so the two phases cannot drift.
 *
 * No shipped card buffs the hand mid-fight yet, so the probe injects a synthetic Echo minion that uses the
 * new `deathrattleBuffHandTribe` factory through `simulate()`'s own `cards` index. The channel is the thing
 * under test; the first real card to use it inherits every guarantee here.
 */
import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { fireRecruitDeathrattlesForTest } from './recruit';

const PROBE: CardDef = {
  id: 'hb_probe', name: 'Hand Buffer', tribe: 'dwarf', tier: 1, attack: 1, health: 1, keywords: [],
  effects: [{ on: 'onDeath', do: 'deathrattleBuffHandTribe', params: { tribe: 'dwarf', attack: 2, health: 3 } }],
  text: '**Echo:** give the **Dwarves** in your hand **+2/+3**.',
};
const CARDS: Record<string, CardDef> = { ...CARD_INDEX, [PROBE.id]: PROBE };

const bm = (cardId: string, attack: number, health: number, golden = false): BoardMinion =>
  ({ cardId, attack, health, keywords: [], golden } as unknown as BoardMinion);
const hand = (uid: string, cardId: string) => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
const handBuffEvents = (events: readonly CombatEvent[]) =>
  events.filter((e): e is Extract<CombatEvent, { type: 'handBuff' }> => e.type === 'handBuff');

describe('R-HAND-02 — combat half: the event and the carry-back', () => {
  const fight = (golden = false, handMinions = [hand('h1', 'dw_brunni'), hand('h2', 'e3_frank'), hand('h3', 'dw_coinfire')]) =>
    simulate([bm('hb_probe', 1, 1, golden)], [bm('sandbag', 20, 20)], makeRng(3), CARDS,
      combatSide({ tier: 6, handMinions }), combatSide({ tier: 6 }));

  it('buffs ONLY the matching hand cards, logs each as a handBuff event, and carries them back', () => {
    const r = fight();
    const ev = handBuffEvents(r.events);
    expect(ev.map((e) => e.uid).sort()).toEqual(['h1', 'h3']);
    for (const e of ev) expect(e).toMatchObject({ side: 'player', attack: 2, health: 3 });
    expect(ev[0]!.source, 'stamped with the granting body').toBeTruthy();
    expect(r.playerHandBuffs?.map((b) => ({ uid: b.uid, attack: b.attack, health: b.health })).sort((a, b) => a.uid.localeCompare(b.uid)))
      .toEqual([{ uid: 'h1', attack: 2, health: 3 }, { uid: 'h3', attack: 2, health: 3 }]);
  });
  it('golden doubles, and a fight with no hand buffs carries nothing', () => {
    expect(fight(true).playerHandBuffs?.[0]).toMatchObject({ attack: 4, health: 6 });
    const none = simulate([bm('sandbag', 1, 1)], [bm('sandbag', 20, 20)], makeRng(3), CARDS, combatSide({ tier: 6, handMinions: [hand('h1', 'dw_brunni')] }), combatSide({ tier: 6 }));
    expect(none.playerHandBuffs).toBeUndefined();
    expect(handBuffEvents(none.events)).toEqual([]);
  });
  it('an ENEMY body with the effect does nothing — a served board has no hand', () => {
    const r = simulate([bm('sandbag', 20, 20)], [bm('hb_probe', 1, 1)], makeRng(3), CARDS,
      combatSide({ tier: 6, handMinions: [hand('h1', 'dw_brunni')] }), combatSide({ tier: 6 }));
    expect(handBuffEvents(r.events)).toEqual([]);
    expect(r.playerHandBuffs).toBeUndefined();
  });
});

describe('R-HAND-02 — the buff is PERMANENT: settle applies it to the run hand', () => {
  const body = (uid: string, cardId: string): BoardCard => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
  };
  const act = (s: RunState, a: Action): RunState => reduce(s, a);

  it('the carried-back buff lands on the hand card, attributed, and survives into the next shop turn', () => {
    // A real fight through the reducer, then the carry-back stamped onto its result before settle — the
    // reducer shares `lastCombat` by reference, so this is exactly what a hand-buffing body would have left.
    let s: RunState = { ...createRun(1), setId: 'set3', phase: 'recruit', embers: 10, tier: 6,
      board: [body('b', 'dw_brunni')], hand: [body('h1', 'dw_coinfire'), body('h2', 'e3_frank')] } as RunState;
    s = act(s, { type: 'faceOmen' });
    expect(s.phase).toBe('combat');
    const src = s.lastCombat!.initial.player[0]!.uid;
    s.lastCombat!.playerHandBuffs = [{ uid: 'h1', attack: 2, health: 3, source: src }];
    s = act(s, { type: 'settleCombat' });
    s = act(s, { type: 'resolveCombat' });
    const h1 = s.hand.find((c) => c.uid === 'h1')!;
    expect(h1.attack).toBe(CARD_INDEX['dw_coinfire']!.attack + 2);
    expect(h1.health).toBe(CARD_INDEX['dw_coinfire']!.health + 3);
    expect(h1.buffs?.find((b) => b.source === 'Brunni'), 'attributed to the granting body').toMatchObject({ attack: 2, health: 3 });
    expect(s.hand.find((c) => c.uid === 'h2')!.attack, 'the other card untouched').toBe(CARD_INDEX['e3_frank']!.attack);
    // Still there a turn later — permanent, not "this turn".
    expect(s.phase).toBe('recruit');
    expect(s.hand.find((c) => c.uid === 'h1')!.attack).toBe(CARD_INDEX['dw_coinfire']!.attack + 2);
  });
});

describe('R-HAND-02 — shop half: the same effect fired outside combat lands directly', () => {
  it('an Echo fired in the shop buffs the matching hand cards, attributed, through the shared arena body', () => {
    // The shop resolves a body's Echo from its def PLUS its per-instance `copiedEcho` (a Gravetwin's copy), so
    // a real card carrying the probe effect as its copied Echo drives the recruit factory exactly as Ossuary
    // Rite / Deathsayer / the Reliquary would — no synthetic card in the global index needed.
    const echo = { on: 'onDeath' as const, do: 'deathrattleBuffHandTribe' as const, params: { tribe: 'dwarf', attack: 2, health: 3 } };
    const brunni = CARD_INDEX['dw_brunni']!;
    const s: RunState = { ...createRun(1), setId: 'set3', phase: 'recruit', embers: 10, tier: 6,
      board: [{ uid: 'b', cardId: 'dw_brunni', tribe: 'dwarf', attack: brunni.attack, health: brunni.health, keywords: [], golden: false, copiedEcho: [echo] }],
      hand: [
        { uid: 'h1', cardId: 'dw_coinfire', tribe: 'dwarf', attack: 2, health: 5, keywords: [], golden: false },
        { uid: 'h2', cardId: 'e3_frank', tribe: 'neutral', attack: 3, health: 3, keywords: [], golden: false },
        { uid: 'h3', cardId: 'wo_mine', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }, // an Ale — never a minion
      ] } as RunState;
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    const h1 = s.hand.find((c) => c.uid === 'h1')!;
    expect([h1.attack, h1.health]).toEqual([2 + 2, 5 + 3]);
    expect(h1.buffs?.find((b) => b.source === 'Brunni')).toMatchObject({ attack: 2, health: 3 });
    expect(s.hand.find((c) => c.uid === 'h2')!.attack, 'not a Dwarf').toBe(3);
    expect(s.hand.find((c) => c.uid === 'h3')!.attack, 'a spell is never a hand minion').toBe(0);
  });
});
