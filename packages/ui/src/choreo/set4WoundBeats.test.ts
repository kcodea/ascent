import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { hitReactionStart, reactionTickStrideMs, reactionTicks, REACTION_TICK_MS } from './hitReactions';

/**
 * R-WOUND-01 PRESENTATION ORDER (owner 2026-10-13: "the hits should go out first on its own beat, then the buffs
 * following the hits should roll out after"), on the SAME machinery as the Demon-damage reactions (#2074): Eatah's
 * Echo puts its hits and their held reactions in ONE wave, hits first, so the replay's hit-reaction split gives the hits
 * their own beat and plays every reaction fire as its own tick on the shared stride; the +Health is a later wave.
 */
const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, keywords, sourceUid: uid } as unknown as BoardMinion);

describe('Set 4 self-damage beats', () => {
  it('the hit beat precedes the reaction beat, which ticks once per fire on the shared stride; the Health follows', () => {
    const p = [bm('b4_eatah', 'pe', 4, 1, ['T']), bm('b4_hawg', 'ph', 0, 3), bm('b4_apua', 'pa', 0, 3), bm('b4_alan', 'pl', 0, 6)];
    const r = simulate(p, [bm('sandbag', 'e0', 1, 200)], makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const eatah = r.initial.player[0]!.uid;
    const ev = r.events as CombatEvent[];
    const firstHit = ev.findIndex((e) => e.type === 'dmg' && e.source === eatah && e.amount === 1);
    expect(firstHit).toBeGreaterThan(-1);
    const wave = ev[firstHit]!.wave;
    // The wave's slice: the Echo's hits, then the held reactions.
    let start = firstHit, end = firstHit;
    while (start > 0 && ev[start - 1]!.wave === wave) start--;
    while (end < ev.length && ev[end]!.wave === wave) end++;
    const split = hitReactionStart(ev, start, end);
    expect(split, 'the wave splits into a hit beat and a reaction beat').toBeGreaterThan(firstHit);
    // Every Echo hit sits on the hit side of the split; every reaction buff on the reaction side.
    for (let i = start; i < end; i++) {
      const e = ev[i]!;
      if (e.type === 'dmg' && e.source === eatah) expect(i).toBeLessThan(split);
      if (e.type === 'buff') expect(i).toBeGreaterThanOrEqual(split);
    }
    // One tick per reaction fire: 3 Beasts hit, Apua and Alan answer each hit -> more than one tick, on the stride.
    const ticks = reactionTicks(ev, split, end);
    expect(ticks.length).toBeGreaterThan(1);
    expect(reactionTickStrideMs(ticks.length)).toBeLessThanOrEqual(REACTION_TICK_MS);
    // The +Health lands on a LATER wave than the hits.
    const mend = ev.findIndex((e, i) => i >= end && e.type === 'buff' && e.source === eatah && e.health === 1);
    expect(mend).toBeGreaterThan(-1);
    expect(ev[mend]!.wave).toBeGreaterThan(wave!);
  });
});
