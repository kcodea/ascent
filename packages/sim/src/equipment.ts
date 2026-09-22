import { CALIBRATION_WRENCH, CARD_INDEX, EQUIPMENT_INDEX, STAR_DESTROYER, equipmentOf, type EquipmentDefinition } from '@game/content';
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
 *  3. **Every Equipment has its OWN charge per turn, plus ONE shared bonus pool** (owner ruling 2026-09-11,
 *     replacing the original single shared allowance). Holding Bloodpot and Titan Hammer means each can be
 *     activated once per turn on its own charge. Bonus charges (Equipment Charger's Start-of-Turn grant,
 *     gilded = 2, any future source) are ADDITIVE into one shared pool that any Equipment may draw from — and
 *     the pool is spent FIRST, so an activation touches an Equipment's own charge only once the pool is empty.
 *     What an Equipment DISPLAYS is its own remaining charge + the pool (`equipmentChargesOf`), rendered
 *     green while the pool is above zero. Swapping spends nothing. Nothing carries across turns: the rebuild
 *     starts every own charge fresh and zeroes the pool.
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

/** The baseline: every Equipment gets ONE own activation per turn. */
export const BASE_EQUIPMENT_ACTIVATIONS = 1;

const EMPTY: PlayerEquipmentState = {
  available: [],
  bonusActivations: 0,
  bonusSpent: 0,
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

/** The SHARED bonus pool still unspent this turn. DERIVED, never stored: the handoff's "available uses should
 *  be derived rather than duplicated across several flags". */
export function equipmentPool(run: Pick<RunState, 'equipment'>): number {
  const e = equipmentState(run);
  return Math.max(0, e.bonusActivations - e.bonusSpent);
}

/** One Equipment's OWN remaining charge this turn (1 or 0). An Equipment the player does not hold has none. */
export function equipmentOwnChargeOf(run: Pick<RunState, 'equipment'>, equipmentId: string): number {
  const g = equipmentState(run).available.find((x) => x.equipmentId === equipmentId);
  return g && !g.ownChargeSpent ? BASE_EQUIPMENT_ACTIVATIONS : 0;
}

/** What one Equipment can fire RIGHT NOW — and the number its slot prints: its own remaining charge + the
 *  shared pool (owner ruling 2026-09-11, point 3). With one bonus charge every held Equipment reads 2. */
export function equipmentChargesOf(run: Pick<RunState, 'equipment'>, equipmentId: string): number {
  return equipmentOwnChargeOf(run, equipmentId) + equipmentPool(run);
}

/** The SELECTED Equipment's charges — what the slot's button and tally are about. Kept under its original
 *  name so every reader of "can the slot fire?" (StatusBar readiness, the empty cue, tests) keeps its
 *  meaning across the per-item-charge change. Zero with nothing selected. */
export function equipmentUsesLeft(run: Pick<RunState, 'equipment'>): number {
  const id = equipmentState(run).selectedEquipmentId;
  return id ? equipmentChargesOf(run, id) : 0;
}

/**
 * SPEND one charge for an activation of `equipmentId` — the pool FIRST, the Equipment's own charge only once
 * the pool is empty (owner ruling 2026-09-11, point 4). So with a pool of 1, using Bloodpot drops EVERY
 * Equipment from a green 2 to a plain 1, and Bloodpot can still fire once more on its own charge. Returns
 * false, changing nothing, when there is nothing left to spend — the reducer refuses on that.
 */
export function spendEquipmentCharge(run: RunState, equipmentId: string): boolean {
  const e = ensure(run);
  const g = e.available.find((x) => x.equipmentId === equipmentId);
  if (e.bonusActivations - e.bonusSpent > 0) { e.bonusSpent += 1; if (g) g.usedThisTurn = true; return true; }
  if (!g || g.ownChargeSpent) return false;
  g.ownChargeSpent = true;
  g.usedThisTurn = true; // Rune of Amplification: this Equipment WAS activated this turn
  return true;
}

// ── AMPLIFIED (owner design 2026-09-16; set 3 batch 2, tranche C) ───────────────────────────────────────
// "Equipment you do not activate becomes Amplified. Amplified Equipment triggers twice the next time you
// activate it. Maximum 1 per Equipment." One stack per Equipment id, kept on `PlayerEquipmentState.amplified`
// so it SURVIVES the Start-of-Turn rebuild (it is the one piece of Equipment state that is meant to carry).

/** The cap: one stack per Equipment. */
export const EQUIPMENT_AMPLIFY_MAX = 1;

/** How many Amplified stacks this Equipment holds (0 or 1). The UI paints the charge indicator BLUE while > 0. */
export function equipmentAmplifiedOf(run: Pick<RunState, 'equipment'>, equipmentId: string): number {
  return equipmentState(run).amplified?.[equipmentId] ?? 0;
}

/** Add one Amplified stack to a HELD Equipment, capped at `EQUIPMENT_AMPLIFY_MAX`. Returns true when a stack was
 *  actually added (an Equipment already at the cap, or one not held, changes nothing). */
export function amplifyEquipment(run: RunState, equipmentId: string): boolean {
  const e = ensure(run);
  if (!e.available.some((g) => g.equipmentId === equipmentId)) return false;
  const cur = e.amplified?.[equipmentId] ?? 0;
  if (cur >= EQUIPMENT_AMPLIFY_MAX) return false;
  e.amplified = { ...(e.amplified ?? {}), [equipmentId]: cur + 1 };
  return true;
}

/** Rune of the Grand Workshop: Amplify EVERY held Equipment. Returns the ids that gained a stack. */
export function amplifyAllHeld(run: RunState): string[] {
  return equipmentState(run).available.map((g) => g.equipmentId).filter((id) => amplifyEquipment(run, id));
}

/** Rune of Amplification (End of Turn): every held Equipment NOT activated this turn gains a stack. Returns the
 *  ids that gained one. Read before `expireEquipmentTurn` clears the per-turn `usedThisTurn` marks. */
export function amplifyUnactivated(run: RunState): string[] {
  return equipmentState(run).available.filter((g) => !g.usedThisTurn).map((g) => g.equipmentId).filter((id) => amplifyEquipment(run, id));
}

/** CONSUME the Amplified stack for an activation of `equipmentId`. Returns true when one was spent — the caller
 *  doubles the trigger count for THIS activation. */
export function consumeAmplified(run: RunState, equipmentId: string): boolean {
  const e = ensure(run);
  const cur = e.amplified?.[equipmentId] ?? 0;
  if (cur <= 0) return false;
  const next = { ...e.amplified };
  if (cur - 1 > 0) next[equipmentId] = cur - 1; else delete next[equipmentId];
  e.amplified = next;
  return true;
}

// ── CALIBRATION WRENCH (set 3 Neutrals, owner handoff 2026-09-18) ────────────────────────────────────────
// "Your next Equipment activation is Amplified." The per-id stack above cannot say "whatever you press next", so
// the Wrench banks a COUNT on the same state and the activation spends it beside the per-id stack.

/** Upcoming activations the Wrench has Amplified (any Equipment but the Wrench itself). */
export function calibrationPendingOf(run: Pick<RunState, 'equipment'>): number {
  return equipmentState(run).calibrationPending ?? 0;
}

/** The Wrench fired: bank `count` more Amplified activations (a gilded Master's Wrench banks two per trigger). */
export function armCalibration(run: RunState, count: number): void {
  if (count <= 0) return;
  const e = ensure(run);
  e.calibrationPending = (e.calibrationPending ?? 0) + count;
}

/** SPEND one pending Calibration for an activation of `equipmentId`. The Wrench never Amplifies itself; nothing
 *  pending → false. The caller doubles the trigger count for THIS activation, exactly as for `consumeAmplified`. */
export function consumeCalibration(run: RunState, equipmentId: string): boolean {
  if (equipmentId === CALIBRATION_WRENCH.id) return false;
  const e = ensure(run);
  const cur = e.calibrationPending ?? 0;
  if (cur <= 0) return false;
  if (cur - 1 > 0) e.calibrationPending = cur - 1; else delete e.calibrationPending;
  return true;
}

/** RUNE OF EMPTY HANDS (owner 2026-09-18): is `equipmentId` PERMANENTLY Amplified — granted by a card the rune's
 *  Discover picked (`equipmentAmplifiedCards`, by CARD like the free list, so a sold-and-rebought copy keeps it)?
 *  Every activation triggers twice and nothing is ever spent. */
export function equipmentPermanentlyAmplified(run: Pick<RunState, 'equipment' | 'equipmentAmplifiedCards'>, equipmentId: string): boolean {
  const amp = run.equipmentAmplifiedCards;
  if (!amp?.length) return false;
  const g = equipmentState(run).available.find((x) => x.equipmentId === equipmentId);
  return !!g?.sourceCardIds?.some((c) => amp.includes(c));
}

/** Will an activation of `equipmentId` RIGHT NOW resolve Amplified — its own stack, Empty Hands' permanent
 *  Amplification, or a pending Calibration it can spend? The slot paints the charge indicator BLUE
 *  (`data-fx="equipment-amplified"`) off this, so the Wrench's pending charge shows on every held Equipment it
 *  would apply to, never on the Wrench itself. */
export function equipmentWillAmplify(run: Pick<RunState, 'equipment' | 'equipmentAmplifiedCards'>, equipmentId: string): boolean {
  if (equipmentAmplifiedOf(run, equipmentId) > 0) return true;
  if (equipmentPermanentlyAmplified(run, equipmentId)) return true;
  return equipmentId !== CALIBRATION_WRENCH.id && calibrationPendingOf(run) > 0;
}

/** SHREDDER (set 3 Neutrals, 2026-09-18): how many held Equipment have NOT been activated this turn — the same
 *  per-turn `usedThisTurn` mark Rune of Amplification reads. Meaningful only BEFORE `expireEquipmentTurn` clears
 *  the marks; the End-of-Turn pass runs first, so Shredder sees the turn as it was played. */
export function unusedEquipmentCount(run: Pick<RunState, 'equipment'>): number {
  return equipmentState(run).available.filter((g) => !g.usedThisTurn).length;
}

/** The run fields the price reads — the same helper the rail prints, so a rune discount is what the slot shows. */
export type EquipmentCostRun = Pick<RunState,
  'equipment' | 'runeEfficientTooling' | 'equipmentActivationsThisTurn' | 'quickReleaseArmed' | 'runeOvercharge'
  | 'equipmentFreeCards' | 'equipmentFreeThisTurn'>;

/** Is `equipmentId` priced at 0 by a run-long rune right now? Rune of Empty Hands (by the granting CARD — sold and
 *  re-bought included) or Rune of the Last Tool (the Echo banked it free for this turn). */
export function equipmentIsFree(run: EquipmentCostRun, equipmentId: string): boolean {
  if (run.equipmentFreeThisTurn?.includes(equipmentId)) return true;
  const free = run.equipmentFreeCards;
  if (!free?.length) return false;
  const g = equipmentState(run).available.find((x) => x.equipmentId === equipmentId);
  return !!g?.sourceCardIds?.some((c) => free.includes(c));
}

/** Rune of Quick Release: does the arm apply to an activation of `equipmentId` right now? Never to the sold
 *  minion's OWN Equipment (owner 2026-09-18: "doesn't discount its own Equipment") — that one neither uses nor
 *  spends the arm. */
export function quickReleaseApplies(run: Pick<RunState, 'quickReleaseArmed'>, equipmentId: string): boolean {
  const arm = run.quickReleaseArmed;
  return !!arm && arm.excludeEquipmentId !== equipmentId;
}

/** Rune of Overcharge: is the NEXT activation one of this turn's free, charge-less ones? */
export function overchargeFree(run: Pick<RunState, 'runeOvercharge' | 'equipmentActivationsThisTurn'>): boolean {
  return (run.runeOvercharge ?? 0) > (run.equipmentActivationsThisTurn ?? 0);
}

/** What this Equipment costs RIGHT NOW: base minus every stacked reduction, floored at 0 — the temporary
 *  reduction, then the tranche-B rune prices (Set 3 batch 2, 2026-09-16): Efficient Tooling's first-activation
 *  discount, Quick Release's armed 0, Overcharge's free first activation, Empty Hands / the Last Tool's 0. */
export function equipmentCostOf(run: EquipmentCostRun, def: EquipmentDefinition): number {
  let cost = def.baseCost - equipmentState(run).temporaryCostReduction;
  if ((run.equipmentActivationsThisTurn ?? 0) === 0 && run.runeEfficientTooling) cost -= run.runeEfficientTooling;
  if (quickReleaseApplies(run, def.id) || overchargeFree(run) || equipmentIsFree(run, def.id)) cost = 0;
  return Math.max(0, cost);
}

/** The params one TRIGGER resolves with — the Gilded set when this entry's version is gilded. */
export function equipmentParams(
  def: EquipmentDefinition,
  version: 'plain' | 'gilded',
): Record<string, number | string> {
  return (version === 'gilded' ? def.gildedParams ?? def.params : def.params) ?? {};
}

/** The wording to print for a version, so text and behaviour read off the same switch.
 *
 *  `amplified` (owner 2026-09-22): while the Equipment will fire twice, a clock-window rule prints the window it
 *  will actually open — an Amplified Thymepiece reads "for the next **16 seconds**" (CLAUDE.md: card text shows
 *  the CURRENT value, never the base rate alone). Only a `**N seconds**` span is touched; every other Equipment
 *  expresses "twice" through what it does, not a printed number. */
export function equipmentText(def: EquipmentDefinition, version: 'plain' | 'gilded', opts?: { amplified?: boolean }): string {
  const text = version === 'gilded' ? def.goldenText ?? def.text : def.text;
  if (!opts?.amplified) return text;
  return text.replace(/\*\*(\d+) seconds\*\*/g, (_m, n: string) => `**${Number(n) * 2} seconds**`);
}

/** Is this Equipment still backed by a body on the board? Sources are tracked per-uid, so a duplicate keeps
 *  the entry alive when one copy dies. Read by the REBUILD, never within a turn — inside a turn a grant
 *  deliberately outlives its source. */
export function equipmentSourceAlive(run: Pick<RunState, 'board' | 'shop'>, g: GrantedEquipment): boolean {
  if (g.sourceKind === 'starform') return run.shop.some((o) => o.starform && g.sourceUids.includes(o.uid));
  return g.sourceUids.some((uid) => run.board.some((c) => c.uid === uid));
}

/**
 * STAR DESTROYER (owner rule C, 2026-09-13) — the one Equipment whose source is the STARFORM OFFER, not a board
 * minion. Held exactly while a Starform exists: called from every path that creates or removes the token
 * (`createStarform`, `removeStarform`, a Demon's Shop consume, the Destroyer's own exit), from the Start-of-Turn
 * rebuild, and as a tripwire at the action boundary in `reduce`. Idempotent: grants when a token is out and the
 * entry is missing, revokes when the token is gone and the entry lingers, re-points `sourceUids` at a NEW token.
 * A revoke that was showing in the slot hands the selection to the left-most surviving entry. Never gilded.
 */
export function syncStarDestroyer(run: RunState): void {
  const sf = run.shop.find((o) => o.starform);
  const e = equipmentState(run);
  const held = e.available.find((g) => g.equipmentId === STAR_DESTROYER.id);
  if (sf) {
    if (held) { if (!held.sourceUids.includes(sf.uid)) held.sourceUids = [sf.uid]; return; }
    const m = ensure(run);
    m.available.push({ equipmentId: STAR_DESTROYER.id, version: 'plain', sourceKind: 'starform', sourceUids: [sf.uid], grantedTurn: run.wave, ownChargeSpent: false });
    if (!m.selectedEquipmentId) m.selectedEquipmentId = STAR_DESTROYER.id;
    return;
  }
  if (!held || !run.equipment) return;
  run.equipment.available = run.equipment.available.filter((g) => g !== held);
  if (run.equipment.selectedEquipmentId === STAR_DESTROYER.id) run.equipment.selectedEquipmentId = run.equipment.available[0]?.equipmentId;
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
    if (!(existing.sourceCardIds ??= []).includes(source.cardId)) existing.sourceCardIds.push(source.cardId);
    // A single Gilded source upgrades the shared entry; a plain one never downgrades it mid-turn.
    if (version === 'gilded') existing.version = 'gilded';
    return existing;
  }
  const granted: GrantedEquipment = {
    equipmentId: def.id,
    version,
    sourceUids: [source.uid],
    sourceCardIds: [source.cardId],
    grantedTurn: run.wave,
    ownChargeSpent: false, // a freshly granted Equipment arrives with its own charge ready
  };
  e.available.push(granted);
  // "Select it automatically if the player had no active Equipment" — never steal a live selection.
  if (!e.selectedEquipmentId) e.selectedEquipmentId = def.id;
  return granted;
}

