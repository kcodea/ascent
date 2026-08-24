/**
 * FIBBSY — Ruby Wealth (owner spec 2026-08-24): 1 Gold → 2 Rubies, usable TWICE per turn.
 *
 * The interesting part is the per-turn cap: `usesPerTurn` is a new gate distinct from once-per-turn
 * (`heroReady`) and whole-game (`maxUses`). These pin that the second press works, the third is refused, the
 * Gold and Rubies are right, and the budget refills next turn.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, hasPower, powerDiscoverPool, getHero, type RunState } from './index';

const rubies = (s: RunState): number => s.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby).length;
const fibbsy = (): RunState => ({ ...createRun(5, 'fibbsy', 'practice'), embers: 10 });

describe('Fibbsy — Ruby Wealth', () => {
  it('the hero exists with 15 armor and the power reads as printed', () => {
    const h = getHero('fibbsy');
    expect(h.armor).toBe(15);
    expect(h.power.kind).toBe('rubyWealth');
    expect(h.power.cost).toBe(1);
    expect(h.power.usesPerTurn).toBe(2);
  });

  it('grants 2 Rubies for 1 Gold, TWICE, then refuses the third use that turn', () => {
    let s = fibbsy();
    const gold0 = s.embers;
    s = reduce(s, { type: 'heroPower' });
    expect(rubies(s), 'first use → 2 Rubies').toBe(2);
    expect(s.embers, 'first use costs 1 Gold').toBe(gold0 - 1);
    expect(s.heroReady, 'still armed for the second press').toBe(true);

    s = reduce(s, { type: 'heroPower' });
    expect(rubies(s), 'second use → 4 Rubies total').toBe(4);
    expect(s.embers).toBe(gold0 - 2);
    expect(s.heroReady, 'now spent for the turn').toBe(false);

    const before = { rubies: rubies(s), gold: s.embers };
    s = reduce(s, { type: 'heroPower' });
    expect(rubies(s), 'the third press this turn does nothing').toBe(before.rubies);
    expect(s.embers, 'and costs no Gold').toBe(before.gold);
  });

  it('will not fire with less than 1 Gold', () => {
    let s: RunState = { ...fibbsy(), embers: 0 };
    s = reduce(s, { type: 'heroPower' });
    expect(rubies(s)).toBe(0);
    expect(s.heroReady, 'a refused use spends no charge').toBe(true);
  });

  it('the per-turn budget refills next turn', () => {
    let s = fibbsy();
    s = reduce(s, { type: 'heroPower' });
    s = reduce(s, { type: 'heroPower' });
    expect(s.heroReady).toBe(false);
    // Play a turn: send to combat and back.
    for (const a of [{ type: 'faceOmen' }, { type: 'resolveCombat' }, { type: 'settleCombat' }] as const) s = reduce(s, a);
    expect(s.heroReady, 'a fresh turn re-arms the power').toBe(true);
    expect(s.heroUsesThisTurn ?? 0, 'and the per-turn counter reset').toBe(0);
  });

  it('is adoptable — it joins the Mimic / Power Shifter / Void discover pool', () => {
    expect(powerDiscoverPool('mimic')).toContain('fibbsy');
    expect(powerDiscoverPool('void')).toContain('fibbsy');
  });

  it('an ADOPTED Ruby Wealth still fires (hasPower routing, not heroId)', () => {
    // Mimic wielding Fibbsy's power should mint Rubies just the same.
    let s: RunState = { ...createRun(5, 'mimic', 'practice'), embers: 10, adoptedPowerId: 'fibbsy', powerOffer: undefined, discover: undefined };
    expect(hasPower(s, 'rubyWealth')).toBe(true);
    s = reduce(s, { type: 'heroPower' });
    expect(rubies(s)).toBe(2);
  });
});
