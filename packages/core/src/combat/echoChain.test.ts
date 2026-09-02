import { describe, it, expect } from 'vitest';
import { combatSide, simulate, makeRng, type BoardMinion } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * THE ECHO-MULTIPLIER CHAIN (owner report 2026-08-06).
 *
 * The owner stated the intended arithmetic exactly:
 *
 *   · gilded Echohorn triggers Dawnclaw 2×
 *   · gilded Dawnclaw triggers the neighbour's Shout 2×
 *   · gilded Drakko makes each of those Shouts fire 2 more times
 *   · Sylus makes every Echo proc happen 1 more time
 *
 * i.e. the multipliers MULTIPLY down the chain. They did not: `rallyProcLeftmostEcho` looped only on the
 * Stag's own gild and consulted no Echo multiplier at all, so Sylus contributed exactly ZERO through it —
 * every count came out byte-identical with 0, 1, 2 or gilded Sylus on the board, i.e. a flat halving of the
 * stated product. Both Rally-proc factories now read the canonical `ctx.echoExtras`, the same multiplier a
 * REAL death honours.
 *
 * These tests count `rally` events, which is one per Echo proc — the directly observable proc count, and
 * independent of what the proc'd Echo happens to do.
 */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const run = (p: BoardMinion[], e: BoardMinion[], seed: number) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES }), combatSide({ tier: 6 }));

/** Echo procs per Echohorn swing: `rally` events / the Stag's attacks, so a longer fight can't skew it. */
function procsPerSwing(board: BoardMinion[], seed = 11): number {
  const a = run(board, [{ cardId: 'omen', attack: 1, health: 4000 }], seed);
  const stag = a.initial.player.find((m) => m.cardId === 'b2_echohorn');
  const swings = a.events.filter((ev) => ev.type === 'attack' && ev.attacker === stag?.uid).length;
  const procs = a.events.filter((ev) => ev.type === 'rally' && ev.source === stag?.uid).length;
  return swings === 0 ? 0 : procs / swings;
}

describe("Echohorn's Rally proc honours every Echo multiplier", () => {
  // A plain Echo body to be the Stag's left-most target. `spore`'s Echo buffs friends — what it does is
  // irrelevant here; it just has to BE an Echo so the Stag picks it.
  const stag = (golden = false): BoardMinion => ({ cardId: 'b2_echohorn', attack: 3, health: 400, golden });
  const echoTarget: BoardMinion = { cardId: 'spore', attack: 1, health: 400 };
  const sylus = (golden = false): BoardMinion => ({ cardId: 'sylus', attack: 1, health: 400, golden });

  it('bare: one proc per swing, doubled by the Stag\'s own gild', () => {
    expect(procsPerSwing([echoTarget, stag()])).toBe(1);
    expect(procsPerSwing([echoTarget, stag(true)]), 'the gild doubles').toBe(2);
  });

  it('SYLUS MULTIPLIES IT — the reported bug (it used to contribute exactly zero)', () => {
    expect(procsPerSwing([echoTarget, stag(), sylus()]), '1 base + 1 Sylus').toBe(2);
    expect(procsPerSwing([echoTarget, stag(), sylus(), sylus()]), 'Sylus stacks additively').toBe(3);
    expect(procsPerSwing([echoTarget, stag(), sylus(true)]), 'a gilded Sylus is +2').toBe(3);
  });

  it('the Stag\'s gild multiplies ON TOP of Sylus, never replaces it', () => {
    // (1 base + 1 Sylus) × 2 for the gild = 4. This is the shape the owner specified, and the same shape
    // `deathrattleReplayAdjacentBattlecry` already used for Drakko.
    expect(procsPerSwing([echoTarget, stag(true), sylus()])).toBe(4);
    expect(procsPerSwing([echoTarget, stag(true), sylus(), sylus()]), '(1+2)×2').toBe(6);
  });
});

describe('the full chain: Echohorn → Dawnclaw → Drakko → Sylus (owner spec 2026-08-06)', () => {
  /** Shouts re-fired by Dawnclaw, per Echohorn swing — the end of the chain the owner cares about. */
  function shoutsPerSwing(board: BoardMinion[], seed = 5): number {
    const a = run(board, [{ cardId: 'omen', attack: 1, health: 4000 }], seed);
    const stag = a.initial.player.find((m) => m.cardId === 'b2_echohorn');
    const swings = a.events.filter((ev) => ev.type === 'attack' && ev.attacker === stag?.uid).length;
    // Dawnclaw narrates each Shout it re-fires; the `sc` line is the observable per-fire beat.
    const fires = a.events.filter((ev) => ev.type === 'shout').length; // one counted event per fire (2026-09-01)
    return swings === 0 ? 0 : fires / swings;
  }

  it('every link multiplies — gilded Stag × gilded Dawnclaw × gilded Drakko × Sylus', () => {
    // Board order matters: Dawnclaw must be the Stag's left-most Echo, with a Shout minion beside it.
    const shoutNeighbour: BoardMinion = { cardId: 'k_deepvein', attack: 2, health: 400 };
    const base: BoardMinion[] = [
      shoutNeighbour,
      { cardId: 'b2_dawnclaw', attack: 2, health: 400, golden: true },
      { cardId: 'b2_echohorn', attack: 3, health: 400, golden: true },
    ];
    const withDrakko = [...base, { cardId: 'drummer', attack: 2, health: 400, golden: true } as BoardMinion];
    const withSylus = [...withDrakko, { cardId: 'sylus', attack: 1, health: 400 } as BoardMinion];

    const a = shoutsPerSwing(base);          // Stag gild 2 × Dawnclaw gild 2 = 4
    const b = shoutsPerSwing(withDrakko);    // × gilded Drakko (1+2 = 3) = 12
    const c = shoutsPerSwing(withSylus);     // × (1 + 1 Sylus) = 24
    expect(a, 'Stag gild × Dawnclaw gild').toBeGreaterThan(0);
    expect(b / a, 'gilded Drakko triples each fire').toBeCloseTo(3, 5);
    // THE FIX: Sylus used to change nothing here at all (b === c), halving the owner's stated product.
    expect(c / b, 'Sylus doubles the whole chain').toBeCloseTo(2, 5);
  });
});