/**
 * Is this grant WORTH ANNOUNCING — i.e. does the player end up holding something they did not have?
 *
 * The gate on the equip cue. Two owner rulings, in order:
 *
 * 2026-08-28: *"only play the equip animation and sfx if a new equipment is actually equipped… if i have an
 * alchemist frank on the board and i play another, it should not play that animation."* Plus: *"if i have a
 * gilded alchemist frank and i play a non gilded alchemist frank, that would also NOT play the sound."*
 *
 * 2026-08-29, deciding the case the first ruling left open: *"if you gild an equip card with the basic
 * version of that equipment, then playing the GILDED version and equipping the GILDED version of the
 * equipment should re-play the equip animation and sfx etc, since that it is a 'new' equipment being added.
 * it still takes the place of the non-gilded version in your equipment, but there should be player feedback
 * for the interaction."*
 *
 * So the rule is not "is this id new" — it is **does what you hold change**:
 *
 *   · id not held            → new Equipment            → ANNOUNCE
 *   · held, incoming plain   → nothing changes           → silent
 *   · held plain, incoming GILDED → the entry upgrades   → ANNOUNCE
 *   · held gilded, incoming gilded → already at the top  → silent
 *
 * The upgrade case is the interesting one and it is exactly what the shape here has to express: a Gilded
 * source really does replace what sits in the slot, so it is a change the player made and should see, even
 * though the Equipment's NAME is unchanged.
 *
 * A predicate on run state rather than a flag returned from the grant, so any future granter (a spell, a
 * rune, a hero power) inherits the rule by asking before it grants. `grantEquipment` is untouched either
 * way — only the announcement is gated, never the grant.
 */
