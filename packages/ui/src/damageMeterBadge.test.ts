import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { computeFrame } from './useCombatReplay';
import { replayOrder } from './choreo/replayOrder';
import { compileMoments } from './choreo/compile';
import { stepProgress } from './cardText';

/**
 * THE LIVE DAMAGE-METER BADGE (owner ask 2026-09-19: *"show these minions' counter update in real time after
 * damage is dealt, even when it's the last minion in combat"*).
 *
 * The combat badge is `computeFrame`'s `damageDealt` — the sum of the `dmg` events stamped with the body as
 * `source`, folded through the END of the beat being cued (`processedEnd`), then read through `stepProgress`
 * exactly as the shop reads the run card. So the badge ticks on the beat the damage lands (the same moment the
 * damage number pops), one increment per hit, for EVERY marker in core's `DAMAGE_METER_MARKERS` — the fold used
 * to be gated on `dw3_hangover` alone, which is why Goldvein never moved in combat — and the `done` frame folds
 * the whole log, so the blow that ends the fight is on the badge too.
 */
const foe = (attack: number, health: number): BoardMinion =>
  ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
const body = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [], sourceUid: 'me', ...over } as unknown as BoardMinion;
};
const fight = (board: BoardMinion[], foes: BoardMinion[]) =>
  simulate(board, foes, makeRng(5), CARD_INDEX,
    combatSide({ tier: 6, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 6 }));

/** The badge readings, one per beat, as the replay would show them (the frame folded through each beat's end),
 *  plus the `done` frame at the end. */
function badgePerBeat(r: ReturnType<typeof simulate>, uid: string): (string | null)[] {
  const events = replayOrder(r.events);
  const beats = compileMoments(events);
  const names = new Map<string, string>();
  const readings: (string | null)[] = [];
  const read = (upto: number, beatStart: number): string | null => {
    const f = computeFrame(r.initial, events, upto, beatStart, names);
    const u = f.player.find((x) => x.uid === uid);
    if (!u) return null;
    const sp = stepProgress(u.cardId, { damageDealt: u.damageDealt });
    return sp ? `${sp.current}/${sp.total}` : null;
  };
  for (const b of beats) readings.push(read(b.end, b.start));
  readings.push(read(events.length, events.length)); // the `done` frame: whole log, dead dropped
  return readings;
}
const dmgBy = (events: readonly CombatEvent[], uid: string): number[] =>
  events.flatMap((e) => (e.type === 'dmg' && e.source === uid ? [e.amount] : []));

describe('the combat damage-meter badge ticks per landed hit, including the blow that ends the fight', () => {
  it('Goldvein (2 Attack): 0/6 → 2/6 → 4/6 → 6/6 as its three hits land — the third is the killing blow and the fight ends on it', () => {
    // Three 1-Health sandbags with 0 Attack: Goldvein swings three times (2 each), the last one ends the fight.
    const r = fight([body('k3_goldvein')], [foe(0, 1), foe(0, 1), foe(0, 1)]);
    const uid = r.initial.player[0]!.uid;
    expect(r.result).toBe('win');
    expect(dmgBy(r.events, uid)).toEqual([2, 2, 2]);
    const readings = badgePerBeat(r, uid);
    // Every distinct reading in order — the badge climbs monotonically and never skips a hit.
    const distinct = readings.filter((v, i) => i === 0 || v !== readings[i - 1]);
    expect(distinct).toEqual(['0/6', '2/6', '4/6', '6/6']);
    // The LAST blow's increment is on the `done` frame (what the end-of-combat sequence shows).
    expect(readings[readings.length - 1]).toBe('6/6');
  });

  it('Goldvein reads 6/6 (fired) for the rest of the fight — never a second lap — and the shop then reads 0/6', () => {
    const r = fight([body('k3_goldvein', { attack: 4 })], [foe(0, 1), foe(0, 1), foe(0, 1)]);
    const uid = r.initial.player[0]!.uid;
    expect(dmgBy(r.events, uid)).toEqual([4, 4, 4]);
    const readings = badgePerBeat(r, uid);
    const distinct = readings.filter((v, i) => i === 0 || v !== readings[i - 1]);
    expect(distinct).toEqual(['0/6', '4/6', '6/6']); // 4 → 8 → 12: clamped at 6/6 once it fired
    expect(r.playerBonusGold).toBe(3);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'me', total: 0 }]); // → the shop's 0/6
  });

  it('Han Gover (Pummel (40), once per combat): a seeded tally is ignored — 0/40 → 15/40 → 30/40 → 40/40 per hit, clamped once it fired; the shop then reads 0/40', () => {
    const r = fight([body('dw3_hangover', { attack: 15, damageDealt: 30 })], [foe(0, 1), foe(0, 1), foe(0, 1)]);
    const uid = r.initial.player[0]!.uid;
    expect(dmgBy(r.events, uid)).toEqual([15, 15, 15]);
    const readings = badgePerBeat(r, uid);
    const distinct = readings.filter((v, i) => i === 0 || v !== readings[i - 1]);
    expect(distinct).toEqual(['0/40', '15/40', '30/40', '40/40']); // 45 dealt: clamped at 40/40 once the Pummel fired
    expect(r.events.filter((e) => e.type === 'pummelTrigger')).toHaveLength(1);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'me', total: 0 }]); // → the shop's 0/40
  });

  it('a hit that never lands (a popped Ward) does not tick the badge', () => {
    const r = fight([body('k3_goldvein', { attack: 3 })], [{ ...foe(0, 3), keywords: ['DS'] } as BoardMinion]);
    const uid = r.initial.player[0]!.uid;
    const readings = badgePerBeat(r, uid);
    const distinct = readings.filter((v, i) => i === 0 || v !== readings[i - 1]);
    expect(distinct).toEqual(['0/6', '3/6']); // the Ward pops (0 dealt), then one real 3
  });
});
