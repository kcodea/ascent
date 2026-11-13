/**
 * A COUNTING HERO POWER IS ARMED (owner 2026-11-10, after Magician's hat: "perfect, add it to those too", then "add it
 * to quillen when his is at 2/3 too").
 *
 * The one rule, for every power that counts toward something:
 *
 *   ARMED = "your next action, or the end of this turn, fires this power."
 *
 * Never "something happens next turn". The hero power button wears the existing READY call while a power is armed in
 * the Shop and drops it the moment the power fires (`powerArmedUi.ts` in `@game/ui`). This file is a READ: each arm
 * below restates the gate its own fire site checks, from the same run fields, and changes nothing.
 *
 *  - Magician (`magicHat`):    the hat is one buy short of firing (`magicHatView().active`): the next card bought
 *                              sends the teammate a copy of a random card in it.
 *  - Re-Pete (`secondHand`):   this is the turn at whose end Second Hand fires (`wave % every === 0`, every = 3, or 2
 *                              with the Ancient of Time) AND it has something to copy right now (`ancientSecondHandSources`:
 *                              the left-most hand card; Bonds: the board's edges). Nothing to copy = it would fire nothing.
 *  - Gorr (`fourPeat`):        exactly 2 minions bought this turn (`gorrBuys`): the 3rd buy fires. Once per turn, so 3 or
 *                              more is not armed; the tally resets at turn setup.
 *  - Juggler (`baldgecoin`):   one minion buy short of the next Carnival Coin (`jugglerBuys === need - 1`; need = 3,
 *                              or 2 with the Ancient of Genesis; carries across turns).
 *  - Pete (`contraband`):      the NEXT refresh is the one that fires (`refreshCount % every === every - 1`; every =
 *                              3, or 2 with the Ancient of Time; carries across turns).
 *  - Ayse (`luckySeat`):       2 of 3 Enchanted cards bought (`ciaEnchantedBought`, wraps at 3, carries across turns).
 *  - Drakko (`quest`):         one Shout buy short of Drumline (`drakkoBuys === need - 1`; need = 5, or 4 / 3 on a later
 *                              Ancient of Genesis completion) and the holding slot's once-per-game latch is not spent.
 *                              A completed quest is never armed again.
 *  - Quillen (`archive`):      ACTIVE. The next Archive press fills it and opens the Discover: the types banked plus
 *                              what one press banks (1; more with Rune of Empowerment / Wishbone, the reducer's `reps`)
 *                              reach the need (3; 2 with the Ancient of Genesis). Natively: 2 of 3. Not while the
 *                              Ancient of Time has made Archive passive. Whether the press is AVAILABLE right now (once
 *                              per turn) is the button's own ready state, which the screen ANDs in.
 *
 * IT FOLLOWS THE HELD POWER, per slot (`activePowers`): Mimic's disguise of the turn, a Power Shifter swap, either of
 * Void's two. The six passives are armed only while passive (an Ancient reshape that makes one pressable leaves it to
 * its button's own ready state).
 * A kind held in both slots fires once (`hasPower`), so only the first slot that holds it shows armed.
 *
 * Phase-agnostic on purpose, like `magicHatView`: the caller decides where a glow may show (the Shop only).
 */
import { ancientArchiveNeed, ancientArchivePassive, ancientCoinNeed, ancientContrabandEvery, ancientDrumlineNeed, ancientSecondHandEvery, ancientSecondHandSources } from './ancients';
import { activePowers, powerLatchSpent, wieldedPowerId } from './heroes';
import { magicHatView } from './magicHat';
import { runeStacksOf } from './runeDup';
import type { RunState } from './state';

/** Minion buys in one turn that fire Gorr's Four Peat. */
const FOUR_PEAT_BUYS = 3;
/** The cycle Ayse's prize counts to (Juggler's coin and Pete's refresh read theirs live: an Ancient can shorten them). */
const CYCLE = 3;

/** Types one Archive press banks: the reducer's hero power `reps` (1 + Rune of Empowerment + a Wishbone per copy). */
function archiveReps(run: RunState): number {
  return 1 + (run.runeEmpowerment ? 1 : 0) + (run.runeWishbone ? runeStacksOf(run, 'rune_wishbone') : 0);
}

export function heroPowerArmed(run: RunState, slot: 0 | 1 = 0): boolean {
  const powers = activePowers(run);
  const power = powers[slot];
  if (!power) return false;
  if (powers.findIndex((p) => p.kind === power.kind) !== slot) return false;
  if (power.kind === 'archive') {
    return !power.passive && !ancientArchivePassive(run) && (run.archivedTribes?.length ?? 0) + archiveReps(run) >= ancientArchiveNeed(run);
  }
  if (!power.passive) return false;
  switch (power.kind) {
    case 'magicHat': return magicHatView(run).active;
    case 'secondHand': return run.wave % ancientSecondHandEvery(run) === 0 && ancientSecondHandSources(run).length > 0;
    case 'fourPeat': return (run.gorrBuys?.length ?? 0) === FOUR_PEAT_BUYS - 1;
    case 'baldgecoin': return (run.jugglerBuys ?? 0) === ancientCoinNeed(run) - 1;
    case 'contraband': { const every = ancientContrabandEvery(run); return (run.refreshCount ?? 0) % every === every - 1; }
    case 'luckySeat': return (run.ciaEnchantedBought ?? 0) === CYCLE - 1;
    case 'quest': {
      const holder = wieldedPowerId(run, slot);
      return !!holder && !powerLatchSpent(run, holder) && (run.drakkoBuys ?? 0) === ancientDrumlineNeed(run) - 1;
    }
    default: return false;
  }
}
