import type { CardDef } from '@game/core';
import { poolOf } from './cardPool';
import type { RunState } from './state';

/**
 * THE run's drawable SPELL pool — the set's spells, TRIBE-GATED to the run (owner 2026-09-10: "tribe-gated spells
 * are important, as are tribe-gated runes and heroes"). A spell whose `tribe` is not `neutral` is offered only
 * when that tribe is one of the run's rolled tribes: a Ruby spell in a run without Kobolds, or Lantern of Souls
 * without Undead, has no payoff line and only burns a slot.
 *
 * Every spell draw goes through here — the shop roll, the Spell Cart, every Discover-a-spell pool, every
 * "get a random spell" grant — so the gate cannot be bypassed by one site reading `poolOf(state).spells`
 * directly (a repo-wide sweep replaced them all on 2026-09-10). Tier filters stay at the call sites: this is
 * membership, not eligibility.
 */
export function runSpells(state: Pick<RunState, 'setId' | 'tribes'>): CardDef[] {
  const tribes = state.tribes ?? [];
  return poolOf(state).spells.filter((c: CardDef) => c.tribe === 'neutral' || tribes.includes(c.tribe));
}
