import type { CombatEvent } from '@game/core';
import { badgeIdForCombatFlag } from '@game/content';
import type { RuneCombatProgress } from '@game/sim';

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

/**
 * A side's RUNE PROGRESS so far this replay (R-RUNE-LIVE-TEXT-01): its `questTrigger` count per combat FLAG and its
 * friendly deaths (the engine's own Avenge count, the side's `friendlyDeath` quest events), up to the replayed step.
 * What a self-improving rune's live text advances by mid-fight (`runeLiveStateInCombat`).
 *
 * Keyed by FLAG, not by badge id: `badgeIdForCombatFlag` only resolves flags armed by BASIC runes and quests, so an
 * Epic rune (the Wild Hunt among them) would always read 0 through the badge counts. Same stale guard as above.
 */
export function runeProgress(
  events: readonly CombatEvent[],
  processedEnd: number,
  beatIdxIsStale: boolean,
  side: 'player' | 'enemy',
  questEvents: readonly { step: number; kind: string }[] | undefined,
): RuneCombatProgress | null {
  if (beatIdxIsStale || processedEnd <= 0) return null;
  const curStep = events[processedEnd - 1]?.step ?? Infinity;
  const triggers: Record<string, number> = {};
  for (const e of events) {
    if (e.type !== 'questTrigger' || e.side !== side || (e.step ?? 0) > curStep) continue;
    triggers[e.flag] = (triggers[e.flag] ?? 0) + 1;
  }
  let deaths = 0;
  for (const q of questEvents ?? []) if (q.kind === 'friendlyDeath' && q.step <= curStep) deaths += 1;
  return { triggers, deaths };
}

/** A stable signature of a progress fold, so a per-beat memo only changes identity when a rune actually moved. */
export function runeProgressKey(p: RuneCombatProgress | null): string {
  return p ? `${p.deaths}|${Object.entries(p.triggers).sort().map(([k, v]) => `${k}:${v}`).join(',')}` : '';
}
