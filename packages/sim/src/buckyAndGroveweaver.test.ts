import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type CombatSideState } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type RunState } from './index';

/** Bucky + his rune, and the Groveweaver rune's COMBAT half (owner 2026-08-07). */
const rune = (id: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.id === id)!;
const mods = (m: Partial<CombatSideState['questMods']>) => ({ questMods: m as CombatSideState['questMods'] });
const wall = [{ cardId: 'sandbag', attack: 0, health: 40000 }];
const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };

describe('Bucky + Rune of Bucky', () => {
  it('the card ships as specced: T6 Dwarf 6/10, rune-exclusive', () => {
    const d = CARD_INDEX['dw_bucky']!;
    expect([d.tier, d.tribe, d.attack, d.health, d.token]).toEqual([6, 'dwarf', 6, 10, true]);
    expect(d.keywords).toContain('SC');
  });

  it('the rune is Epic 7, set-2 scoped, and grants him', () => {
    const r = rune('rune_bucky');
    expect([r.cost, r.epic, r.sets]).toEqual([7, true, ['set2']]);
    const s: RunState = { ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 20, runeforgeOffer: ['rune_bucky'] };
    const next = reduce(s, { type: 'buyRune', index: 0 }) as RunState;
    expect(next.hand.some((c) => c.cardId === 'dw_bucky'), 'no Bucky granted').toBe(true);
  });

  /** Bucky + a Dwarf, with `ales` cast last turn. Returns the buffs Bucky handed out. */
  const fight = (ales: number) => {
    const r = simulate(
      [{ cardId: 'dw_bucky', attack: 6, health: 400 }, { cardId: 'dw_wardkeeper', attack: 1, health: 400 }],
      wall, makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['dwarf'], alesLastTurn: ales }), combatSide({ tier: 1 }));
    const bucky = r.initial.player.find((m) => m.cardId === 'dw_bucky')!;
    return r.events.filter((e) => e.type === 'buff' && e.source === bucky.uid);
  };

  it('scales +5/+5 per Ale cast LAST turn', () => {
    const two = fight(2);
    expect(two.length, 'no buff at 2 Ales').toBeGreaterThan(0);
    expect(two.every((b) => b.type === 'buff' && b.attack === 10 && b.health === 10), '2 Ales → +10/+10').toBe(true);
    const three = fight(3);
    expect(three.every((b) => b.type === 'buff' && b.attack === 15 && b.health === 15), '3 Ales → +15/+15').toBe(true);
  });

  it('zero Ales is a clean no-op — no 0/0 sweep, no narration', () => {
    expect(fight(0).length).toBe(0);
  });

  it('the rune badge counts the Ales you are banking THIS turn', async () => {
    const { runeTally } = await import('../../ui/src/runeTally');
    const base = { ...createRun(3), phase: 'recruit' } as RunState;
    expect(runeTally({ ...base, alesCastThisTurn: 0 }, 'rune_bucky'), 'no Ales → no pill').toBeNull();
    expect(runeTally({ ...base, alesCastThisTurn: 1 }, 'rune_bucky')).toBe('1 Ale');
    expect(runeTally({ ...base, alesCastThisTurn: 3 }, 'rune_bucky')).toBe('3 Ales');
  });

  it('pays in the VERY NEXT combat, not the one after (owner bug report 2026-08-07)', () => {
    // The regression this pins: the tally used to be banked in `resolveCombat`, which runs AFTER the combat
    // side is built in `faceOmen` — so a shop's Ales only reached the fight a whole turn later. Cast, fight,
    // and the buff must be there immediately.
    let s: RunState = {
      ...createRun(3), phase: 'recruit', embers: 0, shop: [], hand: [],
      alesCastThisTurn: 3, // three Ales cast during THIS shop phase
      board: [{ uid: 'b', cardId: 'dw_bucky', tribe: 'dwarf', attack: 6, health: 400, keywords: [], golden: false },
              { uid: 'd', cardId: 'dw_wardkeeper', tribe: 'dwarf', attack: 1, health: 400, keywords: [], golden: false }],
    } as RunState;
    s = reduce(s, { type: 'faceOmen' }) as RunState;
    const bucky = s.lastCombat!.initial.player.find((m) => m.cardId === 'dw_bucky')!;
    const buffs = s.lastCombat!.events.filter((e) => e.type === 'buff' && e.source === bucky.uid);
    expect(buffs.length, 'Bucky paid nothing in the combat right after the Ales were cast').toBeGreaterThan(0);
    expect(buffs.every((b) => b.type === 'buff' && b.attack === 15 && b.health === 15), '3 Ales → +15/+15').toBe(true);
  });

  it('the Ale tally RESETS at the rollover — the combat already read the live figure', () => {
    let s: RunState = { ...createRun(3), phase: 'recruit', alesCastThisTurn: 4 };
    s = reduce({ ...s, phase: 'combat', lastCombat: win } as RunState, { type: 'resolveCombat' }) as RunState;
    expect(s.alesCastThisTurn, 'the running tally did not reset').toBe(0);
  });
});

describe('Rune of the Groveweaver — the combat half', () => {
  /** A Groveweaver whose Echo-summoned Beast arrives mid-fight; returns what the Groveweaver itself gained. */
  const selfGain = (armed: boolean): number => {
    const r = simulate(
      [{ cardId: 'b2_groveweaver', attack: 4, health: 400 }, { cardId: 'pack', attack: 3, health: 1 }],
      [{ cardId: 'omen', attack: 40, health: 4000 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast'], ...(armed ? mods({ runeGroveweaver: true }) : {}) }),
      combatSide({ tier: 1 }));
    const gw = r.initial.player.find((m) => m.cardId === 'b2_groveweaver')!;
    // Buffs the Groveweaver granted TO ITSELF (source and target are both it).
    return r.events.filter((e) => e.type === 'buff' && e.source === gw.uid && e.target === gw.uid)
      .reduce((n, e) => n + (e.type === 'buff' ? e.attack : 0), 0);
  };

  it('without the rune the Groveweaver never buffs itself in combat', () => {
    expect(selfGain(false)).toBe(0);
  });

  it('with the rune it grows as it buffs — the shop behaviour, now in combat', () => {
    expect(selfGain(true), 'Pack’s Echo summons pups; each arrival should pay the Groveweaver +3').toBeGreaterThan(0);
  });
});
