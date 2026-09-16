import { describe, expect, it, vi, beforeEach } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';
import { groupBuffCasts } from './channels/buffCast';
import { resolveBuffSource } from './buffSource';

vi.mock('../fx/playDef', () => ({ playDef: vi.fn(() => null) }));
import { playDef } from '../fx/playDef';
import { fireBuffFx } from '../buffFxRender';

const mockPlayDef = playDef as unknown as ReturnType<typeof vi.fn>;

/**
 * EVERY buff-other trigger streams its tribe tendril from its source — including a source that has FALLEN
 * (owner report 2026-09-16: "Dawn Sentinel isn't triggering the tendril").
 *
 * The 2026-09-15 pass (#1504, `socEotTendrils.test.ts`) covered Start of Combat + End of Turn. This file pins
 * the OTHER families: the Echo class (a dead buffer — the whole class drew nothing), Rally / watcher grants that
 * were attributed to a NAME instead of a body (Flamebanner Marshal, Ashen Heir, a welded Better Bot / Bloodlust
 * Rally, Wolvie's next-summon gift), and the shared resolver both phases now route through.
 */

const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (attack: number, health: number, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId: 'sandbag', attack, health, keywords: [], ...over } as unknown as BoardMinion);

function fight(board: BoardMinion[], enemy: BoardMinion[], seed = 3, side: Record<string, unknown> = {}) {
  const r = simulate(board, enemy, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, poolIds: Object.keys(CARD_INDEX), ...side } as never), combatSide({ tier: 6 }));
  const moments = compileMoments(r.events);
  const uidOf = (cardId: string) => r.initial.player.find((m) => m.cardId === cardId)!.uid;
  const castsFrom = (source: string) => moments.flatMap((m) => groupBuffCasts(m, r.events)).filter((c) => c.source === source);
  return { r, moments, uidOf, castsFrom };
}

describe('ECHO (combat) — a fallen buffer streams its tribe tendril from the slot it fell in', () => {
  beforeEach(() => mockPlayDef.mockClear());

  it('Dawn Sentinel: its Echo buff is sourced on its UID, lands AFTER its death, and binds tendril-trail-celestial from its last rect', () => {
    // Dawn Sentinel (Taunt so it dies first) + another Celestial to receive the Echo, vs a foe that kills it.
    const { r, uidOf, castsFrom } = fight(
      [bm('ce3_dawnsentinel', { keywords: ['T'] }), bm('ce3_wishingstar', { health: 40 })],
      [foe(20, 60)],
    );
    const sentinel = uidOf('ce3_dawnsentinel');
    const star = uidOf('ce3_wishingstar');
    const death = r.events.findIndex((e) => e.type === 'death' && e.target === sentinel);
    expect(death, 'the Sentinel died').toBeGreaterThan(-1);
    const buff = r.events.findIndex((e, i) => i > death && e.type === 'buff' && e.source === sentinel && e.target === star);
    expect(buff, 'its Echo paid the other Celestial, after the death').toBeGreaterThan(death);
    // ONE cast, source → recipient, sourced on the (dead) body's uid — the replay resolves a slot for it.
    const casts = castsFrom(sentinel);
    expect(casts.map((c) => c.target)).toEqual([star]);
    // In the replay the body is gone (`findEl` → null) but its last rect is known → the ribbon leaves from there.
    const src = resolveBuffSource({
      label: false,
      live: () => null,
      lastSlot: () => ({ x: 120, y: 340 }),
    });
    expect(src).toEqual({ center: { x: 120, y: 340 }, sourceless: false, from: 'lastSlot' });
    const ms = fireBuffFx({
      source: src.center, target: { x: 300, y: 340 }, cardId: 'ce3_dawnsentinel',
      tribe: CARD_INDEX['ce3_dawnsentinel']!.tribe, sourceless: src.sourceless,
      uids: { source: sentinel, target: star },
    });
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    expect(mockPlayDef).toHaveBeenCalledWith(
      'tendril-trail-celestial',
      { source: { x: 120, y: 340 }, target: { x: 300, y: 340 } },
      { uids: { source: sentinel, target: star } },
    );
    expect(ms, 'the roll lands on the ribbon, not the stripped descend').toBeGreaterThan(0);
  });

  it('Noggin (Undead) and Grim (Beast): the same class — sourced on the dead body, one cast per recipient', () => {
    {
      const { uidOf, castsFrom } = fight([bm('u3_noggin', { keywords: ['T'] }), bm('sergeant', { health: 40 })], [foe(20, 60)]);
      const casts = castsFrom(uidOf('u3_noggin'));
      expect(casts.map((c) => c.target)).toEqual([uidOf('sergeant')]);
    }
    {
      const { uidOf, castsFrom } = fight([bm('grim', { keywords: ['T'] }), bm('alley', { health: 40 }), bm('pup', { health: 40 })], [foe(20, 60)]);
      const casts = castsFrom(uidOf('grim'));
      expect(casts.map((c) => c.target).sort()).toEqual([uidOf('alley'), uidOf('pup')].sort());
    }
  });

  it('a source with no slot at all (a hero-power / rune LABEL) stays sourceless — nothing is drawn from nowhere', () => {
    const src = resolveBuffSource({ label: true, live: () => ({ x: 1, y: 1 }), lastSlot: () => ({ x: 2, y: 2 }) });
    expect(src).toEqual({ sourceless: true, from: 'none' });
    fireBuffFx({ source: src.center, target: { x: 0, y: 0 }, cardId: '', tribe: 'neutral', sourceless: src.sourceless });
    expect(mockPlayDef).not.toHaveBeenCalled();
    // …and a body that was never rendered (no live element, no remembered slot) likewise.
    expect(resolveBuffSource({ label: false, live: () => null, lastSlot: () => null })).toEqual({ sourceless: true, from: 'none' });
    // A LIVING body wins over its remembered slot.
    expect(resolveBuffSource({ label: false, live: () => ({ x: 9, y: 9 }), lastSlot: () => ({ x: 1, y: 1 }) }).from).toBe('live');
  });
});

