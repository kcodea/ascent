import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatSideState } from '@game/core';
import { replayBeats, replayOrder } from '../choreo/replayOrder';
import type { Moment } from '../choreo/compile';
import { holdMs } from '../choreo/clock';
import {
  CHAIN_RIBBON_BUDGET, HIT_REACTION_LEAD_MS, HIT_REACTION_READ_MS, REACTION_CHAIN_CAP_MS, REACTION_TICK_MS,
  chainEligible, chainTendrilPlan, reactionChainMs, reactionTickStrideMs, reactionTicks,
} from '../choreo/hitReactions';

/**
 * R-DEMON-DMG-BEATS-02 (owner 2026-10-13): "every trigger of the effect should get its own beat, like every volley from
 * fel spikes, every rally trigger from gasket. the buffs should per tick if possible." / "the whole pass i think so it
 * doesnt take forever to show and look kinda goofy" / "the dragonflame animation seems like it's perfect already".
 *
 *   1. The reaction beat survives every reactor shape (Impossible Todd's Imp aura, Rune of Ruins' pulse), where it used
 *      to fold back into the pass and snap in at the next beat.
 *   2. A pass still lands whole; its reactions then play ONE TICK PER LANDED HIT, and the clock holds for the chain.
 *   3. Dragonflame's swing is untouched.
 */
const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], ...extra });
const wall = (n: number, hp = 40): BoardMinion[] => Array.from({ length: n }, () => bm('trainingdummy', 0, hp));
const fight = (p: BoardMinion[], e: BoardMinion[], seed = 7, pSide: Partial<CombatSideState> = {}) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, ...pSide }), combatSide({ tier: 6 }));
const evOf = (events: CombatEvent[], m: Moment) => events.slice(m.start, m.end);
const gasket = (golden = false) => bm('dm_gasket', 7, 3, { keywords: ['RL'], golden });
const RACHEL = 'factory:onFriendlyDemonDamageBuffTribe:friendlyDemonDealtDamage';

/** The swing's beats after its wind-up: each pass, its reaction, …, up to the strike. */
function afterSwing(events: CombatEvent[], attacker = 'm0') {
  const order = replayOrder(events);
  const moments = replayBeats(events);
  const ai = moments.findIndex((m) => m.primary.type === 'attack' && m.primary.attacker === attacker);
  expect(ai).toBeGreaterThanOrEqual(0);
  return { order, moments, ai };
}
const landedHits = (order: CombatEvent[], m: Moment) => evOf(order, m).filter((e) => e.type === 'dmg').length;

describe('the reaction beat survives every reactor (the dropped-beat bug)', () => {
  it('Gasket + Rachel + Impossible Todd: the Imp aura no longer folds the reactions into the pass', () => {
    const { order, moments, ai } = afterSwing(fight([gasket(), bm('dm_radrachel', 0, 40), bm('dm_todd', 0, 40), bm('trainingdummy', 0, 40)], wall(7)).events);
    const pass = moments[ai + 1]!;
    const react = moments[ai + 2]!;
    expect(pass.primary.wave).toBeDefined();
    expect(evOf(order, pass).some((e) => e.type === 'buff' || e.type === 'tribeAura'), 'the pass is the volley only').toBe(false);
    expect(react.hitReaction).toBe(true);
    expect(react.kind, 'scored as a buff wave, so its tendrils play').toBe('buffWave');
    expect(evOf(order, react).some((e) => e.type === 'tribeAura'), 'Todd\'s aura rides the reaction beat').toBe(true);
  });

  it('Gasket + Rachel + Rune of Ruins: Rachel\'s buffs are in the reaction beat, not the pass', () => {
    const { order, moments, ai } = afterSwing(fight([gasket(), bm('dm_radrachel', 0, 40), bm('trainingdummy', 0, 40)], wall(5), 7, { questMods: { runeRuins: true } }).events);
    expect(evOf(order, moments[ai + 1]!).some((e) => e.type === 'buff'), 'no buff left in the pass').toBe(false);
    const react = moments[ai + 2]!;
    expect(react.hitReaction).toBe(true);
    expect(evOf(order, react).some((e) => e.type === 'buff' && e.key === RACHEL)).toBe(true);
  });

  it('Fel Spikes Echo + Rachel + Todd: the volley splits off its reaction too', () => {
    const r = fight([bm('dm_felspikes', 0, 1, { keywords: ['T'] }), bm('dm_radrachel', 0, 40), bm('dm_todd', 0, 40), bm('trainingdummy', 0, 40)],
      [bm('trainingdummy', 5, 40), ...wall(6)], 3);
    const order = replayOrder(r.events);
    const moments = replayBeats(r.events);
    const pi = moments.findIndex((m) => m.primary.wave !== undefined);
    expect(pi).toBeGreaterThanOrEqual(0);
    expect(evOf(order, moments[pi]!).some((e) => e.type === 'buff' || e.type === 'tribeAura')).toBe(false);
    expect(moments[pi + 1]!.hitReaction).toBe(true);
  });

  it('the reorder only moves events WITHIN a pass, so the folded frame is unchanged', () => {
    const r = fight([gasket(true), bm('dm_radrachel', 0, 40), bm('dm_todd', 0, 40), bm('dm_leech', 0, 40)], wall(7));
    const order = replayOrder(r.events);
    expect(order.length).toBe(r.events.length);
    const key = (e: CombatEvent) => JSON.stringify(e);
    const byWave = (evs: CombatEvent[]) => {
      const m = new Map<string, string[]>();
      evs.forEach((e) => { const w = String(e.wave ?? 'none'); m.set(w, [...(m.get(w) ?? []), key(e)]); });
      for (const v of m.values()) v.sort();
      return m;
    };
    expect(byWave(order)).toEqual(byWave(r.events));
  });
});

