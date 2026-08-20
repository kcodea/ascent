import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';

/**
 * RUNE OF AFTERSHOCKS — "Triggering an Echo gives your minions +4/+4 this combat" (owner report 2026-08-09:
 * "broken and continuously triggers after attacks").
 *
 * Two multiplications shipped, and each one paid a WHOLE BOARD BUFF:
 *   · the `onDeath` bus broadcasts to every watcher, and the old code wrapped every one of those calls — so a
 *     board of N rattle-bodies granted N times per death, N−1 of which did nothing at all;
 *   · the doubler and Empty-Graves loops wrapped PER EFFECT, so a body with two Echo effects paid twice.
 *
 * Every assertion below counts the rune's OWN buff events by source label, so it measures the rune rather
 * than whatever else the board was doing.
 */
const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}, seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['beast', 'dragon', 'demon', 'undead', 'mech'], questMods: mods as never }), combatSide());

describe('Rune of Aftershocks fires once per Echo TRIGGER', () => {
  const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];

  it('a board of many Echo bodies does not multiply the grant per death', () => {
    // FIVE bodies that all carry an onDeath effect. Under the old code the FIRST death alone granted five
    // times (one per watcher on the bus); now one death = one trigger = one grant.
    const board: BoardMinion[] = Array.from({ length: 5 }, () => ({ cardId: 'pack', attack: 0, health: 1 }));
    const armed = sim(board, killer, { runeAftershocks: true });
    const grantEvents = armed.events.filter((e) => e.type === 'buff' && (e as { source: string }).source === 'Rune of Aftershocks').length;
    const baseline = sim(board, killer, {}).events.filter((e) => e.type === 'buff' && (e as { source: string }).source === 'Rune of Aftershocks').length;
    expect(baseline, 'unarmed, the rune must grant nothing').toBe(0);
    expect(grantEvents, 'the rune never fired at all').toBeGreaterThan(0);
    // The board is 5 bodies (plus the Pups their Echoes summon). Five deaths, each ONE trigger, each buffing
    // the living — a hard ceiling well under the old per-watcher explosion, which multiplied by the number of
    // rattle-bodies still standing at every single death.
    expect(grantEvents, `runaway: ${grantEvents} grant events from 5 Echo deaths`).toBeLessThan(60);
  });

  it('does not fire at all on a board with no Echo', () => {
    const board: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }, { cardId: 'sandbag', attack: 0, health: 40 }];
    const r = sim(board, killer, { runeAftershocks: true });
    const grants = r.events.filter((e) => e.type === 'buff' && (e as { source: string }).source === 'Rune of Aftershocks').length;
    expect(grants, 'a rattle-less board triggered no Echo, so the rune must stay silent').toBe(0);
  });

  it('a watcher reacting to ANOTHER body’s death is not its own Echo trigger', () => {
    // Brood Matron's onDeath effect watches FRIENDS dying. It is on the bus for every death, but only its own
    // death is its Echo. With a lone fodder body dying beside it, the rune should fire for that body's Echo
    // (it has none — a sandbag) and NOT for the Matron merely observing.
    const board: BoardMinion[] = [
      { cardId: 'sandbag', attack: 0, health: 1 },
      { cardId: 'brood', attack: 0, health: 400 },
    ];
    const r = sim(board, killer, { runeAftershocks: true });
    const grants = r.events.filter((e) => e.type === 'buff' && (e as { source: string }).source === 'Rune of Aftershocks').length;
    expect(grants, 'the Matron observing a death is not an Echo trigger').toBe(0);
  });
});

/**
 * FORCED Echo triggers count too (owner report 2026-08-20: "only triggering when an echo minion dies — it
 * should trigger when an Echo is triggered, so things like echohorn, hawkus etc").
 *
 * The cause was structural: `triggerEcho` (the shared body behind Echohorn Stag / Hawkus / Spots) and two
 * runes fired the target's `onDeath` factories DIRECTLY, so they never passed the `asEcho` chokepoint where
 * this rune (and Rune of the Burrow) live. Nothing about the rune was wrong — it was simply never told.
 * Each case below drives a real forced trigger with NO death and asserts the rune paid.
 */
describe('a FORCED Echo trigger pays the rune, with no death involved', () => {
  // A wall that cannot kill anything and cannot die: every grant below therefore comes from a forced
  // trigger, never from a death. `pack` (Wolf Pack) carries a real onDeath effect — it is the Echo body.
  const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 40000 }];
  const grantsOf = (r: ReturnType<typeof sim>) =>
    r.events.filter((e) => e.type === 'buff' && (e as { source: string }).source === 'Rune of Aftershocks').length;

  it('ECHOHORN STAG — its Rally-proc’d Echo fires the rune', () => {
    const board: BoardMinion[] = [
      { cardId: 'b2_echohorn', attack: 4, health: 40000, keywords: ['RL'] },
      { cardId: 'pack', attack: 0, health: 40000 },
    ];
    expect(grantsOf(sim(board, wall, { runeAftershocks: true })), 'the Stag’s forced Echo paid nothing').toBeGreaterThan(0);
    expect(grantsOf(sim(board, wall, {})), 'unarmed pays nothing').toBe(0);
  });

  it('HAWKUS — an ally Rally forcing the left-most Echo fires the rune', () => {
    const board: BoardMinion[] = [
      { cardId: 'pack', attack: 0, health: 40000 },
      { cardId: 'b2_hawkus', attack: 4, health: 40000 },
      { cardId: 'sandbag', attack: 4, health: 40000, keywords: ['RL'] }, // the Rally that Hawkus watches
    ];
    expect(grantsOf(sim(board, wall, { runeAftershocks: true })), 'Hawkus’ forced Echo paid nothing').toBeGreaterThan(0);
  });

  it('SPOTS — its Start-of-Combat Echo triggers fire the rune', () => {
    const board: BoardMinion[] = [
      { cardId: 'pack', attack: 0, health: 40000 },
      { cardId: 'b2_spots', attack: 0, health: 40000, keywords: ['SC'] },
    ];
    expect(grantsOf(sim(board, wall, { runeAftershocks: true })), 'Spots’ forced Echoes paid nothing').toBeGreaterThan(0);
  });

  it('RUNE OF THE HERALD — its board-wide Echo trigger fires the rune', () => {
    const board: BoardMinion[] = [{ cardId: 'pack', attack: 0, health: 40000 }];
    expect(grantsOf(sim(board, wall, { runeAftershocks: true, runeHerald: true })), 'the Herald’s Echoes paid nothing').toBeGreaterThan(0);
    expect(grantsOf(sim(board, wall, { runeHerald: true })), 'the Herald alone grants no Aftershocks').toBe(0);
  });

  it('a forced trigger still grants ONCE per trigger — no per-effect multiplication', () => {
    // The regression this rune has already had twice: one trigger of one body must be one grant per living
    // minion, never one per Echo EFFECT on that body. Spots forces exactly the Echoes it names.
    const board: BoardMinion[] = [
      { cardId: 'pack', attack: 0, health: 40000 },
      { cardId: 'b2_spots', attack: 0, health: 40000, keywords: ['SC'] },
    ];
    const grants = grantsOf(sim(board, wall, { runeAftershocks: true }));
    // 2 living bodies × at most a couple of forced triggers — a hard ceiling far under a per-effect blowup.
    expect(grants, `runaway: ${grants} grants from a Start-of-Combat forced trigger`).toBeLessThan(20);
  });
});
