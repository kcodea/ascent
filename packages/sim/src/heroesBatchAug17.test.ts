import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, getHero, type RunState, type BoardCard } from './index';

/** Owner hero batch 2026-08-17 — Devourer and Membrance. */

const m = (uid: string, cardId: string, atk = 2, hp = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack: atk, health: hp, keywords: [], golden: false }) as BoardCard;

describe('Devourer — Devour', () => {
  it('is a 10-armor, 1-Gold targeted power', () => {
    const h = getHero('devourer');
    expect([h.armor, h.power.kind, h.power.cost]).toEqual([10, 'devour', 1]);
    expect(h.power.untargeted ?? false, 'targeted').toBe(false);
  });

  it('eats the target and hands its CURRENT stats to another friendly', () => {
    const s = {
      ...createRun(3), phase: 'recruit', heroId: 'devourer', embers: 10, heroReady: true,
      board: [m('eaten', 'stray', 5, 7), m('other', 'alley', 2, 2)],
    } as RunState;
    const after = reduce(s, { type: 'heroPower', uid: 'eaten' } as never);
    expect(after.board.some((c) => c.uid === 'eaten'), 'the target was consumed').toBe(false);
    const survivor = after.board.find((c) => c.uid === 'other')!;
    expect([survivor.attack, survivor.health], 'it gained the eaten stats').toEqual([7, 9]);
    expect(after.embers, '1 Gold charged').toBe(9);
  });

  it('is a no-op with only ONE minion — it never silently deletes a body', () => {
    const s = {
      ...createRun(3), phase: 'recruit', heroId: 'devourer', embers: 10, heroReady: true,
      board: [m('solo', 'stray')],
    } as RunState;
    const after = reduce(s, { type: 'heroPower', uid: 'solo' } as never);
    expect([after.board.length, after.embers, after.heroReady]).toEqual([1, 10, true]);
  });
});

describe('Membrance — Memory', () => {
  it('is an 8-armor, 1-Gold untargeted power', () => {
    const h = getHero('membrance');
    expect([h.armor, h.power.kind, h.power.cost, h.power.untargeted]).toEqual([8, 'memory', 1, true]);
  });

  it("restocks the Shop with PLAIN copies of the last opponent's board", () => {
    const foe = ['stray', 'alley', 'pack'];
    const s = {
      ...createRun(3), phase: 'recruit', heroId: 'membrance', embers: 10, heroReady: true,
      lastCombat: {
        result: 'win', playerDamage: 0, playerDeathrattles: 0, events: [],
        initial: {
          player: [],
          enemy: foe.map((cardId, i) => ({ uid: `e${i}`, cardId, name: cardId, tribe: 'beast', attack: 9, health: 9, keywords: [] })),
        },
      } as never,
    } as RunState;
    const after = reduce(s, { type: 'heroPower' } as never);
    expect(after.shop.map((o) => o.cardId), 'the foe board, in order').toEqual(foe);
    expect(after.shop.every((o) => !o.golden), 'plain — never golden').toBe(true);
    expect(after.shop.every((o) => !o.buffs?.length), 'plain — no buffs carried').toBe(true);
    expect(after.embers, '1 Gold charged').toBe(9);
  });

  it('is a no-op before the first fight — no charge spent', () => {
    const s = { ...createRun(3), phase: 'recruit', heroId: 'membrance', embers: 10, heroReady: true } as RunState;
    const after = reduce(s, { type: 'heroPower' } as never);
    expect([after.embers, after.heroReady]).toEqual([10, true]);
  });
});
