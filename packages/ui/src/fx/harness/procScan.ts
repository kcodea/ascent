import type { CombatEvent, CombatResult } from '@game/core';
import { bindingFor } from '../../choreo/bindings';
import type { MomentKind } from '../../choreo/kinds';
import { replayBeats } from '../../choreo/replayOrder';

/**
 * Which moments in a fought combat a given card caused — the list the proc harness offers you to replay.
 *
 * Pure and React-free on purpose: it is the piece worth testing, and it works on any `CombatResult`,
 * including a fixture. `replayBeats` is documented as pure and cheap, so calling it here rather than
 * reaching into the replay hook's memo costs nothing and keeps this module standalone.
 */
export interface ProcMoment {
  /**
   * Index into the REPLAY's compiled moments array — exactly what `seekTo` takes.
   *
   * Built from `replayBeats(combat.events)`, NOT a locally-composed `compileMoments(replayOrder(...))`:
   * `useCombatReplay` walks `replayBeats` too, so the two call sites share ONE definition of the composition
   * (ordering transforms, then grouping) rather than duplicating it. Duplicating it is exactly what let the
   * original bug happen — the two sides were separately correct and jointly wrong. Compiling from the raw
   * log, or from a differently-composed pairing, would produce indices into a DIFFERENT moment list than the
   * one `seekTo` addresses — a seek that looks right would silently land on an unrelated beat.
   */
  index: number;
  kind: MomentKind;
  /** The acting unit — for the row label, and to disambiguate two copies of the same card. */
  sourceUid: string;
  /** What `bindingFor` says would play here, or null when nothing is bound. */
  boundDef: string | null;
}

/**
 * Every uid this card ever occupied in this fight.
 *
 * Reads BOTH starting rosters and every `summon` event — the same two sources `useCombatReplay` folds to
 * build its uid→cardId map, just inverted. Missing the summon half would silently drop every moment caused
 * by a token, which is a large share of what the harness is for.
 */
export function uidsForCard(combat: CombatResult, cardId: string): Set<string> {
  const out = new Set<string>();
  for (const u of [...combat.initial.player, ...combat.initial.enemy]) {
    if (u.cardId === cardId) out.add(u.uid);
  }
  for (const e of combat.events) {
    if (e.type === 'summon' && e.minion.cardId === cardId) out.add(e.minion.uid);
  }
  return out;
}

/**
 * The unit that ACTED in this event, or null when the event names none.
 *
 * `attack` names its pair differently (attacker/defender) and the attacker is the actor. Everything else
 * carries at most a `source`. A `dmg` deliberately returns null: it names only the unit that was HIT, so
 * attributing it would credit the moment to the victim — and a run of damage collapses into its own moment
 * anyway, whose cast is what the harness wants you to seek to.
 */
export function actingUid(e: CombatEvent): string | null {
  if (e.type === 'attack') return e.attacker;
  return 'source' in e && typeof e.source === 'string' ? e.source : null;
}

/**
 * The card's moments, in replay order. Empty (never throwing) when the card never acted.
 *
 * Calls `replayBeats(combat.events)` — the SAME definition `useCombatReplay` walks — so an `index` handed
 * back here addresses the same moment `seekTo` would show, not a moment from a differently-composed or
 * differently-ordered compilation.
 */
export function scanProcs(combat: CombatResult, cardId: string): ProcMoment[] {
  const uids = uidsForCard(combat, cardId);
  if (uids.size === 0) return [];
  const out: ProcMoment[] = [];
  const moments = replayBeats(combat.events);
  for (let i = 0; i < moments.length; i++) {
    const m = moments[i];
    const actor = actingUid(m.primary);
    if (actor === null || !uids.has(actor)) continue;
    out.push({
      index: i,
      kind: m.kind,
      sourceUid: actor,
      boundDef: bindingFor(cardId, m.kind)?.def ?? null,
    });
  }
  return out;
}