describe('one tick per trigger fire, the pass still whole (R-DEMON-DMG-BEATS-02)', () => {
  it('Gasket + Rachel: the reaction beat plays one tick per LANDED HIT, each tick +2/+1 to every friend', () => {
    const { order, moments, ai } = afterSwing(fight([gasket(), bm('dm_radrachel', 0, 40), bm('trainingdummy', 0, 40), bm('trainingdummy', 0, 40)], wall(7)).events);
    const pass = moments[ai + 1]!;
    const react = moments[ai + 2]!;
    const hits = landedHits(order, pass);
    expect(hits).toBeGreaterThan(1);
    expect(react.ticks, 'one tick per landed Demon hit').toBe(hits);
    const ticks = reactionTicks(order, react.start, react.end);
    expect(ticks.length).toBe(hits);
    for (const t of ticks) {
      const buffs = order.slice(t.start, t.end).filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff');
      expect(buffs.every((b) => b.attack === 2 && b.health === 1), 'each tick is ONE Rachel fire').toBe(true);
      expect(new Set(buffs.map((b) => b.target)).size).toBe(buffs.length);
    }
  });

  it('Gilded Gasket + Rachel + Ruinous Lord: every pass is its own beat, each reaction one tick per hit (both reactors in a tick)', () => {
    const { order, moments, ai } = afterSwing(fight([gasket(true), bm('dm_radrachel', 0, 40), bm('dm_ruinouslord', 0, 40), bm('trainingdummy', 0, 40)], wall(7)).events);
    const shape = moments.slice(ai + 1, ai + 5).map((m) => (m.hitReaction ? 'react' : m.primary.wave !== undefined ? 'pass' : 'other'));
    expect(shape).toEqual(['pass', 'react', 'pass', 'react']);
    for (const k of [1, 3]) {
      const hits = landedHits(order, moments[ai + k]!);
      const react = moments[ai + k + 1]!;
      expect(react.ticks).toBe(hits);
      for (const t of reactionTicks(order, react.start, react.end)) {
        const srcs = new Set(order.slice(t.start, t.end).flatMap((e) => (e.type === 'buff' ? [e.source] : [])));
        expect(srcs, 'Rachel and the Lord fire together on each hit').toEqual(new Set(['m1', 'm2']));
      }
    }
  });

  it('the clock holds the reaction for its whole chain, and the hold GROWS with the number of fires', () => {
    const few = afterSwing(fight([gasket(), bm('dm_radrachel', 0, 40)], wall(2)).events);
    const many = afterSwing(fight([gasket(), bm('dm_radrachel', 0, 40), bm('trainingdummy', 0, 40), bm('trainingdummy', 0, 40)], wall(7)).events);
    const holdAfter = (x: typeof few) => holdMs(x.moments[x.ai + 3]!, x.moments[x.ai + 2]!, 1);
    const nFew = few.moments[few.ai + 2]!.ticks!;
    const nMany = many.moments[many.ai + 2]!.ticks!;
    expect(nMany).toBeGreaterThan(nFew);
    expect(holdAfter(few)).toBeGreaterThanOrEqual(reactionChainMs(nFew));
    expect(holdAfter(many)).toBeGreaterThanOrEqual(reactionChainMs(nMany));
    expect(holdAfter(many)).toBeGreaterThan(holdAfter(few));
    // The reaction still starts right after its pass, and the hold is speed-scaled.
    expect(holdMs(many.moments[many.ai + 2]!, many.moments[many.ai + 1]!, 1)).toBe(HIT_REACTION_LEAD_MS);
    expect(holdMs(many.moments[many.ai + 3]!, many.moments[many.ai + 2]!, 2)).toBe(holdAfter(many) / 2);
  });

  it('the tick constants: 160 ms a tick, the chain capped at 1.6 s, one tick = the old single read', () => {
    expect(REACTION_TICK_MS).toBe(160);
    expect(REACTION_CHAIN_CAP_MS).toBe(1600);
    expect(reactionChainMs(1)).toBe(HIT_REACTION_READ_MS);
    expect(reactionChainMs(5)).toBe(4 * 160 + HIT_REACTION_READ_MS);
    expect(reactionTickStrideMs(30) * 29).toBeLessThanOrEqual(REACTION_CHAIN_CAP_MS + 1e-9);
    expect(reactionChainMs(30)).toBeCloseTo(REACTION_CHAIN_CAP_MS + HIT_REACTION_READ_MS);
  });

  it('the tendril plan stays inside the perf budget: every tick when the ribbons fit, else the full fan once', () => {
    // A cleaving Demon (3 hits) with Rachel + Leech: 2 tendrils a tick → every tick draws.
    expect(chainTendrilPlan([2, 2, 2], 160)).toEqual({ everyTick: true, intensity: 1 });
    // A full Gasket pass with Rachel + the Lord (7 ticks x 10 tendrils): the first tick only, at full strength,
    // which is exactly the fan one summed beat drew before.
    const wide = chainTendrilPlan(Array(7).fill(10), 160);
    expect(wide.everyTick).toBe(false);
    expect(wide.intensity).toBe(1);
    // Whatever draws, the ribbons alive at once never exceed the budget (or one tick's fan).
    for (const [n, w] of [[2, 3], [3, 4], [5, 6], [9, 10], [13, 12]] as const) {
      const p = chainTendrilPlan(Array(n).fill(w), reactionTickStrideMs(n));
      const alive = Math.min(n, Math.ceil(1070 / reactionTickStrideMs(n)));
      expect(p.everyTick ? w * alive : w).toBeLessThanOrEqual(Math.max(CHAIN_RIBBON_BUDGET, w));
    }
  });

  it('a melee Demon hit is one fire: one tick, the reaction beat exactly as before', () => {
    const r = fight([bm('dm_radrachel', 8, 40), bm('dm_leech', 0, 40), bm('trainingdummy', 0, 40)], wall(3));
    const moments = replayBeats(r.events);
    const ai = moments.findIndex((m) => m.primary.type === 'attack' && m.primary.attacker === 'm0');
    const react = moments[ai + 2]!;
    expect(react.kind).toBe('buffWave');
    expect(react.ticks).toBeUndefined();
    expect(holdMs(react, moments[ai + 1]!, 1)).toBe(210);
  });
});

