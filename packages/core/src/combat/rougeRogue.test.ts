import { describe, it, expect } from 'vitest';
import { combatSide, simulate, makeRng, type BoardMinion } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * Rouge Rogue — found by the 2026-07-31 wiring audit. The card's printed rule ("whenever an Imp attacks, give
 * your Imps +3/+3 this combat, improving every 3 Imp attacks") had a fully-built combat factory
 * (`onImpAttackBuffImps`) that NO card referenced — the card def still carried `spellCastBuffImps`, a
 * recruit-phase per-spell buff. So in combat the card did nothing, and in the shop it did something it never
 * printed.
 *
 * These tests pin the re-wire from the OUTSIDE (a full `simulate` run), so they hold regardless of factory
 * internals: the buffs happen, they escalate, and — because the rule says "this combat" — the escalation does
 * NOT ride the permanent `playerSummonBonus` carry-back that its sibling improvers (Kennelmaster, Oona,
 * Broodwright) legitimately use.
 */

/** The Rogue + four Start-of-Combat Imp summoners, vs an inert wall so many Imp attacks land. */
const board: BoardMinion[] = [
  // `sourceUid` set explicitly: without it the carry-back filter skips the minion entirely and the
  // persistence test below would pass VACUOUSLY, proving nothing.
  { cardId: 'dm_chancellor', attack: 4, health: 30, keywords: [], sourceUid: 'ROGUE' },
  // FOUR Imp Wranglers, each summoning an Imp at Start of Combat. Not Legion Shepherd — its Imps are an
  // Echo, and against a 0-Attack wall nothing dies, so no Imps ever arrived (the first fixture's silent hole).
  { cardId: 'dm_wrangler', attack: 2, health: 20, keywords: [] },
  { cardId: 'dm_wrangler', attack: 2, health: 20, keywords: [] },
  { cardId: 'dm_wrangler', attack: 2, health: 20, keywords: [] },
  { cardId: 'dm_wrangler', attack: 2, health: 20, keywords: [] },
];
// A genuinely INERT wall (Drummer has no effects): 0 Attack so the Imps live to attack many times. NOT the
// sandbag — Target Dummy gains +1 Attack per hit, snowballs, and killed each 1/1 Imp on its first clash, so
// only 3 Imp attacks ever happened and the every-3 improve was untestable.
const wall: BoardMinion[] = [{ cardId: 'drummer', attack: 0, health: 200 }];

const fight = (seed: number) =>
  simulate(board, wall, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));

describe('Rouge Rogue — the Imp-attack combat buff it always printed', () => {
  it('buffs the Imps when an Imp attacks', () => {
    const { events } = fight(3);
    const uidsOfImps = new Set(
      events.filter((e) => e.type === 'summon' && e.minion.cardId === 'impscrap').map((e) => (e as { minion: { uid: string } }).minion.uid),
    );
    expect(uidsOfImps.size, 'fixture: the Shepherd must actually flood Imps').toBeGreaterThan(0);
    const impBuffs = events.filter((e) => e.type === 'buff' && uidsOfImps.has((e as { target: string }).target));
    expect(impBuffs.length, 'no Imp was ever buffed by the Rogue').toBeGreaterThan(0);
  });

  it('ESCALATES within the fight — later grants are bigger than +3/+3', () => {
    const { events } = fight(3);
    const grants = events
      .filter((e): e is Extract<typeof e, { type: 'buff' }> => e.type === 'buff')
      .filter((e) => e.attack === e.health && e.attack >= 3); // the Rogue's symmetric grants
    // With a flooded board and a 300-hp wall there are well over 3 Imp attacks, so an improved (+4/+4 or
    // higher) grant must appear. If the improve step ever silently breaks, every grant stays exactly +3/+3.
    expect(grants.some((e) => e.attack > 3), 'the every-3-attacks improve never fired').toBe(true);
  });

  it('the escalation is "this combat" — it must NOT carry back permanently', () => {
    const r = fight(3);
    // The escalation must have actually happened this fight (or the exclusion is untested)…
    const grants = r.events.filter((e): e is Extract<typeof e, { type: 'buff' }> => e.type === 'buff');
    expect(grants.some((e) => e.attack === e.health && e.attack > 3), 'fixture: the improve never fired').toBe(true);
    // …and `playerSummonBonus` — the permanent carry-back channel (Kennelmaster & friends) — must not carry it.
    const carried = (r.playerSummonBonus ?? []).some((b) => b.sourceUid === 'ROGUE');
    expect(carried, 'the "this combat" escalation leaked into the permanent carry-back').toBe(false);
  });
});
