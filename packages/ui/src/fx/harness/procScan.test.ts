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

  // The index is what `seekTo` consumes, so it must be an index into the MOMENT list, not into the event
  // log. Those two domains coincide whenever every event is its own moment, which makes an off-by-domain
  // bug invisible — so this fixture deliberately collapses several events into one moment, making the
  // moment index strictly smaller than the event index it came from.
  it('returns indices into the moment list, not into the event log', async () => {
    const { compileMoments } = await import('../../choreo/compile');
    const collapsing = [
      { type: 'attack', attacker: 'p1', defender: 'e1', step: 1 },
      { type: 'dmg', target: 'e1', amount: 1, step: 1 },
      { type: 'dmg', target: 'p1', amount: 1, step: 1 },
      { type: 'sc', source: 'p1', text: 'bleeds', cast: true, step: 2 },
    ] as unknown as CombatEvent[];
    const c = combatOf([snap('p1', 'bloodbinder')], [snap('e1', 'sandbag')], collapsing);
    const moments = compileMoments(collapsing);
    // Guard the fixture itself: if grouping ever changes so nothing collapses, this test silently stops
    // testing what it claims, exactly like the version it replaces.
    expect(moments.length).toBeLessThan(collapsing.length);

    const procs = scanProcs(c, 'bloodbinder');
    expect(procs.length).toBeGreaterThan(0);
    for (const p of procs) {
      expect(p.index).toBeGreaterThanOrEqual(0);
      expect(p.index).toBeLessThan(moments.length);
      // The moment at this index must be the one whose actor really is our card.
      expect(actingUid(moments[p.index].primary)).toBe(p.sourceUid);
    }
  });

  // The whole point of surfacing `boundDef` is that "no effect here yet" is VISIBLE rather than
  // something you discover by watching nothing happen.
  it('reports the bound def, and null where nothing is bound', () => {
    const procs = scanProcs(combat, 'bloodbinder');
    const cast = procs.find((p) => p.kind === 'scCast');
    expect(cast?.boundDef).toBe('ruby-lance'); // bloodbinder's per-card binding
    const sandbag = scanProcs(combat, 'sandbag').find((p) => p.kind === 'attackExchange');
    expect(sandbag?.boundDef).toBe('self-buff-burst'); // attackExchange's kind-level binding (owner-authored 2026-09-02)
  });

  it('returns an empty array — not a throw — for a card that never acted', () => {
    expect(scanProcs(combat, 'nothere')).toEqual([]);
  });
});

// `useCombatReplay` doesn't walk the raw log — it walks `replayOrder(combat.events)` (deferClashBuffs, then
// deferAvengeAfterSummons), which reorders events for presentation and thereby moves `compileMoments`'s
// grouping boundaries. If `scanProcs` compiled the raw log instead, its indices would address a DIFFERENT
// moment list than the one `seekTo` actually walks — a proc row would seek to an unrelated (or nonexistent)
// beat. This is not hypothetical: a Target Dummy-style self-buff is exactly the case `deferClashBuffs` exists
// for, and `self-buff-gold` is one of only two effects the harness currently binds.
describe("scanProcs compiles the REPLAY's event order, not the raw log", () => {
  // The sim emits a clash-inline self-buff as `dmg(defender) · buff(defender) · dmg(attacker-retaliation)`
  // (see `clashOrder.ts`'s own doc comment for why). `replayOrder` slides the buff to the clash's tail, which
  // merges the two `dmg`s into one impact moment. Two such clashes back to back make raw vs. reordered
  // disagree about more than one moment's worth of offset, so a bug that reads the raw log doesn't just
  // point one moment off — it can point PAST the end of the real (reordered) moment list entirely.
  const clash = (): CombatEvent[] => ([
    { type: 'attack', attacker: 'p1', defender: 'e1', step: 1 },
    { type: 'dmg', target: 'e1', amount: 1, step: 1 },
    { type: 'buff', target: 'e1', source: 'e1', attack: 1, health: 0, step: 1 },
    { type: 'dmg', target: 'p1', amount: 1, step: 1 },
  ] as unknown as CombatEvent[]);
  const events = [...clash(), ...clash()];
  const combat = combatOf([snap('p1', 'bloodbinder')], [snap('e1', 'sandbag')], events);

  it('the fixture really does reorder, and the moment COUNT genuinely differs (sanity check)', async () => {
    const { compileMoments } = await import('../../choreo/compile');
    const { replayOrder } = await import('../../choreo/replayOrder');
    const reordered = replayOrder(events);
    expect(reordered).not.toEqual(events);
    // Raw compiles each clash into 4 moments (attack, e1's dmg, the buff, p1's dmg); reordered merges the
    // two dmgs into one impact moment, so each clash compiles to 3. If this ever stops being true, the
    // fixture has stopped exercising the bug it was built to catch.
    expect(compileMoments(events).length).toBe(8);
    expect(compileMoments(reordered).length).toBe(6);
  });

  it("scanProcs's indices land in the REORDERED moment list — where seekTo actually looks", async () => {
    const { replayBeats } = await import('../../choreo/replayOrder');
    // The oracle here is `replayBeats` itself — the SAME function `scanProcs` and `useCombatReplay` both call
    // — not a locally re-composed `compileMoments(replayOrder(...))`. Composing it locally would let this
    // test keep passing even if `scanProcs` (or `useCombatReplay`) reverted to its own inline composition,
    // which is exactly the drift `replayBeats` exists to make impossible.
    const reorderedMoments = replayBeats(events);

    const procs = scanProcs(combat, 'sandbag');
    const buffProcs = procs.filter((p) => p.sourceUid === 'e1');
    expect(buffProcs.length).toBe(2); // one self-buff per clash

    for (const p of buffProcs) {
      // Compiling the RAW log instead puts the second clash's buff at index 6 — past the end of the real
      // (reordered) 6-moment list (indices 0–5) — which this bounds check alone would have caught.
      expect(p.index).toBeLessThan(reorderedMoments.length);
      expect(reorderedMoments[p.index]!.primary.type).toBe('buff');
      expect(actingUid(reorderedMoments[p.index]!.primary)).toBe('e1');
    }
  });
});
