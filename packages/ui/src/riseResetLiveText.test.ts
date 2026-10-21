/**
 * R-RETURN-RESET-01 (owner 2026-10-21): a body that returns through Rise or Rebirth starts its per-combat caps fresh.
 * The combat card's live "N left this combat" text is re-derived from the replay, so the replay must restart those
 * counters on the `reborn` event too (Immune Iggy's immune swings, Whaloo's Runebind casts), or the returned body
 * would print "0 left" while the engine gives it a full set again.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { computeFrame } from './useCombatReplay';

const m = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health, keywords: [], golden: false, ...over } as unknown as BoardMinion);

function frameAround(cardId: string, field: 'attacksMade' | 'whisperCastsUsed') {
  const r = simulate([m(cardId, { health: 500, keywords: ['RB'] })], [m('sandbag', { attack: 100, health: 5000 })],
    makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
  const names = new Map([...r.initial.player, ...r.initial.enemy].map((x) => [x.uid, x.name]));
  const uid = r.initial.player[0]!.uid;
  const iBack = r.events.findIndex((e) => e.type === 'reborn' && e.target === uid);
  expect(iBack, 'the body returned').toBeGreaterThan(-1);
  const at = (n: number) => computeFrame(r.initial, r.events, n, n, names).player.find((u) => u.uid === uid)![field];
  return { r, uid, iBack, at };
}

describe('R-RETURN-RESET-01: the live per-combat counters restart on a return', () => {
  it('Immune Iggy: spent before its death, fresh right after the Rebirth, then counts its new swings', () => {
    const { r, uid, iBack, at } = frameAround('d3_iggy', 'attacksMade');
    expect(at(iBack)!, 'the first life spent both immune swings').toBeGreaterThanOrEqual(2);
    expect(at(iBack + 1), 'fresh after the return').toBeUndefined();
    const nextSwing = r.events.findIndex((e, i) => i > iBack && e.type === 'attack' && e.attacker === uid);
    expect(nextSwing).toBeGreaterThan(-1);
    expect(at(nextSwing + 1)).toBe(1);
  });

  it('Whaloo: its Runebind count restarts after the Rebirth', () => {
    const { iBack, at } = frameAround('d3_whaloo', 'whisperCastsUsed');
    expect(at(iBack)!, 'casts in the first life').toBeGreaterThan(0);
    expect(at(iBack + 1)).toBeUndefined();
  });
});
