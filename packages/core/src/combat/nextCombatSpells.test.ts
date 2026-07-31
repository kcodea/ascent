import { describe, it, expect } from 'vitest';
import { combatSide, simulate, makeRng, type BoardMinion } from '../index';
import { CARD_INDEX } from '@game/content';

/** Decoy Sigil + Weaken — the combat halves of the two new next-combat spells (owner batch 2026-07-31). */
describe('Decoy Sigil in combat', () => {
  it('the first freed slot summons a 1/1 Training Dummy with Taunt + Ward, far right', () => {
    // A full-ish board with one fragile body: when it dies, the freed slot fills with the Dummy.
    const p: BoardMinion[] = [
      { cardId: 'drummer', attack: 2, health: 30 },
      { cardId: 'drummer', attack: 2, health: 1 }, // dies → room opens
    ];
    const e: BoardMinion[] = [{ cardId: 'drummer', attack: 5, health: 40 }];
    const r = simulate(p, e, makeRng(3), CARD_INDEX,
      combatSide({ tier: 4, questMods: { decoySigils: 1 } }), combatSide({ tier: 1 }));
    const dummies = r.events.filter((ev) => ev.type === 'summon' && (ev as { minion: { cardId: string } }).minion.cardId === 'trainingdummy');
    expect(dummies.length, 'exactly ONE dummy per cast').toBe(1);
    const d = (dummies[0] as { minion: { keywords: string[]; attack: number; health: number } }).minion;
    expect(d.keywords).toContain('T');
    expect(d.keywords).toContain('DS');
    expect([d.attack, d.health]).toEqual([1, 1]);
    // Without the mod, no dummy.
    const bare = simulate(p, e, makeRng(3), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 1 }));
    expect(bare.events.some((ev) => ev.type === 'summon' && (ev as { minion: { cardId: string } }).minion.cardId === 'trainingdummy')).toBe(false);
  });
});

describe('Weaken in combat', () => {
  it('Start of Combat: exactly one random enemy is set to 1 Health', () => {
    const p: BoardMinion[] = [{ cardId: 'drummer', attack: 3, health: 20 }];
    const e: BoardMinion[] = [
      { cardId: 'drummer', attack: 1, health: 30 },
      { cardId: 'drummer', attack: 1, health: 30 },
    ];
    const r = simulate(p, e, makeRng(5), CARD_INDEX,
      combatSide({ tier: 5, questMods: { weakenTargets: 1 } }), combatSide({ tier: 1 }));
    const weakenNarrations = r.events.filter((ev) => ev.type === 'sc' && /Weakened to 1 Health/.test((ev as { text?: string }).text ?? ''));
    expect(weakenNarrations.length).toBe(1);
    // The 3-attack player one-shots the weakened 30-hp body — only possible if its Health really became 1.
    expect(r.events.some((ev) => ev.type === 'death')).toBe(true);
  });
});
