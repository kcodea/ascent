import type { CombatEvent } from '@game/core';
import { badgeIdForCombatFlag } from '@game/content';

/**
 * Which quest/rune combat triggers have fired so far this replay, as a per-badge-id count — the signal the
 * rune-badge burst (`runeTriggerFx.ts`) and the badge bounce both key on.
 *
 * Extracted from `useCombatReplay`'s inline memo so the STALE-RENDER guard can be tested without rendering the
 * whole hook (owner report 2026-08-19: a rune-burst fired for every trigger at the instant combat started).
 *
 * `beatIdxIsStale` is the whole point. When a new fight's event log replaces the previous one, one render runs
 * with the PREVIOUS fight's `beatIdx` before the reset effect zeroes it (see the `processedEnd` note in the
 * hook). On that render `processedEnd` falls back to `events.length`, so without this guard the function would
 * report the WHOLE new fight's trigger set at once — and the burst, unlike the self-correcting badge bounce,
 * cannot be un-fired. While stale, it returns empty; the real per-trigger progression then plays from 0 as the
 * replay advances.
 */
export function triggerCounts(
  events: readonly CombatEvent[],
  processedEnd: number,
  beatIdxIsStale: boolean,
): Record<string, number> {
  const counts: Record<string, number> = {};
  if (beatIdxIsStale || processedEnd <= 0) return counts;
  const curStep = events[processedEnd - 1]?.step ?? Infinity;
  for (const e of events) {
    if (e.type !== 'questTrigger' || e.side !== 'player' || (e.step ?? 0) > curStep) continue;
    const id = badgeIdForCombatFlag(e.flag);
    if (id) counts[id] = (counts[id] ?? 0) + 1; // how many times it has fired so far — a fresh one-shot pulse per bump
  }
  return counts;
}
