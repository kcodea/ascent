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
