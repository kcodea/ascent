import { CARD_INDEX, EQUIPMENT_INDEX, equipmentOf, type EquipmentDefinition } from '@game/content';
import type { BoardCard, GrantedEquipment, PlayerEquipmentState, RunState } from './state';

/**
 * ── EQUIPMENT — the engine half (owner handoff 2026-08-28) ────────────────────────────────────────────────
 *
 * Equipment is a Shop-phase ability GRANTED BY A MINION and owned by the PLAYER. This module owns the state
 * machine; the reducer owns the actions and the UI owns the slot. Three rules drive everything here:
 *
 *  1. **Within a turn, a grant outlives its source.** Selling the Equip minion does not revoke the Equipment.
 *  2. **Across turns, nothing is kept.** Every Start of Turn clears the collection and rebuilds it from the
 *     surviving board, so continued access means keeping an Equip minion alive.
 *  3. **Uses are a shared player allowance**, not a per-Equipment lock. Activating anything spends one;
 *     swapping spends nothing.
 *
 * ── Two decisions the owner confirmed, recorded here because they are load-bearing ────────────────────────
 *
 * ACTIVATION IS ATOMIC. There is no pending-activation state. The engine has never had one — hero powers
 * validate, pay and resolve in a single action, and cancelling is UI state that never reaches the reducer.
 * Equipment matches that (owner ruling 2026-08-28): "cancel spends no Gold and no activation" therefore holds
 * by construction rather than by bookkeeping, and there is nothing extra to persist or replay.
 *
 * CAUSALITY IS LIVE, NOT PERSISTED. Replay v2 is STATE replay — a frame per action carrying RunState, played
 * back by a pure renderer. It cannot carry per-trigger parent/child causality, so Equipment state lives on
 * RunState (captured for free by inclusion-by-omission) and the causal detail is emitted as presentation
 * consequences for the Beat Lab and Doc Bot. `docs/replay-v2-causality.md` records what a future replay
 * revision would need to carry it properly.
 */

/** The baseline shared allowance: one activation per turn. */
export const BASE_EQUIPMENT_ACTIVATIONS = 1;

const EMPTY: PlayerEquipmentState = {
  available: [],
  baseActivations: BASE_EQUIPMENT_ACTIVATIONS,
  bonusActivations: 0,
  activationsSpent: 0,
  temporaryCostReduction: 0,
};

/** The player's Equipment state, defaulted. Read-only callers use this rather than touching `run.equipment`,
 *  so an older save with no field behaves exactly like a player who has never held Equipment. */
export function equipmentState(run: Pick<RunState, 'equipment'>): PlayerEquipmentState {
  return run.equipment ?? EMPTY;
}

/** Mutable accessor — creates the state on first write. */
function ensure(run: RunState): PlayerEquipmentState {
  run.equipment ??= { ...EMPTY, available: [] };
  return run.equipment;
}

/** Activations still available this turn. DERIVED, never stored: the handoff's "available uses should be
 *  derived rather than duplicated across several flags". */
export function equipmentUsesLeft(run: Pick<RunState, 'equipment'>): number {
  const e = equipmentState(run);
  return Math.max(0, e.baseActivations + e.bonusActivations - e.activationsSpent);
}

/** What this Equipment costs RIGHT NOW: base minus every stacked reduction, floored at 0. */
export function equipmentCostOf(run: Pick<RunState, 'equipment'>, def: EquipmentDefinition): number {
  return Math.max(0, def.baseCost - equipmentState(run).temporaryCostReduction);
}

/** The params one TRIGGER resolves with — the Gilded set when this entry's version is gilded. */
export function equipmentParams(
  def: EquipmentDefinition,
  version: 'plain' | 'gilded',
): Record<string, number | string> {
  return (version === 'gilded' ? def.gildedParams ?? def.params : def.params) ?? {};
}

/** The wording to print for a version, so text and behaviour read off the same switch. */
export function equipmentText(def: EquipmentDefinition, version: 'plain' | 'gilded'): string {
  return version === 'gilded' ? def.goldenText ?? def.text : def.text;
}

/** Is this Equipment still backed by a body on the board? Sources are tracked per-uid, so a duplicate keeps
 *  the entry alive when one copy dies. Read by the REBUILD, never within a turn — inside a turn a grant
 *  deliberately outlives its source. */
export function equipmentSourceAlive(run: Pick<RunState, 'board'>, g: GrantedEquipment): boolean {
  return g.sourceUids.some((uid) => run.board.some((c) => c.uid === uid));
}

/**
 * Grant (or upgrade) one Equipment from a source body. The single write path, used by BOTH the play-time
 * `equip` and the Start-of-Turn rebuild, so the duplicate/Gilded precedence rules can only be implemented
 * once:
 *
 *  · duplicates COLLAPSE into one entry, each source recorded separately,
 *  · any Gilded source upgrades the entry for everyone,
 *  · losing the Gilded source downgrades it — which falls out of the rebuild starting from an empty list.
 */
export function grantEquipment(run: RunState, source: BoardCard, def: EquipmentDefinition): GrantedEquipment {
  const e = ensure(run);
  const version: 'plain' | 'gilded' = source.golden ? 'gilded' : 'plain';
  const existing = e.available.find((g) => g.equipmentId === def.id);
  if (existing) {
    if (!existing.sourceUids.includes(source.uid)) existing.sourceUids.push(source.uid);
    // A single Gilded source upgrades the shared entry; a plain one never downgrades it mid-turn.
    if (version === 'gilded') existing.version = 'gilded';
    return existing;
  }
  const granted: GrantedEquipment = {
    equipmentId: def.id,
    version,
    sourceUids: [source.uid],
    grantedTurn: run.wave,
  };
  e.available.push(granted);
  // "Select it automatically if the player had no active Equipment" — never steal a live selection.
  if (!e.selectedEquipmentId) e.selectedEquipmentId = def.id;
  return granted;
}

