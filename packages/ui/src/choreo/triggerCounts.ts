import type { CombatEvent } from '@game/core';
import { badgeIdsForCombatFlag } from '@game/content';
import { isAncientProcFlag, type RuneCombatProgress } from '@game/sim';
import { eventsOfType } from './prefixFold';

/** The reserved `triggerCounts` key the side's ANCIENT proc count rides under (R-FX-ANCIENT-PROC-01): the hero-power
 *  button's rune-trigger burst reads it. Not a content id, so no badge ever matches it. */
export const ANCIENT_PROC_KEY = '__ancientProc';

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
  side: 'player' | 'enemy' = 'player',
): Record<string, number> {
  const counts: Record<string, number> = {};
  if (beatIdxIsStale || processedEnd <= 0) return counts;
  const curStep = events[processedEnd - 1]?.step ?? Infinity;
  // By STEP, not by position (the replay reorders inside a step), so this is not a prefix of the log: it walks the
  // fight's trigger events only (`eventsOfType`, indexed once per log), never the whole log on every beat.
  for (const { e } of eventsOfType(events, 'questTrigger')) {
    if (e.side !== side || (e.step ?? 0) > curStep) continue;
    // Every badge the flag belongs to (Basic AND Epic runes, R-RUNE-COMBAT-FLASH-01): how many times it has fired so
    // far, a fresh one-shot pulse per bump.
    for (const id of badgeIdsForCombatFlag(e.flag)) counts[id] = (counts[id] ?? 0) + 1;
    // An Ancient fired (R-FX-ANCIENT-PROC-01): counted under the reserved key the hero-power button bursts on.
    if (isAncientProcFlag(e.flag)) counts[ANCIENT_PROC_KEY] = (counts[ANCIENT_PROC_KEY] ?? 0) + 1;
  }
  return counts;
}

/**
 * The FOE's rune-badge pulse counts, folded from its rune progress (`runeProgress(..., 'enemy', ...)`, which the store
 * already carries as `combatEnemyRuneProgress`): per badge id, how many of its flags' triggers have replayed so far.
 * The same counts `triggerCounts` gives the player's badges, so both sides bounce on the same beat (R-SYMMETRY-01).
 */
export function badgePulsesFromProgress(p: RuneCombatProgress | null): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!p) return counts;
  for (const [flag, n] of Object.entries(p.triggers)) {
    for (const id of badgeIdsForCombatFlag(flag)) counts[id] = (counts[id] ?? 0) + n;
  }
  return counts;
}

/**
 * A side's RUNE PROGRESS so far this replay (R-RUNE-LIVE-TEXT-01): its `questTrigger` count per combat FLAG and its
 * friendly deaths (the engine's own Avenge count, the side's `friendlyDeath` quest events), up to the replayed step.
 * What a self-improving rune's live text advances by mid-fight (`runeLiveStateInCombat`).
 *
 * Keyed by FLAG, not by badge id: the live-text helpers read a rune's own flag count. Same stale guard as above.
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
  for (const { e } of eventsOfType(events, 'questTrigger')) {
    if (e.side !== side || (e.step ?? 0) > curStep) continue;
    triggers[e.flag] = (triggers[e.flag] ?? 0) + 1;
  }
  let deaths = 0;
  for (const q of questEvents ?? []) if (q.kind === 'friendlyDeath' && q.step <= curStep) deaths += 1;
  // Rune of Sequencing: the last replayed sequence tick for this side (each carries the whole list).
  let sequence: string[] | undefined;
  for (const { e } of eventsOfType(events, 'runeSequence')) {
    if (e.side === side && (e.step ?? 0) <= curStep) sequence = e.seq;
  }
  // Wizened Gems: the last replayed count for this side (the silent Shop-spell marker carries it).
  let wizened: number | undefined;
  for (const { e } of eventsOfType(events, 'shopSpellTally')) {
    if (e.side === side && e.wizened !== undefined && (e.step ?? 0) <= curStep) wizened = e.wizened;
  }
  return { triggers, deaths, ...(sequence ? { sequence } : {}), ...(wizened !== undefined ? { wizened } : {}) };
}

/** A stable signature of a progress fold, so a per-beat memo only changes identity when a rune actually moved. */
export function runeProgressKey(p: RuneCombatProgress | null): string {
  return p ? `${p.deaths}|${Object.entries(p.triggers).sort().map(([k, v]) => `${k}:${v}`).join(',')}${p.sequence ? `|seq:${p.sequence.join(',')}` : ''}${p.wizened !== undefined ? `|wiz:${p.wizened}` : ''}` : '';
}
