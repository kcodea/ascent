import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult } from '@game/core';
import { createRun, reduce, socBoard, type RunState } from '@game/sim';
import { computeFrame } from './useCombatReplay';

/**
 * WEAKEN SETS AN ENEMY'S HEALTH TO 1, ON SCREEN (owner report 2026-10-13):
 *   "weaken is simply not working, please fix this. it should SET an enemy minion's health to 1 at start of combat."
 *
 * Root cause: the engine always set the Health, but the only event it emitted was a narration `sc`, which the
 * replay's fold (`computeFrame`) never read. The weakened card kept showing its full Health until the next hit,
 * so the spell looked like it did nothing. The `sc` now carries `setHealth: 1`, folded like a `dmg`'s
 * `remainingHp`. These tests run the shipped path: a Shop cast, End Turn, the next fight, the replay frame.
 */

const spell = (uid: string, cardId: string): RunState['hand'][number] =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false } as RunState['hand'][number]);
const minion = (uid: string, cardId: string, attack: number, health: number): RunState['board'][number] =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false } as RunState['board'][number]);

type ScEvent = Extract<CombatEvent, { type: 'sc' }>;
const weakenOf = (r: CombatResult): ScEvent[] =>
  r.events.filter((e): e is ScEvent => e.type === 'sc' && /Weakened to 1 Health/.test(e.text));

/** Shop-cast Weaken, End the Turn, and return the fight it armed (seed chosen so the enemy has a body above 1 Health). */
function castWeakenAndFight(seed: number): { pre: RunState; result: CombatResult } {
  const s0 = { ...createRun(seed), setId: 'set1', phase: 'recruit', embers: 30, board: [minion('a', 'supporter', 4, 6)], hand: [spell('sp', 'weaken')] } as RunState;
  const pre = reduce(s0, { type: 'play', uid: 'sp' } as never);
  const next = reduce(pre, { type: 'faceOmen' } as never);
  return { pre, result: next.lastCombat! };
}

describe('Weaken: Shop cast -> next combat sets an enemy to exactly 1 Health, and the replay shows it', () => {
  it('banks on cast, fires at the next Start of Combat, and the frame after the beat reads 1 Health', () => {
    // Seeds whose wave-1 enemy has a body above 1 Health (a 1-Health body is no legal target).
    let checked = 0;
    for (const seed of [12, 77, 40]) {
      const { pre, result } = castWeakenAndFight(seed);
      expect(pre.pendingWeaken).toBe(1);
      const ws = weakenOf(result);
      if (ws.length === 0) continue;
      checked++;
      expect(ws.length).toBe(1);
      const w = ws[0]!;
      expect(w.setHealth).toBe(1);
      const target = result.initial.enemy.find((m) => m.uid === w.source)!;
      expect(target.health).toBeGreaterThan(1);
      // The frame folded THROUGH the Weaken beat shows the target at 1 Health (it showed its full Health before).
      const at = result.events.indexOf(w) + 1;
      const frame = computeFrame(result.initial, result.events, at, at, new Map());
      expect(frame.enemy.find((u) => u.uid === w.source)!.health).toBe(1);
      // And the engine agrees: the first hit it takes leaves 1 - damage (floored at 0).
      const firstHit = result.events.slice(at).find((e): e is Extract<CombatEvent, { type: 'dmg' }> => e.type === 'dmg' && e.target === w.source);
      if (firstHit) expect(firstHit.remainingHp).toBe(Math.max(0, 1 - firstHit.amount));
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('an ENEMY seat\'s Weaken drops one of YOUR bodies to 1 on screen too (snapshot side)', () => {
    const p: BoardMinion[] = [{ cardId: 'drummer', attack: 1, health: 30 }];
    const e: BoardMinion[] = [{ cardId: 'drummer', attack: 1, health: 30 }];
    const r = simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 1 }), combatSide({ tier: 5, questMods: { weakenTargets: 1 } }));
    const w = weakenOf(r)[0]!;
    expect(r.initial.player.some((m) => m.uid === w.source)).toBe(true);
    const at = r.events.indexOf(w) + 1;
    expect(computeFrame(r.initial, r.events, at, at, new Map()).player[0]!.health).toBe(1);
    expect(socBoard(r)[0]!.health).toBe(1);
  });
});
