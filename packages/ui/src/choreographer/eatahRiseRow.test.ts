import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { replayBeats, replayOrder } from '../choreo/replayOrder';
import { computeFrame } from '../useCombatReplay';

/**
 * EATAH IN COMBAT (owner report 2026-10-14: "eatah is doing really janky stuff in combat. the timing of everything is
 * bad and it janks the board around when it rises"). Eatah is "Taunt. Rise. Echo: Deal 1 damage to your Beasts and give
 * them +1 Health." Required presentation, no overlaps: its death beat, then the Echo's hits on their own beat, then the
 * reactions (Apua / Alan) one tick per fire, then the +Health, then the Rise. The dead Eatah's slot is HELD (a ghost)
 * through all of it, so the row never closes and reopens: no other minion moves.
 */
const bm = (cardId: string, attack: number, health: number, keywords: string[] = [], golden = false): BoardMinion =>
  ({ cardId, attack, health, keywords, golden } as unknown as BoardMinion);

function eatahFight(golden = false) {
  // Hawg | Eatah | Apua | Alan; one sandbag that kills Eatah on the first exchange (Taunt draws the swing).
  const p = [bm('b4_hawg', 1, 3), bm('b4_eatah', golden ? 8 : 4, 1, ['T', 'R'], golden), bm('b4_apua', 0, 3), bm('b4_alan', 0, 6)];
  const r = simulate(p, [bm('sandbag', 1, 200)], makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
  const events = r.events as CombatEvent[];
  const order = replayOrder(events);
  const moments = replayBeats(events);
  const eatah = r.initial.player[1]!.uid;
  return { r, order, moments, eatah };
}

/** What each moment IS, for the Eatah sequence: from its (Rise) death to its return. */
function sequence(golden = false) {
  const { r, order, moments, eatah } = eatahFight(golden);
  const di = moments.findIndex((m) => order.slice(m.start, m.end).some((e) => e.type === 'death' && e.target === eatah));
  const ri = moments.findIndex((m) => order.slice(m.start, m.end).some((e) => e.type === 'reborn' && e.target === eatah));
  expect(di).toBeGreaterThanOrEqual(0);
  expect(ri).toBeGreaterThan(di);
  const kind = (i: number): string => {
    const m = moments[i]!;
    const evs = order.slice(m.start, m.end);
    if (evs.some((e) => e.type === 'death' && e.target === eatah)) return 'death';
    if (evs.some((e) => e.type === 'reborn' && e.target === eatah)) return 'rise';
    if (evs.some((e) => e.type === 'dmg' && e.source === eatah)) return 'hits';
    if (m.hitReaction) return 'reactions';
    if (evs.some((e) => e.type === 'buff' && e.source === eatah)) return 'health';
    // The reactions to the CLASH that killed Eatah (Apua / Alan answering the lethal hit, the sandbag's own gain): the
    // shared clash presentation slides them after the exchange, so they read right after the death, before the Echo.
    if (evs.every((e) => e.type === 'buff' && e.wave === undefined)) return 'clash';
    return 'other';
  };
  const shape = moments.slice(di, ri + 1).map((_, k) => kind(di + k));
  return { r, order, moments, eatah, di, ri, shape };
}

describe('Eatah: death, Echo hits, reaction ticks, +Health, then Rise (owner 2026-10-14)', () => {
  for (const golden of [false, true]) {
    it(`${golden ? 'Gilded: ' : ''}the beat order is death (and its clash reactions), hits, reactions, Health${golden ? ' (twice)' : ''}, then the Rise`, () => {
      const { shape, moments, di, ri } = sequence(golden);
      const want = golden
        ? ['death', 'clash', 'hits', 'reactions', 'health', 'hits', 'reactions', 'health', 'rise']
        : ['death', 'clash', 'hits', 'reactions', 'health', 'rise'];
      expect(shape).toEqual(want);
      const react = moments.slice(di, ri).find((m) => m.hitReaction)!;
      expect(react.ticks ?? 1, 'the reactions play one tick per fire').toBeGreaterThan(1);
    });

    it(`${golden ? 'Gilded: ' : ''}the row never reflows: every frame from the death to the Rise keeps the same slots`, () => {
      const { r, order, moments, di, ri } = sequence(golden);
      const names = new Map<string, string>();
      const initialRow = r.initial.player.map((m) => m.uid);
      for (let i = di; i <= ri; i++) {
        const m = moments[i]!;
        // The frame the beat ENDS on, and the one it starts from: both must keep every slot where it was.
        for (const upto of [m.start, m.end]) {
          const row = computeFrame(r.initial, order, upto, m.start, names).player.map((u) => u.uid);
          expect(row, `beat ${i - di} (${upto === m.start ? 'start' : 'end'}) keeps the row`).toEqual(initialRow);
        }
      }
    });
  }
});
