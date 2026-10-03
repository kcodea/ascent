import { describe, expect, it } from 'vitest';
import { DAMAGE_METER_DOS, combatSide, damageMeterOf, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import type { BoardCard } from '@game/sim';
import { stepProgress } from './cardText';
import { instView } from './instView';
import { computeFrame } from './useCombatReplay';
import { replayOrder } from './choreo/replayOrder';
import { compileMoments } from './choreo/compile';

/**
 * R-PUMMEL-BADGE-01 (fix 2026-10-03, owner "yes"): EVERY Pummel card shows its live `n/X` progress badge, in the
 * shop AND in combat.
 *
 * The bug: `stepProgress` (cardText.ts) gated the badge on a HAND-KEPT list of damage-meter factory ids that
 * named three of core's four `DAMAGE_METER_MARKERS` and silently dropped Kobe's `dealtDamageGetRandomRuby`, so
 * Kobe's badge never showed on any surface. The gate now derives from core's registry (`damageMeterOf`). This
 * file guards that from BOTH ends, re-deriving its worklist every run so no new Pummel can slip past it:
 *   - every card whose printed text says "Pummel (X)" carries a registered meter with that same X;
 *   - every registered marker is used by at least one card;
 *   - every such card's badge reads `total mod X` through the shop chain (`instView`) and the combat chain
 *     (`computeFrame` -> `stepProgress`).
 */
const PUMMEL_TEXT = /\bPummel \((\d+)\)/;
const pummelCards = Object.values(CARD_INDEX)
  .filter((c) => !!c && PUMMEL_TEXT.test(c.text))
  .map((c) => c!);

describe('R-PUMMEL-BADGE-01: every Pummel card shows its progress badge', () => {
  it('found the known Pummel roster (the derivation must not go blind)', () => {
    const ids = pummelCards.map((c) => c.id);
    for (const id of ['dw3_hangover', 'k3_goldvein', 'ce3_starcharter', 'k_kobe']) expect(ids).toContain(id);
  });

  it('every printed "Pummel (X)" carries a registered damage meter with the same X', () => {
    const missing: string[] = [];
    for (const c of pummelCards) {
      const x = Number(PUMMEL_TEXT.exec(c.text)![1]);
      const meter = damageMeterOf(c);
      if (!meter) missing.push(`${c.id} (${c.name}): prints Pummel (${x}) but no DAMAGE_METER_MARKERS effect`);
      else if (meter.every !== x) missing.push(`${c.id} (${c.name}): prints Pummel (${x}) but its meter counts to ${meter.every}`);
    }
    expect(missing).toEqual([]);
  });

  it('every registered damage-meter marker is used by a card', () => {
    const unused = DAMAGE_METER_DOS.filter((d) => !Object.values(CARD_INDEX).some((c) => c?.effects.some((e) => e.do === d)));
    expect(unused).toEqual([]);
  });

  it('SHOP: every Pummel card on the board shows `total mod X`, including a fresh 0/X', () => {
    const blind: string[] = [];
    for (const c of pummelCards) {
      const x = damageMeterOf(c)!.every;
      for (const dealt of [0, x - 1, x + 3]) {
        const inst = { uid: `u_${c.id}`, cardId: c.id, attack: c.attack, health: c.health, keywords: [], damageDealt: dealt } as unknown as BoardCard;
        const sp = instView(inst, 1, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { onBoard: true }).stepProgress;
        const want = `${dealt % x}/${x}`;
        const got = sp ? `${sp.current}/${sp.total}` : 'none';
        if (got !== want) blind.push(`${c.id} at ${dealt}: shop badge ${got}, want ${want}`);
      }
    }
    expect(blind).toEqual([]);
  });

  it('COMBAT: Kobe\'s badge ticks per landed hit (0/15 -> 5/15 -> 10/15 -> 0/15) and every Pummel card reads its meter', () => {
    const foe = { cardId: 'sandbag', attack: 0, health: 1, keywords: [] } as unknown as BoardMinion;
    const d = CARD_INDEX['k_kobe']!;
    const kobe = { cardId: 'k_kobe', attack: d.attack, health: d.health, keywords: [], sourceUid: 'me' } as unknown as BoardMinion;
    const r = simulate([kobe], [foe, foe, foe], makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, poolIds: poolFor('set2').all.map((c) => c.id) }), combatSide({ tier: 6 }));
    const uid = r.initial.player[0]!.uid;
    const events = replayOrder(r.events);
    const names = new Map<string, string>();
    const read = (upto: number, start: number): string => {
      const u = computeFrame(r.initial, events, upto, start, names).player.find((x) => x.uid === uid);
      const sp = u ? stepProgress(u.cardId, { damageDealt: u.damageDealt }) : null;
      return sp ? `${sp.current}/${sp.total}` : 'none';
    };
    const readings = [read(0, 0), ...compileMoments(events).map((b) => read(b.end, b.start)), read(events.length, events.length)];
    const distinct = readings.filter((v, i) => i === 0 || v !== readings[i - 1]);
    expect(distinct).toEqual(['0/15', '5/15', '10/15', '0/15']);

    // Every Pummel card: the combat chain (`stepProgress` fed a frame's `damageDealt`) reads its meter.
    const blind = pummelCards.filter((c) => {
      const x = damageMeterOf(c)!.every;
      const sp = stepProgress(c.id, { damageDealt: x + 2 });
      return !sp || sp.current !== 2 || sp.total !== x;
    }).map((c) => c.id);
    expect(blind).toEqual([]);
  });
});
