/**
 * A TRIPLE MADE AT START OF TURN WAITS FOR THE SHOP (R-SOT-GILD-01, player report c49f912b, relayed by the owner
 * 2026-10-24: "when a unit is tripled at the start of turn, it happens while the return to shop transition is
 * happening. this should wait until you return to shop. if it is on a rune select turn, it should wait until the rune
 * is selected").
 *
 * A Start-of-Turn grant (a rune's gift, a hero power, a quest reward) can complete a triple. The sim combines the copies
 * inside `resolveCombat`, which the Shop dispatches while the return curtain fully covers the scene (`coveredOut`), so
 * the gild used to play right there: its trails flew under the blue, its sound rang over the transition, and the golden
 * card was already sitting in the hand when the Shop revealed (and under the Runeforge on a rune turn).
 *
 * Presentation only. The run state is untouched (the golden is in the hand from the commit, exactly as before); the
 * Shop just HOLDS the golden card out of its row and parks the gild until the Shop is actually in front of the player:
 *
 *   · the triple arrived while the wipe was still moving (`gildMustWait`): that is the Start-of-Turn commit, never a
 *     triple the player made by hand on an open Shop;
 *   · it plays once the wipe is at rest, the turn's Start-of-Turn beats have finished, and no offer covers the Shop
 *     (`heldGildMayPlay`): a Runeforge until its rune is picked and has flown to the rack, and likewise a Discover /
 *     quest / power / Ancient offer or a scout. A PEEKED (minimized) offer does not cover the Shop, so peeking plays it;
 *   · leaving the Shop before then drops it: the golden simply shows (nothing to replay on the combat board).
 *
 * Kept free of the DOM so the rules are unit-tested; the Shop (`Recruit.tsx`) does the hiding and the playing.
 */
import type { Pt } from './gildTrailSources';
import type { WipeState } from './wipeMachine';

/** Breath between the Shop becoming free and the parked gild's first trail (the same pad the Start-of-Turn beats use
 *  after the wipe, so the gild never lands on the frame an overlay closes). */
export const HELD_GILD_PAD_MS = 300;

/** A gild parked until the Shop is in front of the player: the golden card's uid (held out of its row) and where each
 *  consumed copy stood, resolved at the commit while the pre-combat layout was still the one on record. */
export interface HeldGild {
  uid: string;
  sources: Pt[];
}

/** Whether a triple that just landed must wait: the commit came in while the wipe was moving (the return trip). */
export function gildMustWait(phase: string, wipe: WipeState): boolean {
  return phase === 'recruit' && wipe !== 'idle';
}

/** The Shop offers that cover the scene while open. A minimized (peeked) offer leaves the Shop in view. */
export function shopOfferCovering(o: {
  runeforge: boolean; forgeMin: boolean; runeLockIn: boolean;
  discover: boolean; discoverMin: boolean;
  quest: boolean; questMin: boolean;
  power: boolean; powerMin: boolean;
  chooseOne: boolean; scouting: boolean; ancientOffer: boolean;
}): boolean {
  return (o.runeforge && !o.forgeMin) || o.runeLockIn
    || (o.discover && !o.discoverMin)
    || (o.quest && !o.questMin)
    || (o.power && !o.powerMin)
    || o.chooseOne || o.scouting || o.ancientOffer;
}

/** A parked gild may play once the Shop is in front of the player: recruit, wipe at rest, the Start-of-Turn beats
 *  done, and nothing covering it. */
export function heldGildMayPlay(g: { phase: string; wipe: WipeState; sotPlaying: boolean; offerCovering: boolean }): boolean {
  return g.phase === 'recruit' && g.wipe === 'idle' && !g.sotPlaying && !g.offerCovering;
}
