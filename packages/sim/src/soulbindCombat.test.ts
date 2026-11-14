/**
 * Sable's Soulbind must carry THROUGH the fight it was forged for.
 *
 * The bond stores the two RUN-BOARD uids. A combat minion is a fresh clone with its own uid (`m0`, `m1`, …)
 * that keeps the board uid as `sourceUid` — so the mirror's `m.uid === bond.a` lookup never matched once
 * combat began, and the bond silently did nothing for the whole fight (owner report 2026-08-21: "it should
 * carry through combat, so any stats gained in combat also work for the 2 linked minions"). Verified before
 * the fix by comparing buff logs with and without a bond: byte-identical.
 *
 * "Resets after combat" needs no separate mechanism — the bond records the wave it was forged on and
 * `questCombatMods` only threads it in while `bond.wave === run.wave`, so it expires at the turn rollover.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef } from '@game/core';
import { CARD_INDEX } from '@game/content';

/** A test-only Start of Combat Beast aura (+1 Attack to every Beast, the `scBeastAura` shape Kennelmaster had until its
 *  2026-11-14 rework): a deterministic in-combat stat gain on BOTH bound bodies. */
const SC_BEAST: CardDef = {
  id: 'test_sc_beast', name: 'Test Pack Leader', tribe: 'beast', tier: 2, attack: 2, health: 20, keywords: ['SC'],
  effects: [{ on: 'startOfCombat', do: 'scBeastAura', params: { tribe: 'beast', attack: 1, health: 0, stepAttack: 1, stepHealth: 0 } }],
  text: '**Start of Combat:** Give all Friendly and summoned Beasts **+1 Attack**.',
};
const CARDS: Record<string, CardDef> = { ...CARD_INDEX, [SC_BEAST.id]: SC_BEAST };

/** Two bound Beasts plus the test aura, plus Packstrider's Rally on itself for an asymmetric gain. */
const board = (): BoardMinion[] => ([
  { cardId: 'b2_packstrider', attack: 2, health: 20, sourceUid: 'A', keywords: [] },
  { cardId: 'b2_wolvie', attack: 2, health: 20, sourceUid: 'B', keywords: [] },
  { cardId: 'test_sc_beast', attack: 2, health: 20, sourceUid: 'K', keywords: [] },
] as never[]);

const fight = (soulbind?: { a: string; b: string }) => simulate(
  board(), [{ cardId: 'sandbag', attack: 0, health: 500 }] as never[], makeRng(7), CARDS,
  combatSide({ tier: 3, tribes: ['beast'], ...(soulbind ? { questMods: { soulbind } } : {}) } as never),
  combatSide({ tier: 1 }),
);

const attackGained = (r: ReturnType<typeof fight>, target: string): number =>
  (r.events.filter((e) => e.type === 'buff') as { target: string; attack: number }[])
    .filter((b) => b.target === target)
    .reduce((n, b) => n + b.attack, 0);

describe('Soulbind mirrors stat gains during combat', () => {
  it('without a bond the two bodies gain independently', () => {
    const r = fight();
    // Packstrider's Rally pumps only itself; Wolvie just takes the shared aura.
    expect(attackGained(r, 'm0')).toBeGreaterThan(attackGained(r, 'm1'));
  });

  it('with a bond both bodies end on the SAME total — every gain is mirrored', () => {
    const r = fight({ a: 'A', b: 'B' });
    const a = attackGained(r, 'm0');
    const b = attackGained(r, 'm1');
    expect(a).toBe(b);
    // …and it is the sum of both bodies' own gains, not one of them.
    expect(a).toBeGreaterThan(attackGained(fight(), 'm0'));
  });

  it('matches on the RUN-BOARD uid, which is what the bond is forged against', () => {
    // A bond naming the combat-side uids (`m0`/`m1`) must NOT match — those are per-fight clones.
    const wrong = fight({ a: 'm0', b: 'm1' });
    expect(attackGained(wrong, 'm0')).toBe(attackGained(fight(), 'm0'));
  });

  it('leaves the unbound third body alone', () => {
    const bonded = fight({ a: 'A', b: 'B' });
    expect(attackGained(bonded, 'm2')).toBe(attackGained(fight(), 'm2'));
  });
});