export function equipIsNews(
  run: Pick<RunState, 'equipment'>,
  equipmentId: string,
  incomingGolden: boolean,
): boolean {
  const held = equipmentState(run).available.find((g) => g.equipmentId === equipmentId);
  if (!held) return true;                                   // a genuinely new Equipment
  return incomingGolden && held.version !== 'gilded';        // …or the upgrade to Gilded
}

/** Does the player hold this Equipment at all, in any version? Kept for callers that want membership rather
 *  than the announcement rule above. */
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
  const amplified = equipmentState(run).amplified; // Amplified stacks CARRY across the rebuild (pruned below)
  const calibration = equipmentState(run).calibrationPending; // …and so does the Wrench's pending count (it IS Amplification)
  // A fresh collection every turn — every re-granted entry arrives with its own charge unspent — and the
  // shared pool back to zero. Bonus charges and cost reductions are per-turn by definition, so they reset
  // here as well as at End of Turn — whichever runs first.
  run.equipment = {
    available: [],
    bonusActivations: 0,
    bonusSpent: 0,
    temporaryCostReduction: 0,
    ...(lastUsed ? { lastUsedEquipmentId: lastUsed } : {}),
    ...(calibration ? { calibrationPending: calibration } : {}),
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
  // The Starform's own Equipment rides the token, not a body: re-granted here when the token survived the turn.
  syncStarDestroyer(run);
  const e = run.equipment;
  // Amplified stacks survive the turn boundary for every Equipment the player STILL holds; a stack on an
  // Equipment whose every source left the board goes with it.
  if (amplified) {
    const kept: Record<string, number> = {};
    for (const g of e.available) if ((amplified[g.equipmentId] ?? 0) > 0) kept[g.equipmentId] = Math.min(EQUIPMENT_AMPLIFY_MAX, amplified[g.equipmentId]!);
    if (Object.keys(kept).length > 0) e.amplified = kept;
  }
  // DEFAULT SELECTION: the last-used Equipment when a valid source survived, else the left-most — which is
  // already `available[0]`, because the scan above ran in board order.
  e.selectedEquipmentId = lastUsed && e.available.some((g) => g.equipmentId === lastUsed)
    ? lastUsed
    : e.available[0]?.equipmentId;
  return cues;
}

/** END OF TURN — the unused pool, spent own charges and temporary reductions expire. The collection itself is
 *  left alone: it is cleared by the next rebuild, which is also what keeps it readable through combat. */
export function expireEquipmentTurn(run: RunState): void {
  if (!run.equipment) return;
  run.equipment.bonusActivations = 0;
  run.equipment.bonusSpent = 0;
  run.equipment.temporaryCostReduction = 0;
  for (const g of run.equipment.available) { g.ownChargeSpent = false; g.usedThisTurn = false; }
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
