/**
 * BEAT CHOREOGRAPHER PR 16 — a resolved combat → an inspectable timeline (read-only).
 *
 * The one composition that turns a fight into the shared timeline vocabulary, so it can be viewed alongside
 * End of Turn. It reuses `replayBeats` — the SAME `compileMoments(replayOrder(events))` the live combat
 * replay folds — rather than re-deriving the moment stream, because two definitions of "the moments of this
 * fight" is exactly how a preview would drift from what the player sees.
 *
 * This does not touch playback. Combat still runs on its own runtime; this only re-describes the result.
 */
import type { CombatEvent } from '@game/core';
import { CARD_INDEX, RUNE_INDEX, QUEST_INDEX } from '@game/content';
import { replayBeats, replayOrder } from '../choreo/replayOrder';
import { adaptCombatMoments } from './adapters/combatMomentAdapter';
import { compileTimeline } from './compileTimeline';
import { fightCardIds } from '../fightRoster';
import type { CompiledTimeline } from './timelineTypes';

/** The minimum shape of a resolved combat this needs — a subset of `CombatResult`. */
export interface ResolvedCombatLike {
  events: CombatEvent[];
  initial: { player: { uid: string; cardId: string }[]; enemy: { uid: string; cardId: string }[] };
}

/** uid → cardId across the whole fight (initial boards + everything summoned + a tag-team step-in). Mirrors `useCombatReplay`. */
function cardIdMap(combat: ResolvedCombatLike): Map<string, string> {
  return fightCardIds(combat); // initial boards + every summon + every Duos tagIn body (R-DUOS-FX-01)
}

/**
 * Adapt + compile a resolved combat into a `CompiledTimeline`. Pure and deterministic; returns null for an
 * empty fight so callers can skip publishing nothing.
 */
export function combatTimelineFrom(combat: ResolvedCombatLike | null | undefined): CompiledTimeline | null {
  if (!combat || combat.events.length === 0) return null;
  const moments = replayBeats(combat.events);
  if (moments.length === 0) return null;
  const cards = cardIdMap(combat);
  // The moments' event indices are into the ORDERED stream (`replayBeats` orders internally via
  // `replayOrder`), so the adapter must see that same order or a moment's consequences would point at the
  // wrong events.
  const ordered = replayOrder(combat.events);
  const input = adaptCombatMoments(moments, ordered, { cardIdOf: (uid) => cards.get(uid) ?? null });
  // DISPLAY NAMES (owner report 2026-08-13: "we need actual names and not the id_names"). The adapter labels
  // with ids because it cannot import content; this composition CAN, so it resolves every source to the name
  // the owner actually recognizes — card ids through CARD_INDEX, keyed rune/quest triggers through their own
  // indexes. Unresolvable ids (system tags, tokens from removed cards) keep the id: honest beats pretty.
  for (const node of input.nodes) {
    const src = node.source;
    const name = src.kind === 'rune' ? RUNE_INDEX[src.id]?.name
      : src.kind === 'quest' ? QUEST_INDEX[src.id]?.name
      : CARD_INDEX[src.id]?.name;
    if (name) src.label = name;
  }
  return compileTimeline(input);
}