/**
 * Does the player ALREADY hold this Equipment?
 *
 * The gate on the equip cue (owner ruling 2026-08-28): *"we need to add logic to only play the equip
 * animation and sfx if a new equipment is actually equipped… if i have an alchemist frank on the board and i
 * play another, it should not play that animation, as i have not equipped new equipment."*
 *
 * Keyed on the Equipment ID, not on the version, because the owner's reason covers both: *"if i have a gilded
 * alchemist frank and i play a non gilded alchemist frank, that would also NOT play the sound, because it is
 * not equipping new equipment."* By that reasoning a plain → Gilded UPGRADE is also not new Equipment — the
 * same Bloodpot, improved — so it is silent too. The grant still happens either way; only the announcement is
 * gated, and `grantEquipment` is untouched.
 *
 * Deliberately a predicate on run state rather than a flag returned from the grant: any future granter (a
 * spell, a rune, a hero power) gets the same rule for free by asking before it grants.
 */
export function holdsEquipment(run: Pick<RunState, 'equipment'>, equipmentId: string): boolean {
  return equipmentState(run).available.some((g) => g.equipmentId === equipmentId);
}

/** One source body that re-equipped, for the UI's per-source cue. */
export interface ReequipCue { uid: string; cardId: string; equipmentId: string }

/**
 * START OF TURN — the rebuild. Called FIRST, before any other Start-of-Turn work (handoff), because a
 * Start-of-Turn effect that reads or spends Equipment must see this turn's collection, not last turn's.
 *
 * There are no Start-of-Turn priority LAYERS in this engine — it is an imperative sequence — so "first" is
 * positional, and a test pins that position rather than trusting the comment.
 *
 * Returns one cue per EQUIPMENT, in board order, attributed to its LEFT-MOST source.
 *
 * Per EQUIPMENT, not per source body — owner ruling 2026-08-28, overriding the handoff's "play an individual
 * re-equip beat for every Equip minion": "if i have 2 alchemist franks on board, only 1 of them re-equips the
 * blood pot, not both of them." Duplicates already collapse into one selector entry, so one animation is what
 * the player is actually being told about; five Franks firing five identical bursts read as a bug, not as
 * information.
 */
export function rebuildEquipment(run: RunState): ReequipCue[] {
  const lastUsed = equipmentState(run).lastUsedEquipmentId;
  // A fresh collection every turn, and the allowance back to baseline. Bonus activations and cost reductions
  // are per-turn by definition, so they reset here as well as at End of Turn — whichever runs first.
  run.equipment = {
    available: [],
    baseActivations: BASE_EQUIPMENT_ACTIVATIONS,
    bonusActivations: 0,
    activationsSpent: 0,
    temporaryCostReduction: 0,
    ...(lastUsed ? { lastUsedEquipmentId: lastUsed } : {}),
  };
  const cues: ReequipCue[] = [];
  const cued = new Set<string>();
  // LEFT TO RIGHT: board order decides the fallback selection, so the scan order IS a rule, not an accident.
  // EVERY source still re-equips (that is what keeps duplicate/Gilded precedence working) — only the CUE is
  // deduplicated, and it is attributed to the left-most source, which is the one board order already favours.
  for (const card of run.board) {
    const def = equipmentOf(CARD_INDEX[card.cardId]);
    if (!def) continue;
    grantEquipment(run, card, def);
    if (cued.has(def.id)) continue;
    cued.add(def.id);
    cues.push({ uid: card.uid, cardId: card.cardId, equipmentId: def.id });
  }
  const e = run.equipment;
  // DEFAULT SELECTION: the last-used Equipment when a valid source survived, else the left-most — which is
  // already `available[0]`, because the scan above ran in board order.
  e.selectedEquipmentId = lastUsed && e.available.some((g) => g.equipmentId === lastUsed)
    ? lastUsed
    : e.available[0]?.equipmentId;
  return cues;
}

/** END OF TURN — unused allowances and temporary reductions expire. The collection itself is left alone: it
 *  is cleared by the next rebuild, which is also what keeps it readable through combat. */
export function expireEquipmentTurn(run: RunState): void {
  if (!run.equipment) return;
  run.equipment.bonusActivations = 0;
  run.equipment.activationsSpent = 0;
  run.equipment.temporaryCostReduction = 0;
}

/** Swap what the slot shows. Free by contract: no Gold, no activation, no cooldown change. */
export function selectEquipment(run: RunState, equipmentId: string): boolean {
  const e = ensure(run);
  if (!e.available.some((g) => g.equipmentId === equipmentId)) return false;
  e.selectedEquipmentId = equipmentId;
  return true;
}

/** The Equipment entry the slot is showing, if any. */
export function selectedEquipment(run: Pick<RunState, 'equipment'>): GrantedEquipment | undefined {
  const e = equipmentState(run);
  return e.available.find((g) => g.equipmentId === e.selectedEquipmentId);
}

/** Its definition, for callers that want cost / text / target mode. */
export function selectedEquipmentDef(run: Pick<RunState, 'equipment'>): EquipmentDefinition | undefined {
  const g = selectedEquipment(run);
  return g ? EQUIPMENT_INDEX[g.equipmentId] : undefined;
}
