/**
 * ANCIENT TRIGGER PROCS (owner 2026-11-17, R-FX-ANCIENT-PROC-01): which combat `questTrigger` flags mean "this side's
 * Ancient just fired". The shared flag is `ANCIENT_PROC_FLAG` (core): an event-fired pairing's combat half pulses it once
 * per fire. A pairing that ALREADY pulses its own per-fire flag for its live counter (R-ANCSYS-04) is listed here instead
 * of pulsing a second event, so a fire is one marker and one beat, never two.
 *
 * Only flags that pulse exactly ONCE PER FIRE of the pairing belong here (never a per-tick counter of something smaller
 * than a fire). The UI counts every listed flag into the hero-power button's rune-trigger burst (`ancientProcFx.ts`).
 */
import { ANCIENT_PROC_FLAG } from '@game/core';
import {
  ANCIENT_COMMISSION_FLAG, ANCIENT_DRAKKO_SHOUT_FLAG, ANCIENT_GILD_CHARGE_FLAG, ANCIENT_MAX_GOLD_AVENGE_FLAG, ANCIENT_SPROUT_FLAG,
  ANCIENT_SUMMIT_AVENGE_FLAG, ANCIENT_SWAP_CHARGE_FLAG,
} from './ancients'; // group 2 aliases
import { ANCIENT_CLEARANCE_STACK_FLAG, ANCIENT_RALLY_GOLD_FLAG } from './ancients'; // group 1 aliases
import { ANCIENT_ALLIN_FLAG, ANCIENT_ATTACK_GOLD_FLAG, ANCIENT_CROWN_FLAG, ANCIENT_DICE_LOCK_FLAG, ANCIENT_GORUN_GIFT_FLAG, ANCIENT_REFRESH_AVENGE_FLAG } from './ancients'; // group 3 aliases
/** Mimic × Death's Start-of-Combat Reclaim mark (a literal in `simulate.ts`). */
const ANCIENT_AUTO_RECLAIM_FLAG = 'ancientAutoReclaim';

const ALIASES = new Set<string>([
  ANCIENT_PROC_FLAG,
  // group 1 (Indy..Gorr): each pulses once per fire of its one pairing
  ANCIENT_CLEARANCE_STACK_FLAG, // Frank × War: one per Pummel (300) crossing (a Clearance stack)
  ANCIENT_RALLY_GOLD_FLAG, // Tradesman × War: one per grafted Rally fire (a Rally doubler's re-run is its own fire)
  // group 2 (Braum..Midas): each pulses once per fire of its one pairing
  ANCIENT_SWAP_CHARGE_FLAG, // Darah × War: one per Swap charge paid
  ANCIENT_GILD_CHARGE_FLAG, // Gildmaster × War: one per Gildcrafter use paid
  ANCIENT_MAX_GOLD_AVENGE_FLAG, // Nadja × Death: one per Avenge (6) fire (Rune of Fury repeats included)
  ANCIENT_SUMMIT_AVENGE_FLAG, // Brackus × Death: one per Avenge (3) fire
  ANCIENT_SPROUT_FLAG, // Rayse × Death: one per Sprout summoned by Avenge (4)
  ANCIENT_COMMISSION_FLAG, // Cassen × Death: one per Avenge (7) advance
  ANCIENT_DRAKKO_SHOUT_FLAG, // Drakko × Bonds: one per Shout triggered (each one grows the Drakkos)
  // group 3 (Keshi..Mimic): each pulses once per fire of its one pairing
  ANCIENT_CROWN_FLAG, // Keshi × Death: one per Avenge (4) fire (Rune of Fury repeats included)
  ANCIENT_ALLIN_FLAG, // Rascal × Death: one per Avenge (4) fire (Fury repeats included)
  ANCIENT_DICE_LOCK_FLAG, // Gambler × Death: one per Avenge (4) fire (Fury repeats included)
  ANCIENT_GORUN_GIFT_FLAG, // Gorun × Death: one per Attack gift
  ANCIENT_ATTACK_GOLD_FLAG, // Gorun × Fortune: one per 5-attack Gold payout
  ANCIENT_AUTO_RECLAIM_FLAG, // Mimic × Death: one per Start-of-Combat Reclaim mark
  ANCIENT_REFRESH_AVENGE_FLAG, // Tradesman / Pete × Death: one per Avenge (3) free Refresh (Fury repeats included)
]);

/** Every flag that counts as an Ancient proc (the shared flag + the per-fire aliases). */
export const ANCIENT_PROC_FLAGS: ReadonlySet<string> = ALIASES;

/** Is this combat `questTrigger` flag an Ancient's proc? */
export function isAncientProcFlag(flag: string | undefined): boolean {
  return !!flag && ALIASES.has(flag);
}
