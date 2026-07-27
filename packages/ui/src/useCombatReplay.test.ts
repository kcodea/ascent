import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type MinionSnapshot } from '@game/core';
import { compileMoments } from './choreo/compile';
import { CARD_INDEX } from '@game/content';
import { computeFrame, grantsShownThrough, layoutRectOf } from './useCombatReplay';
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
  it('shows the Kennelmaster Attack aura on BOTH Deathrattle-summoned Pups in the replay frame (not just the first)', () => {
    const p: BoardMinion[] = [
      { cardId: 'kennel', attack: 1, health: 40 }, // SoC Beast aura, Attack-only
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
      expect(pup.attack).toBe(3); // base 1 + Kennelmaster +2 Attack (owner rebalance 2026-07-25)
      expect(pup.health).toBe(1); // Health untouched — the aura is Attack-only
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

/* WHEN a combat grant shows up in hand. The card must materialise on the beat its effect PROCS — the same
   moment as the purple Deathrattle skull — because that beat is what the coalesce is announcing (owner ask
   2026-07-27). This used to slice to the current beat's `start`, i.e. strictly BEFORE it, which put every
   grant a beat late and made a grant on the LAST beat invisible for the whole replay. */
describe('grantsShownThrough — a combat grant appears ON its own beat', () => {
  it('a real Deathrattle grant is shown at the beat that emits it, not the one after', () => {
    // Scrap Vendor dies early and its Deathrattle grants a Patch Job.
    const p: BoardMinion[] = [
      { cardId: 'scrapvendor', attack: 3, health: 1 },
      { cardId: 'sandbag', attack: 1, health: 40 },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 40 }];
    const combat = simulate(p, e, makeRng(1), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const events = deferClashBuffs(combat.events);
    const beats = compileMoments(events);
    const grantBeat = beats.findIndex((b) => events.slice(b.start, b.end).some((ev) => ev.type === 'toHand'));
    expect(grantBeat).toBeGreaterThanOrEqual(0);
    expect(grantsShownThrough(events, beats, grantBeat)).toContain('patchjob');       // ON the beat
    expect(grantsShownThrough(events, beats, grantBeat - 1)).not.toContain('patchjob'); // not before it
  });

  it('a grant on the FINAL beat is still shown during the replay', () => {
    // The regression that left the owner seeing the coalesce only after combat: the last minion dies, its
    // Deathrattle grants, the fight ends — slicing to `start` never reached that beat's events.
    const events = [
      { type: 'attack', attacker: 'a', defender: 'b' },
      { type: 'death', uid: 'a' },
      { type: 'toHand', cardId: 'patchjob', side: 'player' },
    ] as CombatEvent[];
    const beats = compileMoments(events);
    expect(grantsShownThrough(events, beats, beats.length - 1)).toEqual(['patchjob']);
  });
});