describe('Dragonflame is the reference and does not change (owner 2026-10-13)', () => {
  it('a Flamebeat swing (+ Flamus, + Earthbreaker) keeps its one absorbed wind-up beat, no chain, the same holds', () => {
    for (const golden of [false, true]) {
      const r = fight([bm('d2_flamebeat', 6, 50, { keywords: ['RL'], golden }), bm('d2_warflame', 0, 50, { golden }), bm('d2_scalechanter', 0, 50), bm('d2_riverdrake', 0, 50)], wall(7, 80));
      const { order, moments, ai } = afterSwing(r.events);
      const swing = moments[ai]!;
      expect(swing.kind).toBe('attackExchange');
      expect(evOf(order, swing).filter((e) => e.type === 'spellcast').length, 'every cast rides the wind-up').toBe(golden ? 4 : 2);
      expect(evOf(order, swing).some((e) => e.type === 'dmg'), 'the strike is the next beat').toBe(false);
      expect(chainEligible(order, swing.start, swing.end), 'a cast is never chained').toBe(false);
      expect(moments.every((m) => m.ticks === undefined || m.hitReaction), 'no Dragonflame beat is a chain').toBe(true);
      expect(moments[ai + 1]!.kind).toBe('damage');
      expect(holdMs(moments[ai + 1]!, swing, 1)).toBe(690);
      expect(holdMs(moments[ai + 2]!, moments[ai + 1]!, 1)).toBe(500);
    }
  });
});
