import { useSyncExternalStore } from 'react';
import { EQUIPMENT_AMPLIFIED_COUNTER } from '@game/sim';
import { AMPLIFIED_SLOT_SELECTOR } from '../useAmplifiedSlotFx';
import { RESOURCE_FX_DEF } from './resourceFx';

/**
 * END OF TURN EQUIPMENT FX (owner 2026-10-03, R-EOT-AMPLIFY-01): "Where should Rune of Amplification's End of Turn
 * effect play? i think it should get an end of turn beat".
 *
 * The rune's End-of-Turn pass opens its own beat (`rune:rune_amplification:endOfTurn`) carrying one
 * `counterChanged` per Equipment it Amplified (`equipmentAmplified:<id>`). On that beat:
 *  - the presenter plays the authored `self-buff-burst` (the same def the End-of-Turn economy beats use,
 *    `resourceFx.ts`) on the Equipment slot button;
 *  - the projection's counters hand the Amplified ids to the slot (this tiny bus: StatusBar lives in another
 *    tree), so the charge turns BLUE with the burst, not at the commit and not before.
 *
 * Pure presentation: nothing here reads or writes the run.
 */
export const EQUIPMENT_FX_DEF = RESOURCE_FX_DEF;

/** The Equipment id an `equipmentAmplified:<id>` counter names, or null for any other counter. */
export function amplifiedEquipmentOf(counter: string): string | null {
  return counter.startsWith(EQUIPMENT_AMPLIFIED_COUNTER) ? counter.slice(EQUIPMENT_AMPLIFIED_COUNTER.length) || null : null;
}

/** The def + the HUD selector an End-of-Turn counter change plays on, or null when it has no Equipment home. */
export function equipmentFxFor(counter: string, amount: number): { def: string; selector: string; equipmentId: string } | null {
  if (amount <= 0) return null;
  const equipmentId = amplifiedEquipmentOf(counter);
  return equipmentId ? { def: EQUIPMENT_FX_DEF, selector: AMPLIFIED_SLOT_SELECTOR, equipmentId } : null;
}

/** The Equipment ids the projection has Amplified so far this End of Turn (from its counters). */
export function amplifiedIdsOf(counters: ReadonlyMap<string, number>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [k, v] of counters) {
    const id = amplifiedEquipmentOf(k);
    if (id && v > 0) ids.add(id);
  }
  return ids;
}

type Listener = () => void;
const listeners = new Set<Listener>();
const EMPTY: ReadonlySet<string> = new Set();
let amplified: ReadonlySet<string> = EMPTY;

function subscribe(fn: Listener): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Recruit's projection hook: the ids Amplified on beats delivered so far (empty clears). */
export function setEotAmplified(ids: ReadonlySet<string>): void {
  const next = ids.size ? ids : EMPTY;
  if (next === amplified || (next.size === amplified.size && [...next].every((id) => amplified.has(id)))) return;
  amplified = next;
  for (const fn of listeners) fn();
}

/** The slot's read. StatusBar only honours it while the End-of-Turn lock holds. */
export function useEotAmplified(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => amplified, () => amplified);
}
