import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type MinionSnapshot } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { computeFrame, layoutRectOf } from './useCombatReplay';
import { deferClashBuffs } from './choreo/clashOrder';

const snap = (over: Partial<MinionSnapshot> & { uid: string; cardId: string }): MinionSnapshot => ({
  name: over.cardId, tribe: 'dragon', attack: 1, health: 1, keywords: [], golden: false, ...over,
});
const NAMES = new Map<string, string>();
const fold = (initial: { player: MinionSnapshot[]; enemy: MinionSnapshot[] }, events: CombatEvent[]) =>
  computeFrame(initial, events, events.length, 0, NAMES);

describe('computeFrame — ascend fold (live mid-combat transform)', () => {
  it('adopts the new form identity + keywords when an `ascend` event folds (player side)', () => {
    const initial = { player: [snap({ uid: 'p', cardId: 'tara', name: 'Tara', keywords: ['EG'] })], enemy: [] };
    // A stat buff lands on the same uid, then Tara ascends into Taragosa.
    const { player } = fold(initial, [
      { type: 'buff', target: 'p', attack: 2, health: 2, source: 'p' },
      { type: 'ascend', target: 'p', into: 'taragosa' },
    ] as CombatEvent[]);
    expect(player[0]!.cardId).toBe('taragosa'); // identity swapped live (not stuck at 'tara')
    expect(player[0]!.name).toBe('Taragosa');
    expect(player[0]!.attack).toBe(3); // the buff still landed on the same uid
    expect(player[0]!.keywords).toContain('EG'); // Taragosa's Engraved carries
  });

  it('folds an ascend on the ENEMY side too (true-PvP symmetry)', () => {
    const initial = { player: [], enemy: [snap({ uid: 'e', cardId: 'tara', name: 'Tara', keywords: ['EG'] })] };
    const { enemy } = fold(initial, [{ type: 'ascend', target: 'e', into: 'taragosa' }] as CombatEvent[]);
    expect(enemy[0]!.cardId).toBe('taragosa');
    expect(enemy[0]!.name).toBe('Taragosa');
  });
});

describe('computeFrame — Kennelmaster aura on multi-summon Deathrattles', () => {
  it('shows the +1/+1 on BOTH Deathrattle-summoned Pups in the replay frame (not just the first)', () => {
    const p: BoardMinion[] = [
      { cardId: 'kennel', attack: 1, health: 40 }, // SoC Beast aura +1/+1
      { cardId: 'pack', attack: 2, health: 1 },    // Mama Pup → two 1/1 Pups on death
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 40 }];
    const combat = simulate(p, e, makeRng(1), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast'] }), combatSide({ tier: 1 }));
    const events = deferClashBuffs(combat.events); // the exact transform the hook folds
    const pupUids = events.flatMap((ev) => (ev.type === 'summon' && ev.minion.cardId === 'pup' ? [ev.minion.uid] : []));
    expect(pupUids.length).toBe(2);
    // Fold to the beat right AFTER both Pups' aura buffs land (before combat chips them down).
    let cut = 0;
    events.forEach((ev, i) => { if (ev.type === 'buff' && pupUids.includes(ev.target)) cut = i + 1; });
    const { player } = computeFrame(combat.initial, events, cut, 0, new Map());
    const pups = player.filter((u) => pupUids.includes(u.uid));
    expect(pups.length).toBe(2);
    for (const pup of pups) {
      expect(pup.attack).toBe(2); // base 1 + Kennelmaster +1
      expect(pup.health).toBe(2);
    }
  });
});

// The layout-frame rule. A unit-marking FX (burst, pulse, dust, shatter) must land at the unit's SLOT, not
// wherever a lunge/knockback/pull-home has the card at that instant — anchoring to the live rect painted the
// "phantom mid-board ring" over empty board (owner clip 2026-07-21). gsap reads plain-object targets'
// properties directly, so a stub can stand in for a mid-flight element.
describe('layoutRectOf', () => {
  const stub = (over: Record<string, number> = {}) => ({
    getBoundingClientRect: () => ({ left: 100, top: 200, width: 134, height: 134 }),
    ...over,
  }) as unknown as Element;

  it('at rest, reports the plain centre', () => {
    const r = layoutRectOf(stub());
    expect(r.cx).toBe(167); // 100 + 134/2
    expect(r.cy).toBe(267); // 200 + 134/2
  });

  it('subtracts an in-flight GSAP offset — a lunging card still marks its slot', () => {
    const r = layoutRectOf(stub({ x: 40, y: -60 }));
    expect(r.cx).toBe(127); // 167 - 40
    expect(r.cy).toBe(327); // 267 + 60
  });

  it('de-scales the footprint so a mid-wind-up card does not over-size footprint FX', () => {
    const r = layoutRectOf(stub({ scaleX: 2, scaleY: 2 }));
    expect(r.w).toBe(67);
    expect(r.h).toBe(67);
  });
});