describe('RALLY + WATCHERS (combat) — grants attributed to a body, never to its name', () => {
  it('Flamebanner Marshal (Rally): each Spirit it pays is a cast sourced on its UID (the name form drew nothing)', () => {
    // A Marshal reads the Attack off a minion in HAND — hand it an 11-Attack body through the side's hand.
    const { r, uidOf, castsFrom } = fight(
      [bm('sp3_flamebanner', { health: 40 }), bm('sp3_kindled', { health: 40 }), bm('sp3_tidebud', { health: 40 })],
      [foe(1, 200)], 7,
      { handMinions: [{ uid: 'h1', cardId: 'venom', attack: 11, health: 3, keywords: [], golden: false }] },
    );
    const marshal = uidOf('sp3_flamebanner');
    const paid = r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === marshal && e.attack === 11);
    expect(paid.length, 'the Marshal rallied and paid its Spirits').toBeGreaterThan(0);
    expect(castsFrom(marshal).length, 'one cast per recipient, sourced on the Marshal').toBeGreaterThan(0);
    expect(r.events.some((e) => e.type === 'buff' && e.source === 'Flamebanner Marshal'), 'no label-sourced grant').toBe(false);
  });

  it('Ashen Heir (watcher: a friendly Imp dies): the surviving Imp is paid by a cast sourced on the Heir', () => {
    const { r, uidOf, castsFrom } = fight(
      [bm('impscrap', { keywords: ['T'], health: 1 }), bm('ashen_heir', { health: 40 }), bm('impscrap', { health: 40 })],
      [foe(5, 200)],
    );
    const heir = uidOf('ashen_heir');
    const paid = r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === heir);
    expect(paid.length, 'the Heir paid the living Imp').toBeGreaterThan(0);
    expect(castsFrom(heir).length).toBeGreaterThan(0);
    expect(r.events.some((e) => e.type === 'buff' && e.source === 'Ashen Heir'), 'no label-sourced grant').toBe(false);
  });

  it("Wolvie (Echo → the next Beast summoned): the gift is sourced on the fallen Wolvie's UID", () => {
    const { r, uidOf } = fight([bm('b2_wolvie', { keywords: ['T'], health: 1 }), bm('pack', { health: 1 })], [foe(5, 200)]);
    const wolvie = uidOf('b2_wolvie');
    const pup = r.events.find((e): e is Extract<CombatEvent, { type: 'summon' }> => e.type === 'summon' && e.minion.cardId === 'pup');
    expect(pup, 'Pack Leader died and summoned a Pup').toBeDefined();
    expect(r.events.some((e) => e.type === 'buff' && e.source === wolvie && e.target === pup!.minion.uid)).toBe(true);
    expect(r.events.some((e) => e.type === 'buff' && e.source === 'Wolvie'), 'no label-sourced grant').toBe(false);
  });
});
