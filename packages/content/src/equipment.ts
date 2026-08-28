import type { CardDef } from '@game/core';

/**
 * ── EQUIPMENT (owner handoff 2026-08-28) ─────────────────────────────────────────────────────────────────
 *
 * A Shop-phase, second-hero-power-shaped ability GRANTED BY A MINION rather than owned by the hero. A minion
 * with an `equip` effect hands its Equipment to the player when played; the player activates it from the
 * second power slot, paying Gold and spending one of a SHARED per-turn allowance.
 *
 * The two facts that shape everything else:
 *
 *  1. **Equipment is not permanently unlocked.** It is rebuilt from the board at the start of every turn, so
 *     keeping it means keeping an Equip minion alive. Within a turn it survives its source leaving.
 *  2. **It is player state, not minion state.** Selling the source mid-turn does not revoke it, and an
 *     activated combat effect belongs to the player once paid for.
 *
 * WHY THE DEFINITION LIVES IN CONTENT, keyed by id, rather than on the card: several cards may grant the same
 * Equipment (the handoff's duplicate/Gilded precedence rules exist precisely for that), so the Equipment is
 * the shared thing and the card is one SOURCE of it. A card names its Equipment by id in its `equip` effect.
 */

/** How an Equipment asks for its target — the same vocabulary hero powers use, so the UI's aim flow is reused. */
export type EquipmentTargetMode =
  /** Fires on click, no target (the hero-power `untargeted` shape). */
  | 'none'
  /** Arms, then takes one friendly BOARD minion. */
  | 'friendly';

export interface EquipmentDefinition {
  id: string;
  name: string;
  /** Full sentence for the tooltip, written as the player reads it. */
  text: string;
  /** The Gilded source's wording. Absent = a Gilded source grants the plain version. */
  goldenText?: string;
  /** Gold to activate. Cost reductions apply on top; the floor is 0. */
  baseCost: number;
  targetMode: EquipmentTargetMode;
  /** The recruit factory that resolves one TRIGGER of this Equipment. */
  effectId: string;
  /** Params for `effectId`. A Gilded source uses `gildedParams` when present. */
  params?: Record<string, number | string>;
  gildedParams?: Record<string, number | string>;
}

/**
 * BLOODPOT — the reference Equipment (owner handoff: "Implement only Alchemist Frank as the reference card").
 * Deliberately the simplest shape that still exercises the whole system: a Gold cost, a friendly target, a
 * Gilded upgrade, and a plain stat grant whose result is trivially assertable.
 */
export const BLOODPOT: EquipmentDefinition = {
  id: 'bloodpot',
  name: 'Bloodpot',
  text: 'Give a friendly minion **+3/+3**.',
  goldenText: 'Give a friendly minion **+6/+6**.',
  baseCost: 1,
  targetMode: 'friendly',
  effectId: 'equipmentBuffTarget',
  params: { attack: 3, health: 3 },
  gildedParams: { attack: 6, health: 6 },
};

export const EQUIPMENT: readonly EquipmentDefinition[] = [BLOODPOT];

export const EQUIPMENT_INDEX: Readonly<Record<string, EquipmentDefinition>> =
  Object.fromEntries(EQUIPMENT.map((e) => [e.id, e]));

/** The Equipment a card grants, or undefined. Resolved from the card's `equip` effect, so a card never has to
 *  restate the id anywhere else and the two can never disagree. */
export function equipmentOf(def: CardDef | undefined): EquipmentDefinition | undefined {
  const eff = def?.effects.find((e) => e.on === 'equip');
  const id = eff?.params?.equipmentId;
  return typeof id === 'string' ? EQUIPMENT_INDEX[id] : undefined;
}
