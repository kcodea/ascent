import { describe, expect, it } from 'vitest';
import type { CombatEvent, CombatResult, MinionSnapshot } from '@game/core';
import { actingUid, scanProcs, uidsForCard } from './procScan';

/** A minimal snapshot — only the fields procScan reads. */
const snap = (uid: string, cardId: string): MinionSnapshot =>
  ({ uid, cardId, name: cardId, tribe: 'neutral', attack: 1, health: 1, keywords: [] }) as MinionSnapshot;

/** A CombatResult carrying only what procScan touches. */
const combatOf = (player: MinionSnapshot[], enemy: MinionSnapshot[], events: CombatEvent[]): CombatResult =>
  ({ initial: { player, enemy }, events } as unknown as CombatResult);

describe('uidsForCard', () => {
  it('finds a card on either starting board', () => {
    const c = combatOf([snap('p1', 'bloodbinder')], [snap('e1', 'bloodbinder')], []);
    expect([...uidsForCard(c, 'bloodbinder')].sort()).toEqual(['e1', 'p1']);
  });

  // A unit summoned mid-fight never appears in `initial`, so a scan that only reads the starting
  // rosters silently misses every moment it caused.
  it('finds an instance summoned mid-combat', () => {
    const events = [
      { type: 'summon', minion: snap('s1', 'imp'), side: 'player', index: 0 },
    ] as unknown as CombatEvent[];
    const c = combatOf([snap('p1', 'bloodbinder')], [], events);
    expect([...uidsForCard(c, 'imp')]).toEqual(['s1']);
  });

  it('returns empty for a card that was never in the fight', () => {
    const c = combatOf([snap('p1', 'bloodbinder')], [], []);
    expect(uidsForCard(c, 'nothere').size).toBe(0);
  });
});

describe('actingUid', () => {
  it('reads an attack from its attacker, not its defender', () => {
    expect(actingUid({ type: 'attack', attacker: 'a', defender: 'b' } as CombatEvent)).toBe('a');
  });

  it('reads every other event from its source', () => {
    expect(actingUid({ type: 'sc', source: 'a', text: 'x' } as unknown as CombatEvent)).toBe('a');
  });

  // A `dmg` carries only a target — the unit that was HIT. Attributing it to the target would credit
  // every moment to the victim.
  it('returns null when the event names no actor', () => {
    expect(actingUid({ type: 'dmg', target: 'b', amount: 1 } as unknown as CombatEvent)).toBeNull();
  });
});

describe('scanProcs', () => {
  const events = [
    { type: 'sc', source: 'p1', text: 'bleeds', cast: true, step: 1 },
    { type: 'dmg', target: 'e1', amount: 3, step: 1 },
    { type: 'attack', attacker: 'e1', defender: 'p1', step: 2 },
  ] as unknown as CombatEvent[];
  const combat = combatOf([snap('p1', 'bloodbinder')], [snap('e1', 'sandbag')], events);

  it('finds the moments the card acted in, and none it did not', () => {
    const procs = scanProcs(combat, 'bloodbinder');
    expect(procs.length).toBeGreaterThan(0);
    expect(procs.every((p) => p.sourceUid === 'p1')).toBe(true);
  });

  it('attributes the enemy attack to the enemy card, not ours', () => {
    expect(scanProcs(combat, 'sandbag').some((p) => p.kind === 'attackExchange')).toBe(true);
    expect(scanProcs(combat, 'bloodbinder').some((p) => p.kind === 'attackExchange')).toBe(false);
  });

  // The index is what `seekTo` consumes — if it isn't a valid index into the compiled moments the
  // harness seeks to the wrong beat, or throws.
  it('returns indices that are real positions in the compiled moment list', async () => {
    const { compileMoments } = await import('../../choreo/compile');
    const total = compileMoments(events).length;
    for (const p of scanProcs(combat, 'bloodbinder')) {
      expect(p.index).toBeGreaterThanOrEqual(0);
      expect(p.index).toBeLessThan(total);
    }
  });

  // The whole point of surfacing `boundDef` is that "no effect here yet" is VISIBLE rather than
  // something you discover by watching nothing happen.
  it('reports the bound def, and null where nothing is bound', () => {
    const procs = scanProcs(combat, 'bloodbinder');
    const cast = procs.find((p) => p.kind === 'scCast');
    expect(cast?.boundDef).toBe('ruby-lance'); // bloodbinder's per-card binding
    const sandbag = scanProcs(combat, 'sandbag').find((p) => p.kind === 'attackExchange');
    expect(sandbag?.boundDef).toBe('self-buff-gold'); // attackExchange's kind-level binding
  });

  it('returns an empty array — not a throw — for a card that never acted', () => {
    expect(scanProcs(combat, 'nothere')).toEqual([]);
  });
});
